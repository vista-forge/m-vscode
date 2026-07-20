/**
 * `m test -o json` report rows -> outcomes the Test Explorer can render.
 *
 * ZERO M semantics: every field here is a field the CLI already computed. This
 * module decides only what the *user* is shown, and its one rule is that a
 * not-ok suite can never come out green — a suite that failed with nothing to
 * say still gets a message, because "red with no reason" is how a broken run
 * gets mistaken for a flaky one.
 */

export interface CaseRow {
  label: string;
  passed: number;
  failed: number;
}

export interface FailedAssertion {
  description: string;
  expected?: string;
  actual?: string;
}

export interface EngineErrorRow {
  routine?: string;
  line?: number;
  mnemonic?: string;
  text?: string;
}

export interface SuiteRow {
  suite: string;
  tier?: string;
  passed: number;
  failed: number;
  total: number;
  cases?: number;
  reconcileError?: string;
  ok: boolean;
  tests?: CaseRow[];
  failures?: FailedAssertion[];
  engineError?: EngineErrorRow;
}

export interface TestReport {
  engine: string;
  suites: number;
  passed: number;
  failed: number;
  results: SuiteRow[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read the report out of an envelope's `data`, or undefined when there is none.
 *
 * Undefined is load-bearing: it forces the caller down the failure path instead
 * of rendering an empty (and therefore green-looking) test list.
 */
export function readTestReport(envelope: { data?: unknown }): TestReport | undefined {
  const d = envelope.data;
  if (!isRecord(d)) return undefined;
  if (typeof d.engine !== 'string' || !Array.isArray(d.results)) return undefined;
  return {
    engine: d.engine,
    suites: typeof d.suites === 'number' ? d.suites : d.results.length,
    passed: typeof d.passed === 'number' ? d.passed : 0,
    failed: typeof d.failed === 'number' ? d.failed : 0,
    results: d.results.filter(isRecord) as unknown as SuiteRow[],
  };
}

export type OutcomeState = 'passed' | 'failed' | 'errored';

export interface SuiteOutcome {
  state: OutcomeState;
  /** Human-readable lines for the test message. Never empty when not passed. */
  messages: string[];
  /** Where the engine faulted, when it told us. */
  location?: { routine: string; line: number };
}

function engineErrorLines(e: EngineErrorRow): string[] {
  const where = e.routine !== undefined && e.line !== undefined ? ` (${e.routine}:${e.line})` : '';
  const head = [e.mnemonic, e.text].filter((s) => s !== undefined && s !== '').join(' ');
  return [`engine error: ${head === '' ? 'the engine aborted the suite' : head}${where}`];
}

export function suiteOutcome(suite: SuiteRow): SuiteOutcome {
  const messages: string[] = [];

  // An engine fault is the highest-signal cause: it is why the counts read 0/0.
  if (suite.engineError) {
    const e = suite.engineError;
    const location =
      e.routine !== undefined && e.line !== undefined
        ? { routine: e.routine, line: e.line }
        : undefined;
    return {
      state: 'errored',
      messages: engineErrorLines(e),
      ...(location ? { location } : {}),
    };
  }

  if (suite.reconcileError !== undefined && suite.reconcileError !== '') {
    messages.push(`test integrity: ${suite.reconcileError}`);
  }

  for (const f of suite.failures ?? []) {
    const detail =
      f.expected !== undefined || f.actual !== undefined
        ? `\n  expected: ${f.expected ?? '<none>'}\n  actual:   ${f.actual ?? '<none>'}`
        : '';
    messages.push(`${f.description}${detail}`);
  }

  if (suite.ok) return { state: 'passed', messages: [] };

  if (messages.length === 0) {
    // The CLI said red and gave no reason. Say exactly that, with the counts —
    // never fall through to a green.
    messages.push(
      `suite ${suite.suite} failed (${suite.passed}/${suite.total} assertions passed) ` +
        'but reported no failure detail — run `m test` from a terminal for the full output',
    );
  }
  return { state: 'failed', messages };
}

export interface CaseOutcome {
  label: string;
  state: OutcomeState;
  message?: string;
}

/**
 * Per-`@TEST` outcomes, when the runner orchestrated the suite case by case.
 *
 * The CLI reports failed ASSERTIONS at suite level, not per case, so a red case
 * carries its counts and the suite item carries the assertion detail. Inventing
 * an attribution here would be M knowledge this repo is not allowed to have.
 */
export function caseOutcomes(suite: SuiteRow): CaseOutcome[] {
  return (suite.tests ?? []).map((c) => {
    if (c.failed > 0) {
      return {
        label: c.label,
        state: 'failed' as const,
        message: `${c.failed} of ${c.passed + c.failed} assertions failed in ${c.label} — see ${suite.suite} for the detail`,
      };
    }
    if (c.passed === 0) {
      // Ran but asserted nothing. `m test` red-gates this as a test-integrity
      // violation; showing it green would hide exactly what that gate exists
      // to catch.
      return {
        label: c.label,
        state: 'failed' as const,
        message: `${c.label} ran but made no assertions`,
      };
    }
    return { label: c.label, state: 'passed' as const };
  });
}

/**
 * Suites that were requested but never appeared in the report.
 *
 * Without this a filtered-out or undiscovered suite simply keeps its previous
 * state in the Test Explorer — stale green being the worst possible outcome.
 * The caller marks these errored with a message.
 */
export function unreportedSuites(requested: string[], report: TestReport): string[] {
  const seen = new Set(report.results.map((r) => r.suite));
  return requested.filter((name) => !seen.has(name));
}
