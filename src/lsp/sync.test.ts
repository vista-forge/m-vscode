import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { saveActions } from './sync.ts';

describe('save policy (what happens to a pending change when the user saves)', () => {
  /**
   * T1-9. The client debounces `didChange` by 300 ms. `didSave` used to
   * **cancel** that pending notification, so typing and hitting Ctrl+S inside
   * the debounce window meant the server never saw the last keystrokes: it
   * linted stale text at the precise moment the user asked for a definitive
   * answer, and the editor disagreed with `m lint` on the very file that had
   * just been written to disk.
   */
  it('FLUSHES a pending change in live mode — never drops it', () => {
    assert.deepEqual(saveActions('live'), ['flush-pending']);
  });

  it('sends the full text in on-save mode (nothing was ever streamed)', () => {
    assert.deepEqual(saveActions('on-save'), ['send-full-text']);
  });

  it('never cancels: a dropped change is a stale lint', () => {
    for (const mode of ['live', 'on-save'] as const) {
      assert.equal(
        saveActions(mode).includes('cancel-pending' as never),
        false,
        `mode ${mode} must not cancel`,
      );
    }
  });
});
