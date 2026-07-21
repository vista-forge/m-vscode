/**
 * Pure model pieces of the E3 acceptance harness (matrix A1–A5): the
 * semantic-token wire decode, latency percentiles, torture-corpus assembly,
 * and the per-criterion evidence table. Kept vscode-free so the arithmetic
 * the verdict rests on is unit-testable outside an extension host.
 */

/** One semantic token in absolute coordinates (decoded from the wire). */
export interface AbsoluteToken {
  line: number;
  startColumn: number;
  length: number;
  typeIndex: number;
  modifierSet: number;
}

/**
 * Decode LSP/VS Code semantic-token data (the 5-uint-per-token delta
 * encoding) into absolute positions, so the installed extension's output can
 * be compared against an independently computed oracle.
 */
export function decodeSemanticTokens(data: readonly number[]): AbsoluteToken[] {
  if (data.length % 5 !== 0) {
    throw new Error(`semantic token data length ${data.length} is not a multiple of 5`);
  }
  const out: AbsoluteToken[] = [];
  let line = 0;
  let col = 0;
  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i] as number;
    const deltaCol = data[i + 1] as number;
    line += deltaLine;
    col = deltaLine === 0 ? col + deltaCol : deltaCol;
    out.push({
      line,
      startColumn: col,
      length: data[i + 2] as number,
      typeIndex: data[i + 3] as number,
      modifierSet: data[i + 4] as number,
    });
  }
  return out;
}

/** Linear-interpolated percentile over an unsorted sample. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sorted[lo] as number;
  const hiV = sorted[hi] as number;
  return loV + (hiV - loV) * (rank - lo);
}

/**
 * Assemble a torture document of at least `targetBytes` by concatenating
 * whole routine texts (the W0-c method: synthetic size, real code shape).
 * Sources must each end in a newline — M is line-structured, and a join that
 * glued two lines together would manufacture parse errors the corpus does
 * not have.
 */
export function assembleCorpus(texts: readonly string[], targetBytes: number): string {
  const sources = texts.filter((t) => t.length > 0);
  if (sources.length === 0) throw new Error('no sources to assemble a torture document from');
  let out = '';
  let bytes = 0;
  while (bytes < targetBytes) {
    for (const t of sources) {
      const src = t.endsWith('\n') ? t : `${t}\n`;
      out += src;
      bytes += Buffer.byteLength(src, 'utf8');
      if (bytes >= targetBytes) break;
    }
  }
  return out;
}

/** One acceptance criterion with its evidence — pass/fail is never implicit. */
export interface CriterionRow {
  scenario: string;
  criterion: string;
  pass: boolean;
  measured: string;
  budget: string;
}

export function allPass(rows: readonly CriterionRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.pass);
}

/** Render the evidence table (plain text — cron logs and reports). */
export function renderTable(rows: readonly CriterionRow[]): string {
  const header = ['scenario', 'criterion', 'verdict', 'measured', 'budget'];
  const cells = rows.map((r) => [
    r.scenario,
    r.criterion,
    r.pass ? 'PASS' : 'FAIL',
    r.measured,
    r.budget,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...cells.map((c) => (c[i] as string).length)),
  );
  const fmt = (row: readonly string[]): string =>
    row.map((c, i) => c.padEnd(widths[i] as number)).join('  ');
  return [fmt(header), ...cells.map(fmt)].join('\n');
}
