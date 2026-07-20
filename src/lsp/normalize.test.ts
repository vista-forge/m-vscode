import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  byteColumnFromUtf16,
  diffDiagnostics,
  fromCliDiagnostic,
  fromLspDiagnostic,
  lineOf,
  sortDiagnostics,
  utf16FromByteColumn,
} from './normalize.ts';

/** A plain ASCII document for the coordinate tests that are not about encoding. */
const ASCII_DOC = ['EN ; entry', ' set x=1', '', '', ' write x,!', ' quit'].join('\n');

/**
 * The encoding oracle (T1-2 / T1-3).
 *
 * `m lint` reports BYTE columns; LSP positions count UTF-16 code units. Those
 * two numbers are equal on ASCII and only on ASCII, which is exactly why the
 * equivalence gate used to be blind to the bug: every fixture was ASCII, and
 * `character + 1 === col` held trivially. The conversion below is derived from
 * the DOCUMENT TEXT — never from either producer's column — so it can disagree
 * with both, which is the only way it can catch either being wrong.
 */
describe('the UTF-16 / byte-column oracle', () => {
  //  ` w "café" d work(.x(1))`
  //   0123456789...        — `é` is 2 bytes (UTF-8) and 1 UTF-16 code unit
  const line = ' w "café" d work(.x(1))';

  it('an ASCII prefix has identical byte and UTF-16 offsets', () => {
    assert.equal(utf16FromByteColumn(line, 5), 4);
    assert.equal(byteColumnFromUtf16(line, 4), 5);
  });

  it('a two-byte character shifts every position after it by one', () => {
    // Byte column 19 (1-based) is UTF-16 character 17 (0-based): one fewer,
    // because `é` costs two bytes and one code unit.
    assert.equal(utf16FromByteColumn(line, 19), 17);
    assert.equal(byteColumnFromUtf16(line, 17), 19);
  });

  it('an astral character costs two UTF-16 code units and four bytes', () => {
    const clef = 'a\u{1D11E}b'; // a, 𝄞 (surrogate pair), b
    assert.equal(utf16FromByteColumn(clef, 6), 3); // after 5 bytes: a + 4 = 1 + 2 units
    assert.equal(byteColumnFromUtf16(clef, 3), 6);
  });

  it('round-trips every byte boundary of a mixed-width line', () => {
    for (const byteCol of [1, 2, 4, 8, 10, 12, 20, 24]) {
      assert.equal(
        byteColumnFromUtf16(line, utf16FromByteColumn(line, byteCol)),
        byteCol,
        `byte column ${byteCol} must survive the round trip`,
      );
    }
  });

  it('clamps a position past the end of the line instead of inventing one', () => {
    assert.equal(utf16FromByteColumn(line, 9999), [...line].length);
    assert.equal(byteColumnFromUtf16(line, 9999), Buffer.byteLength(line, 'utf8') + 1);
  });

  it('lineOf returns the requested 1-based line, and "" when there is none', () => {
    assert.equal(lineOf(ASCII_DOC, 2), ' set x=1');
    assert.equal(lineOf(ASCII_DOC, 99), '');
    assert.equal(lineOf('a\r\nb', 1), 'a', 'a CRLF terminator is not part of the line');
  });
});

describe('fromLspDiagnostic — the 0-based to 1-based seam', () => {
  it('converts an LSP position to the 1-based coordinates m lint reports', () => {
    assert.deepEqual(
      fromLspDiagnostic(
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
          severity: 1,
          code: 'M-STY-001',
          message: 'x',
        },
        ASCII_DOC,
      ),
      { rule: 'M-STY-001', line: 1, col: 1, severity: 1 },
    );
  });

  it('converts the UTF-16 character to the BYTE column m lint speaks', () => {
    const doc = 'EN ;\n w "café" d work(.x(1))\n';
    const got = fromLspDiagnostic(
      {
        range: { start: { line: 1, character: 17 }, end: { line: 1, character: 22 } },
        severity: 1,
        code: 'M-MOD-037',
        message: 'x',
      },
      doc,
    );
    assert.deepEqual(got, { rule: 'M-MOD-037', line: 2, col: 19, severity: 1 });
  });

  // The wire value is carried through UNCHANGED — see LSP_SEVERITY_FOR: the
  // server's name->number mapping is many-to-one (style and info both publish
  // as 3), so a number can no longer be inverted to a name and the gate
  // compares numbers.
  const severities = [1, 2, 3, 4];
  for (const lsp of severities) {
    it(`carries LSP severity ${lsp} through unchanged`, () => {
      const got = fromLspDiagnostic(
        {
          range: { start: { line: 4, character: 6 }, end: { line: 4, character: 8 } },
          severity: lsp,
          code: 'M-MOD-009',
          message: 'm',
        },
        ASCII_DOC,
      );
      assert.equal(got.severity, lsp);
      assert.equal(got.line, 5);
      assert.equal(got.col, 7);
    });
  }

  it('treats a missing severity as a warning (the LSP default)', () => {
    const got = fromLspDiagnostic(
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        code: 'M-MOD-024',
        message: 'm',
      },
      ASCII_DOC,
    );
    assert.equal(got.severity, 2);
  });

  it('accepts a numeric rule code without inventing a rule table', () => {
    const got = fromLspDiagnostic(
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 4,
        code: 12,
        message: 'm',
      },
      ASCII_DOC,
    );
    assert.equal(got.rule, '12');
  });

  it('reports an absent code as the empty rule rather than throwing', () => {
    const got = fromLspDiagnostic(
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 4,
        message: 'm',
      },
      ASCII_DOC,
    );
    assert.equal(got.rule, '');
  });
});

