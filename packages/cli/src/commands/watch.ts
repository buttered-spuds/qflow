import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync, watch as fsWatch } from 'fs';
import { join } from 'path';

interface WatchOptions {
  suite?: string;
  env?: string;
  /** Glob/path to watch. Defaults to 'src,tests'. */
  paths?: string;
}

const DEBOUNCE_MS = 400;

/**
 * Re-runs `qflow run` whenever a file under the watched paths changes.
 * Lightweight — uses node's fs.watch (recursive) rather than a heavy chokidar dep.
 */
export async function watchCommand(options: WatchOptions): Promise<void> {
  const cwd = process.cwd();
  const paths = (options.paths ?? 'src,tests').split(',').map((p) => p.trim()).filter(Boolean);
  const targets = paths.filter((p) => existsSync(join(cwd, p)));

  if (targets.length === 0) {
    console.error(chalk.red('\n  No watchable directories found. Pass --paths "<dir1>,<dir2>".\n'));
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n  qflow watch'));
  console.log(chalk.dim(`  Watching: ${targets.join(', ')}`));
  console.log(chalk.dim(`  Suite:    ${options.suite ?? 'pr-smart'}`));
  console.log(chalk.dim('  Press Ctrl+C to exit.\n'));

  let runScheduled: NodeJS.Timeout | null = null;
  let running = false;

  const trigger = (): void => {
    if (runScheduled) clearTimeout(runScheduled);
    runScheduled = setTimeout(() => {
      runScheduled = null;
      if (running) return;
      running = true;
      runOnce(options).then(() => {
        running = false;
      });
    }, DEBOUNCE_MS);
  };

  for (const t of targets) {
    fsWatch(join(cwd, t), { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (filename.toString().includes('node_modules')) return;
      if (filename.toString().includes('.qflow')) return;
      trigger();
    });
  }

  // Initial run
  await runOnce(options);
}

function runOnce(options: WatchOptions): Promise<void> {
  return new Promise((resolve) => {
    console.log(chalk.dim(`\n  ── ${new Date().toLocaleTimeString()} ──`));
    const args = ['@qflow/cli', 'run', '--suite', options.suite ?? 'pr-smart'];
    if (options.env) args.push('--env', options.env);
    const child = spawn('npx', args, { stdio: 'inherit' });
    child.on('exit', () => resolve());
  });
}
