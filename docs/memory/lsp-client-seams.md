# LSP client seams — where the editor and CI can silently disagree

The extension's whole promise is *editor diagnostics == CI diagnostics*. These
are the places that promise can quietly break. All were measured against a real
`m lsp` / `m lint`, not inferred.

> **What the equivalence gate proves (corrected 2026-07-19, P3 Tier 1).** This
> file previously called `equivalence.e2e.test.ts` a *parity* gate. Through P2 it
> was not: it keyed on `line:col rule severity` after bridging the two coordinate
> systems with `character + 1`, and every fixture was pure ASCII — on which a
> UTF-16 code-unit offset and a byte offset are the same number. So it proved
> **wire-number agreement**, and was structurally incapable of failing on defect
> T1-2 (the server publishing byte columns where LSP mandates UTF-16): the
> corruption diffed to exactly zero. It also asserted only that formatting
> *returned an edit*, never that the edit matched `m fmt` (T1-4).
>
> As of Tier 1 it proves parity in both currencies and on both sides:
> the column conversion is derived from the **document text**, a deliberately
> non-ASCII fixture (`fixtures/utf16/`) carries a guard assertion that it stays
> non-ASCII, and the write side is compared byte-for-byte against `m fmt`. All
> three were red-proofed by planting the defect and watching the gate fail.

## 1. Coordinates: two origins AND two currencies

Lines differ by an origin: LSP is 0-based, `m lint` is 1-based. **Columns differ
by origin _and_ unit**: `m lint` reports 1-based **byte** columns, LSP positions
count **UTF-16 code units**. `character + 1 === col` is therefore true only on
ASCII, which is why a `+ 1` looked correct for a whole phase.

The conversion lives in exactly one place (`src/lsp/normalize.ts`) and goes
through the **document text** — `byteColumnFromUtf16` / `utf16FromByteColumn`.
Deriving it from the text rather than from either producer's column is what lets
it disagree with either, which is the only way it can catch either being wrong.

**Never compare the two columns directly.** A gate that does is measuring one
number against itself.

## 2. Config discovery: per FILE on both sides (closed 2026-07-19)

Both `m lint`/`m fmt` and `m lsp` now resolve `.m-cli.toml` from the **file's own
directory** (m-cli T1-1). A file's rule set no longer depends on where the
process was started.

It used to: the CLI walked up from its **CWD** and applied one config to the
whole run. `m lint -o json <fixtureDir>` from the repo root reported **0**
findings while the server reported **20** for the same file. The gate worked
around it by running the CLI with `cwd: fixtureDir`, and a characterisation test
pinned the divergence; that test was **deleted** when T1-1 landed and replaced by
`resolves the fixture config from ANY cwd`, which asserts the opposite.

**A gate that runs the CLI from the wrong directory is green and meaningless** —
it compares an empty finding set against an empty one. Hence the gate's
`the fixture actually produces findings` assertion.

## 3. Formatting rules: resolved from config on both sides (closed), and GATED

`m lsp`'s `textDocument/formatting` used to call `mfmt.Rules(mfmt.Canonical)`
unconditionally while `m fmt` honored `[fmt] rules`, so a project on
`rules = "identity"` got editor formatting `m fmt` would never perform. Closed by
m-cli T0-7; the write-side gate that can PROVE it is Tier 1's T1-4.

Two things that gate depends on, and that a future edit will break silently:

- **`fixtures/format/.m-cli.toml` must pin `[fmt] rules = "canonical"`.** Without
  it both sides resolve identity, the comparison is two no-ops, and the gate is
  green while proving nothing. (This is also what fixed a red that Tier 0 left
  behind: once formatting started honoring config, the config-less fixture
  correctly produced zero edits and the old "returns an edit" assertion failed.)
- **`m fmt --stdin` is the CI oracle** — it resolves the same project config from
  the fixture directory and emits raw formatted bytes, so the comparison is
  byte-for-byte rather than "an edit came back".

Related, when building fixtures: **canonical formatting changes keyword *case*
(lower → UPPER) and little else** — indentation and inter-token spacing survive.
A fixture meant to be "not yet formatted" must use lowercase commands, or
`textDocument/formatting` correctly returns zero edits and the test looks broken
when it is right.

## 4. Server capability set is small — do not stub around it

Today: `textDocumentSync: 1` (FULL) and `documentFormattingProvider: true`.
Nothing else. The gate asserts `hoverProvider`/`completionProvider` are
**absent**, so if P3 adds them the client is forced to notice and wire them
rather than quietly inheriting a half-feature.

## 5. `.m` fixtures must NOT be auto-formatted

`src/lsp/fixtures/` holds deliberately non-canonical routines; formatting them
destroys the fixtures. The org's `m fmt` PostToolUse hook was **verified not to
fire in this repo** (a lowercase probe routine written through the Write tool
came back unchanged). If that hook is ever wired here, it would silently
uppercase `fixtures/format/ZZFMT.m` and the formatting assertion would start
failing for a reason nothing in this repo explains.


