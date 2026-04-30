import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { TestingContext } from '../types.js';

export interface RepoContext {
  /** Page Object Model classes the generator should reuse for UI tests. */
  pageObjects: PageObjectSummary[];
  /** Fixture / factory exports the generator should reuse for test data. */
  fixtures: FixtureSummary[];
  /** Existing test files of the same kind, so the LLM can match style and naming. */
  exampleTests: TestSummary[];
  /** Pinned runner version (e.g. "@playwright/test@^1.50.0") so generated code targets the right syntax. */
  runnerVersion?: string;
  /** tsconfig.json path aliases — so generated imports use the project's conventions. */
  tsconfigPaths: Record<string, string[]>;
}

export interface PageObjectSummary {
  /** Relative path, e.g. tests/pages/LoginPage.ts */
  file: string;
  /** Class name, e.g. LoginPage */
  className: string;
  /** Public method names, e.g. ['login', 'getError', 'isLoggedIn'] */
  methods: string[];
}

export interface FixtureSummary {
  file: string;
  /** Exported names: classes, factory functions, fixture objects. */
  exports: string[];
}

export interface TestSummary {
  file: string;
  /** Test type detected from the file path (ui/api/unit/component). */
  kind: 'ui' | 'api' | 'unit' | 'component';
  /** First describe/test title, used as a style cue. */
  firstTitle?: string;
}

const MAX_FILES_PER_CATEGORY = 30;
const MAX_FILE_SIZE = 50 * 1024; // 50KB — skip generated/minified

/**
 * Scan a project's test/source tree and return a structured summary the
 * Generator and Reviewer can use to write tests that fit the existing codebase.
 *
 * Pure analysis — no LLM calls, fast (<200ms for typical repos).
 */
export class RepoContextAgent {
  async scan(cwd: string, context?: TestingContext): Promise<RepoContext> {
    const [pageObjects, fixtures, exampleTests, runnerVersion, tsconfigPaths] = await Promise.all([
      this.#findPageObjects(cwd),
      this.#findFixtures(cwd),
      this.#findExampleTests(cwd, context),
      this.#detectRunnerVersion(cwd),
      this.#readTsconfigPaths(cwd),
    ]);
    return { pageObjects, fixtures, exampleTests, runnerVersion, tsconfigPaths };
  }

  /**
   * Render the context into a compact string (~1-3KB) suitable for inclusion
   * in an LLM system prompt. Returns empty string if there's nothing useful.
   */
  format(ctx: RepoContext): string {
    const sections: string[] = [];

    if (ctx.runnerVersion) {
      sections.push(`Runner version pinned: ${ctx.runnerVersion} — use syntax compatible with this version.`);
    }

    if (ctx.pageObjects.length > 0) {
      sections.push(
        `Existing Page Objects (REUSE these instead of redefining):\n` +
          ctx.pageObjects
            .map((po) => `  ${po.file} — class ${po.className} { ${po.methods.join(', ')} }`)
            .join('\n'),
      );
    }

    if (ctx.fixtures.length > 0) {
      sections.push(
        `Existing fixtures / factories (REUSE these for test data):\n` +
          ctx.fixtures.map((f) => `  ${f.file} — exports: ${f.exports.join(', ')}`).join('\n'),
      );
    }

    if (ctx.exampleTests.length > 0) {
      sections.push(
        `Example existing tests (match this style and naming):\n` +
          ctx.exampleTests
            .slice(0, 5)
            .map((t) => `  [${t.kind}] ${t.file}${t.firstTitle ? ` — first test: "${t.firstTitle}"` : ''}`)
            .join('\n'),
      );
    }

    if (Object.keys(ctx.tsconfigPaths).length > 0) {
      const aliases = Object.entries(ctx.tsconfigPaths)
        .map(([k, v]) => `${k} → ${v.join(', ')}`)
        .join('; ');
      sections.push(`tsconfig path aliases (use these in imports): ${aliases}`);
    }

    if (sections.length === 0) return '';
    return `\n--- PROJECT CONTEXT (use this to fit existing conventions) ---\n${sections.join('\n\n')}\n--- END PROJECT CONTEXT ---\n`;
  }

  // ─── Internal scanners ───────────────────────────────────────────────────

