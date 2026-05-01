import { describe, it, expect } from 'vitest';
import type { Uri as VscodeUri } from 'vscode';
import { discoverTestsInFile } from '../src/testDiscovery';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// testDiscovery.ts uses only type-level imports from 'vscode', so no mock is needed.

const mockUri = (p: string): VscodeUri => ({ fsPath: p, scheme: 'file', authority: '', path: p, query: '', fragment: '', with: () => ({} as VscodeUri), toJSON: () => ({}) } as unknown as VscodeUri);

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'qflow-disc-'));
  const file = join(dir, 'sample.spec.ts');
  writeFileSync(file, content);
  return file;
}

describe('testDiscovery', () => {
  it('finds bare test() and it() calls', () => {
    const f = tmpFile(`
      test('foo', () => {});
      it("bar", () => {});
    `);
    const tests = discoverTestsInFile(mockUri(f), 'sample.spec.ts');
    expect(tests.map((t) => t.name).sort()).toEqual(['bar', 'foo']);
  });

  it('prefixes with describe blocks', () => {
    const f = tmpFile(`
      describe('Login', () => {
        test('redirects', () => {});
        describe('errors', () => {
          test('shows banner', () => {});
        });
      });
    `);
    const tests = discoverTestsInFile(mockUri(f), 'x.spec.ts');
    const fullNames = tests.map((t) => t.fullName).sort();
    expect(fullNames).toContain('Login > redirects');
    expect(fullNames).toContain('Login > errors > shows banner');
  });

  it('ignores commented-out tests', () => {
    const f = tmpFile(`
      // test('not me', () => {});
      /* test('also not me', () => {}); */
      test('only me', () => {});
    `);
    const tests = discoverTestsInFile(mockUri(f), 'x.spec.ts');
    expect(tests.map((t) => t.name)).toEqual(['only me']);
  });
});
