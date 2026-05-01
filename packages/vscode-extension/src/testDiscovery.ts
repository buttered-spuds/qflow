import type { TextDocument, Uri } from 'vscode';
import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';

export interface DiscoveredTest {
  /** The display name passed as the first arg to test/it. */
  name: string;
  /** Includes any enclosing describe() names, joined by ' > '. */
  fullName: string;
  /** 0-based line where the test() call starts. */
  line: number;
  /** 0-based character where the test() call starts. */
  character: number;
  /** Workspace-absolute file URI. */
  uri: Uri;
  /** Relative path from workspace root, slash-normalised. */
  relPath: string;
}

/**
 * Lightweight regex-based scanner for `test('name', ...)` / `it('name', ...)` /
 * `test.only` / `test.skip`, plus enclosing `describe('name', ...)` blocks.
 *
 * Not a real parser — handles the common case (single quotes, double quotes,
 * backticks). Matches the spec/test conventions used by Playwright, Jest,
 * Vitest, Mocha. For pytest we only get the file (no per-test discovery).
 */
const TEST_CALL_RE = /\b(test|it)(?:\.(?:only|skip|todo))?\s*\(\s*(['"`])([^'"`]+?)\2/g;
const DESCRIBE_RE = /\b(describe|suite)(?:\.(?:only|skip))?\s*\(\s*(['"`])([^'"`]+?)\2/g;

export function discoverTestsInDocument(doc: TextDocument, relPath: string): DiscoveredTest[] {
  const text = doc.getText();
  return extractTests(text, doc.uri, relPath);
}

export async function discoverTestsInFile(uri: Uri, relPath: string): Promise<DiscoveredTest[]> {
  let text: string;
  try {
    text = await readFile(uri.fsPath, 'utf-8');
  } catch {
    return [];
  }
  return extractTests(text, uri, relPath);
}

function extractTests(text: string, uri: Uri, relPath: string): DiscoveredTest[] {
  // Strip line+block comments so we don't match commented-out tests.
  const stripped = stripComments(text);

  // Build a sorted list of describe blocks: { start, end, name }
  // We approximate "end" by matching brace depth from the call site.
  const describes = collectBlocks(stripped, DESCRIBE_RE);

  // Precompute line-start offsets once so each offset→position lookup is O(log n).
  const lineOffsets = buildLineOffsets(stripped);

  const tests: DiscoveredTest[] = [];
  TEST_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEST_CALL_RE.exec(stripped)) !== null) {
    const offset = m.index;
    const name = m[3];
    const enclosing = describes
      .filter((d) => d.start <= offset && offset <= d.end)
      .map((d) => d.name);
    const fullName = enclosing.length > 0 ? `${enclosing.join(' > ')} > ${name}` : name;
    const { line, character } = offsetToPosition(lineOffsets, offset);
    tests.push({ name, fullName, line, character, uri, relPath });
  }
  return tests;
}

interface Block { start: number; end: number; name: string }

function collectBlocks(text: string, re: RegExp): Block[] {
  re.lastIndex = 0;
  const out: Block[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const name = m[3];
    const end = findBlockEnd(text, m.index + m[0].length);
    out.push({ start, end, name });
  }
  return out;
}

/** Walk forward from `from` and return the offset of the matching closing `}`.
 *  String literals are skipped so braces inside strings don't affect depth. */
function findBlockEnd(text: string, from: number): number {
  // Find the first `{` after `from`.
  let i = from;
  while (i < text.length && text[i] !== '{') i++;
  if (i >= text.length) return text.length;
  let depth = 1;
  i++;
  let inStr: string | null = null;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\' && i + 1 < text.length) { i += 2; continue; }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
    }
    i++;
  }
  return i;
}

/**
 * Build an array of character offsets where each line starts.
 * lineOffsets[0] === 0 (line 0 starts at position 0).
 * Built once per file so offsetToPosition is O(log n) per lookup.
 */
function buildLineOffsets(text: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

/** Map a character offset to (line, character) in O(log n) via binary search. */
function offsetToPosition(lineOffsets: number[], offset: number): { line: number; character: number } {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: offset - lineOffsets[lo] };
}

/** Replace comments with spaces so character offsets are preserved. */
function stripComments(text: string): string {
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) { out += next; i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < text.length) { out += '  '; i += 2; } // consume */ only if found
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
