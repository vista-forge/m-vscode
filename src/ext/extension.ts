import * as vscode from 'vscode';
import { statusMessage } from './status.js';

/**
 * P0 activation: prove the extension loads and the `mumps` language is ours.
 *
 * Deliberately thin. All M semantics (parsing, linting, formatting, symbols)
 * live in the toolchain — tree-sitter-m's WASM grammar (P1) and `m lsp` (P2) —
 * never in this client. See CLAUDE.md, "thin client, fat toolchain".
 */
export function activate(context: vscode.ExtensionContext): void {
  const version = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';

  context.subscriptions.push(
    vscode.commands.registerCommand('mVscode.showStatus', () => {
      const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
      vscode.window.showInformationMessage(statusMessage({ version, activeFile }));
    }),
  );
}

export function deactivate(): void {
  // Nothing to tear down yet; the LSP client lands in P2.
}
