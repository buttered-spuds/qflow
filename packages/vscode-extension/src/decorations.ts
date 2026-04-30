import * as vscode from 'vscode';
import { relative } from 'path';
import type { RunStore } from './runStore';
import { discoverTestsInDocument } from './testDiscovery';
import { computeFlakiness, flakinessIndex, type FlakinessStat } from './flakinessService';
import type { TestCase } from './types';

/**
 * Renders pass/fail/skipped/flaky icons in the editor gutter next to each
 * `test('name', ...)` call, plus end-of-line duration & flakiness%.
 */
export class TestGutterDecorations implements vscode.Disposable {
  private readonly passed: vscode.TextEditorDecorationType;
  private readonly failed: vscode.TextEditorDecorationType;
  private readonly skipped: vscode.TextEditorDecorationType;
  private readonly flaky: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    context: vscode.ExtensionContext,
    private readonly store: RunStore,
  ) {
    const make = (codicon: string, themeColor: string): vscode.TextEditorDecorationType =>
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: iconUri(context, codicon, themeColor),
        gutterIconSize: 'contain',
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        overviewRulerColor: new vscode.ThemeColor(themeColor),
      });

    this.passed = make('pass', 'testing.iconPassed');
    this.failed = make('error', 'testing.iconFailed');
    this.skipped = make('skip', 'testing.iconSkipped');
    this.flaky = make('warning', 'list.warningForeground');

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) => e && this.refresh(e)),
      vscode.workspace.onDidSaveTextDocument((d) => this.refreshDoc(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.refreshDoc(e.document)),
    );
  }

  dispose(): void {
    this.passed.dispose();
    this.failed.dispose();
    this.skipped.dispose();
    this.flaky.dispose();
    for (const d of this.disposables) d.dispose();
  }

  /** Re-decorate every visible editor. */
  refreshAll(): void {
    if (!this.enabled()) {
      this.clearAll();
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      this.refresh(editor);
    }
  }

  private refreshDoc(doc: vscode.TextDocument): void {
    if (!this.enabled()) return;
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (editor) this.refresh(editor);
  }

  private refresh(editor: vscode.TextEditor): void {
    if (!this.enabled() || !this.isTestFile(editor.document.uri)) {
      this.clear(editor);
      return;
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const rel = relative(root, editor.document.uri.fsPath).split('\\').join('/');

    const report = this.store.loadLatestReport();
    const flakies = flakinessIndex(computeFlakiness(this.store, this.flakinessWindow()));
    const tests = discoverTestsInDocument(editor.document, rel);

    const passedRanges: vscode.DecorationOptions[] = [];
    const failedRanges: vscode.DecorationOptions[] = [];
    const skippedRanges: vscode.DecorationOptions[] = [];
    const flakyRanges: vscode.DecorationOptions[] = [];

    for (const t of tests) {
      const result = report?.tests.find(
        (rt) => rt.fullName === t.fullName || rt.name === t.name,
      );
      const flaky = flakies.get(t.fullName);
      const range = new vscode.Range(t.line, 0, t.line, 0);
      const opts: vscode.DecorationOptions = {
        range,
        renderOptions: {
          after: {
            contentText: buildAfterText(result, flaky),
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            margin: '0 0 0 2em',
            fontStyle: 'italic',
          },
        },
        hoverMessage: buildHover(result, flaky),
      };

      if (!result) {
        // Untested in latest run — no gutter icon, but still show flakiness if any.
        if (flaky && flaky.flakinessPct > 0) flakyRanges.push(opts);
        continue;
      }

      switch (result.status) {
        case 'passed': passedRanges.push(opts); break;
        case 'failed': failedRanges.push(opts); break;
        case 'skipped': skippedRanges.push(opts); break;
        case 'flaky': flakyRanges.push(opts); break;
      }
    }

    editor.setDecorations(this.passed, passedRanges);
    editor.setDecorations(this.failed, failedRanges);
    editor.setDecorations(this.skipped, skippedRanges);
    editor.setDecorations(this.flaky, flakyRanges);
  }

  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.passed, []);
    editor.setDecorations(this.failed, []);
    editor.setDecorations(this.skipped, []);
    editor.setDecorations(this.flaky, []);
  }

  private clearAll(): void {
    for (const e of vscode.window.visibleTextEditors) this.clear(e);
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('qflow').get<boolean>('gutterDecorations', true);
  }

  private flakinessWindow(): number {
    return vscode.workspace.getConfiguration('qflow').get<number>('flakinessWindow', 20);
  }

  private isTestFile(uri: vscode.Uri): boolean {
    return /\.(spec|test)\.[jt]sx?$/.test(uri.fsPath) ||
           /\.(spec|test)\.(mjs|cjs)$/.test(uri.fsPath);
  }
}

function buildAfterText(result: TestCase | undefined, flaky: FlakinessStat | undefined): string {
  const parts: string[] = [];
  if (result) parts.push(`${result.duration}ms`);
  if (flaky && flaky.flakinessPct > 0) parts.push(`flaky ${flaky.flakinessPct}%`);
  return parts.length > 0 ? `   ${parts.join(' · ')}` : '';
}

function buildHover(result: TestCase | undefined, flaky: FlakinessStat | undefined): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  if (result) {
    md.appendMarkdown(`**${result.status.toUpperCase()}** — ${result.duration}ms\n\n`);
    if (result.error) {
      md.appendCodeblock(result.error, 'text');
    }
  }
  if (flaky && flaky.totalRuns > 1) {
    md.appendMarkdown(
      `\n\n**Flakiness:** ${flaky.flakinessPct}% — ${flaky.failures} failed / ${flaky.totalRuns} runs`,
    );
  }
  return md;
}

/**
 * Resolve a codicon to a themed SVG URI. We use the bundled VS Code codicons
 * indirectly: the gutter icon path requires a real file. We ship simple
 * coloured circles in `media/` so we don't have to render SVGs at runtime.
 */
function iconUri(context: vscode.ExtensionContext, codicon: string, _themeColor: string): vscode.Uri {
  const map: Record<string, string> = {
    pass: 'gutter-pass.svg',
    error: 'gutter-fail.svg',
    skip: 'gutter-skip.svg',
    warning: 'gutter-flaky.svg',
  };
  return vscode.Uri.joinPath(context.extensionUri, 'media', map[codicon] ?? 'gutter-pass.svg');
}
