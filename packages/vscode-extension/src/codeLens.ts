import * as vscode from 'vscode';
import { relative } from 'path';
import type { RunStore } from './runStore';
import { discoverTestsInDocument } from './testDiscovery';
import { computeFlakiness, flakinessIndex } from './flakinessService';

/**
 * Provides inline action lenses above each `test('name', ...)` call:
 *   ▶ Run test    (always)
 *   🔧 Heal this test    (if last run failed)
 */
export class QFlowCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor(private readonly store: RunStore) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (!this.enabled()) return [];
    if (!this.isTestFile(document.uri)) return [];

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return [];
    const rel = relative(root, document.uri.fsPath).split('\\').join('/');

    const tests = discoverTestsInDocument(document, rel);
    const report = this.store.loadLatestReport();
    const flakies = flakinessIndex(
      computeFlakiness(this.store, this.flakinessWindow()),
    );

    const lenses: vscode.CodeLens[] = [];
    for (const t of tests) {
      const range = new vscode.Range(t.line, 0, t.line, 0);
      const result = report?.tests.find(
        (rt) => rt.fullName === t.fullName || rt.name === t.name,
      );
      const flaky = flakies.get(t.fullName);

      lenses.push(new vscode.CodeLens(range, {
        title: '$(play) Run',
        command: 'qflow.runTest',
        arguments: [{ name: t.name, fullName: t.fullName, file: rel }],
      }));

      if (result?.status === 'failed' || result?.status === 'flaky') {
        lenses.push(new vscode.CodeLens(range, {
          title: '$(wrench) Heal',
          command: 'qflow.healTest',
          arguments: [{ name: t.name, fullName: t.fullName, file: rel }],
        }));
      }

      if (flaky && flaky.flakinessPct > 0) {
        lenses.push(new vscode.CodeLens(range, {
          title: `$(warning) Flaky ${flaky.flakinessPct}%`,
          command: 'qflow.openDashboard',
          arguments: [],
        }));
      }
    }
    return lenses;
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('qflow').get<boolean>('codeLens', true);
  }

  private flakinessWindow(): number {
    return vscode.workspace.getConfiguration('qflow').get<number>('flakinessWindow', 20);
  }

  private isTestFile(uri: vscode.Uri): boolean {
    return /\.(spec|test)\.[jt]sx?$/.test(uri.fsPath) ||
           /\.(spec|test)\.(mjs|cjs)$/.test(uri.fsPath);
  }
}
