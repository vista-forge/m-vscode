/**
 * The profile surface: an always-present language-status item saying WHICH
 * project config governs the M file in front of you — or that none does — plus
 * the one-click remedy that fixes the latter (E2, acceptance matrix A5).
 *
 * Why this exists: with no `.m-cli.toml` anywhere up-tree, `m lint` silently
 * applies an unnamed 13-rule default and never names it. In an editor that
 * means diagnostics from a profile the user never chose, with nothing on
 * screen admitting it — and on VistA-era code the modern-family default floods
 * pre-existing noise. A5's criterion is exactly that: silent wrong-profile
 * spam is a FAIL, so the state must be visible without opening a log.
 *
 * Thin glue, per CLAUDE.md: the walk lives in `src/config/discovery.ts`, the
 * reading in `profile.ts`, the wording in `status.ts`, the written bytes in
 * `templates.ts` — all pure and tested without a host. This file owns the
 * vscode objects and the event wiring only.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { CONFIGURE_PROFILE_COMMAND, OPEN_PROFILE_CONFIG_COMMAND } from '../config/contribution.js';
import { CONFIG_FILENAME, nodeFileSystem } from '../config/discovery.js';
import { resolveProfile } from '../config/profile.js';
import { profileStatusView } from '../config/status.js';
import { PROFILE_TEMPLATES, templateById } from '../config/templates.js';
import { MUMPS_LANGUAGE_ID } from '../lang/contribution.js';

/** What the surface currently says — the shape the smoke suite asserts on. */
export interface ProfileStatusSnapshot {
  text: string;
  detail: string;
  severity: 'information' | 'warning';
  command: string;
  /** Directory the state was resolved for (an M document's dir, or a folder). */
  resolvedFor: string;
}

export interface ProfileStatusApi {
  /** Re-resolve and repaint; also announces a CHANGED state to the output channel. */
  refresh(): void;
  current(): ProfileStatusSnapshot;
}

/**
 * `registerProfileStatus` wires the item, the commands and the watcher.
 *
 * `onConfigChanged` is the caller's client-restart path: a config file that
 * appears, changes or disappears changes the rule set the server resolves, and
 * the diagnostics on screen must follow. Restarting is the existing, honest
 * way to get every open document re-linted — the server rebuilds its linter
 * from the new config on the resulting `didOpen`.
 */
export function registerProfileStatus(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  onConfigChanged: () => Promise<void>,
): ProfileStatusApi {
  const item = vscode.languages.createLanguageStatusItem('mVscode.profile', {
    language: MUMPS_LANGUAGE_ID,
    scheme: 'file',
  });
  item.name = 'M lint profile';
  context.subscriptions.push(item);

  let snapshot: ProfileStatusSnapshot = {
    text: '',
    detail: '',
    severity: 'warning',
    command: CONFIGURE_PROFILE_COMMAND,
    resolvedFor: '',
  };

  /**
   * The directory whose profile is reported: the active M document's own
   * directory, because that — not the window's workspace root — is what
   * governs its diagnostics (m-cli T1-1: config is discovered per FILE). The
   * workspace folder is the fallback for "no M file open".
   */
  const subjectDir = (): string => {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc?.languageId === MUMPS_LANGUAGE_ID && doc.uri.scheme === 'file') {
      return dirname(doc.uri.fsPath);
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  };

  const refresh = (): void => {
    const dir = subjectDir();
    if (dir === '') return;
    const view = profileStatusView(resolveProfile(dir, nodeFileSystem));
    item.text = view.text;
    item.detail = view.detail;
    item.severity =
      view.severity === 'warning'
        ? vscode.LanguageStatusSeverity.Warning
        : vscode.LanguageStatusSeverity.Information;
    item.command = { command: view.command, title: view.commandTitle };
    const changed = snapshot.text !== view.text || snapshot.resolvedFor !== dir;
    snapshot = { ...view, resolvedFor: dir };
    // The status item is the surface; the channel line is the record — so a
    // user who asks "why these diagnostics?" can see the answer in the log too.
    if (changed) output.appendLine(`[profile] ${dir}: ${view.text}`);
  };

  const applyConfigChange = async (): Promise<void> => {
    refresh();
    await onConfigChanged();
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refresh()),
    vscode.workspace.onDidOpenTextDocument(() => refresh()),
  );

  // A config written by hand — or by another window — must move the surface
  // too, not only one written through the command below.
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILENAME}`);
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => void applyConfigChange()),
    watcher.onDidChange(() => void applyConfigChange()),
    watcher.onDidDelete(() => void applyConfigChange()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_PROFILE_CONFIG_COMMAND, async () => {
      const dir = subjectDir();
      const resolution = dir === '' ? { configPath: undefined } : resolveProfile(dir);
      if (resolution.configPath === undefined) {
        void vscode.window.showWarningMessage(
          `No \`${CONFIG_FILENAME}\` governs this file. Run "M: Configure M Profile" to write one.`,
        );
        return;
      }
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(resolution.configPath),
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(CONFIGURE_PROFILE_COMMAND, async (templateId?: string) => {
      const dir = targetDirectory();
      if (dir === undefined) {
        void vscode.window.showErrorMessage(
          'M: no folder to configure — open a folder (or an M file on disk) and run ' +
            '"M: Configure M Profile" again.',
        );
        return;
      }
      const target = join(dir, CONFIG_FILENAME);
      if (nodeFileSystem.isFile(target)) {
        // Never overwrite a config that already governs the project: it may
        // carry far more than a profile, and losing it silently is the exact
        // class of failure this phase exists to remove.
        void vscode.window.showWarningMessage(
          `${target} already exists — opening it instead of overwriting it.`,
        );
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
        return;
      }
      const template = templateId === undefined ? await pickTemplate() : templateById(templateId);
      if (template === undefined) {
        if (templateId !== undefined) {
          void vscode.window.showErrorMessage(`M: unknown profile template \`${templateId}\`.`);
        }
        return; // user dismissed the quick pick
      }
      try {
        await writeFile(target, template.content, { encoding: 'utf8', flag: 'wx' });
      } catch (err) {
        void vscode.window.showErrorMessage(
          `M: could not write ${target}: ${(err as Error).message}. ` +
            'Create the file by hand, or pick a folder you can write to.',
        );
        return;
      }
      output.appendLine(`[profile] wrote ${target} (${template.profile})`);
      void vscode.window.showInformationMessage(
        `M profile \`${template.profile}\` configured in ${target}.`,
      );
      await applyConfigChange();
    }),
  );

  refresh();
  return { refresh, current: () => snapshot };
}

/** Where a new config goes: the active M file's workspace folder, else its own
 * directory, else the single open folder. */
function targetDirectory(): string | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc?.languageId === MUMPS_LANGUAGE_ID && doc.uri.scheme === 'file') {
    return vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? dirname(doc.uri.fsPath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function pickTemplate(): Promise<ReturnType<typeof templateById>> {
  const picked = await vscode.window.showQuickPick(
    PROFILE_TEMPLATES.map((t) => ({ label: t.label, description: t.description, id: t.id })),
    {
      title: `Configure the M lint profile (writes ${CONFIG_FILENAME})`,
      placeHolder: 'Which kind of M is this project?',
    },
  );
  return picked === undefined ? undefined : templateById(picked.id);
}
