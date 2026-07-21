# m-vscode — M Language Tools (MUMPS)

A VS Code extension for **pure, portable M** — the language itself, on any M
engine, with **no VistA required**.

This is the third member of the vista-forge editor trio, and the only one that
is about the *language*:

| Extension | Answers |
|---|---|
| [`vista-compass`](../vista-compass) | what the VistA system measurably **IS** (the measured model) |
| [`vista-atlas`](../vista-atlas) | what the VA documentation **SAYS** (the gold corpus) |
| **`m-vscode`** (this) | the **M language itself** — syntax, diagnostics, formatting, tests, coverage |

## Status — P1, P2, P4 (syntax, language client, engine features)

Shipped here:

- the `mumps` language registration (id `mumps`, aliases `MUMPS`/`M`,
  extensions `.m`/`.mac`/`.int`, bracket + comment configuration);
- **AST syntax highlighting** — a VS Code semantic-tokens provider over the
  **tree-sitter-m** grammar (WASM, via `web-tree-sitter`), colouring M from the
  real parse tree rather than a regex approximation;
- an **`m lsp` client over stdio** giving **live diagnostics** and
  **formatting** (so `editor.formatOnSave` works) for M documents;
- a **Test Explorer** over `m test -o json` — suites discovered from
  `*TST.m`, per-`@TEST` cases, failed assertions with their expected/actual,
  and engine faults with routine + line + mnemonic;
- **coverage gutters** from real `m coverage --lcov` output;
- **`M: Execute Selection on the Engine`** over `m vista exec`, into its own
  *M Engine* output channel;
- an **engine status chip** in the status bar, fed by `m vista status`;
- a **lint-profile status item** naming the `.m-cli.toml` that governs the open
  M file — or warning that none does — with a one-click **`M: Configure M
  Profile`** that writes one (see below);
- commands `M: Show Language Tools Status`, `M: Restart Language Server`,
  `M: Execute Selection on the Engine`, `M: Check Engine Status`,
  `M: Configure M Profile`, `M: Open Project Configuration`.

Not yet: hover/completion/symbols (P3). See the effort's
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

### Engine features — through the `m` CLI, and only through it

The Test Explorer, coverage, *Execute Selection* and the status chip all reach
an engine by **shelling out to the `m` CLI**, which owns the driver seam
(m-driver-sdk → m-ydb / m-iris). There is no `docker exec`, no `mumps -direct`,
no `iris session` and no driver binary anywhere in this repo — that is the org's
transport monopoly, and here it is structural: `src/engine/run.ts` is the only
module that starts a process, and the only process it starts is `m`.

Everything above that boundary is pure and tested against **recorded real CLI
output** (`src/engine/fixtures/cli/`), and the boundary itself is tested against
a **fake `m` executable** — which is how `make check` covers the whole path
while staying offline and engine-free. The live dual-engine run is separate
acceptance evidence, not a gate.

**Failure is never silent.** Every way this can break — no `m` on `PATH`, no
Docker, a container that is not running, an engine that will not answer, a
held run-lock, a suite that will not compile, a coverage run that wrote no
tracefile — produces a message naming what failed *and* what to do about it.
The Test Explorer never shows an empty list in place of an error, coverage
never renders 0% in place of a failed measurement, and the status chip says
**unknown** rather than implying health it did not verify.

### The guarantee: editor diagnostics == CI diagnostics

The findings shown in the editor are the findings `m lint` produces — same rule
ids, same lines, same severities. That is not a claim, it is a **gate**:
`src/lsp/equivalence.e2e.test.ts` runs `m lint -o json` and a real `m lsp`
session over the same fixture project and requires an identical result. It runs
in `make check`, and it **fails** rather than skips when `m` is unavailable.

Both diagnostic dialects meet in exactly one module, `src/lsp/normalize.ts`
(LSP is 0-based, `m lint` is 1-based). Nothing else in this repo knows anything
about M.

### An unconfigured folder says so

