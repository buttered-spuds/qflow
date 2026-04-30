import * as vscode from 'vscode';
import { join } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import type { Manifest, ManifestEntry, RunReport } from './types';

/**
 * Centralised cache for manifest + run reports. Reads each file once, then
 * re-reads only when its mtime changes (or `invalidate()` is called by the
 * file watcher in extension.ts).
 */
export class RunStore {
  private manifestCache: { mtimeMs: number; data: Manifest } | null = null;
  private readonly reportCache = new Map<string, { mtimeMs: number; data: RunReport }>();

  invalidate(): void {
    this.manifestCache = null;
    this.reportCache.clear();
  }

  getRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  loadManifest(): Manifest | null {
    const root = this.getRoot();
    if (!root) return null;

    const manifestPath = join(root, '.qflow', 'data', 'manifest.json');
    if (!existsSync(manifestPath)) return null;

    try {
      const stat = statSync(manifestPath);
      if (this.manifestCache && this.manifestCache.mtimeMs === stat.mtimeMs) {
        return this.manifestCache.data;
      }
      const data = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;
      this.manifestCache = { mtimeMs: stat.mtimeMs, data };
      return data;
    } catch {
      return null;
    }
  }

  loadReport(entry: ManifestEntry): RunReport | null {
    const root = this.getRoot();
    if (!root) return null;

    const reportPath = join(root, '.qflow', 'data', entry.file);
    if (!existsSync(reportPath)) return null;

    try {
      const stat = statSync(reportPath);
      const cached = this.reportCache.get(entry.id);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.data;
      }
      const data = JSON.parse(readFileSync(reportPath, 'utf-8')) as RunReport;
      this.reportCache.set(entry.id, { mtimeMs: stat.mtimeMs, data });
      return data;
    } catch {
      return null;
    }
  }

  loadLatestReport(): RunReport | null {
    const manifest = this.loadManifest();
    const latest = manifest?.runs[manifest.runs.length - 1];
    return latest ? this.loadReport(latest) : null;
  }

  /** Most-recent N runs (newest first), capped. */
  recentRuns(limit: number): { entry: ManifestEntry; report: RunReport | null }[] {
    const manifest = this.loadManifest();
    if (!manifest) return [];
    const entries = [...manifest.runs].reverse().slice(0, limit);
    return entries.map((entry) => ({ entry, report: this.loadReport(entry) }));
  }
}
