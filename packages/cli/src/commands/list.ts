import chalk from 'chalk';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { loadConfig, RepoContextAgent } from '@qflow/core';
import type { RunReport } from '@qflow/core';

type ListTarget = 'tests' | 'suites' | 'tickets' | 'runs' | 'page-objects' | 'fixtures';

const VALID: ListTarget[] = ['tests', 'suites', 'tickets', 'runs', 'page-objects', 'fixtures'];

export async function listCommand(target: string | undefined): Promise<void> {
  const cwd = process.cwd();

  if (!target || !VALID.includes(target as ListTarget)) {
    console.error(
      chalk.red(`\n  Usage: qflow list <${VALID.join('|')}>\n`),
    );
    process.exit(1);
  }

  const t = target as ListTarget;

  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  console.log(chalk.bold.cyan(`\n  qflow list ${t}\n`));

  switch (t) {
    case 'suites':
      console.log('  ' + chalk.bold('regression') + chalk.dim(' — full suite (default)'));
      console.log('  ' + chalk.bold('smoke') + chalk.dim('      — tests tagged @smoke or matching tags.smoke'));
      console.log('  ' + chalk.bold('pr-smart') + chalk.dim('   — only tests touched by the current PR diff'));
      if (config.tags?.smoke?.length) {
        console.log(chalk.dim(`\n  tags.smoke      = ${config.tags.smoke.join(', ')}`));
      }
      if (config.tags?.regression?.length) {
        console.log(chalk.dim(`  tags.regression = ${config.tags.regression.join(', ')}`));
      }
      console.log();
      return;

    case 'runs': {
      const dir = join(cwd, '.qflow', 'data');
      if (!existsSync(dir)) {
        console.log(chalk.dim('  No runs yet.\n'));
        return;
      }
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 20);
      for (const f of files) {
        const r = JSON.parse(await readFile(join(dir, f), 'utf-8')) as RunReport;
        const status = r.failed > 0 ? chalk.red('✗') : chalk.green('✓');
        console.log(`  ${status} ${chalk.dim(r.timestamp.slice(0, 19))}  ${r.suite.padEnd(10)} ${r.passed}p / ${r.failed}f / ${r.skipped}s   ${chalk.dim(r.id.slice(0, 8))}`);
      }
      console.log();
      return;
    }

    case 'tests':
    case 'page-objects':
    case 'fixtures': {
      const ctx = await new RepoContextAgent().scan(cwd, config.testingContext);
      if (t === 'tests') {
        if (ctx.exampleTests.length === 0) console.log(chalk.dim('  (no test files discovered)'));
        for (const ex of ctx.exampleTests) {
          console.log(`  ${chalk.cyan(ex.kind.padEnd(10))} ${ex.file}` + (ex.firstTitle ? chalk.dim(`  — "${ex.firstTitle}"`) : ''));
        }
      } else if (t === 'page-objects') {
        if (ctx.pageObjects.length === 0) console.log(chalk.dim('  (no page objects discovered)'));
        for (const po of ctx.pageObjects) {
          console.log(`  ${chalk.bold(po.className)} ${chalk.dim(po.file)}`);
          console.log(chalk.dim(`    methods: ${po.methods.join(', ') || '(none)'}`));
        }
      } else {
        if (ctx.fixtures.length === 0) console.log(chalk.dim('  (no fixtures discovered)'));
        for (const f of ctx.fixtures) {
          console.log(`  ${f.file}`);
          console.log(chalk.dim(`    exports: ${f.exports.join(', ') || '(none)'}`));
        }
      }
      console.log();
      return;
    }

    case 'tickets':
      console.log(chalk.dim('  Listing tickets requires a JIRA/ADO API call. Use your provider UI for now.\n'));
      return;
  }
}
