import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { execa } from 'execa';
import type { LLMAdapter } from '../adapters/llm/base.js';
import type { JiraTicket } from './jira-agent.types.js';
import type { GeneratedTestFile, GenerateOptions, ReviewResult } from './generator-agent.types.js';
import type { TestingContext } from '../types.js';
import { ReviewerAgent } from './reviewer-agent.js';

export class GeneratorAgent {
  private readonly reviewer: ReviewerAgent;

  constructor(private readonly llm: LLMAdapter) {
    this.reviewer = new ReviewerAgent(llm);
  }

  /**
   * Main entry point: generate tests for a ticket, run them through the
   * Reviewer, and return the approved files along with reviewer feedback.
   */
  async generate(
    ticket: JiraTicket,
    opts: GenerateOptions,
  ): Promise<{ files: GeneratedTestFile[]; review: ReviewResult }> {
    const maxRetries = opts.maxRetries ?? 2;
    const ctx = opts.testingContext;
    let files = await this.#generateFiles(ticket, ctx);
    let review = await this.reviewer.review(ticket, files, ctx);

    for (let attempt = 1; attempt < maxRetries && !review.approved; attempt++) {
      console.log(
        `[qflow] Reviewer score ${review.score}/10 — regenerating (attempt ${attempt + 1}/${maxRetries})`,
      );
      files = await this.#generateFiles(ticket, ctx, review);
      review = await this.reviewer.review(ticket, files, ctx);
    }

    return { files, review };
  }

  /** Write generated files to disk. */
  async writeFiles(files: GeneratedTestFile[], cwd: string): Promise<void> {
    for (const file of files) {
      const fullPath = join(cwd, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf-8');
    }
  }

  /**
   * Create a git branch, commit generated files, and open a Draft PR.
   * Returns the PR URL.
   */
  async openDraftPR(
    files: GeneratedTestFile[],
    ticket: JiraTicket,
    review: ReviewResult,
    cwd: string,
  ): Promise<string> {
    const branchName = `qflow/tests/${ticket.key.toLowerCase()}-${Date.now()}`;

    // Commit on a new branch
    await execa('git', ['checkout', '-b', branchName], { cwd });

    for (const file of files) {
      await execa('git', ['add', file.path], { cwd });
    }

    await execa(
      'git',
      ['commit', '-m', `test(qflow): generate tests for ${ticket.key} — ${ticket.summary}`],
      { cwd },
    );

    await execa('git', ['push', '--set-upstream', 'origin', branchName], { cwd });

    // Open Draft PR via GitHub CLI if available, else via GitHub REST API
    const prUrl = await this.#createDraftPR(
      branchName,
      ticket,
      review,
      cwd,
    );

    // Switch back to the original branch
    await execa('git', ['checkout', '-'], { cwd });

    return prUrl;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async #generateFiles(
    ticket: JiraTicket,
    context?: TestingContext,
    previousReview?: ReviewResult,
  ): Promise<GeneratedTestFile[]> {
    const needsUI = !ticket.labels.includes('api-only');
    const needsAPI = ticket.labels.includes('api') || ticket.labels.includes('api-only');

    const response = await this.llm.chat([
      { role: 'system', content: buildSystemPrompt(context) },
      {
        role: 'user',
        content: buildGeneratorPrompt(ticket, { needsUI, needsAPI, previousReview, context }),
      },
    ]);

    return parseGeneratorResponse(ticket.key, response);
  }

  async #createDraftPR(
    branch: string,
    ticket: JiraTicket,
    review: ReviewResult,
    cwd: string,
  ): Promise<string> {
    const title = `test(qflow): ${ticket.key} — ${ticket.summary}`;
    const body = buildPRBody(ticket, review);

    // Try GitHub CLI first
    const ghAvailable = await execa('gh', ['--version'], { cwd, reject: false });
    if (ghAvailable.exitCode === 0) {
      const result = await execa(
        'gh',
        ['pr', 'create', '--draft', '--title', title, '--body', body, '--head', branch],
        { cwd },
      );
      return result.stdout.trim();
    }

    // Fallback: use GitHub REST API via GITHUB_TOKEN
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return `Branch ${branch} pushed. Create a PR manually or install the GitHub CLI (gh).`;
    }

    const repoResult = await execa('git', ['remote', 'get-url', 'origin'], { cwd });
    const remote = repoResult.stdout.trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (!match) return `Branch ${branch} pushed. Could not determine GitHub repo from remote.`;

    const [, owner, repo] = match;
    const defaultBranch = await getDefaultBranch(cwd);

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        title,
        body,
        head: branch,
        base: defaultBranch,
        draft: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return `Branch ${branch} pushed. PR creation failed: ${text.slice(0, 200)}`;
    }

    const pr = (await res.json()) as { html_url: string };
    return pr.html_url;
  }
}

