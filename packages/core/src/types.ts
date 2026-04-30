// ─── Testing context ─────────────────────────────────────────────────────────

/**
 * The kinds of tests this framework will manage in this project.
 * Multi-select — a project may use any combination.
 *
 * - 'ui'        : End-to-end browser tests (Playwright). Files in tests/ui/.
 *                 Generator enforces Page Object Model + accessible-first locators.
 * - 'api'       : HTTP/service tests against a running app. No browser.
 *                 Files in tests/api/. Uses APIRequestContext or supertest.
 * - 'unit'      : In-process tests with mocked external deps. Files mirror sourcePath.
 *                 Generator uses describe('<fn>') + it('should ...') naming.
 * - 'component' : Isolated UI component tests (Playwright Component Testing / RTL).
 *                 Files in tests/components/. No full-app context.
 */
export type TestMode = 'ui' | 'api' | 'unit' | 'component';

export interface TestingContext {
  /** Which kinds of tests are in scope. At least one. */
  modes: TestMode[];
  /**
   * Required when 'unit' or 'component' is in modes.
   * Relative path to source files; tests mirror this structure.
   * e.g. 'src' → src/services/user.ts becomes tests/unit/services/user.test.ts
   */
  sourcePath?: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface QFlowConfig {
  runner: RunnerConfig;
  /**
   * Describes what kinds of tests the framework will generate and review.
   * Drives file structure, naming conventions, locator strategy, mocking.
   */
  testingContext?: TestingContext;
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
  /** Named environment profiles (e.g. staging, prod). Selected with `--env <name>`. */
  environments?: Record<string, EnvironmentProfile>;
  /** Tag → grep-pattern groups for `qflow run --suite smoke|regression`. */
  tags?: TagsConfig;
}

export interface RunnerConfig {
  /** Which test runner to use. */
  type: 'playwright' | 'pytest' | 'jest' | 'vitest' | 'custom';
  /** Path to the runner's own config file (e.g. playwright.config.ts). */
  configFile?: string;
  /** For type:'custom' — the shell command to run. */
  command?: string;
  /** Directory where the runner writes result files. Defaults to .qflow/data. */
  outputDir?: string;
  /** Base URL forwarded to the runner (PLAYWRIGHT_BASE_URL, BASE_URL, etc.). */
  baseUrl?: string;
  /** Number of parallel workers. Forwarded to runner via flag/env. */
  workers?: number;
  /** Retry count for failed tests. */
  retries?: number;
  /** Per-test timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Extra env vars passed to the runner process.
   * Values may reference host env via `${VAR}` interpolation, e.g. `API_TOKEN: '${CI_API_TOKEN}'`.
   * Unresolved `${VAR}` references throw at config load time.
   */
  env?: Record<string, string>;
}

/** Per-environment overrides selected at run time via `--env <name>`. */
export interface EnvironmentProfile {
  baseUrl?: string;
  env?: Record<string, string>;
}

/** Tag groupings used by `qflow run --suite smoke|regression`. */
export interface TagsConfig {
  smoke?: string[];
  regression?: string[];
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
  /** Optional grep/regex pattern of test names. Used by `tags.smoke|regression` config. */
  tagPattern?: string;
}
