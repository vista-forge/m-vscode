import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Language, Parser } from 'web-tree-sitter';

/**
 * Load the tree-sitter-m grammar for the editor.
 *
 * CONSUME, NEVER REBUILD. The artifact is built and drift-gated upstream in
 * `tree-sitter-m` (`make wasm` / `make check-wasm-drift`); this repo vendors a
 * byte-identical copy under `assets/` via `make sync-wasm`, and
 * `scripts/check-wasm.mjs` proves the copy is neither edited nor stale. A
 * second build here would recreate exactly the divergence the upstream gate
 * closed — and that gate fired on a real grammar change on 2026-07-19.
 */

/** Thrown when a shipped asset is absent or unreadable — never swallowed. */
export class GrammarArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrammarArtifactError';
  }
}

export interface GrammarPaths {
  /** The tree-sitter-m grammar, standard web-tree-sitter export set. */
  readonly grammarWasm: string;
  /** `highlights.scm`, vendored from the same upstream commit. */
  readonly highlightsQuery: string;
  /** The upstream build manifest — sha, size, grammar version, toolchain. */
  readonly manifest: string;
  /**
   * Where `web-tree-sitter`'s own runtime `tree-sitter.wasm` lives. Needed only
   * once the extension is bundled: esbuild inlines the emscripten glue into
   * `dist/extension.cjs`, which moves it away from its sibling `.wasm`. Left
   * undefined, emscripten's own resolution (node_modules) applies, which is
   * what the tests use.
   */
  readonly runtimeDir?: string;
}

export function defaultGrammarPaths(baseDir: string): GrammarPaths {
  const assets = join(baseDir, 'assets');
  return {
    grammarWasm: join(assets, 'tree-sitter-m.wasm'),
    highlightsQuery: join(assets, 'highlights.scm'),
    manifest: join(assets, 'tree-sitter-m.wasm.json'),
  };
}

export interface LoadedGrammar {
  readonly language: Language;
  readonly highlights: string;
  readonly artifactSha256: string;
  readonly grammarVersion: string;
}

let initialised: Promise<void> | undefined;

export async function loadGrammar(paths: GrammarPaths): Promise<LoadedGrammar> {
  requirePresent(paths.grammarWasm, 'the tree-sitter-m grammar');
  requirePresent(paths.highlightsQuery, 'the highlight query');
  requirePresent(paths.manifest, 'the artifact manifest');

  // `Parser.init` is process-global and must run exactly once.
  initialised ??= Parser.init(
    paths.runtimeDir
      ? { locateFile: (name: string) => join(paths.runtimeDir as string, name) }
      : {},
  );
  await initialised;

  let language: Language;
  try {
    language = await Language.load(paths.grammarWasm);
  } catch (cause) {
    throw new GrammarArtifactError(
      `Failed to load the M grammar from ${paths.grammarWasm}: ${(cause as Error).message}. ` +
        'The file exists but web-tree-sitter rejected it — most likely an ABI mismatch ' +
        'between the vendored artifact and web-tree-sitter. Re-run `make sync-wasm` and ' +
        '`make check-wasm`; if both are clean the version pair in package.json is wrong.',
    );
  }

  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8')) as {
    artifact_sha256: string;
    grammar_version: string;
  };
  return {
    language,
    highlights: readFileSync(paths.highlightsQuery, 'utf8'),
    artifactSha256: manifest.artifact_sha256,
    grammarVersion: manifest.grammar_version,
  };
}

function requirePresent(path: string, what: string): void {
  if (existsSync(path)) return;
  throw new GrammarArtifactError(
    `M syntax highlighting is unavailable: ${what} is missing at ${path}. ` +
      'Run `make sync-wasm` to vendor it from the tree-sitter-m checkout beside this repo ' +
      '(never `tree-sitter build` here — the artifact and its drift gate live upstream). ' +
      'If this is an installed .vsix, the asset was filtered out of the package: check the ' +
      '`files` array in package.json and re-run `make vsix-verify`.',
  );
}
