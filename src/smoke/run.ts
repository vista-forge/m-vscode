/**
 * Smoke launcher: runs `dist/smoke-suite.cjs` inside the INSTALLED VS Code
 * (`/usr/share/code/code` by default — the P0/compass spike pattern, no
 * download). Invoke with `npm run test:vscode`; not part of `make check`
 * (needs a display + installed VS Code 1.125+).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '@vscode/test-electron';

const VSCODE_BIN = process.env.M_VSCODE_SMOKE_VSCODE ?? '/usr/share/code/code';

const repoRoot = new URL('../..', import.meta.url).pathname;
const smokeFile = join(repoRoot, 'src/lsp/fixtures/capabilities/ZZCAP.m');
const workspace = mkdtempSync(join(tmpdir(), 'm-vscode-smoke-'));

await runTests({
  vscodeExecutablePath: VSCODE_BIN,
  extensionDevelopmentPath: repoRoot,
  extensionTestsPath: join(repoRoot, 'dist/smoke-suite.cjs'),
  launchArgs: [workspace, '--disable-gpu'],
  extensionTestsEnv: { M_VSCODE_SMOKE_FILE: smokeFile },
});
