# Memory index — m-vscode

Per-repo durable memory (committed with the code, per the org CLAUDE.md memory
rules). One line per entry; detail in the topic file. Durable lessons only —
conventions live in `CLAUDE.md`, status lives in the effort tracker.

## Lessons (durable)
- [⚠️ vsix packaging gotchas](vsix-packaging-gotchas.md) — vsce REFUSES `.vscodeignore` + `files` together (peers disagree: atlas uses one, compass the other); verify a package offline by unzipping its `extension/package.json`, not by eye. **P2:** an unbundled runtime dep is invisible to every other gate → `scripts/verify-bundle.mjs`; `vscode-languageclient/node.js` needs the `.js` (no `exports` map).
- [⚠️ LSP client seams](lsp-client-seams.md) — the 4 places editor and CI diagnostics can silently disagree: 0- vs 1-based coordinates · config discovery from CWD (CLI) vs document dir (server) · server hardcodes canonical formatting · fixtures must not be auto-formatted. A gate run from the wrong CWD is green and meaningless.
