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
