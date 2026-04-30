import * as vscode from 'vscode';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

// ─── Shared data types (mirrors @qflow/core types) ───────────────────────────

export interface ManifestEntry {
  id: string;
  timestamp: string;
  suite: string;
  passed: number;
  failed: number;
  total: number;
  file: string;
}

export interface Manifest {
  runs: ManifestEntry[];
  quarantined: string[];
  lastUpdated: string;
}

export interface TestCase {
  name: string;
  fullName: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  duration: number;
  file?: string;
  error?: string;
  tags?: string[];
}

export interface RunReport {
  id: string;
  timestamp: string;
  suite: string;
  runner: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  tests: TestCase[];
}

// ─── Tree item kinds ──────────────────────────────────────────────────────────

type NodeKind = 'loading' | 'empty' | 'suiteGroup' | 'file' | 'test';

export class TestTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: NodeKind,
    public readonly testCase?: TestCase,
  ) {
    super(label, collapsibleState);

    if (kind === 'test' && testCase) {
      this.contextValue = 'qflow.test';
      this.tooltip = testCase.error ?? `${testCase.status} (${testCase.duration}ms)`;
      this.description = `${testCase.duration}ms`;

      switch (testCase.status) {
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
      }
    } else if (kind === 'file') {
      this.contextValue = 'qflow.file';
      this.iconPath = new vscode.ThemeIcon('file-code');
    } else if (kind === 'suiteGroup') {
      this.contextValue = 'qflow.suite';
      this.iconPath = new vscode.ThemeIcon('beaker');
    } else if (kind === 'loading') {
      this.iconPath = new vscode.ThemeIcon('loading~spin');
    } else if (kind === 'empty') {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}

// ─── Test Explorer tree provider ──────────────────────────────────────────────

export class QFlowTestExplorer implements vscode.TreeDataProvider<TestTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TestTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TestTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private latestReport: RunReport | null = null;

  refresh(): void {
    this.latestReport = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TestTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TestTreeItem): vscode.ProviderResult<TestTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    if (element.kind === 'suiteGroup') {
      return this.getFileItems(element.label as string);
    }

    if (element.kind === 'file') {
      return this.getTestItemsForFile(element.label as string);
    }

    return [];
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private getRootItems(): TestTreeItem[] {
    const report = this.loadLatestReport();

    if (!report) {
      return [
        new TestTreeItem(
          'No test runs yet — run `qflow run` to get started',
          vscode.TreeItemCollapsibleState.None,
          'empty',
        ),
      ];
    }

    // Group tests by suite/runner, then by file
    const suiteName = `${report.suite} — ${report.passed}✓ ${report.failed > 0 ? report.failed + '✗' : ''}`.trim();
    const suiteItem = new TestTreeItem(
      suiteName,
      vscode.TreeItemCollapsibleState.Expanded,
      'suiteGroup',
    );
    suiteItem.description = new Date(report.timestamp).toLocaleString();
    suiteItem.tooltip = `Run ID: ${report.id}`;

    return [suiteItem];
  }

  private getFileItems(suiteName: string): TestTreeItem[] {
    const report = this.loadLatestReport();
    if (!report) return [];

    // Collect unique file names
    const files = [...new Set(report.tests.map((t) => t.file ?? '(no file)'))];

    return files.map((file) => {
      const tests = report.tests.filter((t) => (t.file ?? '(no file)') === file);
      const anyFailed = tests.some((t) => t.status === 'failed');
      const allPassed = tests.every((t) => t.status === 'passed');

      const item = new TestTreeItem(
        file,
        vscode.TreeItemCollapsibleState.Collapsed,
        'file',
      );
      item.description = `${tests.length} test${tests.length !== 1 ? 's' : ''}`;
      item.iconPath = anyFailed
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
        : allPassed
          ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
          : new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));

      return item;
    });
  }

  private getTestItemsForFile(file: string): TestTreeItem[] {
    const report = this.loadLatestReport();
    if (!report) return [];

    const tests = report.tests.filter((t) => (t.file ?? '(no file)') === file);
    return tests.map((t) => new TestTreeItem(t.name, vscode.TreeItemCollapsibleState.None, 'test', t));
  }

  private loadLatestReport(): RunReport | null {
    if (this.latestReport) return this.latestReport;

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return null;

    const manifestPath = join(root, '.qflow', 'data', 'manifest.json');
    if (!existsSync(manifestPath)) return null;

    try {
      const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const latest = manifest.runs[manifest.runs.length - 1];
      if (!latest) return null;

      const reportPath = join(root, '.qflow', 'data', latest.file);
      if (!existsSync(reportPath)) return null;

      this.latestReport = JSON.parse(readFileSync(reportPath, 'utf-8')) as RunReport;
      return this.latestReport;
    } catch {
      return null;
    }
  }
}
