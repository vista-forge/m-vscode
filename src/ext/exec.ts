/**
 * "Execute Selection on the Engine" — an M scratchpad over `m vista exec`.
 *
 * The CLI owns the run-lock, the transport and the driver; this command owns
 * only which text to send and where the output goes. Output goes to its own
 * channel rather than a notification: engine output is multi-line and worth
 * keeping, and a toast that vanishes is not a result.
 */

import * as vscode from 'vscode';
import { runExec } from '../engine/engine.js';
import { failureLine } from '../engine/failure.js';
import { engineLabel } from '../engine/settings.js';
import { engineCwd, readEngineSettings } from './engine-settings.js';

/** The text to run: the selection, or the whole line the cursor is on. */
export function selectedCommand(editor: vscode.TextEditor): string {
  const { selection, document } = editor;
  if (!selection.isEmpty) return document.getText(selection);
  return document.lineAt(selection.active.line).text;
}

export function registerExecuteSelection(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('M Engine');
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand('mVscode.executeSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage(
          'M: Execute Selection needs an open editor with an M command selected.',
        );
        return;
      }

      const settings = readEngineSettings();
      const label = engineLabel(settings);
      const command = selectedCommand(editor);

      channel.show(true);
      channel.appendLine(`$ m vista exec --engine ${settings.engine}  [${label}]`);
      channel.appendLine(`> ${command.trim()}`);

      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Running on ${label}…` },
        () => runExec(settings, command, { cwd: engineCwd(editor.document.uri) }),
      );

      if (result.kind === 'failed') {
        const line = failureLine(result.failure);
        channel.appendLine(line);
        void vscode.window.showErrorMessage(line);
        return;
      }

      if (result.stdout !== '') channel.append(ensureNewline(result.stdout));
      if (result.stderr !== '') channel.append(ensureNewline(result.stderr));
      // Always print the status: a command that produced no output and a
      // command that failed silently look identical without it.
      channel.appendLine(`status ${result.status}`);
      if (result.stdout === '' && result.stderr === '') {
        channel.appendLine('(the engine produced no output)');
      }
    }),
  );
}

function ensureNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}
