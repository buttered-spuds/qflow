export interface JiraTicket {
  key: string;
  summary: string;
  description: string;
  /** Raw acceptance criteria text, extracted from description or a dedicated AC field. */
  acceptanceCriteria: string;
  status: string;
  issueType: string;
  labels: string[];
}

export interface JiraSearchResult {
  issues: JiraTicket[];
  total: number;
}

export interface JiraCommentPayload {
  /** JIRA ADF document body. */
  body: object;
}
