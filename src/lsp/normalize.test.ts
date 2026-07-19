import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  diffDiagnostics,
  fromCliDiagnostic,
  fromLspDiagnostic,
  sortDiagnostics,
} from './normalize.ts';

describe('fromLspDiagnostic — the 0-based to 1-based seam', () => {
  it('converts an LSP position to the 1-based coordinates m lint reports', () => {
    assert.deepEqual(
      fromLspDiagnostic({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        severity: 1,
        code: 'M-STY-001',
        message: 'x',
      }),
      { rule: 'M-STY-001', line: 1, col: 1, severity: 'error' },
    );
  });

  const severities: { lsp: number; want: string }[] = [
    { lsp: 1, want: 'error' },
    { lsp: 2, want: 'warning' },
    { lsp: 3, want: 'info' },
    { lsp: 4, want: 'style' },
  ];
  for (const s of severities) {
    it(`maps LSP severity ${s.lsp} to ${s.want}`, () => {
      const got = fromLspDiagnostic({
        range: { start: { line: 4, character: 6 }, end: { line: 4, character: 8 } },
        severity: s.lsp,
        code: 'M-MOD-009',
        message: 'm',
      });
      assert.equal(got.severity, s.want);
      assert.equal(got.line, 5);
      assert.equal(got.col, 7);
    });
  }

  it('treats a missing severity as a warning (the LSP default)', () => {
    const got = fromLspDiagnostic({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      code: 'M-MOD-024',
      message: 'm',
    });
    assert.equal(got.severity, 'warning');
  });

  it('accepts a numeric rule code without inventing a rule table', () => {
    const got = fromLspDiagnostic({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 4,
      code: 12,
      message: 'm',
    });
    assert.equal(got.rule, '12');
  });

  it('reports an absent code as the empty rule rather than throwing', () => {
    const got = fromLspDiagnostic({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: 4,
      message: 'm',
    });
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
      { rule: 'M-MOD-009', line: 2, col: 7, severity: 'style' },
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
      { rule: 'M-STY-001', line: 2, col: 7, severity: 'style' },
      { rule: 'M-MOD-009', line: 2, col: 7, severity: 'style' },
      { rule: 'M-XINDX-062', line: 1, col: 1, severity: 'info' },
      { rule: 'M-MOD-024', line: 2, col: 1, severity: 'style' },
    ]);
    assert.deepEqual(
      got.map((d) => d.rule),
      ['M-XINDX-062', 'M-MOD-024', 'M-MOD-009', 'M-STY-001'],
    );
  });

  it('does not mutate its input', () => {
    const input = [
      { rule: 'B', line: 2, col: 1, severity: 'style' as const },
      { rule: 'A', line: 1, col: 1, severity: 'style' as const },
    ];
    sortDiagnostics(input);
    assert.equal(input[0]?.rule, 'B');
  });
});

describe('diffDiagnostics', () => {
  const a = { rule: 'M-STY-001', line: 2, col: 7, severity: 'style' as const };
  const b = { rule: 'M-MOD-009', line: 2, col: 7, severity: 'style' as const };

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
    const d = diffDiagnostics([a], [{ ...a, severity: 'error' }]);
    assert.equal(d.length, 2);
  });

  it('counts duplicates — the same rule twice on one line is two findings', () => {
    assert.deepEqual(diffDiagnostics([a, a], [a, a]), []);
    assert.equal(diffDiagnostics([a, a], [a]).length, 1);
  });
});
