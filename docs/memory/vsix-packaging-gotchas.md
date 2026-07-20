# vsix packaging gotchas

## `.vscodeignore` and `files` are mutually exclusive

`vsce package` hard-errors when a repo has **both** a `.vscodeignore` file and a
`"files"` array in `package.json`:

> ERROR Both a .vscodeignore file and a "files" property in package.json were
> found. VSCE does not support combining both strategies.

The two org peers disagree, so copying "the house pattern" from both at once
produces exactly this break: **vista-atlas uses `.vscodeignore`**, **vista-compass
uses `files`**. m-vscode follows compass — `files` in `package.json`, no
`.vscodeignore`. If a future need calls for `.vscodeignore` (e.g. an allow-list
over a large `media/` tree), delete `files` in the same change.

## Verify the package offline, by reading it

An extension's contribution points only take effect as they were *packaged* —
the manifest inside the `.vsix`, after `files`/`.vscodeignore` filtering. Assert
that, rather than trusting the source manifest or a GUI:

```bash
unzip -p m-vscode-<version>.vsix extension/package.json | python3 -m json.tool
unzip -l m-vscode-<version>.vsix   # is language-configuration.json actually in there?
```

This is the GUI-free proof that `.m`/`.mac`/`.int` map to language id `mumps`
and that the referenced `language-configuration.json` shipped with it — a
`configuration` path that got filtered out of the package fails silently at
runtime (no error, just no bracket/comment behaviour).

## A bundled runtime dep is invisible to every other gate

`files: ["dist", …]` + `vsce package --no-dependencies` means a runtime
dependency reaches the user **only if esbuild bundled it in**. Leave
`vscode-languageclient` external and the `.vsix` still builds, still installs,
and then does nothing at activation — no error anywhere. Nothing else catches
this: `npm test` runs from `node_modules`, `tsc` type-checks against it, and
`vsce` is happy.

So the bundle gets its own gate, `scripts/verify-bundle.mjs` (in `make check`):
the bundle must export `activate`/`deactivate`, must contain `LanguageClient`,
and must `require()` **nothing outside Node builtins + `vscode`**. That last
check is the general one — it catches the next unbundled dep too. Proved to
fail by re-bundling with `--external:vscode-languageclient/node.js`.
`make vsix-verify` repeats the assertion against the packaged archive itself.

## `vscode-languageclient` has no `exports` map — import `node.js`, with the extension

Under `module: NodeNext`, `import … from 'vscode-languageclient/node'` fails
with **TS2307** (and then cascading TS7006 implicit-`any` on every middleware
callback, which is a red herring — fix the specifier and they all vanish). The
package predates `exports`, so ESM subpath resolution needs the real filename:
**`'vscode-languageclient/node.js'`**.

## TypeScript import specifiers: `.js` in source, `.ts` in tests

Under `module: NodeNext` without `allowImportingTsExtensions`, a source file
importing `'./foo.ts'` fails `tsc --noEmit` with **TS5097**. The house pattern
(same in vista-compass) is: **source files import `./foo.js`**, **test files
import `./foo.ts`** (tsx resolves both). Tests are excluded from `tsconfig.json`,
which is why the asymmetry type-checks.

## ⭐ The product is the CJS bundle, not the ESM source — `import.meta.url` dies in it

**Unit tests ran the extension as real ESM while the shipped product ran as
CJS, and the two disagreed for a month with every gate green.** Symptom, only
ever visible inside a real Extension Host:

```
[highlight] M syntax highlighting failed to start: The argument 'filename' must
be a file URL object, file URL string, or absolute path string. Received undefined
```

Mechanism: `web-tree-sitter` is a **dual-build** package — its `exports` map
offers an ESM build (reads `import.meta.url`) under the `import` condition and a
CJS build (uses `__dirname`) under `require`. **esbuild picks the condition from
the syntax of the import, not from `--format`**, so an `import { Parser } from
'web-tree-sitter'` pulls the *ESM* build into our *CJS* output; esbuild then
rewrites the meaningless `import.meta` to `{}`, and emscripten's node bootstrap
dies on `createRequire(undefined)`.

Three things about this are worth keeping:

- **The throw site is `createRequire`, from `node:module` — not
  `fileURLToPath`.** The two produce *different* messages (`ERR_INVALID_ARG_VALUE`
  "The argument 'filename' must be…" vs `ERR_INVALID_ARG_TYPE` "The \"path\"
  argument must be…"). The reported message identifies which one fired; that
  distinction is what proved the crash is at **module init**, and therefore that
  `Parser.init({locateFile})` could never have rescued it (the runtime never gets
  far enough to consult `locateFile`) and that loading the grammar from bytes
  addresses the wrong layer entirely. Read the message, don't pattern-match it.
- **Fix = give the CJS output a truthful `import.meta.url`** — an esbuild
  `banner` defining `pathToFileURL(__filename).href` plus
  `define: {'import.meta.url': …}`, in `scripts/bundle.mjs`. Chosen over aliasing
  to `tree-sitter.cjs` (hardcodes a dependency-private filename a version bump may
  rename, and fixes only that one package). Strictly additive: asset staging,
  artifact-sha pinning and `check-wasm` all untouched.
- **Bundle only through `scripts/bundle.mjs`.** A direct `esbuild` call silently
  drops the shim; `verify-bundle.mjs` reds on a bundle containing esbuild's empty
  `import.meta` stub, which is the offline half of the guard.

**The general lesson (the expensive one): green unit tests are not evidence the
product works, when the tests and the product are built differently.** Anything
that resolves its own location — wasm loaders, native bindings, worker spawners
— behaves differently in the bundle and must be proven *in the host*. And a
smoke suite must assert a feature's **own output** (highlighting emitted N
semantic tokens), never that the extension *activated*: activation succeeded the
entire time highlighting was dead, because `provider.ts` correctly caught the
error and carried on.
