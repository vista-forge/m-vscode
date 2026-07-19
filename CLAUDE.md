# m-vscode — repo rules

Adds to `~/vista-forge/CLAUDE.md` (org rules), which adds to `~/.claude/CLAUDE.md`.
Nothing here overrides either.

## What this repo is

**M Language Tools (MUMPS)** — a VS Code extension for **pure, portable M**.
No VistA, no `v` layer, no Kernel/FileMan/KIDS. It is the language client for
the `m` toolchain. Effort:
`../docs/proposals/pure-m-vscode/pure-m-vscode.md` (rulings D1–D6);
status: `../docs/proposals/pure-m-vscode/pure-m-vscode-tracker.md`.

## The governing principle — thin client, fat toolchain

**All M semantics live in the toolchain, never here.** Parsing = tree-sitter-m
(WASM). Lint/format/tests/coverage = `m lsp` and the `m` CLI. This repo owns
wiring, VS Code contribution points, and UI state — nothing else. If you catch
yourself writing an M tokenizer, a lint rule, or an engine call here, stop: it
belongs in `tree-sitter-m` or `m-cli`, and the fix is a toolchain change plus a
version bump here.

Corollary: **never reach an M engine from this repo.** P4's engine features
shell out to the `m` CLI, which owns the driver seam
(m-driver-sdk → m-ydb/m-iris). No transport is hand-rolled here.

## Org placement

**Non-waterline**: no `m`/`v` layer artifact, NOT in `.github/ecosystem.json`.
Registered in `workspace/repos.txt` and meta-gate's `REPOS_TXT_ALLOW`. The
`m-` prefix here reads as "the M language", matching the engine-neutral
m-toolchain family it clients for. Per-repo memory lives in `docs/memory/`.

## License — AGPL-3.0, deliberately

Ruling D5. The extension bundles the AGPL tree-sitter-m grammar WASM from P1
onward, so the extension is AGPL — **not** the org's Apache-2.0 default, and
not vista-compass's MIT. Do not "fix" the license to match the peers. Any new
dependency must be AGPL-compatible.

## Language-registration ownership (D2)

This repo is the owner of the `mumps` language id. `src/lang/contribution.ts`
is the source of truth; `package.json`'s `contributes.languages` block is a
projection of it, and `contribution.test.ts` red-gates drift between the two —
edit the constants, then the manifest, and let the test prove they match.

**Open coordination item:** `vista-compass` still registers `mumps` too, so
both extensions installed together double-register the language. Compass drops
its registration in a coordinated minor release (tracker step P1b). Do not edit
vista-compass from a session in this repo.

## Toolchain

Node 24 (`.node-version`, `.npmrc` `engine-strict=true`), TypeScript ESM,
Biome (lint + format), `node:test` + `tsx`, `c8` coverage, esbuild bundle,
`@vscode/vsce` packaging, `simple-git-hooks`.

```bash
make install     # npm install + hooks
make test        # fast inner loop
make test-watch  # TDD mode
make check       # THE GATE: lint + typecheck + test-cov + vuln + bundle + verify-bundle + docs-gate
make vsix        # package the extension
make vsix-verify # package, then unzip and assert what shipped
make log MSG=".."# append to docs/changelog.md
```

- **`make check` is offline** (de-GitHub directive). `vuln` is the shared
  air-gapped `../.github/scripts/vuln-scan.sh`; `npm audit` is NOT at gate time.
- **`make check` needs the `m` toolchain on `PATH`** — the equivalence gate
  (`src/lsp/equivalence.e2e.test.ts`) drives a real `m lsp` and a real
  `m lint`, and FAILS rather than skips if `m` is missing. It is the proof of
  the extension's core promise; never weaken it to a skip.
- **Run gates bare, never piped** — `make check | tail` returns tail's status
  and a red gate sails through.
- Only `npm install` / `npm ci` may touch the network, and only at sync time.

## Conventions

- **TDD is a hard rule**: failing test first, confirm red, implement, confirm
  green. Tests sit beside source (`foo.ts` ↔ `foo.test.ts`), table-driven.
- Source imports use `.js` specifiers (tsc NodeNext); test files import `.ts`.
  This is the house pattern — see vista-compass.
- Extension-host code (`src/ext/extension.ts`) stays thin glue; put anything
  worth testing in a pure module so it is testable without an extension host
  (`src/ext/status.ts` is the pattern).
- No `any`; `noUncheckedIndexedAccess` is on; ESM only; 2-space, single quotes,
  100 cols (Biome decides — don't argue with it).
- Commit `package.json` and `package-lock.json` together.

## Git

Trunk-based per the org Increment Protocol: gates green locally, then commit
straight to `main`. The GitHub remote (`vista-forge/m-vscode`) exists and is
wired, so verified increments push.
