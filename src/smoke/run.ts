/**
 * Smoke launcher: runs `dist/smoke-suite.cjs` inside the INSTALLED VS Code
 * (`/usr/share/code/code` by default — the P0/compass spike pattern, no
 * download). Invoke with `npm run test:vscode`; not part of `make check`
 * (needs a display + installed VS Code 1.125+).
 */

import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '@vscode/test-electron';

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

await runTests({
  vscodeExecutablePath: VSCODE_BIN,
  extensionDevelopmentPath: repoRoot,
  extensionTestsPath: join(repoRoot, 'dist/smoke-suite.cjs'),
  launchArgs: [workspace, '--disable-gpu'],
  extensionTestsEnv: {
    M_VSCODE_SMOKE_FILE: smokeFile,
    M_VSCODE_SMOKE_UNCONFIGURED_FILE: workspaceFile,
  },
});
