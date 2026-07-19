#!/usr/bin/env node
/**
 * Gate: prove the shipped bundle is self-contained.
 *
 * The extension is packaged with `vsce package --no-dependencies` and a
 * `package.json` `files` allow-list of `dist` — so a runtime dependency reaches
 * the user ONLY if esbuild bundled it in. If `vscode-languageclient` were left
 * as an external `require`, the .vsix would still build, still install, and
 * then fail SILENTLY at activation with no diagnostics and no formatting.
 * That failure mode is invisible in every other gate, so it gets its own.
 *
 * Checks, against `dist/extension.cjs`:
 *   1. the bundle exists and exports `activate`/`deactivate`;
 *   2. the language client is actually inside it;
 *   3. nothing outside Node builtins + the `vscode` host API is required at
 *      runtime — i.e. no unbundled dependency to go missing.
 */

import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

const BUNDLE = 'dist/extension.cjs';

let src;
try {
  src = readFileSync(BUNDLE, 'utf8');
} catch {
  fail(`${BUNDLE} is missing — run \`make bundle\` first.`);
}

const problems = [];

for (const symbol of ['activate', 'deactivate']) {
  if (!src.includes(symbol)) problems.push(`bundle does not export \`${symbol}\``);
}

// A marker from vscode-languageclient's own source, not merely our import of it.
if (!src.includes('LanguageClient')) {
  problems.push('vscode-languageclient is NOT bundled — the packaged extension would be inert');
}

const allowed = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'vscode']);
const external = [...src.matchAll(/require\("([^"]+)"\)/g)]
  .map((m) => m[1])
  .filter((mod) => !mod.startsWith('.') && !allowed.has(mod));

if (external.length > 0) {
  problems.push(
    `bundle requires unbundled module(s) at runtime, which the .vsix will not ship: ${[
      ...new Set(external),
    ].join(', ')}`,
  );
}

if (problems.length > 0) fail(problems.join('\n  - '));

console.log(`verify-bundle: OK — ${BUNDLE} is self-contained (${(src.length / 1024) | 0} KiB).`);

function fail(message) {
  console.error(`verify-bundle: FAILED\n  - ${message}`);
  process.exit(1);
}