  async #findPageObjects(cwd: string): Promise<PageObjectSummary[]> {
    const files = await this.#findFiles(cwd, ['tests/pages', 'tests/page-objects', 'e2e/pages'], /\.(ts|js)$/);
    const out: PageObjectSummary[] = [];
    for (const file of files.slice(0, MAX_FILES_PER_CATEGORY)) {
      const content = await this.#readSafe(file);
      if (!content) continue;
      const classMatch = content.match(/export\s+(?:default\s+)?class\s+(\w+)/);
      if (!classMatch) continue;
      const methods: string[] = [];
      // crude: capture public method names. Skip constructor and private (#/_).
      const re = /^\s*(?:async\s+)?(\w+)\s*\(/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const name = m[1];
        if (name === 'constructor' || name.startsWith('_') || name.startsWith('#')) continue;
        if (['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await'].includes(name)) continue;
        if (!methods.includes(name)) methods.push(name);
        if (methods.length >= 8) break;
      }
      out.push({ file: relative(cwd, file), className: classMatch[1], methods });
    }
    return out;
  }

  async #findFixtures(cwd: string): Promise<FixtureSummary[]> {
    const files = await this.#findFiles(
      cwd,
      ['tests/fixtures', 'tests/factories', 'tests/helpers', 'tests/data', 'tests/support'],
      /\.(ts|js)$/,
    );
    const out: FixtureSummary[] = [];
    for (const file of files.slice(0, MAX_FILES_PER_CATEGORY)) {
      const content = await this.#readSafe(file);
      if (!content) continue;
      const exports: string[] = [];
      // export const/let/var X, export function X, export class X
      const re = /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!exports.includes(m[1])) exports.push(m[1]);
        if (exports.length >= 8) break;
      }
      if (exports.length > 0) out.push({ file: relative(cwd, file), exports });
    }
    return out;
  }

  async #findExampleTests(cwd: string, context?: TestingContext): Promise<TestSummary[]> {
    const modes = context?.modes ?? ['ui', 'api'];
    const dirMap: Record<string, 'ui' | 'api' | 'unit' | 'component'> = {
      'tests/ui': 'ui',
      'tests/e2e': 'ui',
      'e2e': 'ui',
      'tests/api': 'api',
      'tests/unit': 'unit',
      'tests/components': 'component',
    };
    const out: TestSummary[] = [];
    for (const [dir, kind] of Object.entries(dirMap)) {
      if (!modes.includes(kind)) continue;
      const files = await this.#findFiles(cwd, [dir], /\.(test|spec)\.(ts|js)$/);
      for (const file of files.slice(0, 5)) {
        const content = await this.#readSafe(file);
        if (!content) continue;
        const titleMatch = content.match(/(?:describe|test|it)\s*\(\s*['"`]([^'"`]+)/);
        out.push({ file: relative(cwd, file), kind, firstTitle: titleMatch?.[1] });
      }
    }
    return out;
  }

  async #detectRunnerVersion(cwd: string): Promise<string | undefined> {
    try {
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const candidate of ['@playwright/test', 'jest', 'vitest']) {
        if (deps[candidate]) return `${candidate}@${deps[candidate]}`;
      }
    } catch {}
    return undefined;
  }

  async #readTsconfigPaths(cwd: string): Promise<Record<string, string[]>> {
    try {
      const raw = await readFile(join(cwd, 'tsconfig.json'), 'utf-8');
      // tsconfig allows comments — strip them naively before parse.
      const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const json = JSON.parse(cleaned) as { compilerOptions?: { paths?: Record<string, string[]> } };
      return json.compilerOptions?.paths ?? {};
    } catch {
      return {};
    }
  }

  // ─── File-system helpers ────────────────────────────────────────────────

  async #findFiles(cwd: string, dirs: string[], pattern: RegExp, depth = 4): Promise<string[]> {
    const results: string[] = [];
    for (const d of dirs) {
      await this.#walk(join(cwd, d), pattern, depth, results);
    }
    return results;
  }

  async #walk(dir: string, pattern: RegExp, depth: number, out: string[]): Promise<void> {
    if (depth < 0) return;
    let entries: string[];
    try { entries = await readdir(dir); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const full = join(dir, e);
      let s;
      try { s = await stat(full); } catch { continue; }
      if (s.isDirectory()) {
        await this.#walk(full, pattern, depth - 1, out);
      } else if (pattern.test(e) && s.size <= MAX_FILE_SIZE) {
        out.push(full);
      }
    }
  }

  async #readSafe(file: string): Promise<string | null> {
    try { return await readFile(file, 'utf-8'); } catch { return null; }
  }
}
