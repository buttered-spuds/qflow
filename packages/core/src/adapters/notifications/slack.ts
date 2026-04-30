import type { RunReport } from '../../types.js';
import type { NotificationAdapter } from './base.js';

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

function statusEmoji(report: RunReport): string {
  return report.failed > 0 ? ':x:' : ':white_check_mark:';
}

function buildBlocks(report: RunReport, dashboardUrl?: string): SlackBlock[] {
  const emoji = statusEmoji(report);
  const status = report.failed > 0 ? 'FAILED' : 'PASSED';
  const duration = formatDuration(report.duration);

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} qflow · ${report.suite} · ${status}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Runner*\n${report.runner}` },
        { type: 'mrkdwn', text: `*Suite*\n${report.suite}` },
        { type: 'mrkdwn', text: `*Passed*\n${report.passed} / ${report.total}` },
        { type: 'mrkdwn', text: `*Failed*\n${report.failed > 0 ? `*${report.failed}*` : '0'}` },
        { type: 'mrkdwn', text: `*Duration*\n${duration}` },
        {
          type: 'mrkdwn',
          text: `*Branch*\n${report.branch ? `\`${report.branch}\`` : '_unknown_'}`,
        },
      ],
    },
  ];

  // List failing tests (up to 10)
  const failed = report.tests.filter((t) => t.status === 'failed').slice(0, 10);
  if (failed.length > 0) {
    const failList = failed.map((t) => `• ${t.fullName}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Failing tests*\n${failList}` },
    });
  }

  if (dashboardUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Dashboard' },
          url: dashboardUrl,
          action_id: 'view_dashboard',
        },
      ],
    });
  }

  blocks.push({ type: 'divider' });

  return blocks;
}

export class SlackAdapter implements NotificationAdapter {
  constructor(private readonly webhookUrl: string) {}

  async send(report: RunReport, dashboardUrl?: string): Promise<void> {
    const body = JSON.stringify({
      blocks: buildBlocks(report, dashboardUrl),
      text: `qflow ${report.suite}: ${report.passed}/${report.total} passed`, // fallback
    });

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Slack webhook failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
