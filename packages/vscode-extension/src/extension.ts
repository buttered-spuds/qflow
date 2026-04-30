import * as vscode from 'vscode';
import { RunnerService } from './runnerService';
import { QFlowTestExplorer } from './testExplorer';
import { QFlowRunsHistory } from './runsHistory';
import { QFlowStatusBar } from './statusBar';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
  const runnerService = new RunnerService();
  const testExplorer = new QFlowTestExplorer();
  const runsHistory = new QFlowRunsHistory();
  const statusBar = new QFlowStatusBar();

  // Register tree views
  const testExplorerView = vscode.window.createTreeView('qflow.testExplorer', {
    treeDataProvider: testExplorer,
    showCollapseAll: true,
  });

  const runsHistoryView = vscode.window.createTreeView('qflow.runsHistory', {
    treeDataProvider: runsHistory,
    showCollapseAll: false,
  });

  // Register all commands
  const commandDisposables = registerCommands(context, runnerService, testExplorer, runsHistory, statusBar);

  // File watcher — refresh views when .qflow/data/ changes
  const dataWatcher = vscode.workspace.createFileSystemWatcher('**/.qflow/data/**');
  dataWatcher.onDidChange(() => {
    testExplorer.refresh();
    runsHistory.refresh();
    statusBar.refresh();
  });
  dataWatcher.onDidCreate(() => {
    testExplorer.refresh();
    runsHistory.refresh();
    statusBar.refresh();
  });
  dataWatcher.onDidDelete(() => {
    testExplorer.refresh();
    runsHistory.refresh();
    statusBar.refresh();
  });

  // Initial data load
  statusBar.refresh();

  context.subscriptions.push(
    testExplorerView,
    runsHistoryView,
    dataWatcher,
    statusBar,
    ...commandDisposables,
  );
}

export function deactivate(): void {
  // nothing to clean up beyond disposables registered in activate
}
