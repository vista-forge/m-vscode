import * as vscode from 'vscode';
import { registerHighlighting } from '../highlight/provider.js';
import { statusText } from '../lsp/policy.js';
import { CONFIG_SECTION, type MLanguageClient, readSettings, startClient } from './client.js';
import { statusMessage } from './status.js';

/**
 * Activation: register the status command and start the `m lsp` client.
 *
 * Deliberately thin. All M semantics (parsing, linting, formatting, symbols)
 * live in the toolchain — tree-sitter-m's WASM grammar (P1) and `m lsp` (P2) —
 * never in this client. See CLAUDE.md, "thin client, fat toolchain".
 */

let running: MLanguageClient | undefined;
let output: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const version = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
  output = vscode.window.createOutputChannel('M Language Tools');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('mVscode.showStatus', () => {
      const editor = vscode.window.activeTextEditor;
      const settings = readSettings();
      const lines = [statusMessage({ version, activeFile: editor?.document.uri.fsPath })];
      lines.push(
        statusText({
          serverPath: settings.serverPath,
          running: running !== undefined,
          mode: editor && running ? running.modeFor(editor.document) : 'live',
        }),
      );
      void vscode.window.showInformationMessage(lines.join(' '));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mVscode.restartServer', async () => {
      await restart();
      void vscode.window.showInformationMessage('M language server restarted.');
    }),
  );

  // A settings change must take effect without reloading the window: the server
  // path, the profile and the sync policy are all fixed at launch.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) await restart();
    }),
  );

  // Syntax highlighting (P1) is independent of the language server (P2): a
  // missing or broken `m` binary must not cost the user their colours, and a
  // missing grammar must not cost them diagnostics.
  await registerHighlighting(context, output);

  await restart();
}

async function restart(): Promise<void> {
  await running?.dispose();
  running = undefined;
  if (!output) return;
  running = await startClient(readSettings(), output);
}

export async function deactivate(): Promise<void> {
  await running?.dispose();
  running = undefined;
}
