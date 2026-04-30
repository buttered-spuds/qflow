import type { JiraConfig } from '../types.js';
import type { JiraTicket, JiraSearchResult } from './jira-agent.types.js';

// ─── JIRA Cloud REST API v3 response shapes (partial) ────────────────────────

interface JiraIssueResponse {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    issuetype: { name: string };
    labels: string[];
    description?: AdfNode | null;
    // Custom AC field — try common field names
    customfield_10016?: AdfNode | null; // "Acceptance Criteria" in many Jira configs
    [key: string]: unknown;
  };
}

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  [key: string]: unknown;
}

interface JiraSearchResponse {
  issues: JiraIssueResponse[];
  total: number;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class JiraAgent {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: JiraConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    // JIRA Cloud: Basic auth with email:api_token (or user:api_token for Server)
    this.authHeader = `Basic ${Buffer.from(`api:${config.token}`).toString('base64')}`;
  }

  /** Fetch a single ticket and extract acceptance criteria. */
  async getTicket(key: string): Promise<JiraTicket> {
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,issuetype,labels,customfield_10016`;
    const raw = await this.#get<JiraIssueResponse>(url);
    return this.#mapIssue(raw);
  }

  /**
   * Fetch all "Done" user stories for a project — used by coverage drift check.
   * Returns up to 500 issues (JIRA API max per page).
   */
  async getDoneStories(project: string): Promise<JiraSearchResult> {
    const jql = encodeURIComponent(
      `project = "${project}" AND issuetype = Story AND status = Done ORDER BY updated DESC`,
    );
    const url = `${this.baseUrl}/rest/api/3/search?jql=${jql}&fields=summary,status,issuetype,labels&maxResults=500`;
    const raw = await this.#get<JiraSearchResponse>(url);
    return {
      issues: raw.issues.map((i) => this.#mapIssue(i)),
      total: raw.total,
    };
  }

  /** Post an ADF comment to a ticket. */
  async addComment(key: string, body: object): Promise<void> {
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/comment`;
    await this.#post(url, { body });
  }

  /** Update a ticket's status to a given transition name (e.g. "In Progress"). */
  async transition(key: string, transitionName: string): Promise<void> {
    // First fetch available transitions
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`;
    const res = await this.#get<{ transitions: Array<{ id: string; name: string }> }>(url);
    const match = res.transitions.find(
      (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
    );
    if (!match) {
      const available = res.transitions.map((t) => t.name).join(', ');
      throw new Error(
        `JIRA transition "${transitionName}" not found on ${key}. Available: ${available}`,
      );
    }
    await this.#post(url, { transition: { id: match.id } });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async #get<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: this.authHeader,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA GET ${url} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  }

  async #post(url: string, body: object): Promise<void> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: this.authHeader,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JIRA POST ${url} failed (${res.status}): ${text.slice(0, 300)}`);
    }
  }

  #mapIssue(raw: JiraIssueResponse): JiraTicket {
    const descriptionText = adfToText(raw.fields.description ?? null);
    const acText =
      adfToText(raw.fields.customfield_10016 ?? null) ||
      extractAcFromDescription(descriptionText);

    return {
      key: raw.key,
      summary: raw.fields.summary ?? '',
      description: descriptionText,
      acceptanceCriteria: acText,
      status: raw.fields.status?.name ?? '',
      issueType: raw.fields.issuetype?.name ?? '',
      labels: raw.fields.labels ?? [],
    };
  }
}

// ─── ADF → plain text ─────────────────────────────────────────────────────────

function adfToText(node: AdfNode | null): string {
  if (!node) return '';
  const parts: string[] = [];

  function walk(n: AdfNode): void {
    if (n.text) parts.push(n.text);
    for (const child of n.content ?? []) {
      walk(child);
      if (n.type === 'paragraph' || n.type === 'heading') parts.push('\n');
      if (n.type === 'listItem') parts.push('\n');
    }
  }

  walk(node);
  return parts.join('').trim();
}

/**
 * Fallback: try to extract an "Acceptance Criteria" section from the description
 * when it's written inline (common in teams that don't use a dedicated AC field).
 * Looks for headings like "Acceptance Criteria", "AC", "Given/When/Then".
 */
function extractAcFromDescription(description: string): string {
  const acPattern = /(?:acceptance criteria|given[\s\S]*?when[\s\S]*?then|ac:|ac\n)/i;
  const lines = description.split('\n');
  const startIdx = lines.findIndex((l) => acPattern.test(l));
  if (startIdx === -1) return description; // return full description as fallback
  return lines.slice(startIdx).join('\n').trim();
}
