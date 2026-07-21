/**
 * Smoke launcher: runs `dist/smoke-suite.cjs` inside the INSTALLED VS Code
 * (`/usr/share/code/code` by default — the P0/compass spike pattern, no
 * download). Invoke with `npm run test:vscode`; not part of `make check`
 * (needs a display + installed VS Code 1.125+).
 *
 * Two modes (B9 P3 / E3 share this machinery — extend, don't fork):
 *
 *  - DEV (default): `extensionDevelopmentPath = repoRoot` loads the working
 *    tree's `dist/` bundle in place.
 *  - INSTALLED (`M_VSCODE_SMOKE_INSTALLED=1`): the extension under test is the
 *    one INSTALLED from the packaged `.vsix` into the persistent
 *    `M_VSCODE_SMOKE_EXTENSIONS_DIR` (with `M_VSCODE_SMOKE_USER_DATA_DIR` as
 *    the profile). The harness's mandatory `extensionDevelopmentPath` is
 *    pointed at an INERT stub extension (no main, no activation events), so
 *    the only live `vista-forge.m-vscode` is the installed copy the suite
 *    resolves by id. Missing dir env => refuse loudly (rc 2); silently
 *    falling back to dev mode would smoke the wrong artifact — the
 *    month-dead-highlighting lesson, from the packaged side this time.
 */

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '@vscode/test-electron';

const VSCODE_BIN = process.env.M_VSCODE_SMOKE_VSCODE ?? '/usr/share/code/code';
const INSTALLED = process.env.M_VSCODE_SMOKE_INSTALLED === '1';

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

let extensionDevelopmentPath = repoRoot;
const launchArgs = [workspace, '--disable-gpu'];

if (INSTALLED) {
  const extDir = process.env.M_VSCODE_SMOKE_EXTENSIONS_DIR;
  const userDataDir = process.env.M_VSCODE_SMOKE_USER_DATA_DIR;
  if (!extDir || !userDataDir) {
    process.stderr.write(
      'smoke: REFUSE — M_VSCODE_SMOKE_INSTALLED=1 needs M_VSCODE_SMOKE_EXTENSIONS_DIR and ' +
        'M_VSCODE_SMOKE_USER_DATA_DIR (the persistent dirs the .vsix was installed into).\n',
    );
    process.exit(2);
  }
  // Sanitize the PERSISTENT profile: a prior run that died mid-§7 (the
  // failure-visibility check plants a bogus Global `serverPath`) leaves the
  // poison in user-data settings.json, and every later run then starts with a
  // dead server — state contamination, not a real red. Strip our keys.
  const settingsPath = join(userDataDir, 'User', 'settings.json');
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    let dirty = false;
    for (const key of Object.keys(settings)) {
      if (key.startsWith('mLanguageTools.')) {
        delete settings[key];
        dirty = true;
      }
    }
    if (dirty) {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      process.stdout.write(`smoke: sanitized stale mLanguageTools.* keys from ${settingsPath}\n`);
    }
  } catch {
    // No settings file yet — nothing to sanitize.
  }

  const stub = mkdtempSync(join(tmpdir(), 'm-vscode-smoke-stub-'));
  writeFileSync(
    join(stub, 'package.json'),
    // No `main`, no activationEvents, no contributes: loads inert.
    JSON.stringify({
      name: 'm-vscode-smoke-stub',
      publisher: 'vista-forge',
      version: '0.0.0',
      engines: { vscode: '^1.100.0' },
    }),
  );
  extensionDevelopmentPath = stub;
  launchArgs.push(`--extensions-dir=${extDir}`, `--user-data-dir=${userDataDir}`);
}

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
