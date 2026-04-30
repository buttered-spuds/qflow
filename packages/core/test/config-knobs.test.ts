import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../src/config.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'qflow-cfg4-'));
});

afterEach(async () => {
  delete process.env.QFLOW_TEST_VAR;
  await rm(cwd, { recursive: true, force: true });
});

async function writeConfig(body: string): Promise<void> {
  await writeFile(join(cwd, 'framework.config.ts'), body, 'utf-8');
}

describe('runner config knobs', () => {
  it('accepts baseUrl/workers/retries/timeoutMs/env', async () => {
    await writeConfig(`export default {
  runner: {
    type: 'playwright',
    baseUrl: 'https://example.com',
    workers: 4,
    retries: 2,
    timeoutMs: 30000,
    env: { FOO: 'bar' },
  },
};`);
    const cfg = await loadConfig(cwd);
    expect(cfg.runner.baseUrl).toBe('https://example.com');
    expect(cfg.runner.workers).toBe(4);
    expect(cfg.runner.retries).toBe(2);
    expect(cfg.runner.timeoutMs).toBe(30000);
    expect(cfg.runner.env?.FOO).toBe('bar');
  });

  it('rejects negative workers', async () => {
    await writeConfig(`export default { runner: { type: 'jest', workers: -1 } };`);
    await expect(loadConfig(cwd)).rejects.toThrow(/workers/);
  });

  it('rejects retries > 10', async () => {
    await writeConfig(`export default { runner: { type: 'jest', retries: 99 } };`);
    await expect(loadConfig(cwd)).rejects.toThrow(/retries/);
  });
});

describe('${VAR} interpolation', () => {
  it('interpolates host env vars in runner.env', async () => {
    process.env.QFLOW_TEST_VAR = 'secret-value';
    await writeConfig(`export default {
  runner: { type: 'jest', env: { TOKEN: '\${QFLOW_TEST_VAR}' } },
};`);
    const cfg = await loadConfig(cwd);
    expect(cfg.runner.env?.TOKEN).toBe('secret-value');
  });

  it('throws when a referenced env var is missing', async () => {
    delete process.env.QFLOW_TEST_VAR;
    await writeConfig(`export default {
  runner: { type: 'jest', env: { TOKEN: '\${QFLOW_TEST_VAR}' } },
};`);
    await expect(loadConfig(cwd)).rejects.toThrow(/QFLOW_TEST_VAR/);
  });

  it('interpolates env in environment profiles', async () => {
    process.env.QFLOW_TEST_VAR = 'staging-token';
    await writeConfig(`export default {
  runner: { type: 'jest' },
  environments: {
    staging: { baseUrl: 'https://staging.example.com', env: { TOKEN: '\${QFLOW_TEST_VAR}' } },
  },
};`);
    const cfg = await loadConfig(cwd);
    expect(cfg.environments?.staging.baseUrl).toBe('https://staging.example.com');
    expect(cfg.environments?.staging.env?.TOKEN).toBe('staging-token');
  });
});

describe('environments + tags', () => {
  it('parses environments map', async () => {
    await writeConfig(`export default {
  runner: { type: 'jest' },
  environments: {
    staging: { baseUrl: 'https://staging.example.com' },
    prod:    { baseUrl: 'https://www.example.com' },
  },
};`);
    const cfg = await loadConfig(cwd);
    expect(Object.keys(cfg.environments ?? {})).toEqual(['staging', 'prod']);
  });

  it('parses tags.smoke and tags.regression', async () => {
    await writeConfig(`export default {
  runner: { type: 'jest' },
  tags: { smoke: ['@smoke', '@critical'], regression: ['@regression'] },
};`);
    const cfg = await loadConfig(cwd);
    expect(cfg.tags?.smoke).toEqual(['@smoke', '@critical']);
    expect(cfg.tags?.regression).toEqual(['@regression']);
  });
});