## Severity is MANY-TO-ONE on the wire — compare numbers, not recovered names

`m lsp` publishes `style` **and** `info` as LSP Information (3). Style used to
map to Hint (4), and that was a parity defect rather than a cosmetic one: VS
Code renders Hint as a faint inline squiggle and **excludes it from the Problems
panel**, so a finding `m lint --check` gates on was invisible where a user looks
for it. (Ruled and implemented server-side in m-cli, 2026-07-20.)

The consequence for this repo: **the LSP severity number can no longer be
inverted to a severity name.** The equivalence gate therefore normalises in the
direction the server itself converts — `m lint`'s name → the LSP number
(`LSP_SEVERITY_FOR`) — and compares wire numbers on both sides. Recovering names
from numbers made the gate red on a legitimate mapping while being no better at
catching a real divergence.

Still red-proofed after the change: restoring `style -> 4` reds it (rc 1), and
flattening every published severity to 3 reds it (rc 1). Error and warning stay
distinct, which is what the gate is actually protecting.

**The general lesson, and it is the same one as the byte/UTF-16 column seam:
normalise toward the producer's own representation, never invent an inverse for
a lossy mapping.**

## P3-feat Session B (2026-07-20) — hover/completion/documentSymbol/folding wiring

**`vscode-languageclient`'s built-in features need no client code to reach the
UI.** `HoverFeature`, `CompletionItemFeature`, `DocumentSymbolFeature` and
`FoldingRangeFeature` are unconditionally constructed in
`BaseLanguageClient.registerBuiltinFeatures()` (`lib/common/client.js`) and
each registers its VS Code provider itself once `initialize` returns a
truthy capability flag, against `clientOptions.documentSelector`. Session B's
work was verifying this, not building it — confirmed by reading the library
source (nothing else needed) AND by driving `vscode.execute*Provider`
against the real, bundled extension in a real Extension Host
(`src/smoke/`, `@vscode/test-electron` against `/usr/share/code/code`,
already installed — no download, no network).

**⚠️ `transport: TransportKind.stdio` is not a no-op — it changes argv.** For
an `Executable`-shaped `ServerOptions` (`command` + `args`, no `module`),
`vscode-languageclient` only appends `--stdio` to the child process's argv
when `transport` is set to `TransportKind.stdio` **explicitly** (that flag
exists for servers offering multiple transports, e.g. `typescript-language-
server`). Leaving `transport` **undefined** still launches over stdio — it is
this shape's default — but sends `args` unmodified. `client.ts` had set the
explicit form since P2; `m lsp` has no `--stdio` flag and exited 2 (USAGE)
on every real launch, which `vscode-languageclient` reported only as
"Pending response rejected since connection got disposed" — no mention of
the flag anywhere. **The equivalence gate could never catch this**: it talks
to `m lsp` directly via the hand-rolled `LspSession` (`session.ts`), never
through `vscode-languageclient`, so a defect in how THIS repo calls that
library was invisible to every gate until a real VS Code ran the real
extension. Fix: omit `transport` for any `Executable` server. Red-proofed
against the smoke suite (rc 1 → 0).

**The smoke suite is the only thing in this repo that exercises the actual
`vscode-languageclient` code path** — `capabilities.e2e.test.ts` (and the
equivalence gate) prove `m lsp` answers correctly over raw stdio, which is
necessary but not sufficient. Not part of `make check` (needs a display and
an installed VS Code — the `vista-compass`/`vista-atlas` `test:vscode`
pattern, reused verbatim: `runTests` against `/usr/share/code/code`, no
download). Run manually (`npm run test:vscode`) and report the result, same
as the P4 dual-engine acceptance run.

**A code-review hunch is not a repro.** Investigating the crash, `restart()`
(in `extension.ts`) looked reentrancy-unsafe (a `didChangeConfiguration`
racing the initial activation restart could dispose a still-starting
client) — a real hazard, closed with `src/ext/serialize.ts`. But the smoke
suite's own output-channel capture showed `started \`m lsp\`` exactly once
during the actual crash, proving that hazard was NOT what caused it. Keep
the fix (it is real and now unit-tested), but do not credit it for a bug it
did not cause — the `--stdio` argv defect was the whole story. Suspect the
mechanism you can reproduce, not the one you can imagine.

**`positionEncoding: utf-16` needed no client change.**
`vscode-languageclient` 9.0.1 hardcodes
`generalCapabilities.positionEncodings = ['utf-16']` in the client
capabilities it sends, and **throws** if `initialize` ever returns a
different `positionEncoding` — so the server declaring `utf-16` is simply
confirming what the client already assumes, and `normalize.ts`'s UTF-16
column arithmetic (unchanged since Tier 1) stays correct without any new
code here.
