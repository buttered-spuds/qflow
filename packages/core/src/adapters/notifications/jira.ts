import type { RunReport } from '../../types.js';
import type { NotificationAdapter } from './base.js';

interface JiraAdapterOptions {
  url: string;
  token: string;
  /** If set, post a comment to this specific ticket key (e.g. PROJ-456). */
  ticketKey?: string;
  /** If set, create/update a test execution on this JIRA project. */
  project?: string;
}

export class JiraAdapter implements NotificationAdapter {
  constructor(private readonly opts: JiraAdapterOptions) {}

  async send(report: RunReport, dashboardUrl?: string): Promise<void> {
    if (!this.opts.ticketKey) {
      // No specific ticket to comment on — skip silently in Phase 2.
      // Phase 3 will pass the ticketKey when tests are generated from a ticket.
      return;
    }

    const comment = buildComment(report, dashboardUrl);

    const url = `${this.opts.url.replace(/\/$/, '')}/rest/api/3/issue/${this.opts.ticketKey}/comment`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // JIRA Cloud uses Basic Auth: base64(email:api_token)
        Authorization: `Basic ${Buffer.from(`api:${this.opts.token}`).toString('base64')}`,
      },
      body: JSON.stringify({ body: comment }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA comment failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}

// Builds a JIRA Atlassian Document Format (ADF) comment body.
function buildComment(report: RunReport, dashboardUrl?: string): object {
  const status = report.failed > 0 ? '❌ FAILED' : '✅ PASSED';
  const duration = formatDuration(report.duration);

  const rows: object[] = [
    tableRow(['Suite', report.suite]),
    tableRow(['Runner', report.runner]),
    tableRow(['Passed', `${report.passed} / ${report.total}`]),
    tableRow(['Failed', String(report.failed)]),
    tableRow(['Duration', duration]),
    tableRow(['Branch', report.branch ?? 'unknown']),
  ];

  if (report.commit) {
    rows.push(tableRow(['Commit', report.commit.slice(0, 7)]));
  }

  const content: object[] = [
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `qflow Test Run · ${status}` }],
    },
    {
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: rows,
    },
  ];

  const failedTests = report.tests.filter((t) => t.status === 'failed').slice(0, 10);
  if (failedTests.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 4 },
      content: [{ type: 'text', text: 'Failing Tests' }],
    });
    content.push({
      type: 'bulletList',
      content: failedTests.map((t) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: t.fullName, marks: [{ type: 'code' }] }],
          },
        ],
      })),
    });
  }

  if (dashboardUrl) {
    content.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'View full results on the dashboard',
          marks: [{ type: 'link', attrs: { href: dashboardUrl } }],
        },
      ],
    });
  }

  return {
    version: 1,
    type: 'doc',
    content,
  };
}

function tableRow(cells: [string, string]): object {
  return {
    type: 'tableRow',
    content: cells.map((text) => ({
      type: 'tableCell',
      attrs: {},
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    })),
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
