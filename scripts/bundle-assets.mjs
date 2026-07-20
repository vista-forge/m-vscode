#!/usr/bin/env node
/**
 * Stage the runtime assets into `dist/assets/`, which is what actually ships.
 *
 * `package.json` `files` allows `dist`, and `vsce package --no-dependencies`
 * drops `node_modules` entirely — so anything the extension reads at runtime
 * must be under `dist` or it is simply not there, with no error until a user
 * opens a `.m` file and sees nothing happen. Two things qualify:
 *
 *   - the vendored tree-sitter-m grammar + its highlight query (from `assets/`,
 *     synced from upstream by `make sync-wasm` — never built here);
 *   - `web-tree-sitter`'s OWN runtime `tree-sitter.wasm`. esbuild inlines the
 *     emscripten glue into `dist/extension.cjs`, which moves it away from its
 *     sibling `.wasm`; `provider.ts` passes `runtimeDir` so emscripten's
 *     `locateFile` finds it here instead.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(repoRoot, 'dist', 'assets');
mkdirSync(out, { recursive: true });

const require = createRequire(import.meta.url);
// Resolve the runtime wasm through its OWN exports entry — web-tree-sitter's
// `exports` map deliberately does not expose `./package.json`, so the usual
// resolve-the-manifest-then-join trick throws ERR_PACKAGE_PATH_NOT_EXPORTED.
const runtimeWasm = require.resolve('web-tree-sitter/tree-sitter.wasm');

const staged = [
  [join(repoRoot, 'assets', 'tree-sitter-m.wasm'), 'tree-sitter-m.wasm'],
  [join(repoRoot, 'assets', 'tree-sitter-m.wasm.json'), 'tree-sitter-m.wasm.json'],
  [join(repoRoot, 'assets', 'highlights.scm'), 'highlights.scm'],
  [runtimeWasm, 'tree-sitter.wasm'],
];

for (const [from, name] of staged) copyFileSync(from, join(out, name));

console.log(`bundle-assets: staged ${staged.length} files into dist/assets/`);
