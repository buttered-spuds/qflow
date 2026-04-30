import type { JiraTicket, JiraSearchResult } from './jira-agent.types.js';

/**
 * Common interface implemented by both JiraAgent and AzureDevOpsAgent.
 * The Orchestrator and CoverageDriftAgent use this type so they work
 * regardless of which ticket system is configured.
 */
export interface TicketAgent {
  /** Fetch a single ticket/work-item and return normalised data. */
  getTicket(key: string): Promise<JiraTicket>;
  /** Fetch all "Done" stories for the configured project. */
  getDoneStories(project: string): Promise<JiraSearchResult>;
  /** Post a comment on a ticket. */
  addComment(key: string, body: object): Promise<void>;
  /** Transition a ticket to a named state/status. */
  transition(key: string, targetState: string): Promise<void>;
}
