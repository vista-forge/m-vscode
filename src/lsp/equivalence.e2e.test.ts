/**
 * THE ACCEPTANCE GATE for the LSP client (P2).
 *
 * The extension's core promise is that **the editor shows exactly the
 * diagnostics CI produces**. That is only true while `m lsp` and `m lint`
 * agree, so this test proves it against the real toolchain rather than
 * asserting it in prose: it runs `m lint -o json` over a fixture project and a
 * headless `m lsp` session over the same file with the same project config,
 * normalises both, and requires an identical multiset of
 * (rule, line, column, severity) — then an identical serialisation.
 *
 * It is a GATE, not a manual check — it runs in `npm run test` and therefore in
 * `make check`. If `m` is missing the test FAILS rather than skipping: a
 * skipped equivalence proof is not a passed one.
 *
 * ## The two alignment conditions this gate pins
 *
 * 1. **Coordinates.** LSP is 0-based, `m lint` is 1-based. `normalize.ts` owns
 *    the +1 and this gate is what proves the sign is right — an off-by-one
 *    shows up as every finding appearing in both "only from" lists.
 * 2. **Config discovery.** `m lint` resolves `.m-cli.toml` by walking up from
 *    its **CWD**; `m lsp` resolves it per **document directory**. They agree
 *    when the CLI runs at the project root — which is the editor case, and the
 *    condition this gate runs under (`cwd: fixtureDir`). The `documents the
 *    config-discovery seam` test below pins the divergence outside that
 *    condition so it cannot change unnoticed; closing it is a P3 ask on m-cli.
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
  type NormalDiagnostic,
  sortDiagnostics,
} from './normalize.ts';
import { LspSession } from './session.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'equivalence');
const fixtureFile = join(fixtureDir, 'ZZEQUIV.m');
const formatFile = join(here, 'fixtures', 'format', 'ZZFMT.m');
const SERVER = process.env.M_VSCODE_SERVER_PATH ?? 'm';

interface LintReport {
  data: { filesScanned: number; findings: number };
  diagnostics?: CliDiagnosticLike[];
}

/**
 * Run `m lint -o json` the way an editor session's project is laid out: from
 * the project root, so config discovery lands on the same `.m-cli.toml` the
 * server resolves for the document.
 */
function lintViaCli(cwd: string): NormalDiagnostic[] {
  let raw: string;
  try {
    raw = execFileSync(SERVER, ['lint', '-o', 'json', '.'], { encoding: 'utf8', cwd });
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
    raw = e.stdout;
  }
  const report = JSON.parse(raw) as LintReport;
  const forFixture = (report.diagnostics ?? []).filter((d) => d.file.endsWith('ZZEQUIV.m'));
  return sortDiagnostics(forFixture.map(fromCliDiagnostic));
}

describe('LSP client / m lint equivalence (e2e, real toolchain)', () => {
  let session: LspSession;
  let viaLsp: NormalDiagnostic[];
  let viaCli: NormalDiagnostic[];

  before(async () => {
    viaCli = lintViaCli(fixtureDir);
    session = new LspSession(SERVER, ['lsp']);
    await session.start(fixtureDir);
    const diags = await session.openAndAwaitDiagnostics(
      fixtureFile,
      readFileSync(fixtureFile, 'utf8'),
    );
    viaLsp = sortDiagnostics(diags.map(fromLspDiagnostic));
  });

  after(async () => {
    await session?.stop();
  });

  it('the fixture actually produces findings (a green gate over zero findings proves nothing)', () => {
    assert.ok(viaCli.length >= 10, `expected a rich fixture, got ${viaCli.length} findings`);
  });

  it('exercises more than one severity (so a severity bug cannot hide)', () => {
    assert.ok(new Set(viaCli.map((d) => d.severity)).size >= 2);
  });

  it('exercises more than one line and column (so an off-by-one cannot hide)', () => {
    assert.ok(new Set(viaCli.map((d) => d.line)).size >= 2);
    assert.ok(new Set(viaCli.map((d) => d.col)).size >= 2);
    assert.ok(
      viaCli.some((d) => d.line > 1 && d.col > 1),
      'need a finding off both the first line and the first column',
    );
  });

  it('reports the same NUMBER of findings through both paths', () => {
    assert.equal(viaLsp.length, viaCli.length);
  });

  it('reports the identical rule ids, lines, columns and severities', () => {
    assert.deepEqual(diffDiagnostics(viaCli, viaLsp), []);
  });

  it('is identical once serialised — the strongest form of the promise', () => {
    assert.equal(JSON.stringify(viaLsp), JSON.stringify(viaCli));
  });

  it('advertises only the capabilities P2 relies on (hover/completion are P3)', () => {
    const caps = session.capabilities as Record<string, unknown>;
    assert.equal(caps.textDocumentSync, 1, 'full document sync');
    assert.equal(caps.documentFormattingProvider, true);
    assert.equal(caps.hoverProvider, undefined);
    assert.equal(caps.completionProvider, undefined);
  });

  it('returns a whole-document edit for formatting a non-canonical routine', async () => {
    const source = readFileSync(formatFile, 'utf8');
    await session.openAndAwaitDiagnostics(formatFile, source);
    const edits = await session.formatting(formatFile);
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0]?.range.start, { line: 0, character: 0 });
    assert.notEqual(edits[0]?.newText, source);
  });

  it('returns no edits for an already-canonical routine (no spurious save churn)', async () => {
    const edits = await session.formatting(fixtureFile);
    assert.deepEqual(edits, []);
  });

  /**
   * Characterisation, not aspiration: `m lint` discovers `.m-cli.toml` from its
   * CWD, so running it from the repo root over the same fixture resolves a
   * DIFFERENT rule set than the server does for that document. The editor case
   * (CWD = project root) is unaffected, which is why the gate above holds. If
   * m-cli moves to per-file discovery (the P3 ask) this test goes red and
   * should simply be deleted — that is the reminder it exists to give.
   */
  it('documents the config-discovery seam between `m lint` (CWD) and `m lsp` (document dir)', () => {
    const fromRepoRoot = execFileSync(SERVER, ['lint', '-o', 'json', fixtureDir], {
      encoding: 'utf8',
      cwd: join(here, '..', '..'),
    });
    const report = JSON.parse(fromRepoRoot) as LintReport;
    assert.equal(
      report.data.findings,
      0,
      'the fixture .m-cli.toml is NOT picked up from a parent CWD — if this changed, m-cli now ' +
        'resolves config per file and this characterisation test should be deleted',
    );
    assert.ok(viaLsp.length > 0, 'the server, resolving per document dir, does pick it up');
  });
});
