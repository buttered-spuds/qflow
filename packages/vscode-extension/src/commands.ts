import * as vscode from 'vscode';
import type { RunnerService } from './runnerService';
import type { RunStore } from './runStore';
import type { QFlowTestExplorer } from './testExplorer';
import type { QFlowRunsHistory, RunTreeItem } from './runsHistory';
import type { QFlowFlakinessView } from './flakinessView';
import type { QFlowStatusBar } from './statusBar';
import type { TestGutterDecorations } from './decorations';
import type { QFlowCodeLensProvider } from './codeLens';
import type { QFlowTestController } from './testController';
import { QFlowDashboardPanel } from './dashboardPanel';

export interface CommandDeps {
  context: vscode.ExtensionContext;
  runner: RunnerService;
  store: RunStore;
  testExplorer: QFlowTestExplorer;
  runsHistory: QFlowRunsHistory;
  flakinessView: QFlowFlakinessView;
  statusBar: QFlowStatusBar;
  decorations: TestGutterDecorations;
  codeLens: QFlowCodeLensProvider;
  testController: QFlowTestController;
}

interface TestRef {
  name: string;
  fullName: string;
  file: string;
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { context, runner, store, testExplorer, runsHistory, flakinessView,
          statusBar, decorations, codeLens, testController } = deps;
  const d: vscode.Disposable[] = [];

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function withProgress(label: string, fn: () => Promise<void>): Promise<void> {
    statusBar.setRunning(label);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: label, cancellable: false },
      async () => {
        try {
          await fn();
          vscode.window.showInformationMessage(`qflow: ${label} complete.`);
        } catch (err) {
          vscode.window.showErrorMessage(
            `qflow: ${label} failed — ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          store.invalidate();
          statusBar.refresh();
          testExplorer.refresh();
          runsHistory.refresh();
          flakinessView.refresh();
          testController.refreshFromStore();
          codeLens.refresh();
          decorations.refreshAll();
          await reloadOpenEditors();
        }
      },
    );
  }

  // After heal --apply patches files on disk, nudge VS Code to re-read them.
  async function reloadOpenEditors(): Promise<void> {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.isDirty || doc.uri.scheme !== 'file') continue;
      // Only spec files — that's what `heal` modifies.
      if (!/\.(spec|test)\.[jt]sx?$/.test(doc.uri.fsPath)) continue;
      try {
        await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri);
      } catch {
        /* ignore */
      }
    }
  }

  // ─── Suite-level runs ─────────────────────────────────────────────────────

  d.push(vscode.commands.registerCommand('qflow.run', async () => {
    const suite = vscode.workspace.getConfiguration('qflow').get<string>('defaultSuite', 'regression');
    await withProgress(`Running ${suite} suite`, () => runner.run(['run', '--suite', suite]));
  }));

  d.push(vscode.commands.registerCommand('qflow.runSmoke', async () => {
    await withProgress('Running smoke suite', () => runner.run(['run', '--suite', 'smoke']));
  }));

  d.push(vscode.commands.registerCommand('qflow.runLocal', async () => {
    const suite = vscode.workspace.getConfiguration('qflow').get<string>('defaultSuite', 'regression');
    await withProgress(`Running ${suite} (local)`, () => runner.run(['run', '--suite', suite, '--local']));
  }));

  // ─── Per-test / per-file ──────────────────────────────────────────────────

  d.push(vscode.commands.registerCommand('qflow.runTest', async (ref?: TestRef) => {
    const target = ref ?? (await pickTestFromActiveEditor());
    if (!target) return;
    await withProgress(`Running ${target.name}`, () =>
      runner.run(['run', '--grep', escapeRegex(target.fullName)]),
    );
  }));

  d.push(vscode.commands.registerCommand('qflow.runFile', async (uriOrFile?: vscode.Uri | { file: string }) => {
    const path = await resolveFilePath(uriOrFile);
    if (!path) return;
    await withProgress(`Running ${path}`, () => runner.run(['run', '--file', path]));
  }));

  d.push(vscode.commands.registerCommand('qflow.healTest', async (ref?: TestRef) => {
    const target = ref ?? (await pickTestFromActiveEditor());
    if (!target) return;
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(search) Dry run', value: 'dry' },
        { label: '$(wrench) Apply changes', value: 'apply' },
      ],
      { placeHolder: `Heal "${target.name}" — choose mode` },
    );
    if (!choice) return;
    const args = ['heal', '--grep', escapeRegex(target.fullName)];
    if (choice.value === 'apply') args.push('--apply');
    await withProgress(`Healing ${target.name}`, () => runner.run(args));
  }));

  // ─── Generation ───────────────────────────────────────────────────────────

  d.push(vscode.commands.registerCommand('qflow.generate', async () => {
    const ticket = await vscode.window.showInputBox({
      prompt: 'Enter the ticket key (e.g. PROJ-123)',
      placeHolder: 'PROJ-123',
      validateInput: (v) => (v.trim() ? null : 'Ticket key is required'),
    });
    if (!ticket) return;
    await withProgress(`Generating tests for ${ticket}`, () =>
      runner.run(['generate', '--ticket', ticket.trim()]),
    );
  }));

  d.push(vscode.commands.registerCommand('qflow.generateFromDescription', async () => {
    const description = await vscode.window.showInputBox({
      prompt: 'Describe what you want to test (free-text)',
      placeHolder: 'e.g. "User can log in with email and password"',
      validateInput: (v) => (v.trim() ? null : 'Description is required'),
    });
    if (!description) return;
    await withProgress('Generating tests', () => runner.run(['generate', '--description', description.trim()]));
  }));

  // ─── Heal / doctor / costs / flakiness ────────────────────────────────────

  d.push(vscode.commands.registerCommand('qflow.heal', async () => {
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(search) Dry run (preview only)', value: 'dry' },
        { label: '$(wrench) Apply changes', value: 'apply' },
      ],
      { placeHolder: 'Self-heal broken Playwright selectors — choose mode' },
    );
    if (!choice) return;
    const args = choice.value === 'apply' ? ['heal', '--apply'] : ['heal'];
    await withProgress('Healing selectors', () => runner.run(args));
  }));

  d.push(vscode.commands.registerCommand('qflow.doctor', async () => {
    runner.showOutput();
    await withProgress('Running health check', () => runner.run(['doctor']));
  }));

  d.push(vscode.commands.registerCommand('qflow.costs', async () => {
    runner.showOutput();
    await runner.run(['costs']).catch(() => undefined);
  }));

  d.push(vscode.commands.registerCommand('qflow.flakiness', async () => {
    runner.showOutput();
    await runner.run(['flakiness']).catch(() => undefined);
  }));

  // ─── View / dashboard ─────────────────────────────────────────────────────

  d.push(vscode.commands.registerCommand('qflow.openDashboard', () => {
    QFlowDashboardPanel.show(context);
  }));

  d.push(vscode.commands.registerCommand('qflow.refresh', () => {
    store.invalidate();
    testExplorer.refresh();
    runsHistory.refresh();
    flakinessView.refresh();
    statusBar.refresh();
    testController.refreshFromStore();
    codeLens.refresh();
    decorations.refreshAll();
  }));

  d.push(vscode.commands.registerCommand('qflow.replayFailed', async () => {
    await withProgress('Replaying failed tests', () => runner.run(['replay']));
  }));

  d.push(vscode.commands.registerCommand('qflow.replayRun', async (item?: RunTreeItem) => {
    if (!item) return;
    await withProgress(`Replaying run ${item.entry.id}`, () =>
      runner.run(['replay', '--run-id', item.entry.id]),
    );
  }));

  d.push(vscode.commands.registerCommand('qflow.watch', async () => {
    const cwd = runner.getWorkspaceRoot();
    if (!cwd) {
      vscode.window.showErrorMessage('qflow: No workspace folder is open.');
      return;
    }
    const terminal = vscode.window.createTerminal({ name: 'qflow watch', cwd });
    terminal.show();
    terminal.sendText('npx @qflow/cli watch');
  }));

  d.push(vscode.commands.registerCommand('qflow.openRunDetail', (item?: RunTreeItem) => {
    QFlowDashboardPanel.show(context, item?.entry.id);
  }));

  d.push(vscode.commands.registerCommand(
    'qflow.openTestSource',
    async (target?: { uri: vscode.Uri; line: number; character: number }) => {
      if (!target?.uri) return;
      const doc = await vscode.workspace.openTextDocument(target.uri);
      const editor = await vscode.window.showTextDocument(doc);
      const pos = new vscode.Position(target.line, target.character);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    },
  ));

  return d;
}

// ─── Local helpers ────────────────────────────────────────────────────────────

async function pickTestFromActiveEditor(): Promise<TestRef | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('qflow: open a test file first.');
    return undefined;
  }
  const { discoverTestsInDocument } = await import('./testDiscovery');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const rel = editor.document.uri.fsPath.startsWith(root)
    ? editor.document.uri.fsPath.slice(root.length + 1).split('\\').join('/')
    : editor.document.uri.fsPath;
  const tests = discoverTestsInDocument(editor.document, rel);
  if (tests.length === 0) {
    vscode.window.showWarningMessage('qflow: no tests found in active file.');
    return undefined;
  }
  // Prefer the test whose range encloses the cursor.
  const cursorLine = editor.selection.active.line;
  const enclosing = tests
    .filter((t) => t.line <= cursorLine)
    .sort((a, b) => b.line - a.line)[0];
  if (enclosing) return { name: enclosing.name, fullName: enclosing.fullName, file: rel };
  const pick = await vscode.window.showQuickPick(
    tests.map((t) => ({ label: t.name, description: t.fullName, t })),
    { placeHolder: 'Select a test to run' },
  );
  return pick ? { name: pick.t.name, fullName: pick.t.fullName, file: rel } : undefined;
}

async function resolveFilePath(uriOrFile?: unknown): Promise<string | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  // Plain vscode.Uri (e.g. from editor/title button or keybinding)
  if (uriOrFile instanceof vscode.Uri) {
    return uriOrFile.fsPath.startsWith(root)
      ? uriOrFile.fsPath.slice(root.length + 1).split('\\').join('/')
      : uriOrFile.fsPath;
  }

  // TreeItem passed from the inline view action — has a resourceUri property
  if (uriOrFile && typeof uriOrFile === 'object' && 'resourceUri' in uriOrFile) {
    const uri = (uriOrFile as { resourceUri: vscode.Uri }).resourceUri;
    if (uri instanceof vscode.Uri) {
      return uri.fsPath.startsWith(root)
        ? uri.fsPath.slice(root.length + 1).split('\\').join('/')
        : uri.fsPath;
    }
  }

  // { file: string } plain object (programmatic callers)
  if (uriOrFile && typeof uriOrFile === 'object' && 'file' in uriOrFile
      && typeof (uriOrFile as { file: unknown }).file === 'string') {
    return (uriOrFile as { file: string }).file;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  return editor.document.uri.fsPath.startsWith(root)
    ? editor.document.uri.fsPath.slice(root.length + 1).split('\\').join('/')
    : editor.document.uri.fsPath;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
