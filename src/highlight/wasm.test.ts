import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultGrammarPaths, GrammarArtifactError, loadGrammar } from './wasm.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL('../../assets/tree-sitter-m.wasm.json', import.meta.url), 'utf8'),
);

test('loadGrammar loads the vendored artifact and reports what it loaded', async () => {
  const loaded = await loadGrammar(defaultGrammarPaths(repoRoot));
  // Pins from the upstream manifest + a live measurement. These change only
  // when tree-sitter-m rebuilds, and check-wasm.mjs proves we re-synced.
  assert.equal(loaded.language.abiVersion, 15, 'tree-sitter ABI');
  // Measured, and re-measured on every re-sync. History of this ONE number:
  // 1019 (S1 spike / P1-upstream notes) -> 1020 at `8a3c0b2` (the
  // `_sp_comment` external token) -> 1170 at `0d41453` (IRIS abbreviations
  // `$I`/`ZW`, regenerated from m-standard). Upstream's own loader test
  // asserts only `> 900`, so it never notices; this pin is what does.
  assert.equal(loaded.language.nodeTypeCount, 1170, 'node kinds');
  assert.equal(loaded.artifactSha256, manifest.artifact_sha256);
  assert.equal(loaded.grammarVersion, manifest.grammar_version);
  assert.ok(loaded.highlights.includes('@comment'), 'highlights.scm came along');
});

test('loadGrammar is loud and actionable when the artifact is missing', async () => {
  const paths = defaultGrammarPaths(repoRoot);
  await assert.rejects(
    loadGrammar({ ...paths, grammarWasm: `${paths.grammarWasm}.nope` }),
    (err: unknown) => {
      assert.ok(err instanceof GrammarArtifactError, 'wrong error class');
      const msg = (err as Error).message;
      // A silently uncoloured editor is the failure this whole effort exists to
      // eliminate. The message must name the file AND the command that fixes it.
      assert.match(msg, /tree-sitter-m\.wasm\.nope/, 'does not name the missing file');
      assert.match(msg, /make sync-wasm/, 'does not name the fix');
      return true;
    },
  );
});

test('loadGrammar is loud and actionable when the query is missing', async () => {
  const paths = defaultGrammarPaths(repoRoot);
  await assert.rejects(
    loadGrammar({ ...paths, highlightsQuery: `${paths.highlightsQuery}.nope` }),
    (err: unknown) => {
      assert.ok(err instanceof GrammarArtifactError);
      assert.match((err as Error).message, /highlights\.scm\.nope/);
      assert.match((err as Error).message, /make sync-wasm/);
      return true;
    },
  );
});

test('defaultGrammarPaths places every asset under one directory', () => {
  const p = defaultGrammarPaths('/x/y');
  assert.equal(p.grammarWasm, '/x/y/assets/tree-sitter-m.wasm');
  assert.equal(p.highlightsQuery, '/x/y/assets/highlights.scm');
  assert.equal(p.manifest, '/x/y/assets/tree-sitter-m.wasm.json');
});
