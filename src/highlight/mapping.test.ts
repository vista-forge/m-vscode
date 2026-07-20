import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CAPTURE_MAP,
  LEGEND,
  mappingFor,
  STANDARD_TOKEN_MODIFIERS,
  STANDARD_TOKEN_TYPES,
} from './mapping.ts';
import { captureNamesInQuery } from './query.ts';

const queryNames = captureNamesInQuery(
  readFileSync(new URL('../../assets/highlights.scm', import.meta.url), 'utf8'),
);

/**
 * THE coverage gate. An unmapped capture does not error — it silently renders
 * as plain text, which is indistinguishable from "the theme chose not to colour
 * it". The list is derived from the shipped query file, so a capture added
 * upstream reds here on the next `make sync-wasm` instead of quietly losing
 * its colour.
 */
test('every capture name in highlights.scm is mapped to a token type', () => {
  const unmapped = queryNames.filter((n) => mappingFor(n) === undefined);
  assert.deepEqual(
    unmapped,
    [],
    `unmapped captures render as PLAIN TEXT with no error: ${unmapped.join(', ')}. ` +
      'Add them to CAPTURE_MAP in src/highlight/mapping.ts.',
  );
});

test('no CAPTURE_MAP entry is dead (every mapping is reachable from the query)', () => {
  const stale = Object.keys(CAPTURE_MAP).filter((n) => !queryNames.includes(n));
  assert.deepEqual(
    stale,
    [],
    `CAPTURE_MAP maps captures highlights.scm no longer produces: ${stale.join(', ')}`,
  );
});

/**
 * Every token type we emit must be one VS Code knows. A type outside the
 * standard legend is only coloured if the active theme happens to map it — i.e.
 * it fails the same silent way an unmapped capture does, but one layer down and
 * only for some users. Custom types would need `contributes.semanticTokenTypes`
 * plus a `semanticTokenScopes` fallback; we deliberately ship none.
 */
test('the legend uses only standard VS Code token types and modifiers', () => {
  for (const type of LEGEND.types) {
    assert.ok(
      STANDARD_TOKEN_TYPES.includes(type),
      `'${type}' is not a standard VS Code semantic token type — themes may not colour it`,
    );
  }
  for (const mod of LEGEND.modifiers) {
    assert.ok(STANDARD_TOKEN_MODIFIERS.includes(mod), `'${mod}' is not a standard modifier`);
  }
});

test('the legend is exactly the set the mapping uses — no more, no less', () => {
  const usedTypes = new Set(Object.values(CAPTURE_MAP).map((m) => m.type));
  const usedMods = new Set(Object.values(CAPTURE_MAP).flatMap((m) => m.modifiers));
  assert.deepEqual([...LEGEND.types].sort(), [...usedTypes].sort());
  assert.deepEqual([...LEGEND.modifiers].sort(), [...usedMods].sort());
});

test('mappingFor is undefined for an unknown capture', () => {
  assert.equal(mappingFor('no.such.capture'), undefined);
});

// Pin the handful of mappings whose choice is a judgement call, so a silent
// re-mapping shows up as a diff with a reason attached.
const pinned: Array<[string, string, string[]]> = [
  ['comment', 'comment', []],
  ['string', 'string', []],
  ['number', 'number', []],
  ['keyword', 'keyword', []],
  ['label', 'label', []],
  ['variable', 'variable', []],
  ['variable.parameter', 'parameter', []],
  ['function', 'function', []],
  ['function.builtin', 'function', ['defaultLibrary']],
  ['variable.builtin', 'variable', ['defaultLibrary']],
  ['operator', 'operator', []],
  ['keyword.operator', 'keyword', []],
  ['constant.builtin', 'regexp', []],
  ['punctuation.special', 'operator', []],
];

for (const [capture, type, modifiers] of pinned) {
  test(`mapping: @${capture} -> ${type}${modifiers.length ? ` +${modifiers}` : ''}`, () => {
    assert.deepEqual(mappingFor(capture), { type, modifiers });
  });
}

test('the pinned table covers the whole map', () => {
  assert.deepEqual(pinned.map(([c]) => c).sort(), Object.keys(CAPTURE_MAP).sort());
});
