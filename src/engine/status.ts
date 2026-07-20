/**
 * The engine status chip.
 *
 * The one rule: never imply health that was not verified. Three states, and
 * `unknown` is a first-class one — the chip says "unknown" when the probe could
 * not run or could not be understood, rather than staying blank (reads as "no
 * problem") or optimistically green.
 */

import type { EnvelopeResult } from './envelope.js';
import { describeFailure } from './failure.js';

export type Health = 'healthy' | 'down' | 'unknown';

export interface StatusChip {
  health: Health;
  /** Status-bar text. Always non-empty. */
  text: string;
  /** Hover text: the evidence, or the reason there is none. Always non-empty. */
  tooltip: string;
}

interface ProbeData {
  transport?: string;
  running?: boolean;
  healthy?: boolean;
  version?: string;
  endpoint?: string;
  latencyMs?: number;
}

const ICON: Record<Health, string> = {
  healthy: '$(pass-filled)',
  down: '$(error)',
  unknown: '$(question)',
};

const chip = (health: Health, label: string, tooltip: string): StatusChip => ({
  health,
  text: `${ICON[health]} M ${label}`,
  tooltip,
});

/** The chip shown before any probe has run, or while one is in flight. */
export function unknownChip(label: string, reason: string): StatusChip {
  return chip('unknown', `${label}: unknown`, `M engine ${label}: status unknown — ${reason}.`);
}

export function statusChip(label: string, result: EnvelopeResult): StatusChip {
  if (result.kind === 'spawn-failed' || result.kind === 'unparseable') {
    const f = describeFailure('status', result);
    return chip(
      'unknown',
      `${label}: unknown`,
      `M engine ${label}: could not determine status.\n${f.message}\n${f.action}`,
    );
  }

  const env = result.envelope;
  if (env.error) {
    const f = describeFailure('status', result);
    return chip(
      'down',
      `${label}: down`,
      `M engine ${label} is not reachable.\n${f.message}\n${f.action}`,
    );
  }

  const d = (env.data ?? {}) as ProbeData;
  if (d.running !== true) {
    return chip(
      'down',
      `${label}: down`,
      `M engine ${label} is not running (probed over ${d.transport ?? 'the driver default'} transport).`,
    );
  }
  if (d.healthy !== true) {
    return chip(
      'down',
      `${label}: unhealthy`,
      `M engine ${label} is running but did not pass its health probe.`,
    );
  }

  const bits = [
    `M engine ${label} is healthy.`,
    d.version !== undefined && d.version !== '' ? `version ${d.version}` : undefined,
    d.endpoint !== undefined && d.endpoint !== '' ? `endpoint ${d.endpoint}` : undefined,
    d.latencyMs !== undefined ? `probe ${d.latencyMs} ms` : undefined,
  ].filter((s): s is string => s !== undefined);
  return chip('healthy', `${label}: ok`, bits.join('\n'));
}
