# Build log — m-vscode

Chronological narrative of *why* the project got to its current shape.
Complements `git log` (which captures *what* per-commit) with rationale,
trade-offs, things tried and reverted, and explicit deferrals.

`make log MSG="..."` appends a dated stub. Newest entries at the bottom.

## 2026-07-19 — P0 scaffold

**Done.** Repo scaffolded from the vista-compass/vista-atlas house pattern
(Node 24, TypeScript ESM, Biome, `node:test` + tsx, c8, esbuild, vsce,
simple-git-hooks); offline `make check` gate wired (shared `vuln-scan.sh` +
`docs-gate`); `mumps` language registered with extensions `.m`/`.mac`/`.int`
(broader than compass's `.m`, matching tree-sitter-m's own file types);
activation smoke command `mVscode.showStatus`.

**Shape decision.** `src/lang/contribution.ts` is the source of truth for the
language registration and `package.json` is a projection of it, red-gated by
`contribution.test.ts`. A manifest block nobody tests is exactly the kind of
fact that rots; this makes drift a failing test rather than a bug report.

**Deferred.** WASM highlighting (P1), LSP client (P2), hover/symbols (P3),
Test Explorer + coverage gutters (P4). No GitHub remote yet — the operator
creates it; commits are local until then.

## 2026-07-19 — P2 language client

**Done.** `vscode-languageclient` wired to the already-shipping `m lsp` over
stdio: live diagnostics and formatting (so `editor.formatOnSave` works) for
`mumps` documents. Settings for enable/server path/server args/lint profile,
plus the R3 knobs. `M: Restart Language Server` added, and a settings change
restarts the client rather than requiring a window reload.

**The acceptance bar.** `src/lsp/equivalence.e2e.test.ts` runs `m lint -o json`
and a headless `m lsp` session over the same fixture project and requires an
identical multiset of (rule, line, column, severity), then an identical
serialisation. It runs inside `make check` and **fails, never skips**, when `m`
is absent — a skipped equivalence proof is not a passed one. Red-proved by
flipping the 0→1-based conversion.

**Two seams found while building it** (detail: `docs/memory/lsp-client-seams.md`).
`m lint` resolves `.m-cli.toml` from its **CWD** while `m lsp` resolves it from
the **document's directory** — running the CLI from the repo root reported 0
findings where the server reported 20, which would have made a "green" gate
meaningless. And `m lsp` hardcodes canonical formatting instead of honouring
`[fmt] rules`. Both are P3 asks on m-cli; neither is worked around here.

**R3 mitigation is client-side and deliberate.** Debounced `didChange` (300 ms)
plus an on-save-only mode for documents ≥ 256 KiB, announced in the output
channel. No `$/cancelRequest` — the server does not honour it yet, and a client
pretending otherwise would be worse than one that waits.

**New gate.** `scripts/verify-bundle.mjs`: the packaged bundle must contain the
language client and `require()` nothing outside Node builtins + `vscode`. An
unbundled runtime dep produces a `.vsix` that installs cleanly and then does
nothing — a failure mode no other gate in this repo can see.

**Thin client held.** Zero M semantics added: rule ids are opaque strings, and
the only M-adjacent knowledge is the LSP severity enum, which the equivalence
gate pins.
