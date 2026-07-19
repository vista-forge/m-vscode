/**
 * The one place the two diagnostic dialects meet.
 *
 * `m lint -o json` reports **1-based** line/column and a severity *name*; LSP
 * reports **0-based** line/character and a severity *number*. The extension's
 * whole promise is that those two describe the same findings, so both are
 * normalised to one shape here and compared by `diffDiagnostics` — which
 * `equivalence.e2e.test.ts` runs as a gate against the real `m` toolchain.
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

/** Normalise an LSP diagnostic, converting its 0-based position to 1-based. */
export function fromLspDiagnostic(d: LspDiagnosticLike): NormalDiagnostic {
  return {
    rule: d.code === undefined ? '' : String(d.code),
    line: d.range.start.line + 1,
    col: d.range.start.character + 1,
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
