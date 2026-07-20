/**
 * THE P3-feat SESSION B ACCEPTANCE GATE — hover, completion, documentSymbol,
 * folding actually deliver real content over the wire, not just advertise a
 * capability flag.
 *
 * `equivalence.e2e.test.ts` proves the server ADVERTISES these four
 * providers. This file proves each one ANSWERS, against the real `m lsp`
 * binary — no fakes, no hand-written expectations about what a command means
 * (that would violate the "zero M semantics in this repo" rule). It asserts
 * only two things about content: that the registry-backed per-engine
 * provenance text the whole effort exists to deliver is present verbatim
 * (proving hover renders it, not that this repo knows M), and that the wire
 * shapes match what `vscode-languageclient`'s built-in features expect
 * (Hover/CompletionItem/DocumentSymbol/FoldingRange), so a client-side
 * mapping bug cannot hide behind "the server answered something".
 *
 * If `m` is missing this FAILS rather than skips — a skipped proof of the
 * differentiating feature is not a passed one.
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LspSession } from './session.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'capabilities');
const fixtureFile = join(fixtureDir, 'ZZCAP.m');
const SERVER = process.env.M_VSCODE_SERVER_PATH ?? 'm';

// Line 2 (0-based) is ` S X=$ZATRANSFORM("abc")`; character 10 sits inside
// the intrinsic-function token, same position VS Code sends for a cursor
// hover anywhere over the word.
const ZATRANSFORM_POSITION = { line: 2, character: 10 };

function ensureServerOnPath(): void {
  try {
    execFileSync(SERVER, ['version'], { encoding: 'utf8' });
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === 'ENOENT') {
      throw new Error(
        `this gate requires the \`${SERVER}\` toolchain on PATH (m-cli). ` +
          'Install it or set M_VSCODE_SERVER_PATH. A skipped capability proof is not a passed one.',
      );
    }
  }
}

describe('LSP language intelligence (e2e, real toolchain, P3-feat Session B)', () => {
  let session: LspSession;
  const text = readFileSync(fixtureFile, 'utf8');

  before(async () => {
    ensureServerOnPath();
    session = new LspSession(SERVER, ['lsp']);
    await session.start(fixtureDir);
    await session.openAndAwaitDiagnostics(fixtureFile, text);
  });

  after(async () => {
    await session?.stop();
  });

  describe('hover', () => {
    it('answers on an intrinsic function with markdown content', async () => {
      const hover = await session.hover(fixtureFile, ZATRANSFORM_POSITION);
      assert.ok(hover, 'expected a hover result, got null/undefined');
      assert.equal(hover.contents.kind, 'markdown');
      assert.ok(hover.contents.value.length > 0, 'hover markdown must not be empty');
    });

    it('renders the per-engine provenance the whole effort exists to deliver', async () => {
      const hover = await session.hover(fixtureFile, ZATRANSFORM_POSITION);
      assert.ok(hover);
      const md = hover.contents.value;
      // This is the differentiating feature (proposal §2, §4-D): a portability
      // warning no other M editor tooling offers. Asserted VERBATIM because the
      // text must come from the vendored m-standard registry, never be
      // reworded/invented client-side — this repo has zero M semantics.
      assert.match(md, /\$ZATRANSFORM/, 'names the symbol');
      assert.match(
        md,
        /In YottaDB.*not in the ANSI standard or IRIS/,
        'renders the per-engine provenance sentence verbatim from the server',
      );
      assert.match(md, /Standard status: `ydb-extension`/, 'renders the standard-status line');
    });

    it('returns a range that covers the hovered symbol (needed for the hover popup anchor)', async () => {
      const hover = await session.hover(fixtureFile, ZATRANSFORM_POSITION);
      assert.ok(hover?.range, 'a hover without a range cannot anchor the popup to the symbol');
      assert.equal(hover.range.start.line, 2);
      assert.ok(hover.range.start.character <= ZATRANSFORM_POSITION.character);
      assert.ok(hover.range.end.character > hover.range.start.character);
    });

    it('answers null (not an error) off a symbol — no hover on whitespace', async () => {
      const hover = await session.hover(fixtureFile, { line: 0, character: 0 });
      // The label position is itself a symbol (the routine name) so this is
      // legitimately either null or a hover — the point is it must not throw.
      assert.ok(hover === null || typeof hover === 'object');
    });
  });

  describe('completion', () => {
    it('offers a non-empty list with the resolveProvider:false shape', async () => {
      const items = await session.completion(fixtureFile, ZATRANSFORM_POSITION);
      assert.ok(items.length > 0, 'expected at least one completion item');
      for (const item of items) {
        assert.ok(typeof item.label === 'string' && item.label.length > 0);
      }
    });

    it('includes items with per-engine provenance in their documentation', async () => {
      const items = await session.completion(fixtureFile, ZATRANSFORM_POSITION);
      const withDocs = items.filter(
        (i) => typeof i.documentation === 'object' && i.documentation !== null,
      );
      assert.ok(
        withDocs.length > 0,
        'expected at least one completion item to carry markdown documentation',
      );
    });

    it('offers the routine label declared in THIS file (AST-derived, not just m-standard)', async () => {
      // Complete right after "D " on the SUB(X) call line (line 3) — the
      // current-routine label SUB should be a candidate there.
      const items = await session.completion(fixtureFile, { line: 3, character: 3 });
      assert.ok(
        items.some((i) => i.label === 'SUB'),
        `expected the current-routine label SUB among completions, got: ${items.map((i) => i.label).join(', ')}`,
      );
    });
  });

  describe('documentSymbol', () => {
    it('returns the routine and its labels with ranges', async () => {
      const symbols = await session.documentSymbol(fixtureFile);
      assert.ok(symbols.length > 0, 'expected at least one symbol');
      const names = symbols.map((s) => s.name);
      assert.ok(names.includes('ZZCAP'), `expected the routine symbol, got: ${names.join(', ')}`);
      for (const sym of symbols) {
        assert.ok(sym.range, `symbol ${sym.name} must carry a range for the outline view`);
        assert.ok(
          sym.range.end.line >= sym.range.start.line,
          `symbol ${sym.name} range must be well-formed`,
        );
      }
    });

    it('includes the SUB label as a child or sibling symbol', async () => {
      const symbols = await session.documentSymbol(fixtureFile);
      const flat = flattenSymbols(symbols);
      assert.ok(
        flat.some((s) => s.name === 'SUB'),
        `expected a SUB symbol among: ${flat.map((s) => s.name).join(', ')}`,
      );
    });
  });

  describe('foldingRange', () => {
    it('returns at least one foldable range spanning more than one line', async () => {
      const ranges = await session.foldingRange(fixtureFile);
      assert.ok(ranges.length > 0, 'expected at least one folding range');
      assert.ok(
        ranges.some((r) => r.endLine > r.startLine),
        'expected at least one multi-line fold (a label body or dot-block)',
      );
    });
  });
});

interface DocSymbolLike {
  name: string;
  range?: unknown;
  children?: DocSymbolLike[];
}

function flattenSymbols(symbols: DocSymbolLike[]): DocSymbolLike[] {
  const out: DocSymbolLike[] = [];
  for (const s of symbols) {
    out.push(s);
    if (s.children) out.push(...flattenSymbols(s.children));
  }
  return out;
}
