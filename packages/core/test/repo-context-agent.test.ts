import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RepoContextAgent } from '../src/agents/repo-context-agent.js';

let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'qflow-repoctx-'));
  // Page Object
  await mkdir(join(cwd, 'tests', 'pages'), { recursive: true });
  await writeFile(
    join(cwd, 'tests', 'pages', 'LoginPage.ts'),
    `import { Page } from '@playwright/test';
export class LoginPage {
  constructor(private page: Page) {}
  async login(user: string, pass: string) { /* ... */ }
  async getError() { return ''; }
  private _internal() {}
}
`,
    'utf-8',
  );
  // Fixture
  await mkdir(join(cwd, 'tests', 'fixtures'), { recursive: true });
  await writeFile(
    join(cwd, 'tests', 'fixtures', 'users.ts'),
    `export const adminUser = { name: 'admin' };
export function makeUser(role: string) { return { role }; }
export class UserFactory {}
`,
    'utf-8',
  );
  // Example UI test
  await mkdir(join(cwd, 'tests', 'ui'), { recursive: true });
  await writeFile(
    join(cwd, 'tests', 'ui', 'login.spec.ts'),
    `import { test } from '@playwright/test';
test.describe('Login', () => {
  test('user can log in', async () => {});
});
`,
    'utf-8',
  );
  // package.json
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({ devDependencies: { '@playwright/test': '^1.50.0' } }),
    'utf-8',
  );
  // tsconfig.json with paths
  await writeFile(
    join(cwd, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }),
    'utf-8',
  );
});

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('RepoContextAgent.scan', () => {
  it('discovers Page Object classes and their public methods', async () => {
    const ctx = await new RepoContextAgent().scan(cwd, { modes: ['ui'] });
    expect(ctx.pageObjects).toHaveLength(1);
    expect(ctx.pageObjects[0].className).toBe('LoginPage');
    expect(ctx.pageObjects[0].methods).toContain('login');
    expect(ctx.pageObjects[0].methods).toContain('getError');
    // private methods stripped
    expect(ctx.pageObjects[0].methods).not.toContain('_internal');
  });

  it('discovers fixtures and their exports', async () => {
    const ctx = await new RepoContextAgent().scan(cwd, { modes: ['ui'] });
    expect(ctx.fixtures.length).toBeGreaterThan(0);
    const exports = ctx.fixtures[0].exports;
    expect(exports).toEqual(expect.arrayContaining(['adminUser', 'makeUser', 'UserFactory']));
  });

  it('discovers example tests for matching modes', async () => {
    const ctx = await new RepoContextAgent().scan(cwd, { modes: ['ui'] });
    expect(ctx.exampleTests.length).toBeGreaterThan(0);
    expect(ctx.exampleTests[0].kind).toBe('ui');
    expect(ctx.exampleTests[0].firstTitle).toBe('Login');
  });

  it('detects pinned runner version', async () => {
    const ctx = await new RepoContextAgent().scan(cwd, { modes: ['ui'] });
    expect(ctx.runnerVersion).toContain('@playwright/test');
  });

  it('reads tsconfig path aliases', async () => {
    const ctx = await new RepoContextAgent().scan(cwd, { modes: ['ui'] });
    expect(ctx.tsconfigPaths['@/*']).toEqual(['src/*']);
  });
});

describe('RepoContextAgent.format', () => {
  it('returns a non-empty string with reuse instructions when context is rich', async () => {
    const ctx = await new RepoContextAgent().scan(cwd, { modes: ['ui'] });
    const formatted = new RepoContextAgent().format(ctx);
    expect(formatted).toContain('REUSE');
    expect(formatted).toContain('LoginPage');
  });

  it('returns empty string for an empty context', () => {
    const formatted = new RepoContextAgent().format({
      pageObjects: [],
      fixtures: [],
      exampleTests: [],
      tsconfigPaths: {},
    });
    expect(formatted).toBe('');
  });
});
