#!/usr/bin/env node
// Gate: the vendored tree-sitter-m artifacts are intact AND not stale.
//
// Two independent failures are possible and both are silent at runtime:
//   1. CORRUPT / EDITED — the committed bytes no longer match what sync-wasm
//      recorded, or the artifact no longer matches its own upstream manifest.
//   2. STALE — upstream rebuilt the grammar (it did today, `8a3c0b2`) and this
//      repo still ships the previous artifact. The editor then colours M by a
//      grammar CI no longer uses.
//
// (1) is always checked, from committed data alone. (2) needs the upstream
// checkout; when it is absent the gate says so LOUDLY and passes (rc 0) rather
// than pretending it verified something — same discipline as tree-sitter-m's
// own ALLOW_MISSING_M_PARSE arm. Set STRICT_UPSTREAM=1 to make absence fatal.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = resolve(repoRoot, process.env.TREE_SITTER_M ?? '../tree-sitter-m');

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const fail = (msg) => {
  console.error(`check-wasm: FAIL — ${msg}`);
  process.exitCode = 1;
};

const source = JSON.parse(readFileSync(join(repoRoot, 'assets/source.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(repoRoot, 'assets/tree-sitter-m.wasm.json'), 'utf8'));

// --- 1a. committed bytes match the recorded provenance -----------------------
for (const [rel, want] of Object.entries(source.files)) {
  const path = join(repoRoot, rel);
  if (!existsSync(path)) {
    fail(`vendored file missing: ${rel} — run \`make sync-wasm\``);
    continue;
  }
  const got = sha(path);
  if (got !== want) fail(`${rel} sha256 ${got} != recorded ${want} (edited by hand? re-sync)`);
}

// --- 1b. the artifact matches its OWN upstream manifest ----------------------
// Guards the case where both the wasm and source.json were regenerated locally
// from a build that was never the upstream artifact.
const artifact = join(repoRoot, 'assets/tree-sitter-m.wasm');
if (existsSync(artifact)) {
  const got = sha(artifact);
  if (got !== manifest.artifact_sha256) {
    fail(`artifact sha256 ${got} != its manifest's ${manifest.artifact_sha256}`);
  }
  const bytes = readFileSync(artifact).length;
  if (bytes !== manifest.artifact_bytes) {
    fail(`artifact is ${bytes} bytes, manifest says ${manifest.artifact_bytes}`);
  }
}

// --- 2. staleness vs upstream ------------------------------------------------
if (!existsSync(upstream)) {
  const msg =
    'UNVERIFIED — tree-sitter-m checkout absent, STALENESS NOT CHECKED. ' +
    'The vendored artifact could be any age. Clone vista-forge/tree-sitter-m beside this repo.';
  if (process.env.STRICT_UPSTREAM === '1') fail(msg);
  else console.error(`check-wasm: ${msg}`);
} else {
  for (const [rel, want] of Object.entries(source.files)) {
    if (rel === 'assets/source.json') continue;
    const upstreamRel = {
      'assets/tree-sitter-m.wasm': 'dist/tree-sitter-m.wasm',
      'assets/tree-sitter-m.wasm.json': 'dist/tree-sitter-m.wasm.json',
      'assets/highlights.scm': 'queries/highlights.scm',
    }[rel];
    if (!upstreamRel) continue;
    const path = join(upstream, upstreamRel);
    if (!existsSync(path)) {
      fail(`upstream file missing: ${path} — run \`make wasm\` in tree-sitter-m (never here)`);
      continue;
    }
    const got = sha(path);
    if (got !== want) {
      fail(
        `STALE — upstream ${upstreamRel} is ${got}, we ship ${want}. ` +
          'Upstream moved; run `make sync-wasm`, re-run the tests, and commit.',
      );
    }
  }
}

if (process.exitCode) {
  console.error('check-wasm: the editor would colour M by a grammar the toolchain no longer uses.');
} else {
  console.log(
    `check-wasm: OK — artifact ${manifest.artifact_sha256.slice(0, 12)}… ` +
      `(${manifest.artifact_bytes} bytes, grammar ${manifest.grammar_version}, ` +
      `tree-sitter ${manifest.toolchain.tree_sitter_cli}) from ${source.upstream_commit.slice(0, 7)}`,
  );
}
