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
  // 1020, not the 1019 quoted in the P1-upstream notes and the S1 spike: those
  // were measured before `8a3c0b2` added the `_sp_comment` external token
  // (EXTERNAL_TOKEN_COUNT 4 -> 5) on 2026-07-19. Upstream's own loader test
  // asserts only `> 900`, so it did not catch the move. Measured here.
  assert.equal(loaded.language.nodeTypeCount, 1020, 'node kinds');
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
