import type { LLMAdapter } from '../adapters/llm/base.js';
import type { JiraTicket } from './jira-agent.types.js';
import type { GeneratedTestFile, ReviewResult } from './generator-agent.types.js';
import type { TestingContext } from '../types.js';
import type { RepoContext } from './repo-context-agent.js';
import { RepoContextAgent } from './repo-context-agent.js';

const REVIEW_THRESHOLD = 6; // score out of 10

export class ReviewerAgent {
  constructor(private readonly llm: LLMAdapter) {}

  async review(ticket: JiraTicket, files: GeneratedTestFile[], context?: TestingContext, repoContext?: RepoContext): Promise<ReviewResult> {
    const filesSummary = files
      .map((f) => `--- ${f.path} (${f.testType}) ---\n${f.content}`)
      .join('\n\n');

    const response = await this.llm.chat([
      {
        role: 'system',
        content: buildReviewSystemPrompt(context, repoContext),
      },
      {
        role: 'user',
        content: buildReviewPrompt(ticket, filesSummary),
      },
    ]);

    return parseReviewResponse(response);
  }
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildReviewSystemPrompt(context?: TestingContext, repoContext?: RepoContext): string {
  const modes = context?.modes ?? ['ui', 'api'];
  const repoBlock = repoContext ? new RepoContextAgent().format(repoContext) : '';
  const dupRule = repoContext && (repoContext.pageObjects.length > 0 || repoContext.fixtures.length > 0)
    ? `\n\nIMPORTANT: The PROJECT CONTEXT below lists existing Page Objects and fixtures. If the generated tests redefine a class/helper that already exists, DOCK THE SCORE BY AT LEAST 2 POINTS and add a 'duplicates existing X' issue.`
    : '';

  const baseInstructions = `You are a senior engineer reviewing auto-generated test code.
Your job is to score tests on quality and identify specific problems that would make them unreliable or meaningless.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "score": <integer 0-10>,
  "feedback": "<one paragraph summary>",
  "issues": ["<issue 1>", "<issue 2>"]
}

Scoring guide:
9-10: Excellent. Meaningful assertions, covers the ACs, robust selectors/structure, no false positives.
7-8:  Good. Minor improvements possible but acceptable.
5-6:  Acceptable but has notable issues. Flag them.
3-4:  Poor. Likely to produce false positives or miss real failures.
0-2:  Reject. Tests do not meaningfully verify the acceptance criteria.

Always-look-for issues (any kind of test):
- Assertions that always pass (expect(true).toBe(true))
- Tests that don't verify the AC at all
- Missing error/edge case coverage
- No assertion on business-meaningful state
- Tests that pass even when the feature is broken
- Duplication of helpers/fixtures that could be reused`;

  const checks: string[] = [];
  if (modes.includes('ui')) {
    checks.push(`UI checks:
- Tests interact with the page directly instead of through Page Object classes — POM is required
- Selectors use nth-child, CSS class names, or auto-generated attributes instead of getByRole/getByLabel/getByText/getByTestId
- Hardcoded timeouts (page.waitForTimeout, setTimeout) instead of expect().toBeVisible() with auto-retry
- Page Object files missing from the output (every page/component under test needs a POM class)`);
  }
  if (modes.includes('api')) {
    checks.push(`API checks:
- Tests launch a browser when they should use APIRequestContext or supertest
- Only the status code is asserted — body shape/contents not verified
- No 4xx error path covered
- Shared fixtures or state between tests`);
  }
  if (modes.includes('unit')) {
    checks.push(`Unit checks:
- Missing describe('<functionName>') blocks — each exported function should have one
- Tests assert on implementation details instead of observable behaviour
- Missing mocks for external dependencies (databases, HTTP, file system)
- Mocks not cleaned up between tests (missing afterEach/afterAll)
- No test for error paths or edge cases (null, empty, invalid input)
- Imports pointing to the wrong module or using absolute paths`);
  }
  if (modes.includes('component')) {
    checks.push(`Component checks:
- Component rendered with real network calls or full app context — should be isolated
- Queries use brittle selectors instead of accessible queries
- Prop variations not exercised
- User interaction paths missing`);
  }

  return [baseInstructions + dupRule, ...checks, repoBlock].filter(Boolean).join('\n\n');
}

function buildReviewPrompt(ticket: JiraTicket, filesSummary: string): string {
  return `Ticket: ${ticket.key} — ${ticket.summary}

Acceptance Criteria:
${ticket.acceptanceCriteria || ticket.description}

Generated test files:
${filesSummary}

Review these tests against the acceptance criteria.`;
}

function parseReviewResponse(response: string): ReviewResult {
  // Strip any accidental markdown fences
  const clean = response.replace(/```(?:json)?/g, '').trim();

  let parsed: { score?: number; feedback?: string; issues?: string[] };
  try {
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    // LLM returned non-JSON — treat as low-quality to trigger regeneration
    return {
      score: 0,
      feedback: `Reviewer returned non-JSON response: ${clean.slice(0, 200)}`,
      issues: ['Could not parse reviewer response'],
      approved: false,
    };
  }

  const score = typeof parsed.score === 'number' ? parsed.score : 0;
  return {
    score,
    feedback: parsed.feedback ?? '',
    issues: parsed.issues ?? [],
    approved: score >= REVIEW_THRESHOLD,
  };
}
