/**
 * `m` command lines, built in one place.
 *
 * The org's transport monopoly says this extension reaches an engine ONLY by
 * shelling to the `m` CLI (org CLAUDE.md, waterline rule 3). This module is the
 * whole of that surface: four verbs, no transport, no driver, no `docker exec`.
 * Keeping argv construction pure also makes the seam testable without a
 * process — the shape of every command is asserted, not eyeballed.
 */

import type { EngineSettings } from './settings.js';

/** Flags shared by the staged, engine-bound verbs (`test`, `coverage`). */
function stagedFlags(s: EngineSettings): string[] {
  const argv = ['--engine', s.engine];
  if (s.docker !== '') argv.push('--docker', s.docker);
  if (s.engine === 'iris' && s.namespace !== '') argv.push('--namespace', s.namespace);
  return argv;
}

/**
 * The driver-backed verbs (`vista status`, `vista exec`) take a transport
 * rather than a container. A configured container means "docker transport". With
 * no container the engine is beside us: for ydb that is the LOCAL transport
 * (the ydb driver's own default is REMOTE, which needs a host — wrong for a
 * local/devbox engine, and unlike how `m test` resolves a docker-less run). IRIS
 * has no local transport, so it keeps its remote/Atelier default from M_IRIS_*.
 */
function driverFlags(s: EngineSettings): string[] {
  const argv = ['--engine', s.engine];
  if (s.docker !== '') {
    argv.push('--transport', 'docker');
  } else if (s.engine === 'ydb') {
    argv.push('--transport', 'local');
  }
  return argv;
}

const JSON_OUT = ['-o', 'json'];

export function testArgv(s: EngineSettings, paths: string[]): string[] {
  return ['test', ...paths, ...stagedFlags(s), ...JSON_OUT];
}

export function coverageArgv(s: EngineSettings, paths: string[], lcovPath: string): string[] {
  // Deliberately no --min-percent: the editor REPORTS coverage; gating it is
  // `make check`'s job, and a threshold here would turn a render into a failure.
  return ['coverage', ...paths, ...stagedFlags(s), '--lcov', lcovPath, ...JSON_OUT];
}

export function statusArgv(s: EngineSettings): string[] {
  return ['vista', 'status', ...driverFlags(s), ...JSON_OUT];
}

export function execArgv(s: EngineSettings, command: string): string[] {
  // The command is ONE argument: `m vista exec` evaluates it as a single M
  // command line, and splitting it here would silently change its meaning.
  return [
    'vista',
    'exec',
    command,
    ...driverFlags(s),
    '--lock-wait',
    `${s.lockWaitSeconds}s`,
    ...JSON_OUT,
  ];
}
