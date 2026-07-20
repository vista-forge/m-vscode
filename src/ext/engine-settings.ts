import * as vscode from 'vscode';
import { type EngineSettings, resolveEngineSettings } from '../engine/settings.js';
import { CONFIG_SECTION } from './client.js';

/**
 * Read the engine settings out of the workspace configuration.
 *
 * The `m` executable is deliberately the SAME setting the language client uses
 * (`mLanguageTools.serverPath`): one toolchain, one path. A user who has
 * pointed the server at a specific `m` should not have to point the engine
 * features at it a second time.
 */
export function readEngineSettings(): EngineSettings {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return resolveEngineSettings({
    engine: cfg.get('engine'),
    docker: cfg.get('docker'),
    namespace: cfg.get('namespace'),
    mPath: cfg.get('serverPath'),
    lockWaitSeconds: cfg.get('engine.lockWaitSeconds'),
  });
}

/** The directory `m` runs in: the workspace folder, so it finds `.m-cli.toml`. */
export function engineCwd(hint?: vscode.Uri): string {
  const folder = hint ? vscode.workspace.getWorkspaceFolder(hint) : undefined;
  return (folder ?? vscode.workspace.workspaceFolders?.[0])?.uri.fsPath ?? process.cwd();
}
