# LSP client seams — where the editor and CI can silently disagree

The extension's whole promise is *editor diagnostics == CI diagnostics*. These
are the places that promise can quietly break. All were measured against a real
`m lsp` / `m lint` during P2, not inferred.

## 1. Coordinates: LSP is 0-based, `m lint` is 1-based

`m lsp` emits `line: f.Line - 1, character: f.Col - 1`. Anything comparing the
two must add 1 back, in exactly one place (`src/lsp/normalize.ts`). An
off-by-one here does not look like a bug in the editor — the squiggle merely
sits one line off — so it is red-gated by `equivalence.e2e.test.ts`, which was
**proved to fail** by flipping the `+ 1` (2 of 10 assertions went red).

## 2. Config discovery: CWD (CLI) vs document directory (server)

- `m lint` discovers `.m-cli.toml` by walking up from its **CWD**.
- `m lsp` discovers it per **document directory** (`linterFor(filepath.Dir(path))`).

They agree in the editor case (CWD = project root) and diverge otherwise. This
is not theoretical: `m lint -o json <fixtureDir>` run from the repo root
reported **0 findings** while the server reported **20** for the same file,
because the fixture's `.m-cli.toml` was never discovered. The equivalence gate
therefore runs the CLI with `cwd: fixtureDir`, and a separate characterisation
test pins the divergence so it cannot change unnoticed.

**A gate that runs the CLI from the wrong directory is green and meaningless** —
it compares an empty finding set against an empty one. Hence the gate's
`the fixture actually produces findings` assertion.

## 3. Formatting rules: the server hardcodes canonical

`m fmt` honours `[fmt] rules` from the project config; `m lsp`'s
`textDocument/formatting` calls `mfmt.Rules(mfmt.Canonical)` unconditionally
(m-cli `internal/lsp/server.go`). A project configuring `rules = "identity"`
would get formatting from the editor that `m fmt` would not perform. Recorded as
a P3 ask against m-cli.

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
