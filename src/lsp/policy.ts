/**
 * Client-side mitigation for the LSP maturity risk (proposal §7-R3).
 *
 * `m lsp` re-lints the whole document on every `didChange` and has no
 * cancellation — a 1 MB routine costs ~17 s per lint, dominated by the lint
 * engine itself. Until the server gains incremental sync and
 * `$/cancelRequest` (P3, in m-cli), the client keeps the editor honest two
 * ways: it debounces keystroke bursts into one change, and above a size
 * threshold it stops sending changes at all and lints on save instead —
 * **visibly**, because a deliberate, explained downgrade beats an editor that
 * mysteriously freezes.
 *
 * Pure policy, no vscode import, no M knowledge: byte counts in, decisions out.
 */

import type { MSettings } from './settings.js';

export type SyncMode = 'live' | 'on-save';

export interface SyncDecision {
  mode: SyncMode;
  /** Delay applied to a change burst. Always 0 in on-save mode. */
  debounceMs: number;
  /** Human-readable justification, shown in the status surface. */
  reason: string;
}

/** Decide how a document of `byteLength` bytes should be synced to the server. */
export function syncDecision(byteLength: number, s: MSettings): SyncDecision {
  if (s.largeFileBytes > 0 && byteLength >= s.largeFileBytes) {
    const kib = Math.round(byteLength / 1024);
    return {
      mode: 'on-save',
      debounceMs: 0,
      reason: `document is ${kib} KiB — linting on save only, to keep typing responsive`,
    };
  }
  return {
    mode: 'live',
    debounceMs: s.debounceMs,
    reason: `linting live, ${s.debounceMs} ms after you stop typing`,
  };
}

export interface StatusInput {
  serverPath: string;
  running: boolean;
  mode: SyncMode;
}

/** One line describing the language-server state, for the status command. */
export function statusText(i: StatusInput): string {
  if (!i.running) return `M language server (\`${i.serverPath} lsp\`) is not running.`;
  const mode = i.mode === 'live' ? 'live as you type' : 'on save (large document)';
  return `M language server (\`${i.serverPath} lsp\`) is running — diagnostics ${mode}.`;
}

/**
 * The message shown when the server executable cannot be found. Names the
 * executable, the toolchain, and the setting that fixes it: a language client
 * that fails silently is worse than one that never started.
 */
export function missingServerMessage(serverPath: string): string {
  return (
    `M Language Tools could not start the language server: \`${serverPath}\` was not found. ` +
    'Install the m toolchain (m-cli) and make sure it is on your PATH, or set ' +
    '`mLanguageTools.serverPath` to its full path. Diagnostics and formatting are unavailable ' +
    'until then.'
  );
}
