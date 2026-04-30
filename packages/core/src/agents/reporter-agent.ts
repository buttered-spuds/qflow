import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { QFlowConfig, RunReport } from '../types.js';
import { SlackAdapter } from '../adapters/notifications/slack.js';
import { TeamsAdapter } from '../adapters/notifications/teams.js';
import { JiraAdapter } from '../adapters/notifications/jira.js';
import type { NotificationAdapter } from '../adapters/notifications/base.js';
import { publishToGhPages } from '../utils/gh-pages-publisher.js';
import { FlakinessAgent } from './flakiness-agent.js';
import { SelfHealingAgent } from './self-healing-agent.js';
import { createLLMAdapter } from '../adapters/llm/index.js';
import { CostLedger, trackUsage } from '../utils/cost-ledger.js';

export interface ReporterOptions {
  /** If true, skip all notifications and gh-pages publishing. */
  local: boolean;
  cwd: string;
  /** Passed from Phase 3 Generator Agent when a specific ticket triggered the run. */
  jiraTicketKey?: string;
}

export class ReporterAgent {
  private readonly adapters: NotificationAdapter[];

  constructor(private readonly config: QFlowConfig) {
    this.adapters = buildAdapters(config);
  }

  async report(report: RunReport, opts: ReporterOptions): Promise<void> {
    // Always persist locally first — this is the source of truth for the local dashboard
    await this.#persistLocally(report, opts.cwd);

    // ── Flakiness analysis (runs after every persist, even locally) ──────────
    const flakinessAgent = new FlakinessAgent(this.config, this.adapters);
    const flakinessResult = await flakinessAgent.analyse(opts.cwd).catch((err: unknown) => {
      console.warn(`[qflow] Flakiness analysis failed: ${String(err)}`);
      return null;
    });
    if (flakinessResult?.newlyQuarantined.length) {
      console.log(
        `[qflow] Quarantined ${flakinessResult.newlyQuarantined.length} new flaky test(s): ${flakinessResult.newlyQuarantined.join(', ')}`,
      );
    }

    // ── Self-healing (only when LLM + selfHealing configured, tests failed) ──
    if (this.config.llm && this.config.selfHealing && report.failed > 0) {
      const llm = createLLMAdapter(this.config.llm);
      const healer = new SelfHealingAgent(
        llm,
        this.config.selfHealing.autoCommit ?? false,
      );
      const healResult = await healer.heal(report.tests, opts.cwd).catch((err: unknown) => {
        console.warn(`[qflow] Self-healing failed: ${String(err)}`);
        return null;
      });
      if (healResult && healResult.healed.length > 0) {
        console.log(`[qflow] Self-healed ${healResult.healed.length} selector(s)`);

        // Track cost
        const ledger = new CostLedger(opts.cwd);
        await ledger.open();
        await trackUsage(ledger, llm.getLastUsage(), 'self-heal', this.config.llm.provider, this.config.llm.model);
        ledger.close();
      }
    }

    if (opts.local) {
      return;
    }

    // Run gh-pages publish and notifications in parallel; collect errors so one
    // failing channel doesn't block the others.
    const tasks: Array<Promise<string | void>> = [];

    // ── GitHub Pages ────────────────────────────────────────────────────────
    let dashboardUrl: string | undefined;
    if (this.config.dashboard?.githubPages) {
      tasks.push(
        publishToGhPages({
          report,
          branch: this.config.dashboard.branch ?? 'gh-pages',
          cwd: opts.cwd,
        }).then((url) => {
          dashboardUrl = url || undefined;
          return url;
        }),
      );
    }

    // Publish first so we have the URL for notifications
    await Promise.allSettled(tasks.filter((_, i) => i === 0));

    // ── Notifications ────────────────────────────────────────────────────────
    const notifyResults = await Promise.allSettled(
      this.adapters.map((adapter) => {
        if (adapter instanceof JiraAdapter && opts.jiraTicketKey) {
          return adapter.send(report, dashboardUrl);
        }
        return adapter.send(report, dashboardUrl);
      }),
    );

    const errors = notifyResults
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason));

    if (errors.length > 0) {
      console.warn(`\n[qflow] Warning: ${errors.length} notification(s) failed:\n${errors.map((e) => `  • ${e}`).join('\n')}\n`);
    }
  }

  async #persistLocally(report: RunReport, cwd: string): Promise<void> {
    const dir = join(cwd, '.qflow', 'data');
    await mkdir(dir, { recursive: true });
    const safeTimestamp = report.timestamp.replace(/[:.]/g, '-');
    const filename = `run-${safeTimestamp}.json`;
    await writeFile(join(dir, filename), JSON.stringify(report, null, 2), 'utf-8');
  }
}

function buildAdapters(config: QFlowConfig): NotificationAdapter[] {
  const adapters: NotificationAdapter[] = [];

  if (config.notifications?.slack?.webhookUrl) {
    adapters.push(new SlackAdapter(config.notifications.slack.webhookUrl));
  }

  if (config.notifications?.teams?.webhookUrl) {
    adapters.push(new TeamsAdapter(config.notifications.teams.webhookUrl));
  }

  if (config.notifications?.jira?.writeResults && config.jira) {
    adapters.push(
      new JiraAdapter({
        url: config.jira.url,
        token: config.jira.token,
        project: config.jira.project,
      }),
    );
  }

  return adapters;
}
