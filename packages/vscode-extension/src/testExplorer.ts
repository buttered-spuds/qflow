import * as vscode from 'vscode';
import { relative } from 'path';
import type { RunStore } from './runStore';
import { discoverTestsInFile, type DiscoveredTest } from './testDiscovery';
import { computeFlakiness, flakinessIndex, type FlakinessStat } from './flakinessService';
import type { TestCase } from './types';

type NodeKind = 'empty' | 'file' | 'test';

export class TestTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: NodeKind,
    public readonly file?: { uri: vscode.Uri; relPath: string; tests: DiscoveredTest[] },
    public readonly test?: { discovered: DiscoveredTest; result?: TestCase; flaky?: FlakinessStat },
  ) {
    super(label, collapsibleState);

    if (kind === 'file' && file) {
      this.contextValue = 'qflow.file';
      this.resourceUri = file.uri;
      this.tooltip = file.relPath;
      this.iconPath = vscode.ThemeIcon.File;
    } else if (kind === 'test' && test) {
      this.contextValue = 'qflow.test';
      const r = test.result;
      const flaky = test.flaky;

      const bits: string[] = [];
      if (r) bits.push(`${r.duration}ms`);
      if (flaky && flaky.flakinessPct > 0) bits.push(`flaky ${flaky.flakinessPct}%`);
      this.description = bits.join(' · ');
      this.tooltip = r?.error ?? r?.status ?? 'not run yet';

      const status: TestCase['status'] | undefined = r?.status;
      switch (status) {
        case 'passed':
          this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
          break;
        case 'failed':
          this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
          break;
        case 'skipped':
          this.iconPath = new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('testing.iconSkipped'));
          break;
        case 'flaky':
          this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
          break;
        default:
          this.iconPath = new vscode.ThemeIcon('circle-outline');
      }

      // Click to open the test source
      this.command = {
        command: 'qflow.openTestSource',
        title: 'Open Test',
        arguments: [{
          uri: test.discovered.uri,
          line: test.discovered.line,
          character: test.discovered.character,
        }],
      };
    } else if (kind === 'empty') {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}

/**
 * Tree view of REAL test files in the workspace, decorated with the latest
 * run's status and rolling flakiness%. Files come from `findFiles(testGlob)`,
 * tests come from a regex scan, results & flakiness from RunStore.
 */
export class QFlowTestExplorer implements vscode.TreeDataProvider<TestTreeItem> {
  private readonly _onDidChange = new vscode.EventEmitter<TestTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TestTreeItem | undefined | void> = this._onDidChange.event;

  private filesCache: { uri: vscode.Uri; relPath: string; tests: DiscoveredTest[] }[] | null = null;
  /** Flakiness index recomputed once per refresh; cleared together with filesCache. */
  private flakinessCache: Map<string, FlakinessStat> | null = null;

  constructor(private readonly store: RunStore) {}

  refresh(): void {
    this.filesCache = null;
    this.flakinessCache = null;
    this._onDidChange.fire();
  }

  getTreeItem(element: TestTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TestTreeItem): Promise<TestTreeItem[]> {
    if (!element) {
      const files = await this.loadFiles();
      if (files.length === 0) {
        return [
          new TestTreeItem(
            'No test files found — adjust `qflow.testFileGlob`',
            vscode.TreeItemCollapsibleState.None,
            'empty',
          ),
        ];
      }
      const report = this.store.loadLatestReport();
      return files.map((f) => {
        const counts = countResults(f.tests, report);
        const item = new TestTreeItem(
          f.relPath,
          vscode.TreeItemCollapsibleState.Collapsed,
          'file',
          f,
        );
        item.description = counts.description;
        if (counts.failed > 0) {
          item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        } else if (counts.passed > 0 && counts.passed === f.tests.length) {
          item.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        }
        return item;
      });
    }

    if (element.kind === 'file' && element.file) {
      const report = this.store.loadLatestReport();
      // Reuse the cached flakiness index — computed once per refresh cycle.
      if (!this.flakinessCache) {
        this.flakinessCache = flakinessIndex(
          computeFlakiness(this.store, this.flakinessWindow()),
        );
      }
      const flakies = this.flakinessCache;
      return element.file.tests.map((d) => {
        const result = report?.tests.find(
          (rt) => rt.fullName === d.fullName || rt.name === d.name,
        );
        const flaky = flakies.get(d.fullName);
        return new TestTreeItem(
          d.name,
          vscode.TreeItemCollapsibleState.None,
          'test',
          undefined,
          { discovered: d, result, flaky },
        );
      });
    }

    return [];
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async loadFiles(): Promise<{ uri: vscode.Uri; relPath: string; tests: DiscoveredTest[] }[]> {
    if (this.filesCache) return this.filesCache;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return [];

    const glob = vscode.workspace
      .getConfiguration('qflow')
      .get<string>('testFileGlob', '**/*.{spec,test}.{ts,tsx,js,jsx,mjs,cjs}');

    const uris = await vscode.workspace.findFiles(
      glob,
      '{**/node_modules/**,**/dist/**,**/.qflow/**}',
    );

    const out = await Promise.all(
      uris.map(async (uri) => {
        const relPath = relative(root, uri.fsPath).split('\\').join('/');
        const tests = await discoverTestsInFile(uri, relPath);
        return { uri, relPath, tests };
      }),
    );
    out.sort((a, b) => a.relPath.localeCompare(b.relPath));

    this.filesCache = out;
    return out;
  }

  private flakinessWindow(): number {
    return vscode.workspace
      .getConfiguration('qflow')
      .get<number>('flakinessWindow', 20);
  }
}

function countResults(
  tests: DiscoveredTest[],
  report: ReturnType<RunStore['loadLatestReport']>,
): { passed: number; failed: number; description: string } {
  if (!report) return { passed: 0, failed: 0, description: `${tests.length} tests` };
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    const r = report.tests.find((rt) => rt.fullName === t.fullName || rt.name === t.name);
    if (r?.status === 'passed') passed++;
    else if (r?.status === 'failed' || r?.status === 'flaky') failed++;
  }
  const parts = [`${tests.length} tests`];
  if (passed > 0) parts.push(`${passed}✓`);
  if (failed > 0) parts.push(`${failed}✗`);
  return { passed, failed, description: parts.join(' · ') };
}
