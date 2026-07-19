/**
 * Per-document trailing debounce.
 *
 * The server re-lints a whole document per `didChange` and cannot be
 * cancelled, so a keystroke burst must reach it as ONE change. Keyed by
 * document URI: a slow document must not delay a fast one.
 */
export class Debouncer {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pending = new Map<string, () => void>();

  constructor(private readonly delayMs: number) {}

  /** Run `fn` after the delay, replacing any call still pending for `key`. */
  schedule(key: string, fn: () => void): void {
    if (this.delayMs <= 0) {
      fn();
      return;
    }
    this.cancel(key);
    this.pending.set(key, fn);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.pending.delete(key);
        fn();
      }, this.delayMs),
    );
  }

  /** Run a pending call for `key` immediately (e.g. on save). */
  flush(key: string): void {
    const fn = this.pending.get(key);
    this.cancel(key);
    fn?.();
  }

  cancel(key: string): void {
    const t = this.timers.get(key);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(key);
    this.pending.delete(key);
  }

  dispose(): void {
    for (const key of [...this.timers.keys()]) this.cancel(key);
  }
}
