# Memory index — m-vscode

Per-repo durable memory (committed with the code, per the org CLAUDE.md memory
rules). One line per entry; detail in the topic file. Durable lessons only —
conventions live in `CLAUDE.md`, status lives in the effort tracker.

## Lessons (durable)
- [⚠️ vsix packaging gotchas](vsix-packaging-gotchas.md) — vsce REFUSES `.vscodeignore` + `files` together (peers disagree: atlas uses one, compass the other); verify a package offline by unzipping its `extension/package.json`, not by eye.
