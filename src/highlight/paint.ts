import { mappingFor } from './mapping.js';

/** A capture as tree-sitter reports it. Columns are UTF-16 code units. */
export interface RawCapture {
  readonly name: string;
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}

/** A VS Code semantic token: single line, non-overlapping, document-ordered. */
export interface SemanticToken {
  readonly line: number;
  readonly startColumn: number;
  readonly length: number;
  readonly type: string;
  readonly modifiers: readonly string[];
}

/**
 * Turn tree-sitter captures into a VS Code semantic token stream.
 *
 * The hard part is that tree-sitter captures NEST — `(postconditional)` spans
 * `:X=1` while `X` and `=` inside it are captured too — and VS Code's token
 * stream must be flat, ordered, and non-overlapping. Rather than pick a winner
 * per pair (which needs an ordering that is transitive, and isn't), the
 * captures are PAINTED onto the characters they cover, largest first, so the
 * most specific capture over any given character is the one left standing.
 * Contiguous characters carrying the same (type, modifiers) then coalesce into
 * one token.
 *
 * Cost is O(covered characters), which for a routine-sized file is nothing, and
 * the result is non-overlapping by construction rather than by assertion.
 */
export function buildTokens(captures: readonly RawCapture[]): SemanticToken[] {
  // Paint order: widest first, so narrower captures overwrite them. Ties go to
  // the later capture, matching tree-sitter's own last-pattern-wins precedence.
  const painted = captures
    .map((capture, order) => ({ capture, order }))
    .filter(({ capture }) => {
      if (capture.startRow !== capture.endRow) return false; // no multi-line tokens
      if (capture.endColumn <= capture.startColumn) return false; // no empty tokens
      return mappingFor(capture.name) !== undefined; // unmapped: dropped, not guessed
    })
    .sort((a, b) => {
      const width =
        b.capture.endColumn - b.capture.startColumn - (a.capture.endColumn - a.capture.startColumn);
      return width !== 0 ? width : a.order - b.order;
    });

  // line -> column -> the mapping key painted there
  const canvas = new Map<number, Map<number, string>>();
  for (const { capture } of painted) {
    let row = canvas.get(capture.startRow);
    if (!row) {
      row = new Map();
      canvas.set(capture.startRow, row);
    }
    for (let col = capture.startColumn; col < capture.endColumn; col++) row.set(col, capture.name);
  }

  const tokens: SemanticToken[] = [];
  for (const line of [...canvas.keys()].sort((a, b) => a - b)) {
    const row = canvas.get(line) as Map<number, string>;
    let start: number | undefined;
    let previous: string | undefined;
    const columns = [...row.keys()].sort((a, b) => a - b);
    for (const [i, col] of columns.entries()) {
      const name = row.get(col) as string;
      const contiguous = i > 0 && col === (columns[i - 1] as number) + 1;
      if (start !== undefined && contiguous && sameStyle(name, previous as string)) continue;
      if (start !== undefined) tokens.push(run(line, start, columns[i - 1] as number, previous));
      start = col;
      previous = name;
    }
    if (start !== undefined) {
      tokens.push(run(line, start, columns[columns.length - 1] as number, previous));
    }
  }
  return tokens;
}

/** Two captures coalesce only if they produce the same token identity. */
function sameStyle(a: string, b: string): boolean {
  if (a === b) return true;
  const [x, y] = [mappingFor(a), mappingFor(b)];
  if (!x || !y) return false;
  return x.type === y.type && x.modifiers.join(',') === y.modifiers.join(',');
}

function run(line: number, from: number, to: number, name: string | undefined): SemanticToken {
  const mapping = mappingFor(name as string) as { type: string; modifiers: readonly string[] };
  return {
    line,
    startColumn: from,
    length: to - from + 1,
    type: mapping.type,
    modifiers: mapping.modifiers,
  };
}
