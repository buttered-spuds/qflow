import * as vscode from 'vscode';
import { relative, join } from 'path';
import type { RunnerService } from './runnerService';
import type { RunStore } from './runStore';
import { discoverTestsInDocument, discoverTestsInFile, type DiscoveredTest } from './testDiscovery';
import type { FlakinessStat } from './flakinessService';
import { computeFlakiness, flakinessIndex } from './flakinessService';

/**
 * Bridges qflow into the native VS Code Testing API. Test files appear in the
 * official Test Explorer pane, with native gutter icons, "Run" / "Debug" code
 * lenses, and the standard test results UI.
 */
export class QFlowTestController {
  private readonly controller: vscode.TestController;
  private readonly fileItems = new Map<string /* relPath */, vscode.TestItem>();
  /** Maps TestItem.id → fullName so runHandler can build the --grep without parsing the id. */
  private readonly testFullNames = new Map<string /* TestItem.id */, string /* fullName */>();
  private readonly listenerDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly runner: RunnerService,
    private readonly store: RunStore,
  ) {
    this.controller = vscode.tests.createTestController('qflow', 'qflow');

    this.controller.resolveHandler = async (item) => {
      if (!item) {
        await this.discoverAllFiles();
      } else if (item.uri) {
        await this.parseTestsInFile(item.uri);
      }
    };

    // Run profile — invokes the qflow CLI for the requested tests.
    this.controller.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.runHandler(request, token),
      true,
    );

    // Watch document changes to keep the tree fresh.
    this.listenerDisposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.isTestFile(e.document.uri)) {
          this.parseTestsInDocument(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.isTestFile(doc.uri)) {
          this.parseTestsInDocument(doc);
        }
      }),
    );
  }

  dispose(): void {
    for (const d of this.listenerDisposables) d.dispose();
    this.controller.dispose();
  }

  /** Refresh every test item with the latest run/flakiness data. */
  async refreshFromStore(): Promise<void> {
    const report = this.store.loadLatestReport();
    if (!report) return;

    // Ensure file items exist for every file in the report (lazy discovery may not have run yet).
    const root = this.store.getRoot();
    for (const t of report.tests) {
      const fileRel = t.file ? this.normalise(t.file) : undefined;
      if (!fileRel || this.fileItems.has(fileRel)) continue;
      if (root) {
        try { await this.parseTestsInFile(vscode.Uri.file(join(root, fileRel))); } catch { /* file may not exist */ }
      }
    }

    const flakies = flakinessIndex(
      computeFlakiness(this.store, this.flakinessWindow()),
    );

    // Track results into a fresh test run so VS Code shows native icons.
    const run = this.controller.createTestRun(
      new vscode.TestRunRequest(),
      `qflow ${report.id}`,
      false,
    );

    for (const t of report.tests) {
      const fileRel = t.file ? this.normalise(t.file) : undefined;
      if (!fileRel) continue;
      const fileItem = this.fileItems.get(fileRel);
      if (!fileItem) continue;

      // Find child item — match by the file-prefixed ID we created in applyDiscovered.
      let testItem: vscode.TestItem | undefined;
      fileItem.children.forEach((child) => {
        const childFullName = this.testFullNames.get(child.id);
        if (childFullName === t.fullName || child.label === t.name) testItem = child;
      });
      if (!testItem) continue;

      testItem.description = describeFlakiness(flakies.get(t.fullName));

      switch (t.status) {
        case 'passed':
          run.passed(testItem, t.duration);
          break;
        case 'failed':
          run.failed(testItem, new vscode.TestMessage(t.error ?? 'Failed'), t.duration);
          break;
        case 'skipped':
          run.skipped(testItem);
          break;
        case 'flaky':
          run.failed(testItem, new vscode.TestMessage(t.error ?? 'Flaky'), t.duration);
          break;
      }
    }
    run.end();
  }

  // ─── Discovery ───────────────────────────────────────────────────────────

  private async discoverAllFiles(): Promise<void> {
    const glob = this.testGlob();
    const uris = await vscode.workspace.findFiles(
      glob,
      '{**/node_modules/**,**/dist/**,**/.qflow/**}',
    );
    for (const uri of uris) {
      this.ensureFileItem(uri);
    }
  }

  private ensureFileItem(uri: vscode.Uri): vscode.TestItem {
    const rel = this.relPath(uri);
    let item = this.fileItems.get(rel);
    if (!item) {
      item = this.controller.createTestItem(rel, rel, uri);
      item.canResolveChildren = true;
      this.controller.items.add(item);
      this.fileItems.set(rel, item);
    }
    return item;
  }

  private async parseTestsInFile(uri: vscode.Uri): Promise<void> {
    const fileItem = this.ensureFileItem(uri);
    const rel = this.relPath(uri);
    const tests = await discoverTestsInFile(uri, rel);
    this.applyDiscovered(fileItem, tests);
  }

  private parseTestsInDocument(doc: vscode.TextDocument): void {
    const fileItem = this.ensureFileItem(doc.uri);
    const rel = this.relPath(doc.uri);
    const tests = discoverTestsInDocument(doc, rel);
    this.applyDiscovered(fileItem, tests);
  }

  private applyDiscovered(fileItem: vscode.TestItem, tests: DiscoveredTest[]): void {
    // Remove stale entries from the map before repopulating.
    fileItem.children.forEach((child) => this.testFullNames.delete(child.id));
    fileItem.children.replace(
      tests.map((t) => {
        // Prefix with the file id (relPath) so IDs are unique across files
        // even when different files contain identically-named tests.
        const id = `${fileItem.id}::${t.fullName}`;
        const child = this.controller.createTestItem(id, t.name, t.uri);
        child.range = new vscode.Range(t.line, t.character, t.line, t.character + t.name.length);
        this.testFullNames.set(id, t.fullName);
        return child;
      }),
    );
  }

  // ─── Run handler ─────────────────────────────────────────────────────────

  private async runHandler(
    request: vscode.TestRunRequest,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const include = request.include ?? [];
    if (include.length === 0) {
      // Run everything via the configured suite.
      const suite = vscode.workspace
        .getConfiguration('qflow')
        .get<string>('defaultSuite', 'regression');
      try {
        await this.runner.run(['run', '--suite', suite]);
      } catch {
        /* errors surface in output channel */
      }
      this.store.invalidate();
      await this.refreshFromStore();
      return;
    }

    // Build a `--grep` from the included test full names so that duplicate short
    // names across different describe blocks don't accidentally match the wrong tests.
    // If an included item is a parent (file-level), expand to its children.
    const names: string[] = [];
    for (const item of include) {
      const fullName = this.testFullNames.get(item.id);
      if (fullName) {
        names.push(fullName);
      } else {
        // Parent item (file or folder) — collect its discovered children.
        item.children.forEach((child) => {
          const childFullName = this.testFullNames.get(child.id);
          if (childFullName) names.push(childFullName);
        });
      }
    }

    if (names.length === 0) {
      // No resolvable test names — fall back to the default suite run.
      const suite = vscode.workspace
        .getConfiguration('qflow')
        .get<string>('defaultSuite', 'regression');
      try {
        await this.runner.run(['run', '--suite', suite]);
      } catch {
        /* errors surface in output channel */
      }
      this.store.invalidate();
      await this.refreshFromStore();
      return;
    }

    // If all selected items come from a single file, restrict with --file so only
    // that file is run (avoids running every spec file looking for the grep match).
    const fileSet = new Set<string>();
    for (const item of include) {
      // Test item ids are formatted as `fileRel::fullName`; file item ids are just `fileRel`.
      fileSet.add(item.id.includes('::') ? item.id.split('::')[0] : item.id);
    }

    const args: string[] = ['run'];
    if (fileSet.size === 1) args.push('--file', [...fileSet][0]);
    if (names.length > 0) args.push('--grep', names.map(escapeRegex).join('|'));

    try {
      await this.runner.run(args);
    } catch {
      /* errors surface in output channel */
    }
    this.store.invalidate();
    await this.refreshFromStore();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private isTestFile(uri: vscode.Uri): boolean {
    const path = uri.fsPath;
    return /\.(spec|test)\.[jt]sx?$/.test(path) ||
           /\.(spec|test)\.(mjs|cjs)$/.test(path);
  }

  private testGlob(): vscode.GlobPattern {
    return vscode.workspace
      .getConfiguration('qflow')
      .get<string>('testFileGlob', '**/*.{spec,test}.{ts,tsx,js,jsx,mjs,cjs}');
  }

  private flakinessWindow(): number {
    return vscode.workspace
      .getConfiguration('qflow')
      .get<number>('flakinessWindow', 20);
  }

  private relPath(uri: vscode.Uri): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return uri.fsPath;
    return relative(root, uri.fsPath).split('\\').join('/');
  }

  private normalise(p: string): string {
    return p.replace(/\\/g, '/');
  }
}

function describeFlakiness(stat: FlakinessStat | undefined): string {
  if (!stat || stat.flakinessPct === 0) return '';
  return `flaky ${stat.flakinessPct}% (${stat.failures}/${stat.totalRuns})`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
