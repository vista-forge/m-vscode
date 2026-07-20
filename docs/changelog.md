# Build log — m-vscode

Chronological narrative of *why* the project got to its current shape.
Complements `git log` (which captures *what* per-commit) with rationale,
trade-offs, things tried and reverted, and explicit deferrals.

`make log MSG="..."` appends a dated stub. Newest entries at the bottom.

## 2026-07-19 — P0 scaffold

Scaffolded from the vista-compass/vista-atlas house pattern: TS/ESM, esbuild,
Biome, node:test + c8, @vscode/vsce, Node 24. Registered the `mumps` language
id (D2) and the AGPL-3.0 license (D5, the extension bundles the AGPL
tree-sitter-m WASM from P1 onward). Non-waterline, registered in
`repos.txt`.

## 2026-07-19 — P2 language client

Wired `vscode-languageclient` to `m lsp` over stdio: diagnostics and
format-on-save. The equivalence gate (`equivalence.e2e.test.ts`) drives a
real `m lsp` and a real `m lint` and requires the two to agree — the
extension's core promise. Tier 1 hardening closed three parity defects the
gate could not originally catch (byte vs UTF-16 columns, per-file config
resolution, unverified formatting) — see `docs/memory/lsp-client-seams.md`
for the full account.

## 2026-07-20

P1-downstream: AST syntax highlighting. Semantic-tokens provider over the vendored tree-sitter-m WASM grammar (consumed from upstream, never rebuilt); capture-mapping coverage gated from highlights.scm itself; R1 typing-session fixture (183 keystroke steps, 26 with ERROR trees) forbidding crash/hang/tree-collapse/colour-loss; check-wasm staleness gate; grammar assets asserted inside the .vsix.

## 2026-07-20

P4 — engine features. Test Explorer over "m test -o json" (suites from *TST.m,
per-@TEST cases, failed assertions with expected/actual, engine faults with
routine + line + mnemonic); coverage gutters from real "m coverage --lcov"
output; "M: Execute Selection on the Engine" over "m vista exec" into its own
output channel; an engine status chip from "m vista status" that says UNKNOWN
rather than implying health it did not verify. Every engine call shells out to
the m CLI - src/engine/run.ts is the only process boundary in the repo, and the
only process it starts is m. Offline gate: recorded real CLI output in
src/engine/fixtures/cli/ plus a fake m executable, so make check needs no engine
and no network. Live dual-engine acceptance green on vehu (YottaDB) and foia-t12
(IRIS): 3/3 assertions, 2/2 cases, coverage 2/2 lines with real gutter data,
exec and status both healthy.

Also: re-vendored the tree-sitter-m grammar at 0d41453 (IRIS abbreviations, node
kinds 1020 -> 1170); check-wasm now compares against tree-sitter-m's committed
HEAD rather than its working tree, so a concurrent session editing that repo can
neither red this gate nor have its uncommitted bytes vendored into a release
(WASM_UPSTREAM_WORKTREE=1 restores the old behaviour); the diagnostic
equivalence gate now compares LSP severity NUMBERS, because m lsp publishes both
style and info as Information (3) and the wire value can no longer be inverted
to a name. v0.1.0 -> v0.2.0.

## 2026-07-20

P3-feat Session B — wire the m lsp client to hover, completion, documentSymbol
and foldingRange. `vscode-languageclient`'s built-in features (HoverFeature,
CompletionItemFeature, DocumentSymbolFeature, FoldingRangeFeature) already
register VS Code providers from the server's advertised capabilities with no
extra client code needed — confirmed by reading `registerBuiltinFeatures` in
the library itself. The equivalence gate's capability assertion (previously
pinning hover/completion ABSENT, correct through P2) now pins the P3-feat set
present and its exact shape; red-proofed (rc 1 -> 0). Added
`capabilities.e2e.test.ts`, extending the headless `LspSession` with
hover/completion/documentSymbol/foldingRange methods, proving each answers
with real content over the wire — including the per-engine provenance
sentence on `$ZATRANSFORM` verbatim from the server, never reworded
client-side.

Added a real VS Code smoke suite (`src/smoke/`, `@vscode/test-electron`
against the installed `/usr/share/code/code`, no download) driving
`vscode.execute{Hover,CompletionItem,DocumentSymbol,FoldingRange}Provider`
against the bundled extension end to end — the first time this extension has
run inside a real Extension Host. It immediately found a genuine defect:
`client.ts` set `transport: TransportKind.stdio` explicitly in
`ServerOptions`, which makes `vscode-languageclient` append `--stdio` to the
server's argv (a convention for servers that support multiple transports).
`m lsp` has no such flag and exited with a USAGE error, which
`vscode-languageclient` surfaced only as an opaque "Pending response rejected
since connection got disposed" — no indication anywhere that the flag was
the cause. Fixed by omitting `transport` (stdio is already this
`ServerOptions` shape's default, without the flag). Red-proofed against the
smoke suite itself (rc 1 -> 0): planting `transport: TransportKind.stdio`
back reproduces the exact original crash.

While investigating, also found (by code review, not by reproduction) that
`extension.ts`'s `restart()` had no reentrancy guard — a `didChangeConfiguration`
event racing the initial activation restart could dispose a still-starting
client. The smoke suite's output-channel capture confirms this did NOT
actually fire during the `--stdio` repro (`started \`m lsp\`` appears exactly
once), so it was not the cause of the observed crash — but it is a real
latent hazard, closed on principle (`src/ext/serialize.ts`, unit-tested) since
a silently dead extension is exactly the failure class this repo forbids. The
smoke suite now asserts the client starts exactly once, as a permanent
regression guard.

`positionEncoding: utf-16` confirmed negotiated correctly:
`vscode-languageclient` 9.0.1 hardcodes `general.positionEncodings =
['utf-16']` in its client capabilities and throws if a server ever advertises
anything else — so the existing UTF-16 column gates in `normalize.ts` needed
no change.

`make check` green and offline throughout (rc 0); `make release` produces a
verified `.vsix`. Version stays v0.2.0 — the coordinator's `v0.2.0` tag
already points at this line of work in progress, and both the version bump
and any tagging decision stay explicit operator actions, per the kickoff's
"do not bump to 1.0 — that is an explicit operator decision after §8 is
verified."