async function getDefaultBranch(cwd: string): Promise<string> {
  const result = await execa(
    'git',
    ['symbolic-ref', 'refs/remotes/origin/HEAD'],
    { cwd, reject: false },
  );
  if (result.exitCode === 0) {
    return result.stdout.trim().replace('refs/remotes/origin/', '');
  }
  return 'main';
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(context?: TestingContext): string {
  const mode = context?.mode ?? 'e2e';

  if (mode === 'unit-integration') {
    const sourcePath = context?.sourcePath ?? 'src';
    return `You are an expert ${context?.role === 'developer' ? 'developer' : 'QA engineer'} writing unit and integration tests.

Rules:
- Write TypeScript using Jest (@types/jest + ts-jest)
- Mirror the source file structure: ${sourcePath}/services/user.ts → tests/unit/services/user.test.ts
- Use a top-level describe('<ModuleName>') block per file
- Use nested describe('<functionName>') blocks for each exported function or method under test
- Inside each function describe, write it('should <behaviour>') tests
- Import the actual module under test using a relative path
- Mock external dependencies (databases, HTTP clients, third-party modules) with jest.mock() at the top of the file
- Clean up mocks in afterEach/afterAll where needed
- Test the happy path AND at least one error or edge case per function
- Assert on return values, thrown errors, or observable side-effects — never on internal implementation details
- Keep each test focused on a single scenario

Respond ONLY with a JSON array of file objects. No markdown, no explanation.
Format: [{"path": "tests/unit/...", "testType": "unit", "content": "...full file content..."}]`;
  }

  // Default: E2E mode
  return `You are an expert QA engineer writing Playwright end-to-end test files.

Rules:
- Write TypeScript using @playwright/test
- ALWAYS use the Page Object Model (POM). Each page or UI component under test gets its own class in tests/pages/. Tests import these classes — never interact with the page directly from a test file.
- Use accessible-first locators in this strict priority order:
    1. page.getByRole()       — prefer for interactive elements (button, link, textbox, etc.)
    2. page.getByLabel()      — for form fields with a visible label
    3. page.getByPlaceholder() — for inputs with placeholder text only
    4. page.getByText()       — for non-interactive text content
    5. page.getByTestId()     — only when no accessible selector is available
  Never use nth-child, CSS class selectors, auto-generated attributes, or XPath.
- Each test must directly verify a specific acceptance criterion
- Tag smoke tests with @smoke in the test name
- UI tests go in tests/ui/, API tests in tests/api/, Page Object classes in tests/pages/
- Use Playwright's APIRequestContext for API tests (no browser)
- Never use hardcoded timeouts — use await expect().toBeVisible() with auto-retry
- Keep tests independent — no shared state between tests

Respond ONLY with a JSON array of file objects. No markdown, no explanation.
Format: [{"path": "tests/ui/...", "testType": "ui"|"api", "content": "...full file content..."}]
Include POM files in the array alongside test files (use testType: "ui" for page object files).`;
}

function buildGeneratorPrompt(
  ticket: JiraTicket,
  opts: { needsUI: boolean; needsAPI: boolean; previousReview?: ReviewResult; context?: TestingContext },
): string {
  const isUnit = opts.context?.mode === 'unit-integration';

  const parts = [
    `Ticket: ${ticket.key} — ${ticket.summary}`,
    ``,
    `Acceptance Criteria:`,
    ticket.acceptanceCriteria || ticket.description,
    ``,
  ];

  if (isUnit) {
    parts.push(`Generate unit/integration tests that cover the behaviour described above.`);
    if (opts.context?.sourcePath) {
      parts.push(`Source path to mirror: ${opts.context.sourcePath}`);
    }
  } else {
    parts.push(
      `Generate: ${[opts.needsUI && 'UI tests (with POM classes)', opts.needsAPI && 'API tests'].filter(Boolean).join(' and ')}`,
    );
  }

  if (opts.previousReview) {
    parts.push(
      ``,
      `Previous review found these issues — fix them in the new version:`,
      ...opts.previousReview.issues.map((i) => `- ${i}`),
    );
  }

  return parts.join('\n');
}

function parseGeneratorResponse(ticketKey: string, response: string): GeneratedTestFile[] {
  const clean = response.replace(/```(?:json)?/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(
      `Generator LLM returned invalid JSON for ${ticketKey}:\n${clean.slice(0, 500)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Generator expected a JSON array, got: ${typeof parsed}`);
  }

  return parsed.map((item, i) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).path !== 'string' ||
      typeof (item as Record<string, unknown>).content !== 'string'
    ) {
      throw new Error(`Generator output item ${i} is missing required fields (path, content)`);
    }
    const f = item as Record<string, unknown>;
    return {
      path: f.path as string,
      content: f.content as string,
      testType: (f.testType as 'ui' | 'api') ?? 'ui',
    };
  });
}

function buildPRBody(ticket: JiraTicket, review: ReviewResult): string {
  const scoreBar = '█'.repeat(Math.round(review.score)) + '░'.repeat(10 - Math.round(review.score));

  return [
    `## qflow — AI-generated tests for [${ticket.key}](${ticket.key})`,
    ``,
    `**${ticket.summary}**`,
    ``,
    `### Acceptance Criteria`,
    ticket.acceptanceCriteria || ticket.description,
    ``,
    `### Reviewer Score`,
    `\`${scoreBar}\` ${review.score}/10`,
    ``,
    review.feedback,
    review.issues.length > 0
      ? `\n**Known issues (review these before merging):**\n${review.issues.map((i) => `- ${i}`).join('\n')}`
      : '',
    ``,
    `---`,
    `_Generated by [qflow](https://github.com/your-org/test-framework). Review before merging._`,
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}
