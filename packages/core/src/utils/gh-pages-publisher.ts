import { execa } from 'execa';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { RunReport, Manifest, ManifestEntry } from '../types.js';

const MAX_RETRIES = 3;
const DATA_DIR = 'data';
const MANIFEST_FILE = 'data/manifest.json';

interface PublishOptions {
  report: RunReport;
  branch: string;
  cwd: string;
}

/**
 * Commits a new run JSON file and updates manifest.json on the gh-pages branch.
 * Uses a worktree so we don't disturb the current checkout.
 * Retries up to MAX_RETRIES times on push conflicts (parallel CI runs).
 */
export async function publishToGhPages(opts: PublishOptions): Promise<string> {
  const { report, branch, cwd } = opts;

  // Filename safe timestamp: 2026-04-29T10-30-00.000Z
  const safeTimestamp = report.timestamp.replace(/[:.]/g, '-');
  const runFilename = `${DATA_DIR}/run-${safeTimestamp}.json`;
  const runUrl = `${DATA_DIR}/run-${safeTimestamp}.json`;

  // Use a worktree in a temp dir so we can commit to gh-pages without switching branch
  const worktreePath = join(cwd, '.qflow', 'gh-pages-worktree');

  try {
    await setupWorktree(cwd, branch, worktreePath);
    await mkdir(join(worktreePath, DATA_DIR), { recursive: true });

    // Write the run JSON
    await writeFile(
      join(worktreePath, runFilename),
      JSON.stringify(report, null, 2),
      'utf-8',
    );

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Always pull latest manifest before updating (handles parallel runs)
      if (attempt > 1) {
        await execa('git', ['pull', '--rebase', 'origin', branch], {
          cwd: worktreePath,
          reject: false,
        });
      }

      const manifest = await readOrCreateManifest(worktreePath);

      // Append this run to the manifest
      const entry: ManifestEntry = {
        id: report.id,
        timestamp: report.timestamp,
        suite: report.suite,
        passed: report.passed,
        failed: report.failed,
        total: report.total,
        file: runFilename,
      };

      // Deduplicate by id in case of retry
      manifest.runs = manifest.runs.filter((r) => r.id !== entry.id);
      manifest.runs.push(entry);
      // Keep newest first, cap at 500 entries
      manifest.runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (manifest.runs.length > 500) {
        manifest.runs = manifest.runs.slice(0, 500);
      }
      manifest.lastUpdated = new Date().toISOString();

      await writeFile(
        join(worktreePath, MANIFEST_FILE),
        JSON.stringify(manifest, null, 2),
        'utf-8',
      );

      await execa('git', ['add', runFilename, MANIFEST_FILE], { cwd: worktreePath });

      const commitMsg = `chore: add run ${report.id.slice(0, 8)} [${report.suite}] ${report.passed}/${report.total} passed`;
      await execa('git', ['commit', '-m', commitMsg], { cwd: worktreePath });

      const pushResult = await execa('git', ['push', 'origin', branch], {
        cwd: worktreePath,
        reject: false,
      });

      if (pushResult.exitCode === 0) {
        // Return the dashboard URL (GitHub Pages convention)
        const repoUrl = await getRepoUrl(cwd);
        return repoUrl ? `${repoUrl}#runs` : '';
      }

      // Push failed — likely a conflict. Reset the commit and retry.
      await execa('git', ['reset', 'HEAD~1'], { cwd: worktreePath });
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Failed to push to gh-pages after ${MAX_RETRIES} attempts:\n${pushResult.stderr}`,
        );
      }
    }
  } finally {
    // Always clean up the worktree
    await execa('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd,
      reject: false,
    });
  }

  return '';
}

async function setupWorktree(
  cwd: string,
  branch: string,
  worktreePath: string,
): Promise<void> {
  // Remove any stale worktree first
  await execa('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd,
    reject: false,
  });

  // Check if the branch exists (local or remote)
  const localBranch = await execa(
    'git',
    ['rev-parse', '--verify', `refs/heads/${branch}`],
    { cwd, reject: false },
  );

  if (localBranch.exitCode === 0) {
    // Branch exists locally
    await execa('git', ['worktree', 'add', worktreePath, branch], { cwd });
  } else {
    // Try remote
    const remoteBranch = await execa(
      'git',
      ['rev-parse', '--verify', `refs/remotes/origin/${branch}`],
      { cwd, reject: false },
    );

    if (remoteBranch.exitCode === 0) {
      await execa('git', ['worktree', 'add', worktreePath, '--track', '-b', branch, `origin/${branch}`], { cwd });
    } else {
      // Branch doesn't exist yet — create an orphan branch
      await execa('git', ['worktree', 'add', '--orphan', '-b', branch, worktreePath], { cwd });
      await execa('git', ['commit', '--allow-empty', '-m', 'chore: init gh-pages branch'], {
        cwd: worktreePath,
      });
      await execa('git', ['push', '--set-upstream', 'origin', branch], {
        cwd: worktreePath,
        reject: false,
      });
    }
  }
}

async function readOrCreateManifest(worktreePath: string): Promise<Manifest> {
  const manifestPath = join(worktreePath, MANIFEST_FILE);
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as Manifest;
  } catch {
    return { runs: [], quarantined: [], lastUpdated: new Date().toISOString() };
  }
}

async function getRepoUrl(cwd: string): Promise<string> {
  try {
    const result = await execa('git', ['remote', 'get-url', 'origin'], { cwd });
    const remote = result.stdout.trim();
    // Convert SSH remote to HTTPS Pages URL
    // git@github.com:owner/repo.git  → https://owner.github.io/repo
    // https://github.com/owner/repo  → https://owner.github.io/repo
    const sshMatch = remote.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return `https://${sshMatch[1]}.github.io/${sshMatch[2]}`;
    }
    const httpsMatch = remote.match(/https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      return `https://${httpsMatch[1]}.github.io/${httpsMatch[2]}`;
    }
  } catch {
    // Not a git repo or no remote — silently ignore
  }
  return '';
}
