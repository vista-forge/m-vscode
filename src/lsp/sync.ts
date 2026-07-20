/**
 * What the client must do with a pending document change when the user saves.
 *
 * Pure policy, no vscode import: a mode goes in, the required actions come out.
 * It lives here rather than inline in `client.ts` for the same reason the sync
 * decision does — a rule this easy to get wrong needs a test, and the extension
 * host is not testable.
 *
 * ## The defect this encodes (T1-9)
 *
 * `didSave` used to **cancel** the debounced `didChange`. The debounce window
 * is 300 ms, so typing and hitting Ctrl+S inside it meant the server never
 * received the last keystrokes: it went on to lint stale text at the exact
 * moment the user asked for a definitive answer, and the editor disagreed with
 * `m lint` on the file that had just been written to disk. `Debouncer.flush`
 * already existed for this and was unused outside its own test.
 *
 * A pending change is never dropped. Saving means "I am done — tell me the
 * truth about THIS text", which is the strongest form of the parity promise
 * and the worst possible moment to answer about the previous text.
 */

import type { SyncMode } from './policy.js';

/**
 * `flush-pending` — run the debounced `didChange` now instead of waiting out
 * the timer (and instead of discarding it).
 * `send-full-text` — the document was never streamed (it is over the size
 * threshold), so its final text has to be sent explicitly.
 */
export type SaveAction = 'flush-pending' | 'send-full-text';

/** The actions a save must perform for a document synced in `mode`. */
export function saveActions(mode: SyncMode): SaveAction[] {
  // In on-save mode `didChange` never schedules anything, so there is nothing
  // to flush; the full text has to be sent instead.
  return mode === 'on-save' ? ['send-full-text'] : ['flush-pending'];
}
