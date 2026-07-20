import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MHighlighter } from './highlighter.ts';
import { mappingFor } from './mapping.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

let hl: MHighlighter;
before(async () => {
  hl = await MHighlighter.create(repoRoot);
});
after(() => hl?.dispose());

test('a real corpus routine parses clean and yields tokens', () => {
  const src = read('ZZDAEMON.m');
  const session = hl.open(src);
  try {
    assert.equal(session.rootType, 'source_file');
    assert.equal(session.hasError, false, 'ZZDAEMON.m is a clean-parsing corpus routine');
    const tokens = session.tokens();
    assert.ok(tokens.length > 200, `expected a dense token stream, got ${tokens.length}`);
  } finally {
    session.dispose();
  }
});

/**
 * The EMPIRICAL half of the capture-mapping gate. mapping.test.ts asserts every
 * name the query FILE declares is mapped; this asserts every name the query
 * actually PRODUCES on real M is mapped. Either alone can pass while colour is
 * silently missing — a name only reachable at runtime, or a mapping for a
 * pattern that no longer matches.
 */
test('every capture produced on real M source is mapped', () => {
  const session = hl.open(read('ZZDAEMON.m'));
  try {
    const produced = session.captureNames();
    assert.ok(produced.length >= 12, `only ${produced.length} capture names produced`);
    const unmapped = produced.filter((n) => mappingFor(n) === undefined);
    assert.deepEqual(unmapped, [], `produced but unmapped (renders as plain text): ${unmapped}`);
  } finally {
    session.dispose();
  }
});

/**
 * COLUMN-UNIT ORACLE. VS Code semantic tokens are addressed in UTF-16 code
 * units; tree-sitter's C core counts bytes. web-tree-sitter converts, but that
 * is a fact about a dependency, not a guarantee — and on an ASCII-only fixture
 * the two numbers are identical, so a regression would be invisible. Expected
 * columns are derived from the DOCUMENT TEXT (JS strings are UTF-16), never
 * from the parser, which is what makes this an oracle rather than an echo.
 */
test('capture columns are UTF-16 code units, not bytes', () => {
  const src = read('ZZUNICODE.m');
  const lines = src.split('\n');
  const session = hl.open(src);
  try {
    const captures = session.captures();
    for (const [name, lineNo] of [
      ['alpha', 5],
      ['beta', 6],
      ['gamma', 7],
      ['delta', 8],
    ] as Array<[string, number]>) {
      const line = lines[lineNo] as string;
      const wantUtf16 = line.indexOf(name);
      const wantBytes = Buffer.byteLength(line.slice(0, wantUtf16), 'utf8');
      assert.notEqual(
        wantUtf16,
        wantBytes,
        `${name} is not past any multi-byte char — bad fixture`,
      );
      const hit = captures.find((c) => c.startRow === lineNo && c.startColumn === wantUtf16);
      assert.ok(
        hit,
        `no capture at UTF-16 column ${wantUtf16} on line ${lineNo} (bytes would be ${wantBytes}); ` +
          `got columns ${captures.filter((c) => c.startRow === lineNo).map((c) => c.startColumn)}`,
      );
      assert.equal(hit.name, 'variable');
    }
  } finally {
    session.dispose();
  }
});

test('the unicode fixture stays non-ASCII (guard)', () => {
  const src = read('ZZUNICODE.m');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is the ASCII range
  assert.ok(/[^\x00-\x7F]/.test(src), 'ZZUNICODE.m was flattened to ASCII — the oracle is blind');
  assert.ok(/\p{Extended_Pictographic}/u.test(src), 'lost the 4-byte (surrogate-pair) case');
});

test('an incremental session ends up byte-for-byte where a fresh parse does', () => {
  const src = read('ZZDAEMON.m');
  const session = hl.open('');
  try {
    // Type it in line by line, then compare against a cold parse of the result.
    let typed = '';
    for (const line of src.split('\n')) {
      const chunk = `${line}\n`;
      session.replace(typed.length, typed.length, chunk);
      typed += chunk;
    }
    const fresh = hl.open(typed);
    try {
      assert.deepEqual(session.tokens(), fresh.tokens());
    } finally {
      fresh.dispose();
    }
  } finally {
    session.dispose();
  }
});

test('tokens never exceed their line length', () => {
  const src = read('ZZDAEMON.m');
  const lines = src.split('\n');
  const session = hl.open(src);
  try {
    for (const t of session.tokens()) {
      const line = lines[t.line];
      assert.ok(line !== undefined, `token on line ${t.line}, document has ${lines.length}`);
      assert.ok(
        t.startColumn + t.length <= line.length,
        `token overruns line ${t.line}: ${t.startColumn}+${t.length} > ${line.length}`,
      );
    }
  } finally {
    session.dispose();
  }
});
