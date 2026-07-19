/**
 * Extension settings, resolved into a server launch description.
 *
 * Pure: takes a plain object (whatever `workspace.getConfiguration` hands back)
 * and returns validated values, so the wiring that actually regresses is
 * testable without an extension host. Nothing here knows any M semantics — a
 * profile name is an opaque string forwarded to the toolchain.
 */

/** Lint profiles `m` accepts. An opaque allow-list, not a rule table. */
export const LINT_PROFILES = [
  'default',
  'modern',
  'pythonic',
  'pedantic',
  'xindex',
  'sac',
  'vista',
  'all',
] as const;

export type LintProfile = (typeof LINT_PROFILES)[number];

export interface MSettings {
  /** Master switch. When false the client is never started. */
  enable: boolean;
  /** Executable providing `lsp`. `m` means "found on PATH". */
  serverPath: string;
  /** Argv after the executable. */
  serverArgs: string[];
  /**
   * Lint profile override. `''` (the default) means "whatever the project's
   * `.m-cli.toml` resolves to" — the same source `m lint` and CI read, which is
   * why it is the default rather than a client-side opinion.
   */
  lintProfile: LintProfile | '';
  /** Delay before a keystroke burst is sent to the server (R3 mitigation). */
  debounceMs: number;
  /** Documents at or above this many bytes lint on save only. 0 disables. */
  largeFileBytes: number;
}

export const DEFAULT_SETTINGS: Readonly<MSettings> = Object.freeze({
  enable: true,
  serverPath: 'm',
  serverArgs: ['lsp'],
  lintProfile: '' as const,
  debounceMs: 300,
  largeFileBytes: 262_144, // 256 KiB
});

const MAX_DEBOUNCE_MS = 10_000;

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const trimmed = v.trim();
  return trimmed === '' ? fallback : trimmed;
}

function strArray(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  return v.every((e) => typeof e === 'string') ? [...(v as string[])] : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function profile(v: unknown): LintProfile | '' {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return (LINT_PROFILES as readonly string[]).includes(t) ? (t as LintProfile) : '';
}

/**
 * Validate raw configuration into settings. Every field falls back to its
 * default rather than throwing: a typo in `settings.json` must not leave the
 * user with a dead extension and no diagnostics.
 */
export function resolveSettings(raw: Record<string, unknown> | undefined): MSettings {
  const r = raw ?? {};
  return {
    enable: bool(r.enable, DEFAULT_SETTINGS.enable),
    serverPath: str(r.serverPath, DEFAULT_SETTINGS.serverPath),
    serverArgs: strArray(r.serverArgs, [...DEFAULT_SETTINGS.serverArgs]),
    lintProfile: profile(r.lintProfile),
    debounceMs: int(r.debounceMs, DEFAULT_SETTINGS.debounceMs, 0, MAX_DEBOUNCE_MS),
    largeFileBytes: int(
      r.largeFileBytes,
      DEFAULT_SETTINGS.largeFileBytes,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export interface ServerLaunch {
  command: string;
  args: string[];
  /**
   * Sent with `initialize`. Present only when the user overrode the profile;
   * `m lsp` ignores unknown options today (it resolves the profile from the
   * project config), so an override is inert until the server honours it —
   * tracked as a P3 ask against m-cli.
   */
  initializationOptions?: { profile: LintProfile };
}

export function serverLaunch(s: MSettings): ServerLaunch {
  const launch: ServerLaunch = { command: s.serverPath, args: [...s.serverArgs] };
  if (s.lintProfile !== '') launch.initializationOptions = { profile: s.lintProfile };
  return launch;
}
