/**
 * Engine-feature settings — the P4 half of this extension's configuration.
 *
 * Pure: raw `workspace.getConfiguration` values in, a validated shape out. The
 * validation is not ceremony — a garbage `engine` value passed straight to the
 * CLI would produce a usage error the user cannot connect to anything they did,
 * so it falls back to a named default instead.
 */

export type EngineKind = 'ydb' | 'iris';

export interface EngineSettings {
  /** Which engine the `m` CLI should reach. */
  engine: EngineKind;
  /** Docker container to run inside; '' means "let the driver decide". */
  docker: string;
  /** IRIS namespace, if configured (ignored for ydb). */
  namespace: string;
  /** The `m` executable — shared with the language-server setting. */
  mPath: string;
  /** Bounded wait for the engine run-lock. Never unbounded, never silent. */
  lockWaitSeconds: number;
}

export interface RawEngineSettings {
  engine?: unknown;
  docker?: unknown;
  namespace?: unknown;
  mPath?: unknown;
  lockWaitSeconds?: unknown;
}

const ENGINES: readonly EngineKind[] = ['ydb', 'iris'];

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;

export function resolveEngineSettings(raw: RawEngineSettings): EngineSettings {
  const engine = ENGINES.includes(raw.engine as EngineKind) ? (raw.engine as EngineKind) : 'ydb';
  const lock =
    typeof raw.lockWaitSeconds === 'number' && Number.isFinite(raw.lockWaitSeconds)
      ? Math.max(0, Math.round(raw.lockWaitSeconds))
      : 30;
  return {
    engine,
    docker: str(raw.docker, ''),
    namespace: str(raw.namespace, ''),
    mPath: str(raw.mPath, 'm'),
    lockWaitSeconds: lock,
  };
}

/**
 * The short "engine/where" label used in the status bar and in messages.
 * Says `local` rather than nothing when no container is configured — a blank
 * would read as "no engine", which is a different (and unverified) claim.
 */
export function engineLabel(s: EngineSettings): string {
  return `${s.engine}/${s.docker === '' ? 'local' : s.docker}`;
}
