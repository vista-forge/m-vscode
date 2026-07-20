#!/usr/bin/env node
// Sync the tree-sitter-m editor artifacts INTO this repo. Consume, never rebuild.
//
// The WASM artifact and its drift gate live upstream in tree-sitter-m
// (`make wasm` / `make check-wasm-drift`). Building a second copy here would
// recreate exactly the divergence risk that gate closed. This script only
// COPIES the committed upstream artifact + query and records what it took, so
// `scripts/check-wasm.mjs` can prove the copy is neither corrupt nor stale.
//
// Usage: node scripts/sync-wasm.mjs [--upstream ../tree-sitter-m]

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argIdx = process.argv.indexOf('--upstream');
const upstream = resolve(
  repoRoot,
  argIdx !== -1 ? process.argv[argIdx + 1] : (process.env.TREE_SITTER_M ?? '../tree-sitter-m'),
);

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const files = [
  ['dist/tree-sitter-m.wasm', 'assets/tree-sitter-m.wasm'],
  ['dist/tree-sitter-m.wasm.json', 'assets/tree-sitter-m.wasm.json'],
  ['queries/highlights.scm', 'assets/highlights.scm'],
];

if (!existsSync(upstream)) {
  console.error(`sync-wasm: upstream checkout not found: ${upstream}`);
  console.error('sync-wasm: clone vista-forge/tree-sitter-m beside this repo, or pass --upstream.');
  process.exit(2);
}

for (const [from] of files) {
  if (!existsSync(join(upstream, from))) {
    console.error(`sync-wasm: missing upstream file: ${join(upstream, from)}`);
    console.error('sync-wasm: run `make wasm` in tree-sitter-m first — do NOT build it here.');
    process.exit(2);
  }
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  /* a tarball checkout has no git dir; the shas below are the real pin */
}

for (const [from, to] of files) copyFileSync(join(upstream, from), join(repoRoot, to));

const source = {
  schema_version: '1',
  comment:
    'Provenance of the vendored tree-sitter-m editor artifacts. Written by scripts/sync-wasm.mjs; verified by scripts/check-wasm.mjs. Do not hand-edit.',
  upstream_repo: 'vista-forge/tree-sitter-m',
  upstream_commit: commit,
  synced_at: new Date().toISOString(),
  files: Object.fromEntries(files.map(([, to]) => [to, sha(join(repoRoot, to))])),
};
writeFileSync(join(repoRoot, 'assets/source.json'), `${JSON.stringify(source, null, 2)}\n`);

console.log(`sync-wasm: synced from ${upstream} @ ${commit}`);
for (const [k, v] of Object.entries(source.files)) console.log(`  ${k}  ${v}`);
