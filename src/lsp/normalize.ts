/**
 * The one place the two diagnostic dialects meet.
 *
 * `m lint -o json` reports **1-based line and BYTE column** with a severity
 * *name*; LSP reports **0-based line and UTF-16 code-unit character** with a
 * severity *number*. The extension's whole promise is that those two describe
 * the same findings, so both are normalised to one shape here — `m lint`'s
 * currency — and compared by `diffDiagnostics`, which `equivalence.e2e.test.ts`
 * runs as a gate against the real `m` toolchain.
 *
 * ## Why the column conversion is not `+1` (T1-2 / T1-3)
 *
 * It used to be. `fromLspDiagnostic` added one to `character` and called it a
 * byte column, which is correct **only on ASCII** — and every fixture was
 * ASCII, so the gate could not fail on the very bug it existed to catch: the
 * server was publishing byte columns where LSP mandates UTF-16 code units, and
 * `character + 1 === col` held for both the right answer and the wrong one. A
 * gate that cannot fail is not a gate.
 *
 * The conversion below therefore goes through the DOCUMENT TEXT: given the
 * line the finding sits on, count how many bytes the first `character` UTF-16
 * code units occupy. That number is derived from neither producer's column, so
 * it can disagree with either — which is what makes it an oracle rather than a
 * restatement.
 *
 * This module holds coordinate arithmetic and the LSP severity enum. It holds
 * no M knowledge: rule ids are opaque strings, never interpreted.
 */

export const SEVERITY_NAMES = ['error', 'warning', 'info', 'style'] as const;
export type SeverityName = (typeof SEVERITY_NAMES)[number];

/** LSP `DiagnosticSeverity` is 1..4; `m lsp` maps style findings to 4 (Hint). */
const LSP_SEVERITY: Record<number, SeverityName> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'style',
};

/** A finding reduced to what both producers must agree on. */
export interface NormalDiagnostic {
  rule: string;
  /** 1-based, as a human and `m lint` count lines. */
  line: number;
  /** 1-based. */
  col: number;
  severity: SeverityName;
}

export interface LspDiagnosticLike {
  range: { start: { line: number; character: number } };
  severity?: number;
  code?: string | number;
  message: string;
}

export interface CliDiagnosticLike {
  file: string;
  line: number;
  col: number;
  rule: string;
  severity: string;
  message: string;
}

/**
 * The 1-based line'th line of `text`, without its terminator. Returns '' when
 * the document has no such line, so an out-of-range position degrades to a
 * clamped column rather than throwing inside a gate.
 */
export function lineOf(text: string, line: number): string {
  if (line < 1) return '';
  const lines = text.split('\n');
  const found = lines[line - 1];
  return found === undefined ? '' : found.replace(/\r$/, '');
}

/**
 * Convert a 0-based UTF-16 code-unit offset into `lineText` to the 1-based
 * BYTE column `m lint` reports. Clamped to the line: a position past the end
 * maps to one past the last byte.
 */
export function byteColumnFromUtf16(lineText: string, character: number): number {
  const units = Math.max(0, Math.min(character, lineText.length));
  return Buffer.byteLength(lineText.slice(0, units), 'utf8') + 1;
}

/**
 * The inverse: a 1-based BYTE column to the 0-based UTF-16 code-unit offset an
 * LSP position must carry. Used by the gate to state what the server SHOULD
 * have published for a finding `m lint` reported.
 */
export function utf16FromByteColumn(lineText: string, byteCol: number): number {
  const bytes = Buffer.from(lineText, 'utf8');
  const offset = Math.max(0, Math.min(byteCol - 1, bytes.length));
  return bytes.subarray(0, offset).toString('utf8').length;
}

/**
 * Normalise an LSP diagnostic into `m lint`'s currency: 1-based line, 1-based
 * BYTE column. `documentText` is required — the column cannot be computed
 * without the text the position refers to, and accepting a guess is how the
 * previous version silently agreed with a bug.
 */
export function fromLspDiagnostic(d: LspDiagnosticLike, documentText: string): NormalDiagnostic {
  const line = d.range.start.line + 1;
  return {
    rule: d.code === undefined ? '' : String(d.code),
    line,
    col: byteColumnFromUtf16(lineOf(documentText, line), d.range.start.character),
    // The LSP default when a server omits severity is Warning.
    severity: LSP_SEVERITY[d.severity ?? 2] ?? 'warning',
  };
}

/** Normalise an `m lint -o json` diagnostic. Coordinates are already 1-based. */
export function fromCliDiagnostic(d: CliDiagnosticLike): NormalDiagnostic {
  if (!(SEVERITY_NAMES as readonly string[]).includes(d.severity)) {
    throw new Error(`unknown severity from m lint: ${d.severity}`);
  }
  return { rule: d.rule, line: d.line, col: d.col, severity: d.severity as SeverityName };
}

function key(d: NormalDiagnostic): string {
  return `${d.line}:${d.col} ${d.rule} [${d.severity}]`;
}

/** Total order by line, column, rule, severity. Returns a new array. */
export function sortDiagnostics(list: readonly NormalDiagnostic[]): NormalDiagnostic[] {
  return [...list].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.col !== b.col) return a.col - b.col;
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    return a.severity < b.severity ? -1 : a.severity > b.severity ? 1 : 0;
  });
}

/**
 * Multiset difference between what `m lint` reported and what the LSP client
 * received. An empty result is the guarantee the extension makes: the editor
 * shows exactly the diagnostics CI produces. Duplicates count — the same rule
 * firing twice at one position is two findings, and losing one is a real bug.
 */
export function diffDiagnostics(
  cli: readonly NormalDiagnostic[],
  lsp: readonly NormalDiagnostic[],
): string[] {
  const counts = new Map<string, number>();
  for (const d of cli) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1);
  for (const d of lsp) counts.set(key(d), (counts.get(key(d)) ?? 0) - 1);

  const out: string[] = [];
  for (const k of [...counts.keys()].sort()) {
    const n = counts.get(k) ?? 0;
    if (n > 0) out.push(`only from m lint (${n}x): ${k}`);
    else if (n < 0) out.push(`only from the LSP client (${-n}x): ${k}`);
  }
  return out;
}
