import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTokens, type RawCapture, type SemanticToken } from './paint.ts';

const cap = (name: string, row: number, from: number, to: number): RawCapture => ({
  name,
  startRow: row,
  startColumn: from,
  endRow: row,
  endColumn: to,
});

const tok = (
  line: number,
  startColumn: number,
  length: number,
  type: string,
  modifiers: string[] = [],
): SemanticToken => ({ line, startColumn, length, type, modifiers });

const cases: Array<{ name: string; captures: RawCapture[]; want: SemanticToken[]; why: string }> = [
  {
    name: 'a single capture becomes a single token',
    captures: [cap('keyword', 0, 1, 4)],
    want: [tok(0, 1, 3, 'keyword')],
    why: 'baseline',
  },
  {
    name: 'unmapped captures are dropped, not emitted as an unknown type',
    captures: [cap('no.such.capture', 0, 0, 5), cap('keyword', 0, 6, 9)],
    want: [tok(0, 6, 3, 'keyword')],
    why: 'an unknown type would be silently uncoloured; mapping.test.ts is the gate that catches it',
  },
  {
    name: 'nested captures: the INNER one wins',
    // `(postconditional)` spans `:X=1`; inside it `X` is @variable and `=` is
    // @operator. VS Code forbids overlapping tokens, so the outer must yield.
    captures: [
      cap('keyword.operator', 0, 5, 9),
      cap('variable', 0, 6, 7),
      cap('operator', 0, 7, 8),
    ],
    want: [
      tok(0, 5, 1, 'keyword'),
      tok(0, 6, 1, 'variable'),
      tok(0, 7, 1, 'operator'),
      tok(0, 8, 1, 'keyword'),
    ],
    why: 'the outer capture survives only where nothing more specific covers it',
  },
  {
    name: 'identical ranges: the later capture wins',
    captures: [cap('variable', 0, 0, 3), cap('function', 0, 0, 3)],
    want: [tok(0, 0, 3, 'function')],
    why: 'query order is the tie-break, matching tree-sitter capture precedence',
  },
  {
    name: 'adjacent captures of the same type merge into one run',
    captures: [cap('operator', 0, 4, 5), cap('operator', 0, 5, 6)],
    want: [tok(0, 4, 2, 'operator')],
    why: 'runs keep the token stream minimal; VS Code renders them identically',
  },
  {
    name: 'adjacent captures of DIFFERENT types stay separate',
    captures: [cap('variable', 0, 4, 5), cap('operator', 0, 5, 6)],
    want: [tok(0, 4, 1, 'variable'), tok(0, 5, 1, 'operator')],
    why: 'the run break is on (type, modifiers), not position',
  },
  {
    name: 'same type but different modifiers do NOT merge',
    captures: [cap('variable', 0, 0, 1), cap('variable.builtin', 0, 1, 2)],
    want: [tok(0, 0, 1, 'variable'), tok(0, 1, 1, 'variable', ['defaultLibrary'])],
    why: 'modifiers are part of the token identity',
  },
  {
    name: 'multi-line captures are dropped',
    captures: [
      { name: 'comment', startRow: 0, startColumn: 0, endRow: 2, endColumn: 3 },
      cap('keyword', 3, 1, 4),
    ],
    want: [tok(3, 1, 3, 'keyword')],
    why: 'a VS Code semantic token cannot span lines; M has no multi-line token anyway',
  },
  {
    name: 'empty ranges are dropped',
    captures: [cap('keyword', 0, 3, 3), cap('variable', 0, 4, 5)],
    want: [tok(0, 4, 1, 'variable')],
    why: 'a zero-length token is not renderable',
  },
  {
    name: 'output is sorted by line then column regardless of input order',
    captures: [cap('keyword', 5, 10, 12), cap('variable', 5, 1, 2), cap('comment', 1, 0, 4)],
    want: [tok(1, 0, 4, 'comment'), tok(5, 1, 1, 'variable'), tok(5, 10, 2, 'keyword')],
    why: 'VS Code requires tokens in document order',
  },
  {
    name: 'a capture straddled by two smaller ones survives in the gap',
    captures: [cap('keyword.operator', 0, 0, 10), cap('variable', 0, 2, 4), cap('number', 0, 6, 8)],
    want: [
      tok(0, 0, 2, 'keyword'),
      tok(0, 2, 2, 'variable'),
      tok(0, 4, 2, 'keyword'),
      tok(0, 6, 2, 'number'),
      tok(0, 8, 2, 'keyword'),
    ],
    why: 'painting is per-character, so partial coverage is expressed exactly',
  },
  { name: 'no captures yields no tokens', captures: [], want: [], why: 'degenerate case' },
];

for (const c of cases) {
  test(`buildTokens: ${c.name}`, () => {
    assert.deepEqual(buildTokens(c.captures), c.want, c.why);
  });
}

test('buildTokens: output is never overlapping and always ordered', () => {
  // Property check over a pile of deliberately conflicting captures.
  const names = ['keyword', 'variable', 'operator', 'string', 'number', 'comment'];
  const captures: RawCapture[] = [];
  for (let i = 0; i < 200; i++) {
    const row = i % 7;
    const from = (i * 3) % 40;
    const len = 1 + (i % 9);
    captures.push(cap(names[i % names.length] as string, row, from, from + len));
  }
  const tokens = buildTokens(captures);
  assert.ok(tokens.length > 0);
  let prevLine = -1;
  let prevEnd = -1;
  for (const t of tokens) {
    assert.ok(t.length > 0, 'zero-length token');
    if (t.line === prevLine) {
      assert.ok(t.startColumn >= prevEnd, `overlap on line ${t.line} at ${t.startColumn}`);
    } else {
      assert.ok(t.line > prevLine, 'lines out of order');
      prevLine = t.line;
    }
    prevEnd = t.startColumn + t.length;
  }
});
