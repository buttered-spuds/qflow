import { readFile, writeFile } from 'fs/promises';
import { join, relative } from 'path';
import { execa } from 'execa';
import type { LLMAdapter } from '../adapters/llm/base.js';
import type { TestCase } from '../types.js';

export interface HealedSelector {
  file: string;
  oldSelector: string;
  newSelector: string;
  testName: string;
}

export interface SelfHealResult {
  healed: HealedSelector[];
  /** Files that were written to disk. */
  patchedFiles: string[];
}

const SYSTEM_PROMPT = `You are a Playwright expert. A test failed because a selector no longer exists in the DOM.
Given the failing test name, the broken selector, and a snippet of the current DOM, propose a replacement selector.

Rules:
- Prefer getByRole, getByLabel, getByTestId (data-testid attribute) over CSS selectors
- Never use nth-child, auto-generated class names, or positional selectors
- Return ONLY a JSON object: {"selector": "...", "selectorType": "getByRole|getByLabel|getByTestId|locator"}
- No explanation, no markdown`;

/**
 * Detects "locator not found" / "strict mode violation" errors in failed tests,
 * asks the LLM to propose a healed selector, and patches the source file.
 *
 * If `autoCommit` is true (from config.selfHealing.autoCommit), the patched
 * files are committed to the current branch.
 */
export class SelfHealingAgent {
  constructor(
    private readonly llm: LLMAdapter,
    private readonly autoCommit = false,
  ) {}

  async heal(
    failedTests: TestCase[],
    cwd: string,
  ): Promise<SelfHealResult> {
    const selectorErrors = failedTests.filter(
      (t) =>
        t.error &&
        /locator\s.*not found|strict mode violation|element.*not visible|no element found/i.test(
          t.error,
        ),
    );

    if (selectorErrors.length === 0) {
      return { healed: [], patchedFiles: [] };
    }

    const healed: HealedSelector[] = [];
    const filePatches = new Map<string, string>(); // file → patched content

    for (const test of selectorErrors) {
      const selector = extractSelector(test.error ?? '');
      if (!selector || !test.file) continue;

      const filePath = join(cwd, test.file);
      let content: string;
      try {
        content = filePatches.get(test.file) ?? await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      if (!content.includes(selector)) continue;

      const newSelector = await this.#proposeReplacement(test.name, selector, test.error ?? '');
      if (!newSelector || newSelector === selector) continue;

      const patched = applyPatch(content, selector, newSelector);
      filePatches.set(test.file, patched);
      healed.push({ file: test.file, oldSelector: selector, newSelector, testName: test.name });
    }

    const patchedFiles: string[] = [];
    for (const [file, content] of filePatches.entries()) {
      await writeFile(join(cwd, file), content, 'utf-8');
      patchedFiles.push(file);
    }

    if (this.autoCommit && patchedFiles.length > 0) {
      await this.#commit(patchedFiles, healed, cwd);
    }

    return { healed, patchedFiles };
  }

  async #proposeReplacement(
    testName: string,
    brokenSelector: string,
    errorMessage: string,
  ): Promise<string | null> {
    const prompt = [
      `Test: "${testName}"`,
      `Broken selector: ${brokenSelector}`,
      `Error: ${errorMessage.slice(0, 500)}`,
      '',
      'Propose a replacement selector. Return ONLY JSON: {"selector": "...", "selectorType": "..."}',
    ].join('\n');

    try {
      const response = await this.llm.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ]);
      const clean = response.replace(/```(?:json)?/g, '').trim();
      const parsed = JSON.parse(clean) as { selector?: string };
      return parsed.selector ?? null;
    } catch {
      return null;
    }
  }

  async #commit(files: string[], healed: HealedSelector[], cwd: string): Promise<void> {
    for (const file of files) {
      await execa('git', ['add', file], { cwd, reject: false });
    }

    const msg = [
      `fix(qflow): self-heal ${healed.length} selector(s)`,
      '',
      ...healed.map((h) => `- ${h.testName}: ${h.oldSelector} → ${h.newSelector}`),
    ].join('\n');

    await execa('git', ['commit', '-m', msg], { cwd, reject: false });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Extract the broken selector string from a Playwright error message.
 * Playwright errors typically look like:
 *   Error: locator('.my-class') strict mode violation...
 *   Error: page.locator('button[data-id="foo"]') not found
 */
function extractSelector(error: string): string | null {
  // Match locator('...') or page.locator('...')
  const m = error.match(/locator\(['"]([^'"]+)['"]\)/);
  if (m) return m[1];

  // Match getByTestId / getByRole etc.
  const m2 = error.match(/getBy\w+\(['"]([^'"]+)['"]\)/);
  if (m2) return m2[1];

  return null;
}

/**
 * Replace the old selector string inside the source file content with the new one.
 * Preserves surrounding quote style.
 */
function applyPatch(content: string, oldSel: string, newSel: string): string {
  // Try double quotes first, then single
  const dq = content.replace(`"${oldSel}"`, `"${newSel}"`);
  if (dq !== content) return dq;
  return content.replace(`'${oldSel}'`, `'${newSel}'`);
}
