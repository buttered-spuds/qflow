import type { RunReport } from '../../types.js';

/**
 * Notification adapter interface — implemented in Phase 2.
 * Each channel (Slack, Teams, JIRA) implements this.
 */
export interface NotificationAdapter {
  send(report: RunReport, dashboardUrl?: string): Promise<void>;
}
