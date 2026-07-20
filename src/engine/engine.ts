/**
 * The four engine operations, composed from the pure modules around them.
 *
 * Each returns a discriminated result so a caller CANNOT accidentally render a
 * failure as an empty success — there is no shape here that means "nothing
 * happened". That is the whole design: `runTests` either has a report or a
 * named failure; `runCoverage` either has records or a named failure (including
 * the case where the CLI exited 0 but wrote no tracefile, which would otherwise
 * paint the file 0% covered and look like a measurement).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverageArgv, execArgv, statusArgv, testArgv } from './argv.js';
import { parseEnvelope } from './envelope.js';
import { describeFailure, type Failure } from './failure.js';
import { type CoverageRecord, parseLcov } from './lcov.js';
import { readTestReport, type TestReport } from './report.js';
import { type RunOptions, runM } from './run.js';
import { type EngineSettings, engineLabel } from './settings.js';
import { type StatusChip, statusChip } from './status.js';

export type RunContext = Omit<RunOptions, 'cwd'> & { cwd: string };

export type TestRunResult =
  | { kind: 'report'; report: TestReport }
  | { kind: 'failed'; failure: Failure };

export async function runTests(
  settings: EngineSettings,
  paths: string[],
  ctx: RunContext,
): Promise<TestRunResult> {
  const raw = await runM(settings.mPath, testArgv(settings, paths), ctx);
  const parsed = parseEnvelope(raw);
  if (parsed.kind === 'envelope') {
    const report = readTestReport(parsed.envelope);
    // A failing envelope still carries its report; render it. Only a genuine
    // absence of report data falls through to the failure path.
    if (report) return { kind: 'report', report };
  }
  return { kind: 'failed', failure: describeFailure('test', parsed) };
}

export type CoverageRunResult =
  | { kind: 'coverage'; records: CoverageRecord[] }
  | { kind: 'failed'; failure: Failure };

export async function runCoverage(
  settings: EngineSettings,
  paths: string[],
  ctx: RunContext,
): Promise<CoverageRunResult> {
  const dir = await mkdtemp(join(tmpdir(), 'm-vscode-cov-'));
  const lcovPath = join(dir, 'coverage.info');
  try {
    const raw = await runM(settings.mPath, coverageArgv(settings, paths, lcovPath), ctx);
    const parsed = parseEnvelope(raw);
    if (parsed.kind !== 'envelope' || parsed.envelope.error) {
      return { kind: 'failed', failure: describeFailure('coverage', parsed) };
    }

    let text: string;
    try {
      text = await readFile(lcovPath, 'utf8');
    } catch {
      // Exited 0 and wrote nothing. Reporting "0% covered" here would be an
      // invented measurement — the exact silent-failure class P4 forbids.
      return {
        kind: 'failed',
        failure: {
          message:
            '`m coverage` reported success but wrote no LCOV tracefile, so there is nothing to display.',
          action:
            'Run `m coverage --lcov <file>` in a terminal to see what it did; check the engine and container settings.',
        },
      };
    }
    const records = parseLcov(text);
    if (records.length === 0) {
      return {
        kind: 'failed',
        failure: {
          message: `\`m coverage\` produced no coverage records for ${engineLabel(settings)}.`,
          action:
            'Check that the run exercised routine source files (`[dependencies] routines` in `.m-cli.toml`).',
        },
      };
    }
    return { kind: 'coverage', records };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runStatus(settings: EngineSettings, ctx: RunContext): Promise<StatusChip> {
  const raw = await runM(settings.mPath, statusArgv(settings), {
    ...ctx,
    timeoutMs: ctx.timeoutMs ?? 60_000,
  });
  return statusChip(engineLabel(settings), parseEnvelope(raw));
}

export type ExecRunResult =
  | { kind: 'output'; stdout: string; stderr: string; status: number }
  | { kind: 'failed'; failure: Failure };

export async function runExec(
  settings: EngineSettings,
  command: string,
  ctx: RunContext,
): Promise<ExecRunResult> {
  const trimmed = command.trim();
  if (trimmed === '') {
    return {
      kind: 'failed',
      failure: {
        message: 'Nothing to run: the selection is empty.',
        action: 'Select an M command (or put the cursor on a line) and run the command again.',
      },
    };
  }

  const raw = await runM(settings.mPath, execArgv(settings, trimmed), ctx);
  const parsed = parseEnvelope(raw);
  if (parsed.kind !== 'envelope' || parsed.envelope.error) {
    return { kind: 'failed', failure: describeFailure('exec', parsed) };
  }
  const d = (parsed.envelope.data ?? {}) as { stdout?: string; stderr?: string; status?: number };
  return {
    kind: 'output',
    stdout: d.stdout ?? '',
    stderr: d.stderr ?? '',
    status: d.status ?? 0,
  };
}
