/**
 * Which files are test suites.
 *
 * The `*TST.m` convention is the m toolchain's, not this repo's — `m test`
 * discovers by the same rule. Matching it here is only so the Test Explorer can
 * show a tree BEFORE a run; the CLI remains the authority on what actually runs
 * (its report is what populates results). No M is parsed.
 */

const basename = (path: string): string => path.split(/[/\\]/).pop() ?? path;

export function isSuiteFile(path: string): boolean {
  return /TST\.m$/.test(basename(path));
}

/** The routine name — the key `m test` reports results under. */
export function suiteName(path: string): string {
  return basename(path).replace(/\.m$/, '');
}

/** A stable Test Explorer item id: same file, same item across runs. */
export function suiteIdFor(path: string): string {
  return `suite:${path}`;
}

/**
 * Paths for a COVERAGE run: the suites, plus a source root.
 *
 * `m coverage`'s positional paths are "suites to run **and routine sources to
 * exercise**" — so a run given only suite files measures only those suites and
 * legitimately produces an empty tracefile. Measured on a live YottaDB run:
 * `m coverage ZZMVSMATHTST.m` yields no records, `m coverage ZZMVSMATHTST.m .`
 * yields the two covered lines of `ZZMVSMATH.m`. The editor's meaning of "run
 * with coverage" is "cover this project", so the workspace root goes in.
 */
export function coveragePaths(suitePaths: string[], sourceRoot: string): string[] {
  return suitePaths.includes(sourceRoot) ? suitePaths : [...suitePaths, sourceRoot];
}
