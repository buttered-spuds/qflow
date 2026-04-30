import type { AzureDevOpsConfig } from '../types.js';
import type { JiraTicket, JiraSearchResult } from './jira-agent.types.js';
import type { TicketAgent } from './ticket-agent.js';

// ─── Azure DevOps REST API shapes (partial) ───────────────────────────────────

interface AdoWorkItem {
  id: number;
  fields: {
    'System.Title': string;
    'System.Description'?: string;
    'Microsoft.VSTS.Common.AcceptanceCriteria'?: string;
    'System.State': string;
    'System.WorkItemType': string;
    'System.Tags'?: string;
    [key: string]: unknown;
  };
}

interface AdoWiqlResult {
  workItems: Array<{ id: number; url: string }>;
}

interface AdoWorkItemList {
  value: AdoWorkItem[];
}

// ─── Agent ────────────────────────────────────────────────────────────────────

/**
 * Azure DevOps ticket agent — mirrors JiraAgent's public API so the
 * Orchestrator can use either without changes.
 *
 * Authentication: Personal Access Token (PAT) with at least:
 *   Work Items: Read & Write
 *
 * Config in framework.config.ts:
 *   azureDevOps: {
 *     orgUrl: process.env.QFLOW_ADO_ORG_URL!,  // https://dev.azure.com/my-org
 *     token:  process.env.QFLOW_ADO_TOKEN!,
 *     project: 'MyProject',
 *   }
 */
export class AzureDevOpsAgent implements TicketAgent {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly apiVersion = '7.1';

  constructor(private readonly config: AzureDevOpsConfig) {
    this.baseUrl = config.orgUrl.replace(/\/$/, '');
    // PAT auth: Basic base64(':token')
    this.authHeader = `Basic ${Buffer.from(`:${config.token}`).toString('base64')}`;
  }

  /** Fetch a single work item by numeric ID or string like "AB#123". */
  async getTicket(key: string): Promise<JiraTicket> {
    const id = parseWorkItemId(key);
    const url = `${this.baseUrl}/${encodeURIComponent(this.config.project)}/_apis/wit/workitems/${id}?api-version=${this.apiVersion}&$expand=fields`;
    const raw = await this.#get<AdoWorkItem>(url);
    return this.#mapWorkItem(raw);
  }

  /**
   * Fetch all Done user stories for the project using WIQL.
   * Returns up to 500 work items.
   */
  async getDoneStories(project: string): Promise<JiraSearchResult> {
    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project}' AND [System.WorkItemType] = 'User Story' AND [System.State] = 'Done' ORDER BY [System.ChangedDate] DESC`,
    };
    const wiqlUrl = `${this.baseUrl}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${this.apiVersion}&$top=500`;
    const wiqlResult = await this.#post<AdoWiqlResult>(wiqlUrl, wiql);

    if (!wiqlResult.workItems.length) {
      return { issues: [], total: 0 };
    }

    // Batch-fetch up to 200 at a time (ADO API limit)
    const ids = wiqlResult.workItems.slice(0, 200).map((w) => w.id);
    const batchUrl = `${this.baseUrl}/${encodeURIComponent(project)}/_apis/wit/workitems?ids=${ids.join(',')}&api-version=${this.apiVersion}&$expand=fields`;
    const batchResult = await this.#get<AdoWorkItemList>(batchUrl);

    const issues = batchResult.value.map((w) => this.#mapWorkItem(w));
    return { issues, total: wiqlResult.workItems.length };
  }

  /** Add a plain-text comment to a work item. */
  async addComment(key: string, body: object): Promise<void> {
    const id = parseWorkItemId(key);
    const url = `${this.baseUrl}/${encodeURIComponent(this.config.project)}/_apis/wit/workitems/${id}/comments?api-version=7.1-preview.3`;
    // body may be an ADF doc from JIRA path — extract text or use JSON
    const text = extractText(body);
    await this.#post(url, { text });
  }

  /** Transition a work item to a new state (e.g. "Active", "Done", "Resolved"). */
  async transition(key: string, targetState: string): Promise<void> {
    const id = parseWorkItemId(key);
    const url = `${this.baseUrl}/${encodeURIComponent(this.config.project)}/_apis/wit/workitems/${id}?api-version=${this.apiVersion}`;
    await this.#patch(url, [
      { op: 'add', path: '/fields/System.State', value: targetState },
    ]);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  #mapWorkItem(item: AdoWorkItem): JiraTicket {
    const f = item.fields;
    const description = stripHtml(f['System.Description'] ?? '');
    const ac = stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '');
    const tags = (f['System.Tags'] ?? '')
      .split(';')
      .map((t: string) => t.trim())
      .filter(Boolean);

    return {
      key: String(item.id),
      summary: f['System.Title'],
      description,
      acceptanceCriteria: ac || description,
      status: f['System.State'],
      issueType: f['System.WorkItemType'],
      labels: tags,
    };
  }

  async #get<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure DevOps GET ${url} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  }

  async #post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure DevOps POST ${url} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  }

  async #patch<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json-patch+json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure DevOps PATCH ${url} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Accept "AB#123", "123", or numeric ID. */
function parseWorkItemId(key: string): number {
  const match = key.match(/(\d+)$/);
  if (!match) throw new Error(`Cannot parse Azure DevOps work item ID from: "${key}"`);
  return parseInt(match[1], 10);
}

/** Strip HTML tags from ADO description/AC fields (they use HTML, not markdown). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extract plain text from an ADF doc or plain object for ADO comments. */
function extractText(body: object): string {
  // If it's an ADF document, walk content nodes
  const doc = body as { content?: Array<{ content?: Array<{ text?: string }> }> };
  if (doc.content) {
    const parts: string[] = [];
    for (const block of doc.content) {
      for (const inline of block.content ?? []) {
        if (inline.text) parts.push(inline.text);
      }
    }
    return parts.join(' ');
  }
  return JSON.stringify(body);
}
