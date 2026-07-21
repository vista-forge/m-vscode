/**
 * Shared installed-mode launch context for the Extension-Host harnesses
 * (B9 P3 smoke and the E3 acceptance matrix — one machinery, per the E3
 * kickoff "extend, don't fork").
 *
 * INSTALLED mode (`M_VSCODE_SMOKE_INSTALLED=1`): the extension under test is
 * the one INSTALLED from the packaged `.vsix` into the persistent
 * `M_VSCODE_SMOKE_EXTENSIONS_DIR` (with `M_VSCODE_SMOKE_USER_DATA_DIR` as the
 * profile). The harness's mandatory `extensionDevelopmentPath` is pointed at
 * an INERT stub extension (no main, no activation events), so the only live
 * `vista-forge.m-vscode` is the installed copy the suites resolve by id.
 * Missing dir env => refuse loudly (rc 2); silently falling back to dev mode
 * would smoke the wrong artifact — the month-dead-highlighting lesson, from
 * the packaged side this time.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface InstalledContext {
  /** The inert stub extension dir (or undefined outside installed mode). */
  extensionDevelopmentPath: string | undefined;
  /** Extra launch args selecting the persistent dirs (empty outside installed mode). */
  launchArgs: string[];
}

export function isInstalledMode(): boolean {
  return process.env.M_VSCODE_SMOKE_INSTALLED === '1';
}

/**
 * Resolve the installed-mode launch context from the environment, sanitizing
 * the PERSISTENT profile first: a prior run that died mid-check (the
 * failure-visibility check plants a bogus Global `serverPath`) leaves the
 * poison in user-data settings.json, and every later run then starts with a
 * dead server — state contamination, not a real red. Strip our keys.
 *
 * Exits the process with rc 2 when the persistent-dir env is missing.
 */
export function installedContext(): InstalledContext {
  if (!isInstalledMode()) return { extensionDevelopmentPath: undefined, launchArgs: [] };

  const extDir = process.env.M_VSCODE_SMOKE_EXTENSIONS_DIR;
  const userDataDir = process.env.M_VSCODE_SMOKE_USER_DATA_DIR;
  if (!extDir || !userDataDir) {
    process.stderr.write(
      'smoke: REFUSE — M_VSCODE_SMOKE_INSTALLED=1 needs M_VSCODE_SMOKE_EXTENSIONS_DIR and ' +
        'M_VSCODE_SMOKE_USER_DATA_DIR (the persistent dirs the .vsix was installed into).\n',
    );
    process.exit(2);
  }

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
  return {
    extensionDevelopmentPath: stub,
    launchArgs: [`--extensions-dir=${extDir}`, `--user-data-dir=${userDataDir}`],
  };
}
