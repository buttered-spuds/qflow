import { appendFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { TokenUsage } from '../adapters/llm/base.js';
import type { TokenUsageRecord } from '../types.js';

/**
 * Persistent append-only JSONL cost ledger.
 *
 * Each LLM call appends one JSON line to `.qflow/costs.jsonl`.
 * Pure JavaScript — zero native dependencies, works on any Node version.
 *
 * File format: one JSON object per line, each conforming to TokenUsageRecord.
 */
export class CostLedger {
  private readonly ledgerPath: string;
  private records: TokenUsageRecord[] | null = null;

  constructor(cwd: string) {
    const dir = join(cwd, '.qflow');
    mkdirSync(dir, { recursive: true });
    this.ledgerPath = join(dir, 'costs.jsonl');
  }

  /** Load existing records from disk (lazy, cached). */
  async open(): Promise<void> {
    if (!existsSync(this.ledgerPath)) {
      this.records = [];
      return;
    }
    const raw = await readFile(this.ledgerPath, 'utf-8');
    this.records = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as TokenUsageRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is TokenUsageRecord => r !== null);
  }

  /** Append a usage record to the ledger file. */
  async insert(record: Omit<TokenUsageRecord, 'id'>): Promise<void> {
    const line = JSON.stringify(record) + '\n';
    await appendFile(this.ledgerPath, line, 'utf-8');
    // Invalidate cache so next read picks up the new record
    this.records = null;
  }

  /** All records, newest first. */
  all(): TokenUsageRecord[] {
    return this.#loaded().slice().reverse();
  }

  /** Summarised totals grouped by provider+model. */
  summary(): Array<{
    provider: string;
    model: string;
    calls: number;
    totalTokens: number;
    totalCostUsd: number;
  }> {
    const map = new Map<string, { provider: string; model: string; calls: number; totalTokens: number; totalCostUsd: number }>();
    for (const r of this.#loaded()) {
      const key = `${r.provider}::${r.model}`;
      const entry = map.get(key) ?? { provider: r.provider, model: r.model, calls: 0, totalTokens: 0, totalCostUsd: 0 };
      entry.calls += 1;
      entry.totalTokens += r.totalTokens;
      entry.totalCostUsd += r.estimatedCostUsd;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  }

  /** Last N records (newest first). */
  recent(limit = 20): TokenUsageRecord[] {
    return this.#loaded().slice(-limit).reverse();
  }

  /** No-op — kept for API compatibility. */
  close(): void {
    this.records = null;
  }

  #loaded(): TokenUsageRecord[] {
    if (!this.records) throw new Error('CostLedger not opened. Call ledger.open() first.');
    return this.records;
  }
}

/**
 * Helper: record usage from any LLMAdapter call.
 *
 * @example
 * const response = await llm.chat(messages);
 * await trackUsage(ledger, llm.getLastUsage(), 'generate', 'openai', 'gpt-4o');
 */
export async function trackUsage(
  ledger: CostLedger,
  usage: TokenUsage,
  command: string,
  provider: string,
  model: string,
): Promise<void> {
  await ledger.insert({
    timestamp: new Date().toISOString(),
    command,
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
  });
}

