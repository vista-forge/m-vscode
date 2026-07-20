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
