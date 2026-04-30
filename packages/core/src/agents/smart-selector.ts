import { readdir, readFile } from 'fs/promises';
import { join, relative, extname } from 'path';
import { existsSync } from 'fs';
import { execa } from 'execa';
import type { LLMAdapter } from '../adapters/llm/base.js';

export interface SmartSelectionResult {
  /** Subset of test files to run, relative to cwd. Empty = run all. */
  testFiles: string[];
  /** Strategy used to derive the selection. */
  strategy: 'git-static' | 'llm-fallback' | 'all';
  changedFiles: string[];
}

/**
 * Analyse `git diff` output and determine the minimal set of test files that
 * should be executed.
 *
 * Algorithm:
 *   1. Get changed files from git (compare HEAD to merge-base with main/master).
 *   2. Build a static map of test-file → source-file references by scanning
 *      import statements in test files (no dep graph tool required).
 *   3. Return the intersection of changed source files → test files.
 *   4. If the static map is empty or the changed files include config/infra
 *      files, fall back to asking the LLM for guidance, then run all.
 */
export class SmartSelector {
  constructor(
    private readonly cwd: string,
    private readonly llm?: LLMAdapter,
  ) {}

  async select(testDir = 'tests'): Promise<SmartSelectionResult> {
    const changedFiles = await this.#getChangedFiles();

    if (changedFiles.length === 0) {
      return { testFiles: [], strategy: 'all', changedFiles: [] };
    }

    // Always run all if infra/config changed
    const infraChanged = changedFiles.some((f) =>
      /playwright\.config|jest\.config|pytest\.ini|setup\.cfg|pyproject\.toml|package\.json|tsconfig/.test(f),
    );
    if (infraChanged) {
      return { testFiles: [], strategy: 'all', changedFiles };
    }

    const testFiles = await this.#findTestFiles(testDir);
    const mapping = await this.#buildImportMap(testFiles);
    const affected = this.#resolveAffected(changedFiles, mapping);

    if (affected.length > 0) {
      return { testFiles: affected, strategy: 'git-static', changedFiles };
    }

    // No static match — ask LLM if configured
    if (this.llm) {
      return this.#llmFallback(changedFiles, testFiles);
    }

    return { testFiles: [], strategy: 'all', changedFiles };
  }

  async #getChangedFiles(): Promise<string[]> {
    // Try to find the merge base; if not in a git repo just return []
    const baseResult = await execa(
      'git',
      ['merge-base', 'HEAD', 'origin/main'],
      { cwd: this.cwd, reject: false },
    );
    const base =
      baseResult.exitCode === 0
        ? baseResult.stdout.trim()
        : (
            await execa('git', ['merge-base', 'HEAD', 'origin/master'], {
              cwd: this.cwd,
              reject: false,
            })
          ).stdout.trim();

    if (!base) return [];

    const diffResult = await execa('git', ['diff', '--name-only', base, 'HEAD'], {
      cwd: this.cwd,
      reject: false,
    });

    if (diffResult.exitCode !== 0 || !diffResult.stdout.trim()) return [];

    return diffResult.stdout
      .trim()
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
  }

  async #findTestFiles(testDir: string): Promise<string[]> {
    const dir = join(this.cwd, testDir);
    if (!existsSync(dir)) return [];

    const results: string[] = [];
    await walk(dir, this.cwd, results);
    return results.filter((f) => {
      const ext = extname(f);
      return (ext === '.ts' || ext === '.js' || ext === '.py') &&
        /\.(spec|test)\.|_test\.|test_/.test(f);
    });
  }

  /**
   * Build a map: testFile → Set<sourceFile> by scanning static import lines.
   * This avoids requiring madge/dependency-cruiser as a runtime dep.
   */
  async #buildImportMap(testFiles: string[]): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();

    await Promise.all(
      testFiles.map(async (testFile) => {
        const fullPath = join(this.cwd, testFile);
        let content: string;
        try {
          content = await readFile(fullPath, 'utf-8');
        } catch {
          return;
        }

        const deps = new Set<string>();
        // Match both TS/JS import and Python import/from
        const importRe =
          /(?:import|from)\s+['"]([^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(content)) !== null) {
          const raw = m[1];
          // Only local paths (./... or ../...)
          if (raw.startsWith('.')) {
            const abs = join(this.cwd, testFile, '..', raw).replace(/\\/g, '/');
            const rel = relative(this.cwd, abs).replace(/\\/g, '/');
            deps.add(rel);
            // Also add without extension variants
            deps.add(rel.replace(/\.(ts|js|py)$/, ''));
          }
        }
        map.set(testFile, deps);
      }),
    );

    return map;
  }

  #resolveAffected(
    changedFiles: string[],
    map: Map<string, Set<string>>,
  ): string[] {
    const changed = new Set(
      changedFiles.flatMap((f) => [f, f.replace(/\.(ts|js|py)$/, '')]),
    );

    const affected: string[] = [];
    for (const [testFile, deps] of map.entries()) {
      for (const dep of deps) {
        if (changed.has(dep)) {
          affected.push(testFile);
          break;
        }
      }
    }
    return affected;
  }

  async #llmFallback(
    changedFiles: string[],
    testFiles: string[],
  ): Promise<SmartSelectionResult> {
    if (!this.llm) return { testFiles: [], strategy: 'all', changedFiles };

    const prompt = [
      'You are a QA engineer. Given the following changed source files and available test files,',
      'return a JSON array of test file paths that should be run. If unsure, return an empty array [].',
      '',
      'Changed files:',
      changedFiles.map((f) => `- ${f}`).join('\n'),
      '',
      'Available test files:',
      testFiles.map((f) => `- ${f}`).join('\n'),
      '',
      'Respond with ONLY a JSON array, e.g. ["tests/ui/foo.spec.ts"]. No markdown.',
    ].join('\n');

    try {
      const response = await this.llm.chat([{ role: 'user', content: prompt }]);
      const clean = response.replace(/```(?:json)?/g, '').trim();
      const parsed = JSON.parse(clean) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        if (parsed.length > 0) {
          return { testFiles: parsed, strategy: 'llm-fallback', changedFiles };
        }
      }
    } catch {
      // Swallow — fall through to run all
    }

    return { testFiles: [], strategy: 'all', changedFiles };
  }
}

async function walk(dir: string, root: string, results: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, root, results);
      } else {
        results.push(relative(root, full).replace(/\\/g, '/'));
      }
    }),
  );
}
