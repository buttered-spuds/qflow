import type { RunOptions, RunReport } from '../../types.js';

export interface RunnerAdapter {
  run(options: RunOptions): Promise<RunReport>;
}
