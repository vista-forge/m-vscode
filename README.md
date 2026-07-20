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

## Status — P1 + P2 (syntax highlighting + language client)

Shipped here:

- the `mumps` language registration (id `mumps`, aliases `MUMPS`/`M`,
  extensions `.m`/`.mac`/`.int`, bracket + comment configuration);
- **AST syntax highlighting** — a VS Code semantic-tokens provider over the
  **tree-sitter-m** grammar (WASM, via `web-tree-sitter`), colouring M from the
  real parse tree rather than a regex approximation;
- an **`m lsp` client over stdio** giving **live diagnostics** and
  **formatting** (so `editor.formatOnSave` works) for M documents;
- commands `M: Show Language Tools Status` and `M: Restart Language Server`.

Not yet: hover/completion/symbols (P3), Test Explorer and coverage gutters
(P4). See the effort's
[proposal](../docs/proposals/pure-m-vscode/pure-m-vscode.md) and
[tracker](../docs/proposals/pure-m-vscode/pure-m-vscode-tracker.md).

### Syntax highlighting — consumed, never rebuilt

The grammar is **not built here**. `tree-sitter-m` builds and drift-gates the
`web-tree-sitter` artifact upstream; `make sync-wasm` vendors a byte-identical
copy into `assets/`, and `make check-wasm` (first step of `make check`) proves
that copy is neither hand-edited nor **stale** against the upstream checkout. A
second build in this repo would recreate exactly the divergence the upstream
gate exists to prevent.

Capture names from `highlights.scm` are translated to VS Code semantic token
types by one table, `src/highlight/mapping.ts` — the only M-adjacent knowledge
in the repo. An **unmapped capture renders as plain text with no error**, so the
mapping is gated from the query file itself, both statically (every name the
query declares) and empirically (every name it produces on a real routine).

Mid-typing buffers are the state an editor actually lives in, so they get their
own acceptance test: `src/highlight/typing-session.e2e.test.ts` replays 183
keystroke-level edits over a real corpus routine — including deliberately broken
states that produce ERROR trees — and forbids a crash, a hang, a tree collapse,
or the document losing its colour. Partial trees are *expected* and tolerated;
the test states exactly which is which.

### The guarantee: editor diagnostics == CI diagnostics

The findings shown in the editor are the findings `m lint` produces — same rule
ids, same lines, same severities. That is not a claim, it is a **gate**:
`src/lsp/equivalence.e2e.test.ts` runs `m lint -o json` and a real `m lsp`
session over the same fixture project and requires an identical result. It runs
in `make check`, and it **fails** rather than skips when `m` is unavailable.

Both diagnostic dialects meet in exactly one module, `src/lsp/normalize.ts`
(LSP is 0-based, `m lint` is 1-based). Nothing else in this repo knows anything
about M.

### Settings

| Setting | Default | Meaning |
|---|---|---|
| `mLanguageTools.enable` | `true` | run the language server at all |
| `mLanguageTools.serverPath` | `m` | path to the `m` executable |
| `mLanguageTools.serverArgs` | `["lsp"]` | arguments passed to it |
| `mLanguageTools.lint.profile` | `""` | profile override; empty = the project's `.m-cli.toml`, which is what keeps the editor and CI identical (see the note below) |
| `mLanguageTools.diagnostics.debounceMs` | `300` | delay before a keystroke burst is re-linted |
| `mLanguageTools.diagnostics.largeFileBytes` | `262144` | documents this size or larger lint on **save only** |

The last two mitigate the server's whole-document, non-cancellable lint
(proposal §7-R3): a 1 MB routine costs seconds per lint, so above the threshold
the extension deliberately stops linting as you type and says so in the *M
Language Tools* output channel — an explained downgrade beats a frozen editor.
`mLanguageTools.lint.profile` is inert until `m lsp` honours a client-supplied
profile (a P3 change in m-cli); until then the project config governs.

If `m` is not on `PATH` the extension says so, once, with the setting that
fixes it — it never fails silently.

## Installing the extension

Distribution is **local-first** (org rule 6: releases are annotated git tags
plus committed artifacts; no marketplace publishing yet — that is a separate,
deferred ruling, see the [tracker](../docs/proposals/pure-m-vscode/pure-m-vscode-tracker.md)).
The released `.vsix` is committed at the repo root as
`m-vscode-<version>.vsix` (currently
[`m-vscode-0.1.0.vsix`](m-vscode-0.1.0.vsix)). To install it:

```bash
code --install-extension m-vscode-0.1.0.vsix
```

Or from the Extensions view: **⋯ menu → Install from VSIX…** and pick the
file. To build your own copy instead of using the committed one, run
`make release` (below) and install the `.vsix` it produces.

**Runtime requirement:** syntax highlighting (tree-sitter-m, bundled in the
`.vsix`) works with no other install. Diagnostics and format-on-save need the
**`m` executable on `PATH`** (it runs `m lsp` as a child process) — without it
the extension says so once, in the *M Language Tools* output channel, and
names the setting (`mLanguageTools.serverPath`) that points it elsewhere.

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
make check       # check-wasm + lint + typecheck + test-cov + vuln + bundle + verify-bundle + docs-gate (offline)
make sync-wasm   # re-vendor the tree-sitter-m artifacts from ../tree-sitter-m
make check-wasm  # the vendored grammar is intact and not stale
make vsix        # package the .vsix (always rebuilds map-free before packaging)
make vsix-verify # package, then unzip and assert the bundle + grammar really shipped
make release     # clean + npm ci + full gate + no-sourcemap bundle + package + verify
```

`make check` requires the `m` toolchain on `PATH` — the equivalence gate talks
to a real `m lsp`. It stays offline: no network at gate time.

Node 24 (`.node-version`, `engine-strict=true`). Full conventions: `CLAUDE.md`.

## License

**AGPL-3.0** (ruling D5) — this extension bundles the AGPL-licensed
tree-sitter-m grammar artifact from P1 onward, so the whole extension is AGPL.
Note this differs from the org's Apache-2.0 default and from vista-compass's
MIT. See [LICENSE](LICENSE).
