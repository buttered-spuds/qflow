import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../src/config.js';

async function makeTempProject(configContent: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qflow-config-'));
  await writeFile(join(dir, 'framework.config.ts'), configContent, 'utf-8');
  return dir;
}

describe('loadConfig', () => {
  it('loads a minimal valid config', async () => {
    const dir = await makeTempProject(`
      const config = { runner: { type: 'playwright' } };
      export default config;
    `);
    const cfg = await loadConfig(dir);
    expect(cfg.runner.type).toBe('playwright');
    await rm(dir, { recursive: true });
  });

  it('accepts testingContext.modes as a valid array', async () => {
    const dir = await makeTempProject(`
      const config = {
        runner: { type: 'playwright' },
        testingContext: { modes: ['ui', 'api'] },
      };
      export default config;
    `);
    const cfg = await loadConfig(dir);
    expect(cfg.testingContext?.modes).toEqual(['ui', 'api']);
    await rm(dir, { recursive: true });
  });

  it("rejects testingContext when modes include 'unit' but sourcePath is missing", async () => {
    const dir = await makeTempProject(`
      const config = {
        runner: { type: 'jest' },
        testingContext: { modes: ['unit'] },
      };
      export default config;
    `);
    await expect(loadConfig(dir)).rejects.toThrow(/sourcePath/i);
    await rm(dir, { recursive: true });
  });

  it('accepts unit mode when sourcePath is provided', async () => {
    const dir = await makeTempProject(`
      const config = {
        runner: { type: 'vitest' },
        testingContext: { modes: ['unit'], sourcePath: 'src' },
      };
      export default config;
    `);
    const cfg = await loadConfig(dir);
    expect(cfg.testingContext?.sourcePath).toBe('src');
    await rm(dir, { recursive: true });
  });

  it('rejects empty modes array', async () => {
    const dir = await makeTempProject(`
      const config = {
        runner: { type: 'playwright' },
        testingContext: { modes: [] },
      };
      export default config;
    `);
    await expect(loadConfig(dir)).rejects.toThrow(/at least one/i);
    await rm(dir, { recursive: true });
  });

  it('rejects invalid runner type', async () => {
    const dir = await makeTempProject(`
      const config = { runner: { type: 'mocha' } };
      export default config;
    `);
    await expect(loadConfig(dir)).rejects.toThrow();
    await rm(dir, { recursive: true });
  });

  it('throws when no config file is found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qflow-noconfig-'));
    await expect(loadConfig(dir)).rejects.toThrow();
    await rm(dir, { recursive: true });
  });
});
