import chalk from 'chalk';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

const PACKAGES = ['@qflow/core', '@qflow/cli'] as const;

/**
 * Bumps qflow packages in the current project to the latest version on npm.
 * Reads package.json, fetches `npm view <pkg> version` for each, rewrites the
 * pinned versions, and (unless --dry-run) runs the project's package manager.
 */
export async function upgradeCommand(options: { dryRun?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const pkgPath = join(cwd, 'package.json');

  if (!existsSync(pkgPath)) {
    console.error(chalk.red('\n  Error: no package.json in the current directory.\n'));
    process.exit(1);
  }

  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  console.log(chalk.bold.cyan('\n  qflow upgrade\n'));

  let changed = false;

  for (const name of PACKAGES) {
    const current = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    if (!current) {
      console.log(chalk.dim(`  ${name}: not installed (skipped)`));
      continue;
    }

    let latest: string;
    try {
      const { stdout } = await execFileP('npm', ['view', name, 'version']);
      latest = stdout.trim();
    } catch {
      console.log(chalk.yellow(`  ${name}: could not fetch latest from registry`));
      continue;
    }

    if (current.replace(/^[\^~]/, '') === latest) {
      console.log(chalk.dim(`  ${name}: already at ${latest}`));
      continue;
    }

    console.log(`  ${chalk.bold(name)}: ${chalk.red(current)} → ${chalk.green('^' + latest)}`);
    if (pkg.dependencies?.[name]) pkg.dependencies[name] = `^${latest}`;
    if (pkg.devDependencies?.[name]) pkg.devDependencies[name] = `^${latest}`;
    changed = true;
  }

  if (!changed) {
    console.log(chalk.green('\n  Already up to date.\n'));
    return;
  }

  if (options.dryRun) {
    console.log(chalk.dim('\n  --dry-run: package.json not modified.\n'));
    return;
  }

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(chalk.green('\n  ✓ package.json updated.'));
  console.log(chalk.dim('  Run your package manager (npm install / pnpm install / yarn) to apply.\n'));
}
