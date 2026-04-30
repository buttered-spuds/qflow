import { describe, it, expect, vi } from 'vitest';
import { GeneratorAgent } from '../src/agents/generator-agent.js';
import { ReviewerAgent } from '../src/agents/reviewer-agent.js';
import type { LLMAdapter, ChatMessage, TokenUsage } from '../src/adapters/llm/base.js';
import type { JiraTicket } from '../src/agents/jira-agent.types.js';

class MockLLM implements LLMAdapter {
  public lastSystemPrompt = '';
  public lastUserPrompt = '';
  constructor(private readonly response: string) {}
  async chat(messages: ChatMessage[]): Promise<string> {
    this.lastSystemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';
    this.lastUserPrompt = messages.find((m) => m.role === 'user')?.content ?? '';
    return this.response;
  }
  async toolCall(): Promise<never> { throw new Error('not used'); }
  getLastUsage(): TokenUsage { return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 }; }
}

const ticket: JiraTicket = {
  key: 'TEST-1',
  summary: 'User can log in',
  description: 'As a user, I want to log in.',
  acceptanceCriteria: 'Given valid creds, when I submit, then I see the dashboard.',
  labels: [],
  status: 'In Progress',
  issueType: 'Story',
};

describe('GeneratorAgent', () => {
  it('parses a valid JSON array response into GeneratedTestFile[]', async () => {
    const llm = new MockLLM(
      JSON.stringify([
        { path: 'tests/ui/login.spec.ts', testType: 'ui', content: 'export {};' },
      ]),
    );
    const reviewerLLM = new MockLLM(JSON.stringify({ score: 9, feedback: 'good', issues: [] }));
    const agent = new GeneratorAgent(llm);
    // swap reviewer for the same agent — a private field; bypass via any
    (agent as unknown as { reviewer: ReviewerAgent }).reviewer = new ReviewerAgent(reviewerLLM);

    const { files, review } = await agent.generate(ticket, { cwd: process.cwd(), maxRetries: 1 });
    expect(files).toHaveLength(1);
    expect(files[0].testType).toBe('ui');
    expect(review.approved).toBe(true);
  });

  it('strips markdown fences from the LLM response', async () => {
    const llm = new MockLLM(
      '```json\n' +
      JSON.stringify([{ path: 'tests/api/x.spec.ts', testType: 'api', content: 'x' }]) +
      '\n```',
    );
    const reviewerLLM = new MockLLM(JSON.stringify({ score: 8, feedback: 'ok', issues: [] }));
    const agent = new GeneratorAgent(llm);
    (agent as unknown as { reviewer: ReviewerAgent }).reviewer = new ReviewerAgent(reviewerLLM);

    const { files } = await agent.generate(ticket, { cwd: process.cwd(), maxRetries: 1 });
    expect(files[0].path).toBe('tests/api/x.spec.ts');
  });

  it('throws on malformed JSON', async () => {
    const llm = new MockLLM('not json');
    const reviewerLLM = new MockLLM(JSON.stringify({ score: 1, feedback: '', issues: [] }));
    const agent = new GeneratorAgent(llm);
    (agent as unknown as { reviewer: ReviewerAgent }).reviewer = new ReviewerAgent(reviewerLLM);

    await expect(agent.generate(ticket, { cwd: process.cwd(), maxRetries: 1 })).rejects.toThrow(/invalid JSON/i);
  });

  it('includes mode-specific rules in the system prompt', async () => {
    const llm = new MockLLM(JSON.stringify([{ path: 't/x.spec.ts', testType: 'unit', content: 'x' }]));
    const reviewerLLM = new MockLLM(JSON.stringify({ score: 9, feedback: '', issues: [] }));
    const agent = new GeneratorAgent(llm);
    (agent as unknown as { reviewer: ReviewerAgent }).reviewer = new ReviewerAgent(reviewerLLM);

    await agent.generate(ticket, {
      cwd: process.cwd(),
      maxRetries: 1,
      testingContext: { modes: ['unit'], sourcePath: 'src' },
      repoContext: { pageObjects: [], fixtures: [], exampleTests: [], tsconfigPaths: {} },
    });

    expect(llm.lastSystemPrompt).toMatch(/describe\('<functionName>'\)/);
    expect(llm.lastSystemPrompt).not.toMatch(/Page Object Model/);
  });

  it('includes UI rules when modes include ui', async () => {
    const llm = new MockLLM(JSON.stringify([{ path: 't/x.spec.ts', testType: 'ui', content: 'x' }]));
    const reviewerLLM = new MockLLM(JSON.stringify({ score: 9, feedback: '', issues: [] }));
    const agent = new GeneratorAgent(llm);
    (agent as unknown as { reviewer: ReviewerAgent }).reviewer = new ReviewerAgent(reviewerLLM);

    await agent.generate(ticket, {
      cwd: process.cwd(),
      maxRetries: 1,
      testingContext: { modes: ['ui'] },
      repoContext: { pageObjects: [], fixtures: [], exampleTests: [], tsconfigPaths: {} },
    });

    expect(llm.lastSystemPrompt).toMatch(/Page Object Model/);
    expect(llm.lastSystemPrompt).toMatch(/getByRole/);
  });

  it('injects repo context into the system prompt', async () => {
    const llm = new MockLLM(JSON.stringify([{ path: 't/x.spec.ts', testType: 'ui', content: 'x' }]));
    const reviewerLLM = new MockLLM(JSON.stringify({ score: 9, feedback: '', issues: [] }));
    const agent = new GeneratorAgent(llm);
    (agent as unknown as { reviewer: ReviewerAgent }).reviewer = new ReviewerAgent(reviewerLLM);

    await agent.generate(ticket, {
      cwd: process.cwd(),
      maxRetries: 1,
      testingContext: { modes: ['ui'] },
      repoContext: {
        pageObjects: [{ file: 'tests/pages/LoginPage.ts', className: 'LoginPage', methods: ['login'] }],
        fixtures: [],
        exampleTests: [],
        tsconfigPaths: {},
      },
    });

    expect(llm.lastSystemPrompt).toMatch(/LoginPage/);
    expect(llm.lastSystemPrompt).toMatch(/REUSE/);
  });
});

describe('ReviewerAgent', () => {
  it('parses a valid JSON review and approves above threshold', async () => {
    const llm = new MockLLM(JSON.stringify({ score: 8, feedback: 'looks good', issues: [] }));
    const reviewer = new ReviewerAgent(llm);
    const review = await reviewer.review(ticket, [
      { path: 'tests/ui/x.spec.ts', testType: 'ui', content: 'x' },
    ]);
    expect(review.score).toBe(8);
    expect(review.approved).toBe(true);
  });

  it('does not approve below threshold', async () => {
    const llm = new MockLLM(JSON.stringify({ score: 3, feedback: 'bad', issues: ['no asserts'] }));
    const reviewer = new ReviewerAgent(llm);
    const review = await reviewer.review(ticket, [
      { path: 'tests/ui/x.spec.ts', testType: 'ui', content: 'x' },
    ]);
    expect(review.approved).toBe(false);
    expect(review.issues).toContain('no asserts');
  });

  it('treats non-JSON responses as score 0 (triggers regeneration)', async () => {
    const llm = new MockLLM('completely broken');
    const reviewer = new ReviewerAgent(llm);
    const review = await reviewer.review(ticket, [
      { path: 'tests/ui/x.spec.ts', testType: 'ui', content: 'x' },
    ]);
    expect(review.score).toBe(0);
    expect(review.approved).toBe(false);
  });
});
