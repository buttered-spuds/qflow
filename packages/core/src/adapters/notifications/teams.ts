import type { RunReport } from '../../types.js';
import type { NotificationAdapter } from './base.js';

// Teams Incoming Webhook uses the legacy "MessageCard" format for maximum
// compatibility. The newer Adaptive Cards format requires a different
// connector type. MessageCard works with all standard Teams webhooks.

function themeColor(report: RunReport): string {
  return report.failed > 0 ? 'FF0000' : '3FB950';
}

function buildCard(report: RunReport, dashboardUrl?: string): object {
  const status = report.failed > 0 ? '❌ FAILED' : '✅ PASSED';
  const duration = formatDuration(report.duration);

  const facts = [
    { name: 'Runner', value: report.runner },
    { name: 'Suite', value: report.suite },
    { name: 'Passed', value: `${report.passed} / ${report.total}` },
    { name: 'Failed', value: String(report.failed) },
    { name: 'Duration', value: duration },
    { name: 'Branch', value: report.branch ?? 'unknown' },
  ];

  if (report.commit) {
    facts.push({ name: 'Commit', value: report.commit.slice(0, 7) });
  }

  const sections: object[] = [
    {
      activityTitle: `qflow · ${report.suite} · ${status}`,
      activitySubtitle: new Date(report.timestamp).toLocaleString(),
      facts,
      markdown: true,
    },
  ];

  // List failing tests (up to 10)
  const failed = report.tests.filter((t) => t.status === 'failed').slice(0, 10);
  if (failed.length > 0) {
    sections.push({
      title: 'Failing Tests',
      text: failed.map((t) => `- ${t.fullName}`).join('  \n'),
      markdown: true,
    });
  }

  const card: Record<string, unknown> = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: themeColor(report),
    summary: `qflow ${report.suite}: ${report.passed}/${report.total} passed`,
    sections,
  };

  if (dashboardUrl) {
    card.potentialAction = [
      {
        '@type': 'OpenUri',
        name: 'View Dashboard',
        targets: [{ os: 'default', uri: dashboardUrl }],
      },
    ];
  }

  return card;
}

export class TeamsAdapter implements NotificationAdapter {
  constructor(private readonly webhookUrl: string) {}

  async send(report: RunReport, dashboardUrl?: string): Promise<void> {
    const body = JSON.stringify(buildCard(report, dashboardUrl));

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Teams webhook failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
