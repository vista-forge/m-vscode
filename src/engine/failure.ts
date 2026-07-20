/**
 * Turning a failed `m` invocation into something the user can act on.
 *
 * The standing theme of this effort: no silent failure. Every path through this
 * module produces BOTH a message (what broke) and an action (what to do) — and
 * the CLI's own `hint`, when it supplied one, always wins over our generic
 * advice, because the CLI knows more about its own refusal than we do.
 */

import type { EnvelopeResult } from './envelope.js';

export type Verb = 'test' | 'coverage' | 'exec' | 'status';

export interface Failure {
  message: string;
  action: string;
}

const ACTIONS: Record<string, string> = {
  ENGINE_UNRESOLVED: 'Set `mLanguageTools.engine` to `ydb` or `iris` in your workspace settings.',
  BAD_ENGINE: 'Set `mLanguageTools.engine` to `ydb` or `iris` in your workspace settings.',
  STAGE_FAILED:
    'Check that the container in `mLanguageTools.docker` is running (`docker ps`) and that Docker is available.',
  NO_DRIVER:
    'Build the engine driver (`make build` in m-ydb / m-iris) or set its `M_<ENGINE>_BIN` environment variable.',
  UNREACHABLE:
    'Check that the engine is running and that the container in `mLanguageTools.docker` is correct.',
  SKIPPED_ENGINE_BUSY:
    'Another `m` run holds the engine run-lock. Wait for it to finish and try again.',
  DISCOVER_FAILED: 'Check that the workspace folder contains readable `*TST.m` suites.',
  BAD_CONFIG: 'Fix the project `.m-cli.toml` named in the message.',
};

const GENERIC =
  'Run the same command in a terminal to see the full output, then fix what it names.';

export function describeFailure(verb: Verb, result: EnvelopeResult): Failure {
  const head = `\`m ${verb}\` failed`;

  if (result.kind === 'spawn-failed') {
    return {
      message: `${head}: ${result.message}`,
      action:
        'Install the `m` toolchain (m-cli) and make sure it is on your PATH, or set ' +
        '`mLanguageTools.serverPath` to its full path.',
    };
  }

  if (result.kind === 'unparseable') {
    return { message: `${head}: ${result.message}`, action: GENERIC };
  }

  const err = result.envelope.error;
  if (!err) {
    return {
      message: `${head}: the CLI reported exit ${result.envelope.exit} with no error detail`,
      action: GENERIC,
    };
  }
  const hint = err.hint?.trim();
  return {
    message: `${head} [${err.code}]: ${err.message}`,
    action: hint !== undefined && hint !== '' ? hint : (ACTIONS[err.code] ?? GENERIC),
  };
}

/** One-line rendering for an output channel or a notification. */
export function failureLine(f: Failure): string {
  return `${f.message} — ${f.action}`;
}
