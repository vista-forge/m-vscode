---
name: profile-surface-seams
description: The lint-profile surface — mirroring m-cli's config walk, why a config write needs a client restart, and how to assert a LanguageStatusItem from a smoke suite
metadata:
  type: project
---

# Profile-surface seams (E2 / acceptance matrix A5)

Durable lessons from wiring the "which profile governs this file?" surface.
Status lives in the effort tracker; conventions live in `CLAUDE.md`.

## The label is a claim about the SERVER, so the walk must be the server's walk

`m lsp` does not echo its effective profile (checked 2026-07-21: `serverInfo`
is `{"name":"m"}` and nothing else carries it), so the client detects the
governing config itself — `src/config/discovery.ts` ports m-cli's
`internal/config.FindConfig`. Two details are easy to get wrong and both change
the answer:

- the walk **stops at a `.git` boundary** (a config above a repo does not
  govern it), and
- the **per-level config check runs BEFORE that boundary check**, so a config
  sitting beside `.git` is still found.

`.m-cli.toml` beats a same-level `pyproject.toml`, and a `pyproject.toml`
counts only when it really carries a `[tool.m-cli]` table. A client walk that
disagrees with the server produces a confident WRONG label — worse than no
label, which is the whole failure A5 exists to kill. If m-cli ever gains a
profile echo, that becomes the source and this walk becomes the fallback.

## Writing a config does not re-lint anything by itself

`m lsp` caches a linter per governing-config path, stamped with that file's
mtime+size, and rebuilds it when the stamp moves — but only when something asks
it to lint, i.e. on `didOpen`/`didChange`. Writing a `.m-cli.toml` while
documents are already open therefore changes NOTHING on screen until the
client restarts (which re-sends `didOpen` for every open document). Red-proved
2026-07-21: with the restart suppressed, the in-host assertion "diagnostics
refresh under the newly written vista profile" times out at 60 s while the
status label still flips — i.e. **the label alone is not evidence the rules
changed**, which is exactly why the smoke suite asserts real diagnostics too.

## A LanguageStatusItem is invisible to any other extension

There is no API to enumerate another extension's language-status items, so the
in-host suite cannot read the surface the way it reads hovers or diagnostics
(`vscode.execute*Provider`). The seam used instead: `activate()` returns a
small API object exposing the item's own live `text`/`detail`/`severity` plus
the directory the state was resolved for — **state only, never a setter**, or a
test could set the state it then asserts. Same spirit as the highlighting rule:
a feature is proven by its own output, never by its activation.

## The remedy writes bytes into a user's project — prove the toolchain accepts them

m-cli treats a near-miss key or an unknown `[fmt] rules` preset as a HARD error
(T0-6/T2-9), so a wrong template would leave a project *worse* than
unconfigured — `m lint` refusing to run at all. `templates.e2e.test.ts` runs the
real `m lint` over each written template and requires it to select the same
rules as `--profile <name>`; both templates pin `[fmt] rules = "identity"`,
because `canonical` rewrites source and nothing written on a user's behalf
should arm that on legacy routines.
