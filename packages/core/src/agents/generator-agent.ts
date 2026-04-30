import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { execa } from 'execa';
import type { LLMAdapter } from '../adapters/llm/base.js';
import type { JiraTicket } from './jira-agent.types.js';
import type { GeneratedTestFile, GenerateOptions, ReviewResult } from './generator-agent.types.js';
import type { TestingContext, TestMode } from '../types.js';
import type { RepoContext } from './repo-context-agent.js';
import { RepoContextAgent } from './repo-context-agent.js';
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
    const repoContext = opts.repoContext ?? (await new RepoContextAgent().scan(opts.cwd, ctx));
    let files = await this.#generateFiles(ticket, ctx, repoContext);
    let review = await this.reviewer.review(ticket, files, ctx, repoContext);

    for (let attempt = 1; attempt < maxRetries && !review.approved; attempt++) {
      console.log(
        `[qflow] Reviewer score ${review.score}/10 — regenerating (attempt ${attempt + 1}/${maxRetries})`,
      );
      files = await this.#generateFiles(ticket, ctx, repoContext, review);
      review = await this.reviewer.review(ticket, files, ctx, repoContext);
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
    repoContext?: RepoContext,
    previousReview?: ReviewResult,
  ): Promise<GeneratedTestFile[]> {
    const response = await this.llm.chat([
      { role: 'system', content: buildSystemPrompt(context, repoContext) },
      {
        role: 'user',
        content: buildGeneratorPrompt(ticket, { previousReview, context }),
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

const UI_RULES = `UI tests (Playwright @playwright/test, TypeScript):
- ALWAYS use the Page Object Model. Each page/component gets a class in tests/pages/. Test files import POM classes — never call page.goto/page.click directly.
- Accessible-first locators in this strict priority order:
    1. page.getByRole()        — buttons, links, textboxes, headings
    2. page.getByLabel()       — form fields with a visible label
    3. page.getByPlaceholder() — inputs with placeholder text only
    4. page.getByText()        — non-interactive text
    5. page.getByTestId()      — only when no accessible selector exists
  NEVER use nth-child, CSS class names, auto-generated attributes, XPath.
- Tag smoke tests with @smoke in the test name.
- Use \`await expect(...).toBeVisible()\` (auto-retrying) — never page.waitForTimeout.
- File locations: UI tests in tests/ui/, POM classes in tests/pages/.`;

const API_RULES = `API tests (Playwright APIRequestContext or supertest, TypeScript):
- No browser. Use Playwright's \`request\` fixture or supertest against the running app.
- File location: tests/api/.
- Assert on status code AND response body shape (use a schema check or specific field assertions).
- Cover at least one error path (4xx) per endpoint.
- Never share state between tests — set up and tear down within each test.`;

const UNIT_RULES = (sourcePath: string) => `Unit tests (Jest, TypeScript):
- Mirror the source file structure. ${sourcePath}/services/user.ts → tests/unit/services/user.test.ts
- Top-level describe('<ModuleName>') per file.
- Nested describe('<functionName>') per exported function.
- Inside each function describe, write it('should <behaviour>') tests.
- Import the module under test by relative path.
- Mock external deps (db, http, fs, third-party modules) with jest.mock() at the top.
- Clean up mocks in afterEach where needed.
- Test happy path AND at least one error/edge case per function.
- Assert on observable behaviour — return values, thrown errors, side effects — never on internal implementation details.`;

const COMPONENT_RULES = `Component tests (Playwright Component Testing or React Testing Library, TypeScript):
- File location: tests/components/.
- Render the component in isolation. Mock data props and event handlers.
- Use accessible queries (getByRole/getByLabel) — same priority as UI tests.
- Test rendering, prop variations, and user interactions.
- Never spin up the full app or hit a real backend.`;

function rulesFor(modes: TestMode[], sourcePath: string): string {
  const sections: string[] = [];
  if (modes.includes('ui')) sections.push(UI_RULES);
  if (modes.includes('api')) sections.push(API_RULES);
  if (modes.includes('unit')) sections.push(UNIT_RULES(sourcePath));
  if (modes.includes('component')) sections.push(COMPONENT_RULES);
  return sections.join('\n\n');
}

function buildSystemPrompt(context?: TestingContext, repoContext?: RepoContext): string {
  const modes = context?.modes ?? ['ui', 'api'];
  const sourcePath = context?.sourcePath ?? 'src';
  const repoBlock = repoContext ? new RepoContextAgent().format(repoContext) : '';

  return `You are an expert engineer writing high-quality automated tests.

This project uses these kinds of tests: ${modes.join(', ')}.
Apply the rules below for each kind. If a ticket only relates to one kind, generate only those files.

${rulesFor(modes, sourcePath)}

General rules (all modes):
- TypeScript only.
- Each test must verify a specific acceptance criterion — no decorative or always-passing assertions.
- Tests must be independent. No shared mutable state between tests.
- Prefer one assertion concept per test. Multiple expects are fine if they describe the same behaviour.
${repoBlock}
Output format:
Respond ONLY with a JSON array of file objects. No markdown fences, no prose.
Each item: { "path": "tests/...", "testType": "ui"|"api"|"unit"|"component", "content": "<full file>" }
Include POM/helper files in the array alongside test files.`;
}

function buildGeneratorPrompt(
  ticket: JiraTicket,
  opts: { previousReview?: ReviewResult; context?: TestingContext },
): string {
  const modes = opts.context?.modes ?? ['ui', 'api'];

  // Infer which modes apply to this ticket from its labels (best-effort hint).
  const wantedModes: TestMode[] = [];
  if (ticket.labels.includes('api-only')) {
    if (modes.includes('api')) wantedModes.push('api');
  } else {
    for (const m of modes) {
      if (m === 'api' && !(ticket.labels.includes('api') || ticket.labels.includes('ui'))) continue;
      wantedModes.push(m);
    }
    // If labels gave no hints, target all configured modes.
    if (wantedModes.length === 0) wantedModes.push(...modes);
  }

  const parts = [
    `Ticket: ${ticket.key} — ${ticket.summary}`,
    ``,
    `Acceptance Criteria:`,
    ticket.acceptanceCriteria || ticket.description,
    ``,
    `Generate tests for these kinds: ${wantedModes.join(', ')}`,
  ];

  if (opts.context?.sourcePath && (modes.includes('unit') || modes.includes('component'))) {
    parts.push(`Source path to mirror for unit/component tests: ${opts.context.sourcePath}`);
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
      testType: (f.testType as 'ui' | 'api' | 'unit' | 'component') ?? 'ui',
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
