# m-vscode — M Language Tools (MUMPS)

A VS Code extension for **pure, portable M** — the language itself, on any M
engine, with **no VistA required**.

This is the third member of the vista-forge editor trio, and the only one that
is about the *language*:

| Extension | Answers |
|---|---|
| [`vista-compass`](../vista-compass) | what the VistA system measurably **IS** (the measured model) |
| [`vista-atlas`](../vista-atlas) | what the VA documentation **SAYS** (the gold corpus) |
| **`m-vscode`** (this) | the **M language itself** — syntax, diagnostics, formatting, tests |

## Status — P0 (scaffold)

Shipped here: the `mumps` language registration (id `mumps`, aliases
`MUMPS`/`M`, extensions `.m`/`.mac`/`.int`, bracket + comment configuration)
and an activation smoke command, `M: Show Language Tools Status`.

Not yet: tree-sitter syntax highlighting (P1), the `m lsp` client for
diagnostics and format-on-save (P2), hover/completion/symbols (P3), Test
Explorer and coverage gutters (P4). See the effort's
[proposal](../docs/proposals/pure-m-vscode/pure-m-vscode.md) and
[tracker](../docs/proposals/pure-m-vscode/pure-m-vscode-tracker.md).

## Design principle — thin client, fat toolchain

No M semantics live in this repo. Parsing comes from **tree-sitter-m** (WASM
grammar), and every analysis — lint, format, tests, coverage — comes from the
**`m` toolchain** over LSP. The extension is wiring: if a behaviour can be
implemented in `m lsp` instead of here, it belongs in `m lsp`.

## Org placement

**Non-waterline.** m-vscode carries no `m`/`v` layer artifact and is not in
`.github/ecosystem.json` — it is an editor client that never touches an M
engine itself (P4's engine features go through the `m` CLI, never through a
hand-rolled transport). It is registered in `workspace/repos.txt` and on
meta-gate's `REPOS_TXT_ALLOW`.

## Development

```bash
make install     # npm install + git hooks
make test        # node:test via tsx
make check       # lint + typecheck + test-cov + vuln + bundle + docs-gate (offline)
make vsix        # package the .vsix
```

Node 24 (`.node-version`, `engine-strict=true`). Full conventions: `CLAUDE.md`.

## License

**AGPL-3.0** (ruling D5) — this extension bundles the AGPL-licensed
tree-sitter-m grammar artifact from P1 onward, so the whole extension is AGPL.
Note this differs from the org's Apache-2.0 default and from vista-compass's
MIT. See [LICENSE](LICENSE).
