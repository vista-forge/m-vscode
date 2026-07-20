# highlight fixtures

- **`ZZDAEMON.m`** — byte-identical copy of `m-modern-corpus/ewd/_zewdDaemon.m`
  (EWD, the m-modern corpus). A *real* routine, deliberately not a synthetic
  one: it parses clean (`hasError=false`) and produces 13 of the 14 capture
  names `highlights.scm` defines, across 510 captures. Used by the token tests
  and as the typed text of the R1 typing session. Do not tidy it — its value is
  that nobody wrote it for this test.

- **`ZZUNICODE.m`** — the **column-unit oracle**. Contains 2-, 3- and 4-byte
  UTF-8 characters *before* captured tokens on the same line, so a column
  reported in bytes and a column reported in UTF-16 code units are different
  numbers. `wasm.test.ts` derives the expected columns from the document text
  and asserts the parser's, plus a guard that this file stays non-ASCII —
  "simplifying" it to ASCII reds the gate instead of silently restoring the
  blind spot. Same discipline as `src/lsp/fixtures/utf16/ZZUNI.m` (see
  `docs/memory/lsp-client-seams.md`).
