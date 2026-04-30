export interface GeneratedTestFile {
  /** Relative path the file should be written to, e.g. tests/ui/PROJ-123-login.spec.ts */
  path: string;
  content: string;
  /** 'ui' for Playwright browser tests, 'api' for request-only tests */
  testType: 'ui' | 'api';
}

export interface ReviewResult {
  /** 0–10. Below threshold triggers regeneration. */
  score: number;
  /** Human-readable feedback added to the Draft PR description. */
  feedback: string;
  /** Specific issues found (empty if score is acceptable). */
  issues: string[];
  approved: boolean;
}

export interface GenerateOptions {
  cwd: string;
  /** Max number of regeneration attempts if Reviewer rejects. Defaults to 2. */
  maxRetries?: number;
}
