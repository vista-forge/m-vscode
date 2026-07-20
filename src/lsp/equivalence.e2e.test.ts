/**
 * THE ACCEPTANCE GATE for the LSP client.
 *
 * The extension's core promise is that **the editor shows exactly the
 * diagnostics CI produces, and formats exactly the way CI formats**. That is
 * only true while `m lsp` and the `m` CLI agree, so this file proves it against
 * the real toolchain rather than asserting it in prose. It runs `m lint -o json`
 * and a headless `m lsp` session over the same files with the same project
 * config, normalises both, and requires identical multisets — and it does the
 * same for the WRITE side, comparing `m fmt`'s output against the edit
 * `textDocument/formatting` returns.
 *
 * It is a GATE, not a manual check — it runs in `npm run test` and therefore in
 * `make check`. If `m` is missing the test FAILS rather than skipping: a
 * skipped equivalence proof is not a passed one.
 *
 * ## What this gate proves, and what it used to only appear to prove
 *
 * 1. **Coordinates — in the right CURRENCY.** LSP is 0-based and counts UTF-16
 *    code units; `m lint` is 1-based and counts BYTES. The gate used to bridge
 *    those with `character + 1`, which is correct only on ASCII — and every
 *    fixture was ASCII. So when the server published byte columns where LSP
 *    mandates UTF-16 (defect T1-2), the corruption diffed to **exactly zero**
 *    and the gate stayed green over a real, live bug. The conversion now goes
 *    through the DOCUMENT TEXT (`normalize.ts`), and the `utf16` fixture below
 *    is deliberately non-ASCII with an assertion that it STAYS non-ASCII, so
 *    the gate can fail on the thing it exists to catch.
 * 2. **Config discovery.** Both sides now resolve `.m-cli.toml` per FILE
 *    (m-cli T1-1), so a fixture project's config governs its routines whatever
 *    directory anyone runs from. The former "documents the config-discovery
 *    seam" characterisation test asserted the opposite and was deleted when
 *    that landed; `resolves the fixture config from ANY cwd` replaces it.
 * 3. **Formatting.** Previously untested beyond "an edit came back" (defect
 *    T1-4). Now compared byte-for-byte against `m fmt`.
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type CliDiagnosticLike,
  diffDiagnostics,
  fromCliDiagnostic,
  fromLspDiagnostic,
  lineOf,
  type NormalDiagnostic,
  sortDiagnostics,
  utf16FromByteColumn,
} from './normalize.ts';
import { LspSession } from './session.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'equivalence');
const fixtureFile = join(fixtureDir, 'ZZEQUIV.m');
const utf16Dir = join(here, 'fixtures', 'utf16');
const utf16File = join(utf16Dir, 'ZZUNI.m');
const formatDir = join(here, 'fixtures', 'format');
const formatFile = join(formatDir, 'ZZFMT.m');
const SERVER = process.env.M_VSCODE_SERVER_PATH ?? 'm';

interface LintReport {
  data: { filesScanned: number; findings: number };
  diagnostics?: CliDiagnosticLike[];
}

/** Run `m` and return stdout, tolerating the non-zero exit a gate verdict causes. */
function runM(args: string[], cwd: string, input?: string): string {
  try {
    return execFileSync(SERVER, args, {
      encoding: 'utf8',
      cwd,
      ...(input === undefined ? {} : { input }),
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; code?: string };
    if (e.code === 'ENOENT') {
      throw new Error(
        `the equivalence gate requires the \`${SERVER}\` toolchain on PATH (m-cli). ` +
          'Install it or set M_VSCODE_SERVER_PATH. A skipped equivalence proof is not a passed one.',
      );
    }
    // `m lint` exits non-zero when a severity gate trips; the report is still on stdout.
    if (typeof e.stdout !== 'string') throw err;
    return e.stdout;
  }
}

/** The findings `m lint` reports for one file of a fixture project. */
function lintViaCli(cwd: string, basename: string): NormalDiagnostic[] {
  const report = JSON.parse(runM(['lint', '-o', 'json', '.'], cwd)) as LintReport;
  const forFixture = (report.diagnostics ?? []).filter((d) => d.file.endsWith(basename));
  return sortDiagnostics(forFixture.map(fromCliDiagnostic));
}

/**
 * One fixture project's two views of the same file, ready to compare. `text` is
 * the document as both sides saw it — the oracle for every column conversion.
 */
interface Pair {
  viaCli: NormalDiagnostic[];
  viaLsp: NormalDiagnostic[];
  rawLsp: { range: { start: { line: number; character: number } }; code?: string | number }[];
  text: string;
  session: LspSession;
}

async function openPair(dir: string, file: string, basename: string): Promise<Pair> {
  const text = readFileSync(file, 'utf8');
  const viaCli = lintViaCli(dir, basename);
  const session = new LspSession(SERVER, ['lsp']);
  await session.start(dir);
  const rawLsp = await session.openAndAwaitDiagnostics(file, text);
  return {
    viaCli,
    viaLsp: sortDiagnostics(rawLsp.map((d) => fromLspDiagnostic(d, text))),
    rawLsp,
    text,
    session,
  };
}

describe('LSP client / m lint equivalence (e2e, real toolchain)', () => {
  let p: Pair;

  before(async () => {
    p = await openPair(fixtureDir, fixtureFile, 'ZZEQUIV.m');
  });

  after(async () => {
    await p?.session?.stop();
  });

  it('the fixture actually produces findings (a green gate over zero findings proves nothing)', () => {
    assert.ok(p.viaCli.length >= 10, `expected a rich fixture, got ${p.viaCli.length} findings`);
  });

  it('exercises more than one severity (so a severity bug cannot hide)', () => {
    assert.ok(new Set(p.viaCli.map((d) => d.severity)).size >= 2);
  });

  it('exercises more than one line and column (so an off-by-one cannot hide)', () => {
    assert.ok(new Set(p.viaCli.map((d) => d.line)).size >= 2);
    assert.ok(new Set(p.viaCli.map((d) => d.col)).size >= 2);
    assert.ok(
      p.viaCli.some((d) => d.line > 1 && d.col > 1),
      'need a finding off both the first line and the first column',
    );
  });

  it('reports the same NUMBER of findings through both paths', () => {
    assert.equal(p.viaLsp.length, p.viaCli.length);
  });

  it('reports the identical rule ids, lines, columns and severities', () => {
    assert.deepEqual(diffDiagnostics(p.viaCli, p.viaLsp), []);
  });

  it('is identical once serialised — the strongest form of the promise', () => {
    assert.equal(JSON.stringify(p.viaLsp), JSON.stringify(p.viaCli));
  });

  it('advertises the full P3-feat capability set (Session A landed, m-cli ed9a4ec)', () => {
    const caps = p.session.capabilities as Record<string, unknown>;
    assert.equal(caps.textDocumentSync, 1, 'full document sync');
    assert.equal(caps.documentFormattingProvider, true);
    assert.equal(caps.hoverProvider, true);
    assert.deepEqual(
      caps.completionProvider,
      { resolveProvider: false },
      'no resolve step — completion items arrive fully populated',
    );
    assert.equal(caps.documentSymbolProvider, true);
    assert.equal(caps.foldingRangeProvider, true);
  });

  /**
   * The server must SAY what its positions count. An unadvertised encoding is
   * unverifiable by a client, and this gate's whole column comparison is only
   * meaningful against a declared unit.
   */
  it('advertises the position encoding its coordinates use', () => {
    const caps = p.session.capabilities as Record<string, unknown>;
    assert.equal(
      caps.positionEncoding,
      'utf-16',
      'the session offers no positionEncodings, so the LSP default must be advertised',
    );
  });

  /**
   * Replaces the deleted "documents the config-discovery seam" test. m-cli now
   * resolves config per FILE, so the fixture's `.m-cli.toml` governs its
   * routine no matter where the process was started — which is the property
   * that makes editor/CI parity a fact rather than a coincidence of cwd.
   */
  it('resolves the fixture config from ANY cwd — parity does not depend on where you stand', () => {
    const fromRepoRoot = JSON.parse(
      runM(['lint', '-o', 'json', fixtureDir], join(here, '..', '..')),
    ) as LintReport;
    assert.equal(
      fromRepoRoot.data.findings,
      p.viaCli.length,
      'linting the fixture from the repo root must resolve the same config, and so the same findings',
    );
  });
});

/**
 * The ENCODING half of the gate (T1-2 / T1-3).
 *
 * Everything here is about a fixture whose findings sit AFTER multi-byte
 * characters, where a byte column and a UTF-16 column are different numbers.
 */
describe('LSP position encoding (e2e, non-ASCII fixture)', () => {
  let p: Pair;

  before(async () => {
    p = await openPair(utf16Dir, utf16File, 'ZZUNI.m');
  });

  after(async () => {
    await p?.session?.stop();
  });

  /**
   * The fixture guard. Without this, someone "simplifying" ZZUNI.m to ASCII
   * would silently restore the blind spot: the gate would keep passing and stop
   * proving anything. It asserts the fixture still contains positions where the
   * two currencies DISAGREE — the only positions that can catch the bug.
   */
  it('the fixture exercises positions where the byte and UTF-16 columns DIFFER', () => {
    const divergent = p.viaCli.filter((d) => {
      const line = lineOf(p.text, d.line);
      return utf16FromByteColumn(line, d.col) !== d.col - 1;
    });
    assert.ok(
      divergent.length >= 3,
      `the fixture must keep multi-byte characters before its findings; only ${divergent.length} ` +
        'position(s) distinguish a byte column from a UTF-16 column. If ZZUNI.m was made ASCII, ' +
        'this gate can no longer fail on defect T1-2 — restore the non-ASCII text.',
    );
  });

  it('covers 2-byte, 3-byte and 4-byte (surrogate-pair) characters', () => {
    assert.match(p.text, /é/u, 'two-byte');
    assert.match(p.text, /日/u, 'three-byte');
    assert.match(p.text, /\u{1F6A8}/u, 'four-byte / surrogate pair');
  });

  /**
   * THE assertion this tier exists for. For every finding `m lint` reported,
   * compute — from the document text — the UTF-16 character offset LSP requires,
   * and require the server to have published exactly that. Publishing the byte
   * column instead (the pre-fix behaviour) fails here by construction.
   */
  it('publishes UTF-16 code-unit characters, not byte columns', () => {
    const want = p.viaCli.map((d) => ({
      rule: d.rule,
      line: d.line - 1,
      character: utf16FromByteColumn(lineOf(p.text, d.line), d.col),
    }));
    const got = p.rawLsp.map((d) => ({
      rule: d.code === undefined ? '' : String(d.code),
      line: d.range.start.line,
      character: d.range.start.character,
    }));
    const key = (x: { rule: string; line: number; character: number }) =>
      `${x.line}:${x.character} ${x.rule}`;
    assert.deepEqual(
      got.map(key).sort(),
      want.map(key).sort(),
      'every LSP character must equal the UTF-16 offset computed from the document text',
    );
  });

  it('still agrees with m lint once converted back to byte columns', () => {
    assert.deepEqual(diffDiagnostics(p.viaCli, p.viaLsp), []);
  });
});

/**
 * The WRITE side (T1-4). Until now the only formatting assertion was that an
 * edit came back at all — the exact drift class the diagnostics gate prevents
 * was unguarded where it does the most damage, because format-on-save REWRITES
 * the user's file.
 */
describe('LSP formatting / m fmt equivalence (e2e, real toolchain)', () => {
  let session: LspSession;

  before(async () => {
    session = new LspSession(SERVER, ['lsp']);
    await session.start(formatDir);
  });

  after(async () => {
    await session?.stop();
  });

  it('formats a routine to exactly what `m fmt` produces', async () => {
    const source = readFileSync(formatFile, 'utf8');
    await session.openAndAwaitDiagnostics(formatFile, source);
    const edits = await session.formatting(formatFile);
    assert.equal(edits.length, 1, 'a non-canonical routine must produce one whole-document edit');

    // `m fmt --stdin` resolves the SAME project config from the fixture dir, so
    // this is the CI answer for this file, byte for byte.
    const viaCli = runM(['fmt', '--stdin'], formatDir, source);
    // The edit spans the whole document, so applying it IS its newText.
    const viaLsp = (edits[0] as { newText: string }).newText;
    assert.equal(
      viaLsp,
      viaCli,
      'format-on-save must write exactly what `m fmt` writes — anything else is CI/editor drift ' +
        "in the one place it silently rewrites the user's source",
    );
    assert.notEqual(viaCli, source, 'the fixture must actually need formatting');
  });

  it('replaces the WHOLE document — the edit range must cover it', async () => {
    const source = readFileSync(formatFile, 'utf8');
    const edits = await session.formatting(formatFile);
    const range = (edits[0] as { range: { start: unknown; end: { line: number } } }).range;
    assert.deepEqual(range.start, { line: 0, character: 0 });
    assert.equal(
      range.end.line,
      source.split('\n').length - 1,
      "the edit must end on the document's last line",
    );
  });

  it('returns no edits for an already-canonical routine (no spurious save churn)', async () => {
    const canonical = runM(['fmt', '--stdin'], formatDir, readFileSync(formatFile, 'utf8'));
    await session.openAndAwaitDiagnostics(formatFile, canonical);
    const edits = await session.formatting(formatFile);
    assert.deepEqual(edits, [], 'formatting already-formatted text must be a no-op');
  });
});
