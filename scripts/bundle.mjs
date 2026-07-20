#!/usr/bin/env node
/**
 * Bundle the extension with esbuild.
 *
 * Usage: `node scripts/bundle.mjs [--release]`
 *   dev      — with a source map (extension-host breakpoints resolve to TS)
 *   --release— no source map (the packaged .vsix must never carry one)
 *
 * ## Why this is a script and not a one-line esbuild invocation
 *
 * The `import.meta.url` shim below needs a banner AND a define that agree with
 * each other, plus the explanation of what breaks without them. That does not
 * belong squeezed into a `package.json` string.
 *
 * ## The ESM->CJS `import.meta.url` trap (fixed here; smoke-gated in src/smoke)
 *
 * This extension's `main` is CJS (`dist/extension.cjs`) because that is what a
 * VS Code extension host loads. But `web-tree-sitter` is a dual-build package:
 * its `exports` map offers an ESM build (`tree-sitter.js`, which resolves its
 * own on-disk location via `import.meta.url`) under the `import` condition and
 * a CJS build (`tree-sitter.cjs`, which uses `__dirname`) under `require`.
 * esbuild picks the condition from the SYNTAX OF THE IMPORT, not from the
 * output format — our `import { Parser } from 'web-tree-sitter'` is an ESM
 * import, so the ESM build gets pulled into a CJS output. esbuild then rewrites
 * the now-meaningless `import.meta` to `{}`, so `import.meta.url` is
 * `undefined`, and emscripten's node bootstrap dies on its very first line:
 *
 *     createRequire(import.meta.url)
 *     -> TypeError [ERR_INVALID_ARG_VALUE]: The argument 'filename' must be a
 *        file URL object, file URL string, or absolute path string.
 *        Received undefined
 *
 * That is a MODULE-INIT crash, which is why `Parser.init({locateFile})` cannot
 * rescue it: the runtime never gets far enough to consult `locateFile`. It also
 * only ever bit the packaged product — every unit test imports the same module
 * under real ESM (`node --import tsx`), where `import.meta.url` is real. AST
 * highlighting was therefore broken in the .vsix from P1-downstream until
 * 2026-07-20 while every gate stayed green.
 *
 * The fix is to give the CJS output a truthful `import.meta.url`: the file URL
 * of the bundle itself, which is exactly what `import.meta.url` would have been
 * had the module stayed ESM. All three of web-tree-sitter's uses then behave —
 * `createRequire`, the `scriptDirectory` computation, and the
 * `new URL('tree-sitter.wasm', import.meta.url)` fallback in `findWasmBinary`.
 *
 * Deliberately NOT chosen:
 *   - aliasing the import to `web-tree-sitter/tree-sitter.cjs` — works, but
 *     hardcodes a private file name from the dependency's layout that a version
 *     bump may rename, and fixes only this one package;
 *   - loading the grammar from bytes (`Language.load(buffer)`) — addresses
 *     grammar location, not the runtime's own bootstrap, so it does not touch
 *     the actual crash;
 *   - dropping `runtimeDir`/`locateFile` and letting the shimmed
 *     `import.meta.url` resolve the runtime wasm — that would make the runtime
 *     `tree-sitter.wasm` load from `dist/` instead of `dist/assets/`, moving an
 *     asset that `bundle-assets.mjs`, `verify-bundle.mjs` and `vsix-verify`
 *     all pin. The shim is kept strictly additive: asset staging, the
 *     artifact-sha pinning and the `check-wasm` gate are untouched.
 */

import { build } from 'esbuild';

const release = process.argv.includes('--release');

// Must agree with the `define` below. `__filename` is always present in a CJS
// output; `pathToFileURL` gives the `file://` form emscripten expects.
const SHIM = '__mVscodeImportMetaUrl';
const banner =
  `const ${SHIM} = require('node:url').pathToFileURL(__filename).href;\n` +
  '// ^ ESM->CJS shim for bundled dependencies that read import.meta.url\n' +
  '//   (web-tree-sitter). See scripts/bundle.mjs for why.\n';

await build({
  entryPoints: ['src/ext/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !release,
  banner: { js: banner },
  define: { 'import.meta.url': SHIM },
  logLevel: 'info',
});
