# Memory index — m-vscode

Per-repo durable memory (committed with the code, per the org CLAUDE.md memory
rules). One line per entry; detail in the topic file. Durable lessons only —
conventions live in `CLAUDE.md`, status lives in the effort tracker.

## Lessons (durable)
- [⚠️ vsix packaging gotchas](vsix-packaging-gotchas.md) — vsce REFUSES `.vscodeignore` + `files` together (peers disagree: atlas uses one, compass the other); verify a package offline by unzipping its `extension/package.json`, not by eye. **P2:** an unbundled runtime dep is invisible to every other gate → `scripts/verify-bundle.mjs`; `vscode-languageclient/node.js` needs the `.js` (no `exports` map).
- [⚠️ LSP client seams](lsp-client-seams.md) — where editor and CI diagnostics can silently disagree. ⭐ **Columns differ in ORIGIN _and_ UNIT** (`m lint` = 1-based BYTES, LSP = UTF-16 code units) — `character + 1` is right only on ASCII, so an ASCII-only fixture set made the equivalence gate structurally unable to fail on a live encoding bug. Convert through the DOCUMENT TEXT, never compare the two columns directly, and keep the non-ASCII fixture guard. Config discovery + formatting-preset seams are CLOSED (per-file on both sides; `[fmt] rules` honored) and now GATED — `fixtures/format/.m-cli.toml` must pin `canonical` or the write-side gate compares two no-ops. A gate that cannot fail is not a gate.
