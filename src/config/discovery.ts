/**
 * Which project config governs a file — a faithful port of m-cli's
 * `internal/config.FindConfig`.
 *
 * The client repeats this walk rather than inventing its own notion of
 * "project" because the answer is a CLAIM ABOUT THE SERVER: the profile
 * surface tells the user which file the diagnostics in front of them came
 * from. A different walk here would produce a confident, wrong label — the
 * exact silent-wrong-profile failure A5 exists to kill. `m lsp` (P3+) does not
 * yet echo its effective profile, so detection is client-side; when it does,
 * this becomes the fallback rather than the source.
 *
 * Ported behaviours, including the two that are easy to miss: the walk stops
 * at a `.git` boundary, and the per-level config check runs BEFORE that
 * boundary check, so a config sitting beside `.git` is still found.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** The preferred project-local config file (m-cli `ConfigFilename`). */
export const CONFIG_FILENAME = '.m-cli.toml';
/** The Python-packaging fallback (m-cli `PyprojectFilename`). */
export const PYPROJECT_FILENAME = 'pyproject.toml';

/**
 * The three filesystem questions the walk asks. Injectable so the port is
 * table-tested against an in-memory tree instead of a scatter of temp dirs.
 */
export interface FileSystemProbe {
  isFile(path: string): boolean;
  exists(path: string): boolean;
  read(path: string): string | undefined;
}

export const nodeFileSystem: FileSystemProbe = {
  isFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  exists: (path) => {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
  read: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
};

/**
 * Does this `pyproject.toml` carry a `[tool.m-cli]` table?
 *
 * m-cli decodes the TOML and asks whether `tool` has an `m-cli` key. With no
 * TOML parser in this extension (a dependency for one predicate is a poor
 * trade) the same question is answered structurally: a `[tool.m-cli…]` section
 * header, or an `m-cli =` key inside a `[tool]` table. Both forms are what
 * real files use; a bare mention in a comment is deliberately not enough.
 */
export function pyprojectGoverns(text: string): boolean {
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (header?.[1] !== undefined) {
      section = header[1].replace(/["']/g, '').replace(/\s+/g, '');
      if (section === 'tool.m-cli' || section.startsWith('tool.m-cli.')) return true;
      continue;
    }
    if (section === 'tool' && /^(?:m-cli|["']m-cli["'])\s*=/.test(line)) return true;
  }
  return false;
}

/**
 * The path of the config file governing `start` (a directory, or a file whose
 * directory is used), or undefined when nothing does.
 */
export function findConfig(
  start: string,
  fs: FileSystemProbe = nodeFileSystem,
): string | undefined {
  let current = isAbsolute(start) ? start : resolve(start);
  if (fs.isFile(current)) current = dirname(current);
  for (;;) {
    const local = join(current, CONFIG_FILENAME);
    if (fs.isFile(local)) return local;
    const py = join(current, PYPROJECT_FILENAME);
    if (fs.isFile(py) && pyprojectGoverns(fs.read(py) ?? '')) return py;
    // The boundary check comes AFTER the per-level check, exactly as m-cli
    // orders it: a config beside `.git` governs its own repo.
    if (fs.exists(join(current, '.git'))) return undefined;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
