/**
 * The `m lsp` language client — thin glue only.
 *
 * Everything with a decision in it (settings validation, sync policy, the
 * debouncer, the diagnostic coordinate seam) lives in `src/lsp/*` as pure
 * modules with their own tests; this file is the part that can only run inside
 * an extension host. It owns no M knowledge: diagnostics arrive from the server
 * and are handed to VS Code untouched.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node.js';
import { Debouncer } from '../lsp/debounce.js';
import { missingServerMessage, type SyncMode, syncDecision } from '../lsp/policy.js';
import { type MSettings, resolveSettings, serverLaunch } from '../lsp/settings.js';
import { saveActions } from '../lsp/sync.js';

export const CONFIG_SECTION = 'mLanguageTools';

const execFileAsync = promisify(execFile);

/** Read and validate this extension's configuration. */
export function readSettings(): MSettings {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return resolveSettings({
    enable: cfg.get('enable'),
    serverPath: cfg.get('serverPath'),
    serverArgs: cfg.get('serverArgs'),
    lintProfile: cfg.get('lint.profile'),
    debounceMs: cfg.get('diagnostics.debounceMs'),
    largeFileBytes: cfg.get('diagnostics.largeFileBytes'),
  });
}

/**
 * True when the server executable can be run. Probed with `--help` rather than
 * assumed: a missing binary must produce ONE clear message at activation, not a
 * silently dead extension.
 */
async function serverIsRunnable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--help'], { timeout: 10_000 });
    return true;
  } catch (err) {
    // A non-zero exit still proves the executable exists; only ENOENT does not.
    return (err as { code?: string }).code !== 'ENOENT';
  }
}

/** A running client plus the state the status command reports. */
export interface MLanguageClient {
  client: LanguageClient;
  /** Current sync mode of the active document, for the status surface. */
  modeFor(document: vscode.TextDocument): SyncMode;
  dispose(): Promise<void>;
}

/**
 * Start the language client. Returns undefined when the extension is disabled
 * or the server is unavailable — in the latter case after telling the user
 * exactly what to do about it.
 */
export async function startClient(
  settings: MSettings,
  output: vscode.OutputChannel,
): Promise<MLanguageClient | undefined> {
  if (!settings.enable) {
    output.appendLine('mLanguageTools.enable is false — language server not started.');
    return undefined;
  }

  const launch = serverLaunch(settings);
  if (!(await serverIsRunnable(launch.command))) {
    const message = missingServerMessage(launch.command);
    output.appendLine(message);
    void vscode.window.showErrorMessage(message);
    return undefined;
  }

  const serverOptions: ServerOptions = {
    command: launch.command,
    args: launch.args,
    transport: TransportKind.stdio,
  };

  const debouncer = new Debouncer(settings.debounceMs);
  const modes = new Map<string, SyncMode>();

  const decide = (doc: vscode.TextDocument): SyncMode => {
    const key = doc.uri.toString();
    const cached = modes.get(key);
    if (cached !== undefined) return cached;
    const decision = syncDecision(Buffer.byteLength(doc.getText(), 'utf8'), settings);
    modes.set(key, decision.mode);
    output.appendLine(`${doc.uri.fsPath}: ${decision.reason}`);
    return decision.mode;
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'mumps' }],
    outputChannel: output,
    ...(launch.initializationOptions
      ? { initializationOptions: launch.initializationOptions }
      : {}),
    middleware: {
      // R3 mitigation. Collapse a keystroke burst into one re-lint, and above
      // the size threshold do not send changes at all — the document syncs on
      // save instead, which `decide` announced in the output channel.
      didChange: (event, next) => {
        const doc = event.document;
        if (decide(doc) === 'on-save') return Promise.resolve();
        debouncer.schedule(doc.uri.toString(), () => void next(event));
        return Promise.resolve();
      },
      didSave: (doc, next) => {
        const key = doc.uri.toString();
        // T1-9: FLUSH the pending change, never cancel it. Saving inside the
        // debounce window used to drop the last keystrokes, so the server
        // linted stale text at the exact moment parity matters most.
        for (const action of saveActions(modes.get(key) ?? 'live')) {
          if (action === 'flush-pending') {
            debouncer.flush(key);
          } else {
            // A large document was never streamed; send its final text on save
            // so the diagnostics the user sees still match `m lint`.
            void client.sendNotification('textDocument/didChange', {
              textDocument: { uri: key, version: doc.version },
              contentChanges: [{ text: doc.getText() }],
            });
          }
        }
        return next(doc);
      },
      didClose: (doc, next) => {
        const key = doc.uri.toString();
        debouncer.cancel(key);
        modes.delete(key);
        return next(doc);
      },
    },
  };

  const client = new LanguageClient(
    'mLanguageTools',
    'M Language Server',
    serverOptions,
    clientOptions,
  );
  await client.start();
  output.appendLine(`started \`${launch.command} ${launch.args.join(' ')}\``);

  return {
    client,
    modeFor: (doc) => modes.get(doc.uri.toString()) ?? 'live',
    dispose: async () => {
      debouncer.dispose();
      await client.stop();
    },
  };
}
