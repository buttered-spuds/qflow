import * as vscode from 'vscode';
import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

export class RunnerService implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;
  private cachedToken: string | undefined;

  constructor() {
    this.channel = vscode.window.createOutputChannel('qflow');
  }

  /** Run a qflow CLI command in the workspace root. Returns when the process exits. */
  async run(args: string[]): Promise<void> {
    const cwd = this.getWorkspaceRoot();
    if (!cwd) {
      throw new Error('No workspace folder is open.');
    }

    this.channel.show(true);
    this.channel.appendLine('');
    this.channel.appendLine(`─────────────────────────────────────────`);
    this.channel.appendLine(`  qflow ${args.join(' ')}`);
    this.channel.appendLine(`─────────────────────────────────────────`);

    const { cmd, cmdArgs } = this.resolveCommand(args, cwd);
    const env = this.buildEnv();

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, cmdArgs, {
        cwd,
        shell: process.platform === 'win32',
        env,
      });

      proc.stdout?.on('data', (data: Buffer) => {
        this.channel.append(data.toString());
      });

      proc.stderr?.on('data', (data: Buffer) => {
        this.channel.append(data.toString());
      });

      proc.on('error', (err: Error) => {
        this.channel.appendLine(`\n  Error: ${err.message}`);
        reject(err);
      });

      proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (code === 0) {
          resolve();
        } else {
          const msg = code !== null
            ? `qflow exited with code ${code}`
            : `qflow was terminated by signal ${signal ?? 'unknown'}`;
          this.channel.appendLine(`\n  ${msg}`);
          reject(new Error(msg));
        }
      });
    });
  }

  /** Show the output channel without running a command. */
  showOutput(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }

  getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private resolveCommand(args: string[], cwd: string): { cmd: string; cmdArgs: string[] } {
    // If a custom cli path is configured, use it directly.
    const configPath: string = vscode.workspace.getConfiguration('qflow').get('cliPath', '');
    if (configPath) {
      return { cmd: configPath, cmdArgs: args };
    }

    // Prefer a locally installed binary inside the project.
    // On Windows the shim is `qflow.cmd`; on POSIX it is just `qflow`.
    const binDir = join(cwd, 'node_modules', '.bin');
    const localBin = process.platform === 'win32'
      ? join(binDir, 'qflow.cmd')
      : join(binDir, 'qflow');
    if (existsSync(localBin)) {
      return { cmd: localBin, cmdArgs: args };
    }

    // Fall back to npx.
    return { cmd: 'npx', cmdArgs: ['@qflow/cli', ...args] };
  }

  /**
   * Build the subprocess environment, injecting GITHUB_TOKEN from whichever
   * source is available so the user never has to configure it manually:
   *   1. Already present in process.env (launched from terminal)
   *   2. VS Code setting qflow.githubToken
   *   3. `gh auth token` (GitHub CLI — most common local setup)
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (env['GITHUB_TOKEN']) return env;

    // VS Code setting override
    const settingToken: string = vscode.workspace.getConfiguration('qflow').get('githubToken', '');
    if (settingToken) {
      env['GITHUB_TOKEN'] = settingToken;
      return env;
    }

    // Try `gh auth token` (cached per RunnerService instance)
    if (!this.cachedToken) {
      try {
        this.cachedToken = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      } catch {
        // gh CLI not installed or not authenticated — leave token unset
      }
    }
    if (this.cachedToken) env['GITHUB_TOKEN'] = this.cachedToken;

    return env;
  }
}
