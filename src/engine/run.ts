/**
 * THE process boundary.
 *
 * This is the only place in the extension that starts a process, and the only
 * process it starts is the `m` CLI. That is the org's transport monopoly made
 * structural: there is no code path from this repo to a driver binary, a
 * container, or an M interpreter (org CLAUDE.md, waterline rule 3).
 *
 * Everything above this function is pure and tested with recorded output;
 * `run.test.ts` exercises this function itself against a fake `m` executable,
 * which is how `make check` stays offline and engine-free.
 */

import { spawn } from 'node:child_process';
import type { ProcessResult } from './envelope.js';

export interface RunOptions {
  cwd: string;
  /** Hard ceiling. A hung CLI must become a message, never a frozen editor. */
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export function runM(mPath: string, argv: string[], opts: RunOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(mPath, argv, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      // No shell: argv reaches the CLI verbatim, so an M command containing
      // spaces, quotes or `$` is not re-interpreted on its way to the engine.
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let spawnError: string | undefined;

    const timer = setTimeout(() => {
      spawnError = `\`m\` timed out after ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s and was stopped`;
      child.kill('SIGTERM');
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const onAbort = (): void => {
      spawnError = '`m` run cancelled';
      child.kill('SIGTERM');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (result: ProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({ code: null, stdout, stderr, spawnError: `spawn ${mPath}: ${err.message}` });
    });

    child.on('close', (code) => {
      finish({
        code: spawnError === undefined ? code : null,
        stdout,
        stderr,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    });
  });
}
