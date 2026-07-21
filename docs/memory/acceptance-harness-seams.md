# Acceptance-harness seams (E3) — measure on the instrument the budget was ratified on

The E3 matrix harness (`src/smoke/acceptance-run.ts` + `acceptance.ts`, `make
accept-installed`, installed-mode only) exposed two measurement seams that will
bite any future perf gate here:

- **A latency budget belongs to its instrument.** The ratified live-lint
  budget (p95 ≤ 600 ms per didChange, <256 KiB) was set on the W0-c
  **LSP-layer** didChange→publish measurement. The in-host end-to-end number
  (applyEdit → diagnostics event) additionally carries **~350 ms of host-side
  cost at ~137 KB** — highlighter re-tokenization per edit plus conversion/
  dispatch of ~750 diagnostics — and reds a green server (measured: LSP layer
  p95 390 ms, in-host 650–755 ms, same doc, same binary). The gate therefore
  runs on a headless `LspSession` against the same `m` binary the extension
  launches (`session.changeAndAwaitDiagnostics`), and the end-to-end
  counterpart is **recorded as telemetry** (`info.a3EndToEndP95Ms`), never
  silently substituted. Suspect-the-metric order held: verify the effective
  debounce FIRST (the suite records `a3EffectiveDebounceMs` — workspace
  `.vscode/settings.json` does apply under `@vscode/test-electron`).

- **Publish latency is finding-density-bound (W0-c item 4), and the corpus
  has ~70 findings/KB outliers** (`_zewdGTM.m`). An assembled fixture that
  cycles dense files measures a different instrument than the ratified curve
  (~9.5 findings/KB). The live document is density-calibrated by a
  deterministic rule (sorted ewd files, ≤ 12 findings/KB under the profile
  the workspace will actually use — measured on a scratch COPY, since lint
  in-corpus resolves the corpus's own `.m-cli.toml`), no parse-reds,
  first-fit to ≥ 128 KiB.

Smaller seams, same harness:

- An **empty→empty diagnostics publish may fire no
  `onDidChangeDiagnostics` event** — openAndAwaitPublish treats the missing
  event as "no measurement", not a failure, or every clean file costs a
  timeout.
- **Criteria are recorded rows, not bare asserts** (`CriterionRow` with
  measured-vs-budget), so a red is a finding with evidence and the scenario
  keeps recording the remaining criteria; a crashed host surfaces as an
  explicit FAIL row ("scenario completed and recorded evidence").
- The A2 loudness criterion is **CLI-parity + M-INTERNAL-PARSE present**, not
  "all diagnostics are parse errors" — the vista profile legitimately reports
  XINDX findings on the parseable lines of a parse-broken file (DINVMSM: 17
  parse + 3 XINDX, identical on both sides).
