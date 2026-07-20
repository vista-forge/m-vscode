import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnvelope } from './envelope.ts';
import { statusChip, unknownChip } from './status.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const chipFor = (name: string) => {
  const r = parseEnvelope({
    code: 0,
    stdout: readFileSync(join(here, 'fixtures', 'cli', name), 'utf8'),
    stderr: '',
  });
  if (r.kind !== 'envelope') throw new Error('fixture did not parse');
  return statusChip('ydb/vehu', r);
};

describe('statusChip — the honesty rules', () => {
  it('a healthy engine reports healthy, with its version', () => {
    const chip = chipFor('status-ydb.json');
    assert.equal(chip.health, 'healthy');
    assert.ok(chip.text.includes('ydb/vehu'));
    assert.ok(chip.tooltip.includes('r2.02'), 'the probed version belongs in the tooltip');
  });

  it('a reachable-but-not-running engine is DOWN, never blank', () => {
    const chip = chipFor('status-unreachable.json');
    assert.equal(chip.health, 'down');
    assert.ok(chip.tooltip.length > 0);
  });

  it('an unparseable probe is UNKNOWN — it must not imply health it did not verify', () => {
    const chip = statusChip('ydb/vehu', parseEnvelope({ code: 0, stdout: 'boom', stderr: '' }));
    assert.equal(chip.health, 'unknown');
    assert.ok(chip.tooltip.toLowerCase().includes('could not'));
  });

  it('a missing `m` is UNKNOWN and names the setting that fixes it', () => {
    const chip = statusChip(
      'ydb/vehu',
      parseEnvelope({ spawnError: 'spawn m ENOENT', code: null, stdout: '', stderr: '' }),
    );
    assert.equal(chip.health, 'unknown');
    assert.ok(chip.tooltip.includes('mLanguageTools'), 'must name the setting');
  });

  it('an error envelope (UNREACHABLE) is DOWN and carries the CLI hint through', () => {
    const chip = statusChip(
      'iris/foia-t12',
      parseEnvelope({
        code: 4,
        stdout: '',
        stderr: JSON.stringify({
          schemaVersion: '1.0',
          ok: false,
          exit: 4,
          error: { code: 'UNREACHABLE', exit: 4, message: 'no driver', hint: 'check M_IRIS_* env' },
        }),
      }),
    );
    assert.equal(chip.health, 'down');
    assert.ok(chip.tooltip.includes('check M_IRIS_* env'), 'the hint is the actionable half');
  });

  it('never renders an empty chip text for any health', () => {
    for (const chip of [
      chipFor('status-ydb.json'),
      chipFor('status-unreachable.json'),
      unknownChip('ydb/vehu', 'not probed yet'),
    ]) {
      assert.notEqual(chip.text.trim(), '');
      assert.notEqual(chip.tooltip.trim(), '');
    }
  });
});

describe('unknownChip', () => {
  it('is what the bar shows BEFORE the first probe — explicitly unknown', () => {
    const chip = unknownChip('ydb/vehu', 'not probed yet');
    assert.equal(chip.health, 'unknown');
    assert.ok(chip.tooltip.includes('not probed yet'));
  });
});

describe('statusChip — running but unhealthy', () => {
  it('is DOWN, and says running-but-unhealthy rather than just "down"', () => {
    const chip = statusChip(
      'ydb/vehu',
      parseEnvelope({
        code: 0,
        stdout: JSON.stringify({
          schemaVersion: '1.0',
          ok: true,
          exit: 0,
          data: { transport: 'docker', running: true, healthy: false },
        }),
      }),
    );
    assert.equal(chip.health, 'down');
    assert.ok(chip.tooltip.includes('health probe'));
  });

  it('a healthy probe with no version still renders a non-empty tooltip', () => {
    const chip = statusChip(
      'ydb/vehu',
      parseEnvelope({
        code: 0,
        stdout: JSON.stringify({
          schemaVersion: '1.0',
          ok: true,
          exit: 0,
          data: { running: true, healthy: true },
        }),
      }),
    );
    assert.equal(chip.health, 'healthy');
    assert.ok(chip.tooltip.includes('healthy'));
  });
});
