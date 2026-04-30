import * as vscode from 'vscode';
import type { RunnerService } from './runnerService';
import type { QFlowTestExplorer } from './testExplorer';
import type { QFlowRunsHistory } from './runsHistory';
import type { QFlowStatusBar } from './statusBar';
import { QFlowDashboardPanel } from './dashboardPanel';

export function registerCommands(
  context: vscode.ExtensionContext,
  runner: RunnerService,
  testExplorer: QFlowTestExplorer,
  runsHistory: QFlowRunsHistory,
  statusBar: QFlowStatusBar,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // ─── Helper to wrap a run ─────────────────────────────────────────────────

  async function withProgress(label: string, fn: () => Promise<void>): Promise<void> {
    statusBar.setRunning(label);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: label, cancellable: false },
      async () => {
        try {
          await fn();
          vscode.window.showInformationMessage(`qflow: ${label} complete.`);
        } catch (err) {
          vscode.window.showErrorMessage(`qflow: ${label} failed — ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          statusBar.refresh();
          testExplorer.refresh();
          runsHistory.refresh();
        }
      },
    );
  }

  // ─── qflow.run ────────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.run', async () => {
      const suite: string = vscode.workspace.getConfiguration('qflow').get('defaultSuite', 'regression');
      await withProgress(`Running ${suite} suite`, () => runner.run(['run', '--suite', suite]));
    }),
  );

  // ─── qflow.runSmoke ───────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.runSmoke', async () => {
      await withProgress('Running smoke suite', () => runner.run(['run', '--suite', 'smoke']));
    }),
  );

  // ─── qflow.runLocal ───────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.runLocal', async () => {
      const suite: string = vscode.workspace.getConfiguration('qflow').get('defaultSuite', 'regression');
      await withProgress(`Running ${suite} suite (local)`, () => runner.run(['run', '--suite', suite, '--local']));
    }),
  );

  // ─── qflow.generate ───────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.generate', async () => {
      const ticket = await vscode.window.showInputBox({
        prompt: 'Enter the ticket key (e.g. PROJ-123)',
        placeHolder: 'PROJ-123',
        validateInput: (v) => (v.trim() ? null : 'Ticket key is required'),
      });
      if (!ticket) return;

      await withProgress(`Generating tests for ${ticket}`, () => runner.run(['generate', '--ticket', ticket.trim()]));
    }),
  );

  // ─── qflow.generateFromDescription ───────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.generateFromDescription', async () => {
      const description = await vscode.window.showInputBox({
        prompt: 'Describe what you want to test (free-text)',
        placeHolder: 'e.g. "User can log in with email and password"',
        validateInput: (v) => (v.trim() ? null : 'Description is required'),
      });
      if (!description) return;

      await withProgress('Generating tests', () => runner.run(['generate', '--description', description.trim()]));
    }),
  );

  // ─── qflow.openDashboard ─────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.openDashboard', () => {
      QFlowDashboardPanel.show(context);
    }),
  );

  // ─── qflow.heal ───────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.heal', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(search) Dry run (preview changes only)', value: 'dry' },
          { label: '$(wrench) Apply changes', value: 'apply' },
        ],
        { placeHolder: 'Self-heal broken Playwright selectors — choose mode' },
      );
      if (!choice) return;

      const args = choice.value === 'apply' ? ['heal', '--apply'] : ['heal'];
      await withProgress('Healing selectors', () => runner.run(args));
    }),
  );

  // ─── qflow.doctor ─────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.doctor', async () => {
      runner.showOutput();
      await withProgress('Running health check', () => runner.run(['doctor']));
    }),
  );

  // ─── qflow.costs ──────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.costs', async () => {
      runner.showOutput();
      await runner.run(['costs']).catch(() => undefined);
    }),
  );

  // ─── qflow.flakiness ──────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.flakiness', async () => {
      runner.showOutput();
      await runner.run(['flakiness']).catch(() => undefined);
    }),
  );

  // ─── qflow.refresh ────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.refresh', () => {
      testExplorer.refresh();
      runsHistory.refresh();
      statusBar.refresh();
    }),
  );

  // ─── qflow.replayFailed ───────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.replayFailed', async () => {
      await withProgress('Replaying failed tests', () => runner.run(['replay']));
    }),
  );

  // ─── qflow.watch ──────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.watch', async () => {
      const cwd = runner.getWorkspaceRoot();
      if (!cwd) {
        vscode.window.showErrorMessage('qflow: No workspace folder is open.');
        return;
      }
      // Watch mode runs indefinitely; open a terminal instead of blocking the extension host.
      const terminal = vscode.window.createTerminal({ name: 'qflow watch', cwd });
      terminal.show();
      terminal.sendText('npx @qflow/cli watch');
    }),
  );

  // ─── qflow.openRunDetail ─────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('qflow.openRunDetail', () => {
      QFlowDashboardPanel.show(context);
    }),
  );

  return disposables;
}
