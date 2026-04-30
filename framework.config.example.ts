import type { QFlowConfig } from '@qflow/core';

const config: QFlowConfig = {
  runner: {
    type: 'playwright',
    configFile: 'playwright.config.ts',
  },

  // ── Ticket system: pick ONE ──────────────────────────────────────────────

  // Option A: JIRA Cloud / Server
  jira: {
    url: process.env.QFLOW_JIRA_URL!,
    token: process.env.QFLOW_JIRA_TOKEN!,
    project: 'PROJ',
  },

  // Option B: Azure DevOps
  // azureDevOps: {
  //   orgUrl: process.env.QFLOW_ADO_ORG_URL!,   // https://dev.azure.com/my-org
  //   token:  process.env.QFLOW_ADO_TOKEN!,
  //   project: 'MyProject',
  // },

  // ── LLM provider: pick ONE ───────────────────────────────────────────────

  llm: {
    provider: 'openai',
    apiKey: process.env.QFLOW_LLM_API_KEY!,
    model: 'gpt-4o',
  },

  // GitHub Copilot — no extra API key needed in GitHub Actions
  // llm: {
  //   provider: 'github-copilot',
  //   apiKey: process.env.GITHUB_TOKEN ?? '',
  //   model: 'gpt-4o',
  // },

  // Ollama (local / offline)
  // llm: {
  //   provider: 'ollama',
  //   apiKey: '',
  //   model: 'llama3.2',
  //   baseUrl: 'http://localhost:11434/v1',
  // },

  notifications: {
    slack: { webhookUrl: process.env.QFLOW_SLACK_WEBHOOK! },
    teams: { webhookUrl: process.env.QFLOW_TEAMS_WEBHOOK! },
    jira: { writeResults: true },
  },

  dashboard: {
    githubPages: true,
    branch: 'gh-pages',
  },

  flakiness: {
    quarantineThreshold: 0.2,
    historyDepth: 10,
  },

  smartSelection: {
    enabled: true,
  },
};

export default config;
