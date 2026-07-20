import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { captureNamesInQuery } from './query.ts';

// The capture-mapping coverage gate is only as good as this extractor: if it
// under-reports, every "is it mapped?" assertion passes vacuously. So the
// extractor gets its own table, including the two shapes the real
// highlights.scm actually contains that a naive /@\w+/ scan gets wrong.
const cases: Array<{ name: string; scm: string; want: string[] }> = [
  { name: 'empty', scm: '', want: [] },
  { name: 'single capture', scm: '(comment) @comment', want: ['comment'] },
  { name: 'dotted names', scm: '(x) @function.builtin', want: ['function.builtin'] },
  {
    name: 'deduplicates repeats',
    scm: '(a) @variable\n(b) @variable\n(c) @variable',
    want: ['variable'],
  },
  {
    // The real file contains: `; \`@expr\` — the \`@\` is itself the marker.`
    name: 'ignores @names inside line comments',
    scm: '; the `@expr` marker is documented here\n(operator) @operator',
    want: ['operator'],
  },
  {
    // The real file contains: `"@" @operator`
    name: 'ignores @ inside string literals',
    scm: '"@" @operator',
    want: ['operator'],
  },
  {
    name: 'ignores a semicolon inside a string literal',
    scm: '";" @comment\n(x) @keyword',
    want: ['comment', 'keyword'],
  },
  {
    name: 'multiple captures on one pattern',
    scm: '(pair key: (_) @property value: (_) @string)',
    want: ['property', 'string'],
  },
  { name: 'underscores and digits', scm: '(x) @tag_1', want: ['tag_1'] },
];

for (const c of cases) {
  test(`captureNamesInQuery: ${c.name}`, () => {
    assert.deepEqual(captureNamesInQuery(c.scm).sort(), c.want.sort());
  });
}

test('captureNamesInQuery: the real highlights.scm yields a non-trivial set', () => {
  const scm = readFileSync(new URL('../../assets/highlights.scm', import.meta.url), 'utf8');
  const names = captureNamesInQuery(scm);
  // Guard against the vacuous-pass mode: an extractor returning [] would make
  // every coverage assertion in mapping.test.ts trivially green.
  assert.ok(names.length >= 10, `expected >= 10 capture names, got ${names.length}`);
  assert.ok(names.includes('comment'));
  assert.ok(names.includes('function.builtin'));
  // Proof the comment/string filtering fired on the REAL file, not just fakes:
  // `@expr` appears only inside a `;` comment, and `"@"` only as a literal.
  assert.ok(!names.includes('expr'), 'picked up @expr from a comment');
  assert.deepEqual(new Set(names).size, names.length, 'names not deduplicated');
});
