/**
 * The single source of truth for this extension's M language registration.
 *
 * `package.json`'s `contributes.languages` block is a PROJECTION of these
 * constants — `contribution.test.ts` red-gates any drift between the two, so
 * the manifest can never silently diverge from what the code believes.
 *
 * File types follow tree-sitter-m's own set (`m`/`mac`/`int`) rather than the
 * `.m`-only set vista-compass shipped: `.mac`/`.int` are the IRIS source and
 * intermediate forms, and this extension is the M language owner (ruling D2).
 */

export const MUMPS_LANGUAGE_ID = 'mumps';

export const MUMPS_ALIASES = ['MUMPS', 'M'] as const;

/** Lowercase, dot-prefixed. Order matches `package.json`. */
export const MUMPS_EXTENSIONS = ['.m', '.mac', '.int'] as const;

/**
 * True when `path` names a file this extension claims by extension.
 *
 * Accepts both POSIX and Windows separators, and is case-insensitive (`.M` is
 * a routine on a case-insensitive filesystem). A bare dotfile whose whole
 * basename is the extension (`.m`) is NOT claimed — it has no stem, so it is a
 * hidden file, not a routine.
 */
export function isMumpsFile(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false; // no extension, or a bare dotfile
  const ext = base.slice(dot).toLowerCase();
  return (MUMPS_EXTENSIONS as readonly string[]).includes(ext);
}
