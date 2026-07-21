import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  allPass,
  assembleCorpus,
  decodeSemanticTokens,
  percentile,
  renderTable,
} from './acceptance-model.ts';

test('decodeSemanticTokens rebuilds absolute positions from the 5-uint delta encoding', () => {
  // Two tokens on line 0 (cols 0 and 4), one on line 2 (col 1).
  const data = [0, 0, 3, 1, 0, 0, 4, 2, 5, 1, 2, 1, 7, 0, 0];
  assert.deepEqual(decodeSemanticTokens(data), [
    { line: 0, startColumn: 0, length: 3, typeIndex: 1, modifierSet: 0 },
    { line: 0, startColumn: 4, length: 2, typeIndex: 5, modifierSet: 1 },
    { line: 2, startColumn: 1, length: 7, typeIndex: 0, modifierSet: 0 },
  ]);
});

test('decodeSemanticTokens rejects a stream that is not 5-aligned', () => {
  assert.throws(() => decodeSemanticTokens([0, 0, 3]), /multiple of 5/);
});

test('percentile interpolates on the sorted sample (p95 of a known series)', () => {
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5.5);
  // p95 over 10 points: rank 8.55 -> between 9 and 10.
  const p95 = percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95);
  assert.ok(p95 > 9 && p95 <= 10, `p95 was ${p95}`);
  assert.throws(() => percentile([], 95), /empty/);
});

test('assembleCorpus concatenates whole source texts to at least the target size', () => {
  const texts = ['A ;one\n set x=1\n quit\n', 'B ;two\n set y=2\n quit\n'];
  const out = assembleCorpus(texts, 100);
  assert.ok(Buffer.byteLength(out, 'utf8') >= 100, 'reaches the target size (cycling sources)');
  assert.ok(out.startsWith('A ;one'), 'keeps source order');
  assert.ok(!out.includes('\n\n'), 'no blank line is introduced at the joins');
  assert.ok(out.endsWith('\n'), 'ends with a newline');
});

test('assembleCorpus refuses when there is nothing to assemble from', () => {
  assert.throws(() => assembleCorpus([], 1000), /no sources/);
  assert.throws(() => assembleCorpus(['', ''], 1000), /no sources/);
});

test('allPass and renderTable report per-criterion rows honestly', () => {
  const rows = [
    {
      scenario: 'A1',
      criterion: 'highlighting',
      pass: true,
      measured: '1234 tokens',
      budget: 'non-empty + oracle match',
    },
    {
      scenario: 'A3',
      criterion: 'idle hover',
      pass: false,
      measured: '712 ms',
      budget: '<= 500 ms',
    },
  ];
  assert.equal(allPass(rows), false);
  const table = renderTable(rows);
  assert.match(table, /A1/);
  assert.match(table, /FAIL/);
  assert.match(table, /712 ms/);
  assert.equal(allPass([rows[0] as (typeof rows)[0]]), true);
});
