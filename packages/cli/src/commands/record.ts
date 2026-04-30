import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface RecordOptions {
  output?: string;
}

/**
 * Thin wrapper around `npx playwright codegen` that drops the captured spec
 * into the project's standard tests/ui/ directory.
 */
export async function recordCommand(url: string | undefined, options: RecordOptions): Promise<void> {
  if (!url) {
    console.error(chalk.red('\n  Usage: qflow record <url> [-o tests/ui/my.spec.ts]\n'));
    process.exit(1);
  }

  const cwd = process.cwd();
  if (!existsSync(join(cwd, 'package.json'))) {
    console.error(chalk.red('\n  Error: not in a project directory (no package.json).\n'));
    process.exit(1);
  }

  const output = options.output ?? `tests/ui/recorded-${Date.now()}.spec.ts`;

  console.log(chalk.bold.cyan('\n  qflow record'));
  console.log(chalk.dim(`  URL:    ${url}`));
  console.log(chalk.dim(`  Output: ${output}\n`));
  console.log(chalk.dim('  Launching Playwright Inspector. Close the browser when done.\n'));

  const child = spawn(
    'npx',
    ['playwright', 'codegen', '--target=playwright-test', `--output=${output}`, url],
    { cwd, stdio: 'inherit' },
  );

  await new Promise<void>((resolve) => child.on('exit', () => resolve()));

  if (existsSync(join(cwd, output))) {
    console.log(chalk.green(`\n  ✓ Saved ${output}\n`));
    console.log(chalk.dim('  Tip: review the file and rewrite hard-coded selectors using getByRole / getByLabel before committing.\n'));
  }
}
