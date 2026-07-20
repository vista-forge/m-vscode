/**
 * The `m` CLI's JSON envelope (clikit `Envelope`), read defensively.
 *
 * Two measured facts about the real CLI drive the shape here:
 *
 *  1. A FAILING run still carries its `data`. `m test` emits ONE document with
 *     `ok:false`, `exit:3`, the full report as data and the error inline — so a
 *     red suite must be rendered, not discarded with the error.
 *  2. When there is no report at all (staging refused, bad flags), the envelope
 *     goes to **stderr** and stdout is empty. A failing run can therefore put a
 *     full envelope on stdout and a SHORT one on stderr at the same time; the
 *     stdout one, which has the data, wins.
 *
 * Anything that is not a recognisable envelope becomes an explicit
 * `unparseable`/`spawn-failed` result. There is no "assume it worked" branch:
 * that is the failure class this whole phase exists to avoid.
 */

export interface CliError {
  code: string;
  exit: number;
  message: string;
  hint?: string;
}

export interface Envelope {
  schemaVersion: string;
  command?: string;
  ok: boolean;
  exit: number;
  data?: unknown;
  error?: CliError;
}

/** Raw result of running the CLI — see `run.ts`. */
export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export type EnvelopeResult =
  | { kind: 'envelope'; envelope: Envelope; raw: ProcessResult }
  | { kind: 'unparseable'; message: string; raw: ProcessResult }
  | { kind: 'spawn-failed'; message: string; raw: ProcessResult };

function asEnvelope(text: string): Envelope | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || !trimmed.startsWith('{')) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const o = value as Record<string, unknown>;
  // `schemaVersion` + `ok` + `exit` is the envelope's identity. Requiring it
  // keeps unrelated JSON (a stray tool's output on the same stream) from being
  // read as a successful run.
  if (typeof o.schemaVersion !== 'string') return undefined;
  if (typeof o.ok !== 'boolean' || typeof o.exit !== 'number') return undefined;
  return value as unknown as Envelope;
}

export function parseEnvelope(raw: ProcessResult): EnvelopeResult {
  if (raw.spawnError !== undefined) {
    return { kind: 'spawn-failed', message: raw.spawnError, raw };
  }
  const fromStdout = asEnvelope(raw.stdout);
  if (fromStdout) return { kind: 'envelope', envelope: fromStdout, raw };
  const fromStderr = asEnvelope(raw.stderr);
  if (fromStderr) return { kind: 'envelope', envelope: fromStderr, raw };

  const noise = [raw.stdout, raw.stderr]
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .join('\n');
  return {
    kind: 'unparseable',
    message:
      noise === '' ? `the \`m\` CLI exited ${raw.code ?? '?'} without producing any output` : noise,
    raw,
  };
}