With no `.m-cli.toml` anywhere up-tree, `m lint` applies an **unnamed default
rule set** and never names it — so an editor that just showed the findings
would be showing diagnostics from a profile nobody chose, silently. On
VistA-era code that default is actively wrong: it floods legacy routines with
modern-style findings.

So the extension always states which config governs the file in front of you.
The **M lint profile** language-status item (the `{}` icon in the status bar,
visible whenever an M file is active) reads either

- `profile: vista — .m-cli.toml` — with the full path of the governing file in
  its tooltip; or
- `no M profile configured — default rules in effect` — **warning-tinted**,
  with a **Configure…** button.

That button (`M: Configure M Profile`) writes a minimal `.m-cli.toml` into the
workspace root from one of two templates — **Modern M** (`[lint] rules =
"modern"`) or **VistA-era M** (`[lint] rules = "vista"`) — after which the
status item and the diagnostics both refresh. Both templates pin
`[fmt] rules = "identity"`: canonical formatting *rewrites* source, and nothing
written on your behalf should arm a rewrite of 40-year-old routines. An
existing `.m-cli.toml` is never overwritten — the command opens it instead.

The detection is the same up-tree walk m-cli itself does
(`src/config/discovery.ts` ports `config.FindConfig`, `.git` boundary
included), because the label is a claim about what the *server* resolved.

### Settings

| Setting | Default | Meaning |
|---|---|---|
| `mLanguageTools.enable` | `true` | run the language server at all |
| `mLanguageTools.serverPath` | `m` | path to the `m` executable |
| `mLanguageTools.serverArgs` | `["lsp"]` | arguments passed to it |
| `mLanguageTools.lint.profile` | `""` | profile override; empty = the project's `.m-cli.toml`, which is what keeps the editor and CI identical (see the note below) |
| `mLanguageTools.diagnostics.debounceMs` | `300` | delay before a keystroke burst is re-linted |
| `mLanguageTools.diagnostics.largeFileBytes` | `262144` | documents this size or larger lint on **save only** |
| `mLanguageTools.engine` | `ydb` | which engine the engine features reach (`ydb` \| `iris`) |
| `mLanguageTools.docker` | `""` | Docker container holding the engine (e.g. `vehu`, `foia-t12`); empty leaves the connection to the driver's own environment |
| `mLanguageTools.namespace` | `""` | IRIS namespace for test/coverage runs; ignored for YottaDB |
| `mLanguageTools.engine.lockWaitSeconds` | `30` | bounded wait for the engine run-lock before *Execute Selection* gives up and names the holder |

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
[`m-vscode-0.3.0.vsix`](m-vscode-0.3.0.vsix)). To install it:

```bash
code --install-extension m-vscode-0.2.0.vsix
```

Or from the Extensions view: **⋯ menu → Install from VSIX…** and pick the
file. To build your own copy instead of using the committed one, run
`make release` (below) and install the `.vsix` it produces.

**Runtime requirement:** syntax highlighting (tree-sitter-m, bundled in the
`.vsix`) works with no other install. Diagnostics, format-on-save, tests,
coverage and engine execution all need the **`m` executable on `PATH`** (it runs `m lsp` as a child process) — without it
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
engine itself (the engine features go through the `m` CLI, never through a
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
to a real `m lsp`. It stays offline and **engine-free**: no network at gate
time, and the engine features are exercised against a fake `m` executable, not
a live engine.

`make check-wasm` compares the vendored grammar against tree-sitter-m's
**committed HEAD**, not its working tree — a neighbouring session editing that
repo must not red this one's gate, and must certainly not have its uncommitted
bytes vendored into a release. Set `WASM_UPSTREAM_WORKTREE=1` for the one case
where the working tree is what you mean.

Node 24 (`.node-version`, `engine-strict=true`). Full conventions: `CLAUDE.md`.

## License

**AGPL-3.0** (ruling D5) — this extension bundles the AGPL-licensed
tree-sitter-m grammar artifact from P1 onward, so the whole extension is AGPL.
Note this differs from the org's Apache-2.0 default and from vista-compass's
MIT. See [LICENSE](LICENSE).
