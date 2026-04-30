import type { QFlowConfig, RunOptions, RunReport } from '../types.js';
import { RunnerAgent } from './runner-agent.js';
import { ReporterAgent } from './reporter-agent.js';
import { JiraAgent } from './jira-agent.js';
import { AzureDevOpsAgent } from './azure-devops-agent.js';
import type { TicketAgent } from './ticket-agent.js';
import { GeneratorAgent } from './generator-agent.js';
import { CoverageDriftAgent } from './coverage-drift-agent.js';
import { createLLMAdapter } from '../adapters/llm/index.js';
import { CostLedger, trackUsage } from '../utils/cost-ledger.js';

export interface OrchestratorRunOptions {
  suite: string;
  local: boolean;
  cwd: string;
}

export interface OrchestratorGenerateOptions {
  ticketKey: string;
  cwd: string;
  maxRetries?: number;
}

export interface GenerateResult {
  prUrl: string;
  filesWritten: string[];
  reviewScore: number;
  reviewFeedback: string;
}

export class Orchestrator {
  private readonly runnerAgent: RunnerAgent;
  private readonly reporterAgent: ReporterAgent;

  constructor(private readonly config: QFlowConfig) {
    this.runnerAgent = new RunnerAgent(config);
    this.reporterAgent = new ReporterAgent(config);
  }

  async run(options: OrchestratorRunOptions): Promise<RunReport> {
    const runOptions: RunOptions = {
      suite: options.suite,
      cwd: options.cwd,
      local: options.local,
    };

    const report = await this.runnerAgent.run(runOptions);

    await this.reporterAgent.report(report, {
      local: options.local,
      cwd: options.cwd,
    });

    return report;
  }

  async generate(options: OrchestratorGenerateOptions): Promise<GenerateResult> {
    const ticketAgent = this.#resolveTicketAgent();
    if (!ticketAgent) {
      throw new Error('A ticket system (jira or azureDevOps) is required for npx qflow generate.');
    }
    if (!this.config.llm) {
      throw new Error('llm config is required for npx qflow generate. Add it to framework.config.ts.');
    }

    const ticket = await ticketAgent.getTicket(options.ticketKey);
    return this.generateFromTicket(ticket, options);
  }

  async generateFromTicket(
    ticket: import('./jira-agent.types.js').JiraTicket,
    options: Omit<OrchestratorGenerateOptions, 'ticketKey'>,
  ): Promise<GenerateResult> {
    if (!this.config.llm) {
      throw new Error('llm config is required for generate. Add it to framework.config.ts.');
    }

    const llm = createLLMAdapter(this.config.llm);
    const generatorAgent = new GeneratorAgent(llm);

    // 1. Generate tests (with Reviewer loop)
    const { files, review } = await generatorAgent.generate(ticket, {
      cwd: options.cwd,
      maxRetries: options.maxRetries,
    });

    // 2. Write files to disk
    await generatorAgent.writeFiles(files, options.cwd);

    // 3. Commit + open Draft PR
    const prUrl = await generatorAgent.openDraftPR(files, ticket, review, options.cwd);

    // 4. Update ticket with PR link (only if a ticket system is configured)
    const ticketAgent = this.#resolveTicketAgent();
    if (ticketAgent) {
      await ticketAgent.addComment(ticket.key, buildTicketComment(prUrl, review));
    }

    // 5. Record LLM cost
    const ledger = new CostLedger(options.cwd);
    await ledger.open();
    await trackUsage(ledger, llm.getLastUsage(), 'generate', this.config.llm.provider, this.config.llm.model);
    ledger.close();

    return {
      prUrl,
      filesWritten: files.map((f) => f.path),
      reviewScore: review.score,
      reviewFeedback: review.feedback,
    };
  }

  async coverageCheck(cwd: string): Promise<import('./coverage-drift-agent.js').CoverageDriftResult> {
    if (!this.config.jira && !this.config.azureDevOps) {
      throw new Error('A ticket system (jira or azureDevOps) is required for coverage drift detection.');
    }
    const agent = new CoverageDriftAgent(this.config);
    return agent.check(cwd);
  }

  // Phase 4: flakinessCheck(report) → quarantine logic (auto-called via ReporterAgent)

  #resolveTicketAgent(): TicketAgent | null {
    if (this.config.jira) return new JiraAgent(this.config.jira);
    if (this.config.azureDevOps) return new AzureDevOpsAgent(this.config.azureDevOps);
    return null;
  }
}

function buildTicketComment(prUrl: string, review: { score: number; feedback: string }): object {
  return {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `🤖 qflow generated tests — reviewer score: ${review.score}/10. ` },
          { type: 'text', text: 'Draft PR: ' },
          { type: 'text', text: prUrl, marks: [{ type: 'link', attrs: { href: prUrl } }] },
        ],
      },
    ],
  };
}
