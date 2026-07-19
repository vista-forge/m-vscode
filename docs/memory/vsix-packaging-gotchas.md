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

## TypeScript import specifiers: `.js` in source, `.ts` in tests

Under `module: NodeNext` without `allowImportingTsExtensions`, a source file
importing `'./foo.ts'` fails `tsc --noEmit` with **TS5097**. The house pattern
(same in vista-compass) is: **source files import `./foo.js`**, **test files
import `./foo.ts`** (tsx resolves both). Tests are excluded from `tsconfig.json`,
which is why the asymmetry type-checks.
