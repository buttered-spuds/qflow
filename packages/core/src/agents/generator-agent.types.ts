import type { TestingContext } from '../types.js';
import type { RepoContext } from './repo-context-agent.js';

export interface GeneratedTestFile {
  /** Relative path the file should be written to, e.g. tests/ui/PROJ-123-login.spec.ts */
  path: string;
  content: string;
  /** What kind of test this is — used to pick file conventions and reviewer rules. */
  testType: 'ui' | 'api' | 'unit' | 'component';
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
  /** Controls which conventions the generator and reviewer apply. */
  testingContext?: TestingContext;
  /** Existing project context (POMs, fixtures, examples) for the generator and reviewer to honour. */
  repoContext?: RepoContext;
}
