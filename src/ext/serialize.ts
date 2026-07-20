/**
 * Serialize calls to an async function so overlapping invocations run one
 * after another, never concurrently.
 *
 * `restart()` (in `extension.ts`) disposes the running language client and
 * starts a new one. It had no reentrancy guard: a second `restart()` firing
 * while the first was still starting (e.g. a `workspace/didChangeConfiguration`
 * event racing the initial activation restart, or the `mVscode.restartServer`
 * command firing during a settings-driven restart) would dispose the first
 * restart's half-started client out from under it.
 * `vscode-languageclient` surfaces that as "Pending response rejected since
 * connection got disposed", `client.start()` rejects, and `activate()` then
 * throws — the whole extension comes up dead with no error a user would ever
 * see. That is exactly the silent-failure class this repo's CLAUDE.md
 * forbids, so it is closed on principle even though it was NOT what caused
 * the crash `src/smoke/suite.ts` first turned up (that was the `--stdio`
 * argv defect fixed in `client.ts` — confirmed by the smoke suite's output-
 * channel capture showing exactly one `started \`m lsp\`` line per run,
 * i.e. `restart()` was never actually re-entered in that repro).
 *
 * Serializing removes the race outright, independent of what triggers the
 * second call: every restart still runs, in order, once the previous one has
 * fully settled.
 */
export function serialize<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return (...args: Args): Promise<T> => {
    const next = chain.then(
      () => fn(...args),
      () => fn(...args),
    );
    // Swallow rejections in the CHAIN link only — never in what callers
    // observe. Without this, one caller's rejected promise would trip
    // `.then`'s rejection handler for every subsequent call forever.
    chain = next.catch(() => undefined);
    return next;
  };
}
