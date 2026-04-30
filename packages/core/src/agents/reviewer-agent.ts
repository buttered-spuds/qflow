import type { LLMAdapter } from '../adapters/llm/base.js';
import type { JiraTicket } from './jira-agent.types.js';
import type { GeneratedTestFile, ReviewResult } from './generator-agent.types.js';
import type { TestingContext } from '../types.js';

const REVIEW_THRESHOLD = 6; // score out of 10

export class ReviewerAgent {
  constructor(private readonly llm: LLMAdapter) {}

  async review(ticket: JiraTicket, files: GeneratedTestFile[], context?: TestingContext): Promise<ReviewResult> {
    const filesSummary = files
      .map((f) => `--- ${f.path} (${f.testType}) ---\n${f.content}`)
      .join('\n\n');

    const response = await this.llm.chat([
      {
        role: 'system',
        content: buildReviewSystemPrompt(context),
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

function buildReviewSystemPrompt(context?: TestingContext): string {
  const mode = context?.mode ?? 'e2e';
  const baseInstructions = `You are a senior ${context?.role === 'developer' ? 'developer' : 'QA engineer'} reviewing auto-generated test code.
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

Common issues to look for:
- Assertions that always pass (e.g. expect(true).toBe(true))
- Tests that don't verify the AC at all
- Missing error state or edge case coverage
- No assertion on actual business-meaningful state
- Tests that pass even when the feature is broken`;

  if (mode === 'unit-integration') {
    return `${baseInstructions}

Unit/integration-specific issues to check:
- Missing describe('<functionName>') blocks — each exported function should have one
- Tests that assert on implementation details instead of observable behaviour
- Missing mocks for external dependencies (databases, HTTP, file system)
- Mocks not cleaned up between tests (missing afterEach/afterAll)
- No test for error paths or edge cases (null, empty, invalid input)
- Imports pointing to the wrong module or using absolute paths`;
  }

  return `${baseInstructions}

E2E-specific issues to check:
- Tests that interact with the page directly instead of through Page Object classes — POM is required
- Selectors that use nth-child, CSS class names, or auto-generated attributes instead of getByRole/getByLabel/getByText/getByTestId
- Hardcoded timeouts (page.waitForTimeout, setTimeout) instead of expect().toBeVisible() with auto-retry
- Page Object files missing from the output (every page/component under test needs a POM class)
- API tests that launch a browser instead of using APIRequestContext`;
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