describe('fromCliDiagnostic', () => {
  it('passes 1-based coordinates through unchanged', () => {
    assert.deepEqual(
      fromCliDiagnostic({
        file: '/x/ZZTEST.m',
        line: 2,
        col: 7,
        rule: 'M-MOD-009',
        severity: 'style',
        message: 'm',
      }),
      { rule: 'M-MOD-009', line: 2, col: 7, severity: 3 },
    );
  });

  it('rejects a severity vocabulary it does not know instead of guessing', () => {
    assert.throws(
      () =>
        fromCliDiagnostic({
          file: '/x/ZZTEST.m',
          line: 1,
          col: 1,
          rule: 'M-STY-001',
          severity: 'catastrophe',
          message: 'm',
        }),
      /unknown severity/i,
    );
  });
});

describe('sortDiagnostics', () => {
  it('orders by line, then column, then rule — stable across both producers', () => {
    const got = sortDiagnostics([
      { rule: 'M-STY-001', line: 2, col: 7, severity: 3 },
      { rule: 'M-MOD-009', line: 2, col: 7, severity: 3 },
      { rule: 'M-XINDX-062', line: 1, col: 1, severity: 3 },
      { rule: 'M-MOD-024', line: 2, col: 1, severity: 3 },
    ]);
    assert.deepEqual(
      got.map((d) => d.rule),
      ['M-XINDX-062', 'M-MOD-024', 'M-MOD-009', 'M-STY-001'],
    );
  });

  it('does not mutate its input', () => {
    const input = [
      { rule: 'B', line: 2, col: 1, severity: 3 },
      { rule: 'A', line: 1, col: 1, severity: 3 },
    ];
    sortDiagnostics(input);
    assert.equal(input[0]?.rule, 'B');
  });
});

describe('diffDiagnostics', () => {
  const a = { rule: 'M-STY-001', line: 2, col: 7, severity: 3 };
  const b = { rule: 'M-MOD-009', line: 2, col: 7, severity: 3 };

  it('reports no differences for identical sets', () => {
    assert.deepEqual(diffDiagnostics([a, b], [b, a]), []);
  });

  it('reports an empty pair as equivalent', () => {
    assert.deepEqual(diffDiagnostics([], []), []);
  });

  it('names a diagnostic only CI produced', () => {
    const d = diffDiagnostics([a, b], [a]);
    assert.equal(d.length, 1);
    assert.match(d[0] ?? '', /only from m lint.*2:7 M-MOD-009/);
  });

  it('names a diagnostic only the editor produced', () => {
    const d = diffDiagnostics([a], [a, b]);
    assert.equal(d.length, 1);
    assert.match(d[0] ?? '', /only from the LSP client.*M-MOD-009/);
  });

  it('catches an off-by-one that would otherwise look like a match', () => {
    const shifted = { ...a, line: 1 };
    const d = diffDiagnostics([a], [shifted]);
    assert.equal(d.length, 2);
  });

  it('catches a severity disagreement on an otherwise identical finding', () => {
    const d = diffDiagnostics([a], [{ ...a, severity: 1 }]);
    assert.equal(d.length, 2);
  });

  it('counts duplicates — the same rule twice on one line is two findings', () => {
    assert.deepEqual(diffDiagnostics([a, a], [a, a]), []);
    assert.equal(diffDiagnostics([a, a], [a]).length, 1);
  });
});
