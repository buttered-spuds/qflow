import type { QFlowConfig, RunOptions, RunReport } from '../types.js';
import { createRunner } from '../adapters/runners/index.js';
import { SmartSelector } from './smart-selector.js';
import { createLLMAdapter } from '../adapters/llm/index.js';

export class RunnerAgent {
  constructor(private readonly config: QFlowConfig) {}

  async run(options: RunOptions): Promise<RunReport> {
    // Smart selection: only filter when suite is 'pr-smart' and enabled in config
    if (options.suite === 'pr-smart' && this.config.smartSelection?.enabled !== false) {
      const llm = this.config.llm ? createLLMAdapter(this.config.llm) : undefined;
      const selector = new SmartSelector(options.cwd, llm);
      const selection = await selector.select();

      if (selection.strategy !== 'all' && selection.testFiles.length > 0) {
        console.log(
          `[qflow] Smart selection (${selection.strategy}): running ${selection.testFiles.length} file(s) from ${selection.changedFiles.length} changed file(s)`,
        );
        // Pass the file list to the runner via env — runner adapters read QFLOW_TEST_FILES
        options = {
          ...options,
          env: {
            ...options.env,
            QFLOW_TEST_FILES: selection.testFiles.join(','),
          },
        };
      } else if (selection.strategy === 'all') {
        console.log('[qflow] Smart selection: running full suite (config/infra change detected)');
      }
    }

    const runner = createRunner(this.config.runner);
    return runner.run(options);
  }
}
