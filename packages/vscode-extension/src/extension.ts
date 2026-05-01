import * as vscode from 'vscode';
import { RunnerService } from './runnerService';
import { RunStore } from './runStore';
import { QFlowTestExplorer } from './testExplorer';
import { QFlowRunsHistory } from './runsHistory';
import { QFlowFlakinessView } from './flakinessView';
import { QFlowStatusBar } from './statusBar';
import { QFlowTestController } from './testController';
import { QFlowCodeLensProvider } from './codeLens';
import { TestGutterDecorations } from './decorations';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
  const store = new RunStore();
  const runner = new RunnerService();
  const testExplorer = new QFlowTestExplorer(store);
  const runsHistory = new QFlowRunsHistory(store);
  const flakinessView = new QFlowFlakinessView(store);
  const statusBar = new QFlowStatusBar(store);

  // Native VS Code Testing API integration (gives us native gutter icons,
  // run/debug code lenses, and the official Test Explorer pane).
  const testController = new QFlowTestController(runner, store);

  // Custom inline lenses for "Run" / "Heal this test" / "Flaky N%".
  const codeLens = new QFlowCodeLensProvider(store);
  const codeLensRegistration = vscode.languages.registerCodeLensProvider(
    [
      { language: 'typescript', pattern: '**/*.{spec,test}.{ts,tsx}' },
      { language: 'javascript', pattern: '**/*.{spec,test}.{js,jsx,mjs,cjs}' },
      { language: 'typescriptreact', pattern: '**/*.{spec,test}.tsx' },
      { language: 'javascriptreact', pattern: '**/*.{spec,test}.jsx' },
    ],
    codeLens,
  );

  // Per-test pass/fail/duration gutter icons + end-of-line annotations.
  const decorations = new TestGutterDecorations(context, store);

  // Sidebar tree views.
  const testExplorerView = vscode.window.createTreeView('qflow.testExplorer', {
    treeDataProvider: testExplorer,
    showCollapseAll: true,
  });
  const runsHistoryView = vscode.window.createTreeView('qflow.runsHistory', {
    treeDataProvider: runsHistory,
    showCollapseAll: false,
  });
  const flakinessTreeView = vscode.window.createTreeView('qflow.flakinessView', {
    treeDataProvider: flakinessView,
    showCollapseAll: false,
  });

  // ─── Refresh on file changes ──────────────────────────────────────────────

  const refreshAll = (): void => {
    if (!vscode.workspace.getConfiguration('qflow').get<boolean>('autoRefresh', true)) return;
    store.invalidate();
    testExplorer.refresh();
    runsHistory.refresh();
    flakinessView.refresh();
    statusBar.refresh();
    testController.refreshFromStore();
    codeLens.refresh();
    decorations.refreshAll();
  };

  const dataWatcher = vscode.workspace.createFileSystemWatcher('**/.qflow/data/**');
  dataWatcher.onDidChange(refreshAll);
  dataWatcher.onDidCreate(refreshAll);
  dataWatcher.onDidDelete(refreshAll);

  // Also re-render decorations when the user changes config / opens a file.
  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('qflow')) refreshAll();
  });

  // ─── Commands ─────────────────────────────────────────────────────────────

  const commandDisposables = registerCommands({
    context,
    runner,
    store,
    testExplorer,
    runsHistory,
    flakinessView,
    statusBar,
    decorations,
    codeLens,
    testController,
  });

  // Initial paint
  statusBar.refresh();
  testController.refreshFromStore();
  decorations.refreshAll();

  context.subscriptions.push(
    testExplorerView,
    runsHistoryView,
    flakinessTreeView,
    dataWatcher,
    configChangeDisposable,
    runner,
    statusBar,
    decorations,
    testController,
    codeLensRegistration,
    ...commandDisposables,
  );
}

export function deactivate(): void {
  // disposables registered above clean themselves up
}
