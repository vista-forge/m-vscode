import * as vscode from 'vscode';
import { type HighlightStatus, registerHighlighting } from '../highlight/provider.js';
import { statusText } from '../lsp/policy.js';
import {
  CONFIG_SECTION,
  clientStartCount,
  type MLanguageClient,
  readSettings,
  shownServerErrors,
  startClient,
} from './client.js';
import { registerEngineStatus } from './engine-status.js';
import { registerExecuteSelection } from './exec.js';
import {
  type ProfileStatusApi,
  type ProfileStatusSnapshot,
  registerProfileStatus,
} from './profile-status.js';
import { serialize } from './serialize.js';
import { statusMessage } from './status.js';
import { registerTesting } from './testing.js';

/**
 * Activation: register the status command and start the `m lsp` client.
 *
 * Deliberately thin. All M semantics (parsing, linting, formatting, symbols)
 * live in the toolchain — tree-sitter-m's WASM grammar (P1) and `m lsp` (P2) —
 * never in this client. See CLAUDE.md, "thin client, fat toolchain".
 */

let running: MLanguageClient | undefined;
let output: vscode.OutputChannel | undefined;

/**
 * What `activate()` hands back to the extension host — the seam the in-host
 * smoke suite reads. It exposes STATE ONLY (what the profile surface currently
 * says), never a way to drive the extension: a test that could set the state
 * it then asserts would prove nothing.
 */
export interface MVscodeApi {
  profileStatus(): ProfileStatusSnapshot;
  /** Lifetime count of successful `m lsp` client starts (reentrancy guard). */
  clientStarts(): number;
  /** Did the tree-sitter-m grammar load in THIS host (the bundled boundary)? */
  highlight(): HighlightStatus;
  /** Errors this extension SHOWED the user about the server (visibility proof). */
  serverErrors(): readonly string[];
}

export async function activate(context: vscode.ExtensionContext): Promise<MVscodeApi> {
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
  highlightStatus = await registerHighlighting(context, output);

  // Engine features (P4). Independent of both the grammar and the language
  // server: they shell out to the `m` CLI, which owns the driver seam. A
  // missing `m` costs the user their tests, not their colours or diagnostics.
  registerTesting(context, output);
  registerExecuteSelection(context);
  registerEngineStatus(context);

  // The profile surface (A5). Registered BEFORE the client starts so the very
  // first M file a user opens already carries an honest answer to "which rules
  // am I being linted against?" — including when the server never starts.
  profile = registerProfileStatus(context, output, restart);

  await restart();

  return {
    profileStatus: () => profileStatus(),
    clientStarts: () => clientStartCount(),
    highlight: () => highlightStatus,
    serverErrors: () => shownServerErrors(),
  };
}

let highlightStatus: HighlightStatus = { grammarLoaded: false };

let profile: ProfileStatusApi | undefined;

/** The current profile surface state; a blank, warning-tinted default before
 * activation has wired it, never a confident-looking one. */
function profileStatus(): ProfileStatusSnapshot {
  return (
    profile?.current() ?? {
      text: 'M profile: not resolved yet',
      detail: 'The extension has not finished activating.',
      severity: 'warning',
      command: 'mVscode.configureProfile',
      resolvedFor: '',
    }
  );
}

/**
 * Serialized so a `didChangeConfiguration` event racing the initial
 * activation restart (or two rapid settings edits) can never dispose a
 * still-starting client out from under itself — see `serialize.ts`, and the
 * real-VS-Code failure it was written to fix.
 */
const restart = serialize(async (): Promise<void> => {
  await running?.dispose();
  running = undefined;
  if (!output) return;
  running = await startClient(readSettings(), output);
});

export async function deactivate(): Promise<void> {
  await running?.dispose();
  running = undefined;
}
