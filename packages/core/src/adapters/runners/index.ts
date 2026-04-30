import type { RunnerConfig } from '../../types.js';
import type { RunnerAdapter } from './base.js';
import { PlaywrightRunner } from './playwright.js';
import { PytestRunner } from './pytest.js';
import { JestRunner } from './jest.js';
import { VitestRunner } from './vitest.js';
import { CustomRunner } from './custom.js';

export { PlaywrightRunner } from './playwright.js';
export { PytestRunner } from './pytest.js';
export { JestRunner } from './jest.js';
export { VitestRunner } from './vitest.js';
export { CustomRunner } from './custom.js';
export type { RunnerAdapter } from './base.js';

export function createRunner(config: RunnerConfig): RunnerAdapter {
  switch (config.type) {
    case 'playwright':
      return new PlaywrightRunner(config);
    case 'pytest':
      return new PytestRunner(config);
    case 'jest':
      return new JestRunner(config);
    case 'vitest':
      return new VitestRunner(config);
    case 'custom': {
      if (!config.command) {
        throw new Error(
          'runner.command is required when runner.type is "custom".',
        );
      }
      return new CustomRunner(config.command, config);
    }
  }
}
