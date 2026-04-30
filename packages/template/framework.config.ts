import type { QFlowConfig } from '@qflow/core';

// Replace all process.env values with real secrets in CI.
// Add them as GitHub Actions secrets and reference via ${{ secrets.NAME }}.
const config: QFlowConfig = {
  runner: {
    type: 'playwright',
    configFile: 'playwright.config.ts',
  },

  // ── Optional: JIRA integration (Phase 3) ──────────────────────────────────
  // jira: {
  //   url: process.env.QFLOW_JIRA_URL!,
  //   token: process.env.QFLOW_JIRA_TOKEN!,
  //   project: 'PROJ',
  // },

  // ── Optional: LLM for AI features (Phase 3) ───────────────────────────────
  // llm: {
  //   provider: 'openai',
  //   apiKey: process.env.QFLOW_LLM_API_KEY!,
  //   model: 'gpt-4o',
  // },

  // ── Optional: Notifications (Phase 2) ────────────────────────────────────
  // notifications: {
  //   slack: { webhookUrl: process.env.QFLOW_SLACK_WEBHOOK! },
  //   teams: { webhookUrl: process.env.QFLOW_TEAMS_WEBHOOK! },
  //   jira: { writeResults: true },
  // },

  // ── Optional: GitHub Pages dashboard (Phase 2) ────────────────────────────
  // dashboard: {
  //   githubPages: true,
  //   branch: 'gh-pages',
  // },

  flakiness: {
    quarantineThreshold: 0.2,
    historyDepth: 10,
  },

  smartSelection: {
    enabled: true,
  },
};

export default config;
