# Syntax-highlighting seams — where colour goes missing silently

Durable lessons from P1-downstream (2026-07-19). Status lives in the effort
tracker; conventions live in `CLAUDE.md`. These are the things that would cost a
day to rediscover.

## Every failure in this path is SILENT — that shapes the whole design

There is no error state for "this text was not coloured". A missing mapping, a
missing asset, a stale grammar and a theme that simply chose grey all render
identically. So each one gets an explicit gate rather than a runtime check:

| Failure | Symptom | Gate |
|---|---|---|
| capture name has no token-type mapping | that construct is plain text | `mapping.test.ts`, derived from `highlights.scm` |
| mapping exists but the query stopped producing the name | dead entry, nothing visibly wrong | same test, reverse direction |
| token type is not a standard VS Code type | uncoloured for *some* themes only | legend asserted against the standard set |
| asset filtered out of the `.vsix` | extension installs, colours nothing | `verify-bundle.mjs` + `make vsix-verify` |
| vendored grammar goes stale vs upstream | editor colours by a grammar CI abandoned | `scripts/check-wasm.mjs` |
| grammar fails to load at runtime | uncoloured editor, no message | `GrammarArtifactError` → output channel **and** `showErrorMessage` |

The coverage gate is deliberately **two-sided**: static (every name the query
file declares) *and* empirical (every name it actually produces on a real
routine). Either alone passes while colour is missing — a name only reachable at
runtime, or a mapping for a pattern that no longer matches.

## web-tree-sitter reports columns in UTF-16 code units — measured, not assumed

VS Code semantic tokens are addressed in UTF-16 code units; tree-sitter's C core
counts bytes. `web-tree-sitter` converts, so **no conversion is needed here** —
but that is a fact about a dependency, and on ASCII the two numbers are equal,
so a regression would be invisible. `fixtures/ZZUNICODE.m` carries 2-, 3- and
4-byte characters *before* captured tokens, expected columns are derived from
the document text (JS strings are UTF-16), and a guard assertion fails if the
fixture is ever flattened to ASCII. Same discipline as the LSP side's `ZZUNI.m`
— see [[lsp-client-seams]]. **Do not** reuse the LSP path's byte↔UTF-16
conversion here: the two producers genuinely differ, and applying `m lint`'s
byte columns to tree-sitter's would corrupt colour on every non-ASCII line.

## Tree-sitter captures NEST; VS Code tokens must not overlap

`(postconditional)` spans `:X=1` while `X` and `=` inside it are captured too.
Picking a winner pairwise needs an ordering that is transitive, and it isn't.
`paint.ts` instead **paints** captures onto the characters they cover, widest
first, so the most specific capture over any character survives; contiguous
characters with the same (type, modifiers) then coalesce. Non-overlapping by
construction rather than by assertion, and it makes the wide-node captures
(`postconditional`, `format_control`) do the right thing for free — they colour
only the gaps their children do not.

## Node kinds moved 1019 → 1020 and nothing upstream noticed

`8a3c0b2` (the single-space-comment fix) added the `_sp_comment` external token,
moving the grammar's node-type count. Upstream's loader test asserts only
`> 900`, so it stayed green, and "1019" outlived its truth in the S1 spike
notes, the P1-upstream log and the P1-downstream kickoff. **A number quoted in
three documents is not three confirmations of it.** This repo pins the exact
count, which is what surfaced the move.

## Only two things are needed at runtime, and one is not ours

`web-tree-sitter` ships its own emscripten runtime `tree-sitter.wasm` alongside
the JS glue. esbuild inlines the glue into `dist/extension.cjs`, which moves it
away from its sibling `.wasm` — so the runtime must be staged into `dist/assets`
and pointed at via `Parser.init({ locateFile })`. Resolve it as
`require.resolve('web-tree-sitter/tree-sitter.wasm')`: the package's `exports`
map deliberately does **not** expose `./package.json`, so the usual
resolve-the-manifest-then-`join` idiom throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## A mid-typing fixture has to be able to fail

`typing-session.e2e.test.ts` asserts that at least 20 of its steps produced an
ERROR tree. Without that, a fixture that only ever visits valid states passes
forever while proving nothing about error recovery. Measured today: **183 steps,
26 with ERROR trees**, worst whole-document token count **554/556**, slowest
step **2.4 ms** — i.e. tree-sitter-m's default error recovery is, on this
evidence, entirely adequate for live editing (R1 is not a live risk).

The colour-loss invariant needs **two forms**, and conflating them produced a
false red: while text is being appended the meaningful window is "lines already
typed" (each window keeping its own high-water mark — comparing a 10-line window
against a 130-line window's best measures the window, not the highlighter); once
the document is whole the interesting failure is the whole file going dark, so
the measure is total tokens against a cold parse.
