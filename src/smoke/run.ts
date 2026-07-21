/**
 * Smoke launcher: runs `dist/smoke-suite.cjs` inside the INSTALLED VS Code
 * (`/usr/share/code/code` by default — the P0/compass spike pattern, no
 * download). Invoke with `npm run test:vscode`; not part of `make check`
 * (needs a display + installed VS Code 1.125+).
 *
 * Two modes (B9 P3 / E3 share this machinery — extend, don't fork; the
 * installed-mode context lives in `installed.ts`, also used by the E3
 * acceptance runner `acceptance-run.ts`):
 *
 *  - DEV (default): `extensionDevelopmentPath = repoRoot` loads the working
 *    tree's `dist/` bundle in place.
 *  - INSTALLED (`M_VSCODE_SMOKE_INSTALLED=1`): the extension under test is the
 *    one INSTALLED from the packaged `.vsix` into the persistent
 *    `M_VSCODE_SMOKE_EXTENSIONS_DIR` (see `installed.ts` for the contract and
 *    the rc-2 refuse rule).
 */

import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '@vscode/test-electron';
import { installedContext } from './installed.js';

const VSCODE_BIN = process.env.M_VSCODE_SMOKE_VSCODE ?? '/usr/share/code/code';

const repoRoot = new URL('../..', import.meta.url).pathname;
const smokeFile = join(repoRoot, 'src/lsp/fixtures/capabilities/ZZCAP.m');

// The opened folder is deliberately an EMPTY scratch dir with no `.m-cli.toml`
// anywhere up-tree (`/tmp` has no `.git` boundary either) — that is the A5
// scenario: a real, unconfigured folder. A copy of the fixture routine lives
// inside it so the profile assertions run on a document the scratch folder
// actually governs, while `M_VSCODE_SMOKE_FILE` stays the repo fixture, whose
// own `.m-cli.toml` makes it the CONFIGURED comparison case.
const workspace = mkdtempSync(join(tmpdir(), 'm-vscode-smoke-'));
const workspaceFile = join(workspace, 'ZZCAP.m');
copyFileSync(smokeFile, workspaceFile);

const installed = installedContext();
const extensionDevelopmentPath = installed.extensionDevelopmentPath ?? repoRoot;
const launchArgs = [workspace, '--disable-gpu', ...installed.launchArgs];

await runTests({
  vscodeExecutablePath: VSCODE_BIN,
  extensionDevelopmentPath,
  extensionTestsPath: join(repoRoot, 'dist/smoke-suite.cjs'),
  launchArgs,
  extensionTestsEnv: {
    M_VSCODE_SMOKE_FILE: smokeFile,
    M_VSCODE_SMOKE_UNCONFIGURED_FILE: workspaceFile,
  },
});
