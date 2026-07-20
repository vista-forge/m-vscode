# Engine-feature seams (P4) — what is non-obvious about shelling to `m`

Durable notes for the Test Explorer / coverage / exec / status features. The
[proposal](../../../docs/proposals/pure-m-vscode/pure-m-vscode.md) and
[tracker](../../../docs/proposals/pure-m-vscode/pure-m-vscode-tracker.md) carry
the narrative; this file carries the facts that will still bite next time.

## The `m` CLI's JSON envelope has two publication channels

Measured against the real CLI, not assumed:

- A **failing** `m test` run emits ONE document on **stdout** with `ok:false`,
  `exit:3`, the **full report as `data`**, and the error inline — and a SHORT
  envelope (error only, no data) on **stderr** at the same time.
- A run that produced no report at all (staging refused, bad flags) emits
  **nothing on stdout** and the envelope on **stderr**.

So the rule is: parse stdout first, fall back to stderr, and never treat a
failing envelope as "no results" — `readTestReport` returning `undefined` is
what distinguishes the two, and it is load-bearing. Reading only stdout loses
every refusal; reading only stderr loses every red suite's detail.

## `m coverage` measures the paths you give it — a suite alone measures nothing

`m coverage`'s positional paths are "suites to run **and routine sources to
exercise**". Passing only the selected `*TST.m` files produces a **valid, empty
tracefile**: exit 0, no records. Measured live on YottaDB:

| invocation | records |
|---|---|
| `m coverage ZZMVSMATHTST.m` | none |
| `m coverage ZZMVSMATHTST.m .` | `ZZMVSMATH.m` 2/2 |

`[dependencies] routines` in `.m-cli.toml` **stages** a routine; it does not
make it measured. Hence `coveragePaths()` appends the workspace root. This was
found by the live acceptance run, not by any unit test — a fake CLI writes
whatever tracefile you tell it to.

The corollary is the durable one: **"the CLI exited 0" is not evidence that a
measurement happened.** An empty tracefile renders as 0% covered, which looks
like a result. `runCoverage` therefore treats *no tracefile* and *no records*
as named failures, never as coverage.

## `m vista exec`/`status` take `--transport`, not `--docker`

The staged verbs (`test`, `coverage`) take `--docker <container>`. The
driver-backed verbs take `--transport local|docker|remote` and read the
container from the driver's own `M_<ENGINE>_*` environment. One settings pair
therefore maps to two different flag shapes — `argv.ts` does that translation
and its tests pin it. Default transport is `remote`, so a configured container
must be turned into `--transport docker` explicitly or the probe goes somewhere
else entirely.

## A cross-repo drift gate must read the neighbour's COMMITTED HEAD

`check-wasm` compared the vendored grammar against tree-sitter-m's **working
tree**. During P4 a concurrent session had that repo's `dist/` dirty, which:

1. **red this repo's gate** for a change that did not exist yet, and
2. instructed the operator to `make sync-wasm` — which would have vendored
   **uncommitted bytes** into a released `.vsix`.

Fixed to read `git show HEAD:<path>` (`WASM_UPSTREAM_WORKTREE=1` restores the
old behaviour for validating a grammar change from inside tree-sitter-m). This
is the inverse of [[docs-validate-worktree-masking]]: there a dirty worktree
hid a failure, here it invented one. **Any gate that reads a sibling repo must
say which state it read** — the message now names `upstream HEAD` vs `the
upstream WORKING TREE`.

## Faking `m` at the process boundary is what keeps the gate offline

`run.test.ts` and `engine.e2e.test.ts` write a real executable shell script and
run it as `m`. That covers argv construction, both output channels, non-zero
exits, spawn failure, timeout and cancellation — everything except the engine
itself — with no Docker and no network. Recorded real CLI output lives in
`src/engine/fixtures/cli/` so the fake replays true bytes, not invented ones.

Do not be tempted to make the offline gate talk to an engine "just for
coverage": `make check` runs on every push.

## `make log MSG="…"` runs backticks in the message

`make log` interpolates `$(MSG)` into a shell `printf`, so **backticks in a
changelog message are command substitution**. A message describing `` `m test` ``
literally executed `m test`, `m coverage --lcov` and `m vista exec` (four
engine-bound refusals) and wrote their JSON error envelopes into
`docs/changelog.md`. Use plain quotes in `MSG`, or append to the changelog with
an editor. Harmless here only because every substituted command happened to be
a read-only refusal.

## A version bump deadlocks `make release` against the docs gate

`README.md` links the committed artifact by its versioned filename; `docs-gate`
(inside `make check`, inside `make release`) checks that link; `make release` is
what produces the file. So after a version bump, `make release` fails on a link
to the artifact it has not built yet. Order for a bump: **`make vsix` once, then
`make release`.** Also `git rm --cached` the superseded `.vsix` in the same
commit — two tracked artifacts is worse than none.

## A defect planted in an unreached branch proves nothing

Red-proofing `readTestReport` by making the malformed-data branch return an
empty report came back **green** — the fixture used (a staging refusal) has no
`data` at all, so an earlier guard returned first. The test suite genuinely did
not cover malformed-but-present data. The gap was real; the red-proof found it.
Always confirm the planted line is the one the test actually reaches.
