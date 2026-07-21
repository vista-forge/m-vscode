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
// checkout; when it is absent the gate REFUSES (rc != 0), naming what it could
// not verify, rather than pretending it verified something — the same
// refuse-by-default discipline as tree-sitter-m's own ALLOW_MISSING_M_PARSE arm.
// Set ALLOW_MISSING_UPSTREAM=1 to skip the staleness check as a visible,
// per-invocation choice (policy P5c: skip != pass, hatch != default).

import { spawnSync } from 'node:child_process';
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
  // Refuse by default: "cannot verify" must never read as "verified". The skip
  // is an explicit, per-invocation choice — ALLOW_MISSING_UPSTREAM=1, never an
  // ambient default (policy P5c: skip != pass, hatch != default).
  if (process.env.ALLOW_MISSING_UPSTREAM === '1') {
    console.error(`check-wasm: !! ${msg}`);
    console.error(
      'check-wasm: !! *** SKIPPED *** staleness UNVERIFIED, by request (ALLOW_MISSING_UPSTREAM=1).',
    );
  } else {
    fail(`${msg} Set ALLOW_MISSING_UPSTREAM=1 to skip this check as a visible, deliberate choice.`);
  }
} else {
  // Compare against upstream's COMMITTED HEAD, not its working tree.
  //
  // The working tree is a shared, mutable thing: another session editing
  // tree-sitter-m's `dist/` reds this repo's gate for a change that does not
  // exist yet — and the gate's own remedy (`make sync-wasm`) would then vendor
  // UNCOMMITTED bytes into a released `.vsix`. Observed live 2026-07-20 during
  // P4, with a concurrent grammar session mid-edit. Committed-HEAD reads are
  // also what the org's local watcher does, for the same reason.
  //
  // `WASM_UPSTREAM_WORKTREE=1` restores the old behaviour for the one case it
  // is right for: verifying a grammar change from inside tree-sitter-m before
  // committing it.
  const useWorktree = process.env.WASM_UPSTREAM_WORKTREE === '1';
  const upstreamCommit = useWorktree ? 'the upstream WORKING TREE' : 'upstream HEAD';

  const upstreamSha = (rel) => {
    if (useWorktree) {
      const path = join(upstream, rel);
      return existsSync(path) ? sha(path) : undefined;
    }
    const show = spawnSync('git', ['-C', upstream, 'show', `HEAD:${rel}`], {
      maxBuffer: 64 * 1024 * 1024,
    });
    if (show.status !== 0) return undefined;
    return createHash('sha256').update(show.stdout).digest('hex');
  };

  for (const [rel, want] of Object.entries(source.files)) {
    if (rel === 'assets/source.json') continue;
    const upstreamRel = {
      'assets/tree-sitter-m.wasm': 'dist/tree-sitter-m.wasm',
      'assets/tree-sitter-m.wasm.json': 'dist/tree-sitter-m.wasm.json',
      'assets/highlights.scm': 'queries/highlights.scm',
    }[rel];
    if (!upstreamRel) continue;
    const got = upstreamSha(upstreamRel);
    if (got === undefined) {
      fail(
        `upstream file missing at ${upstreamCommit}: ${upstreamRel} — ` +
          'run `make wasm` in tree-sitter-m (never here)',
      );
      continue;
    }
    if (got !== want) {
      fail(
        `STALE — upstream ${upstreamRel} is ${got} at ${upstreamCommit}, we ship ${want}. ` +
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
