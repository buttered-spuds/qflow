// ─── Config ──────────────────────────────────────────────────────────────────

export interface QFlowConfig {
  runner: RunnerConfig;
  /** JIRA Cloud / Server ticket system. Mutually exclusive with azureDevOps. */
  jira?: JiraConfig;
  /** Azure DevOps ticket system. Mutually exclusive with jira. */
  azureDevOps?: AzureDevOpsConfig;
  llm?: LLMConfig;
  notifications?: NotificationsConfig;
  dashboard?: DashboardConfig;
  flakiness?: FlakinessConfig;
  smartSelection?: SmartSelectionConfig;
  selfHealing?: SelfHealingConfig;
}

export interface RunnerConfig {
  /** Which test runner to use. */
  type: 'playwright' | 'pytest' | 'jest' | 'custom';
  /** Path to the runner's own config file (e.g. playwright.config.ts). */
  configFile?: string;
  /** For type:'custom' — the shell command to run. */
  command?: string;
  /** Directory where the runner writes result files. Defaults to .qflow/data. */
  outputDir?: string;
}

export interface JiraConfig {
  url: string;
  token: string;
  project: string;
}

export interface AzureDevOpsConfig {
  /** e.g. https://dev.azure.com/my-org */
  orgUrl: string;
  /** Personal Access Token */
  token: string;
  /** Azure DevOps project name */
  project: string;
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'azure' | 'gemini' | 'ollama' | 'github-copilot' | 'custom';
  apiKey: string;
  model: string;
  /** Required for azure, ollama, and custom providers. */
  baseUrl?: string;
}

export interface NotificationsConfig {
  slack?: { webhookUrl: string };
  teams?: { webhookUrl: string };
  jira?: { writeResults: boolean };
}

export interface DashboardConfig {
  githubPages?: boolean;
  /** Branch to commit result JSON to. Defaults to 'gh-pages'. */
  branch?: string;
  repoOwner?: string;
  repoName?: string;
}

export interface FlakinessConfig {
  /** 0–1 failure rate threshold to quarantine a test. Defaults to 0.2. */
  quarantineThreshold?: number;
  /** How many past runs to evaluate for flakiness. Defaults to 10. */
  historyDepth?: number;
}

export interface SmartSelectionConfig {
  enabled?: boolean;
}

export interface SelfHealingConfig {
  /** If true, auto-commit the healed selector back to the same branch. Defaults to false. */
  autoCommit?: boolean;
}

// ─── Cost tracking ────────────────────────────────────────────────────────────

export interface TokenUsageRecord {
  id?: number;
  timestamp: string;
  command: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// ─── Test results ─────────────────────────────────────────────────────────────

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'flaky';

export interface TestCase {
  name: string;
  fullName: string;
  status: TestStatus;
  /** Duration in milliseconds. */
  duration: number;
  file?: string;
  error?: string;
  tags?: string[];
}

export interface RunReport {
  id: string;
  timestamp: string;
  suite: string;
  runner: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  /** Duration in milliseconds. */
  duration: number;
  tests: TestCase[];
  commit?: string;
  branch?: string;
  /** 'ci' | 'manual' | 'pr' */
  triggeredBy?: string;
  prNumber?: number;
}

// ─── Dashboard manifest ───────────────────────────────────────────────────────

export interface ManifestEntry {
  id: string;
  timestamp: string;
  suite: string;
  passed: number;
  failed: number;
  total: number;
  /** Relative path to the run JSON file on gh-pages. */
  file: string;
}

export interface Manifest {
  runs: ManifestEntry[];
  /** Full test names currently quarantined (non-blocking). */
  quarantined: string[];
  lastUpdated: string;
}

// ─── Runner options ───────────────────────────────────────────────────────────

export interface RunOptions {
  suite: string;
  cwd: string;
  local: boolean;
  env?: Record<string, string>;
}
