import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnvelope } from './envelope.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string) => readFileSync(join(here, 'fixtures', 'cli', name), 'utf8');

describe('parseEnvelope', () => {
  it('reads a success envelope from stdout', () => {
    const r = parseEnvelope({ code: 0, stdout: fixture('test-pass-ydb.json'), stderr: '' });
    assert.equal(r.kind, 'envelope');
    if (r.kind !== 'envelope') return;
    assert.equal(r.envelope.ok, true);
    assert.equal(r.envelope.exit, 0);
    assert.ok(r.envelope.data);
  });

  it('reads a FAILING envelope from stdout and keeps BOTH the data and the error', () => {
    const r = parseEnvelope({ code: 3, stdout: fixture('test-fail-ydb.json'), stderr: '' });
    assert.equal(r.kind, 'envelope');
    if (r.kind !== 'envelope') return;
    assert.equal(r.envelope.ok, false);
    assert.equal(r.envelope.error?.code, 'TESTS_FAILED');
    // The report is the point: a red run must still render its suites.
    assert.ok(r.envelope.data, 'failing run must still carry its report data');
  });

  it('falls back to the stderr envelope when stdout is empty', () => {
    const r = parseEnvelope({
      code: 1,
      stdout: '',
      stderr: fixture('test-stage-failed.stderr.json'),
    });
    assert.equal(r.kind, 'envelope');
    if (r.kind !== 'envelope') return;
    assert.equal(r.envelope.error?.code, 'STAGE_FAILED');
  });

  it('prefers the stdout envelope when BOTH streams carry one (stderr is the short form)', () => {
    const r = parseEnvelope({
      code: 3,
      stdout: fixture('test-fail-ydb.json'),
      stderr: fixture('test-stage-failed.stderr.json'),
    });
    assert.equal(r.kind, 'envelope');
    if (r.kind !== 'envelope') return;
    assert.ok(r.envelope.data, 'the stdout envelope (with data) must win');
  });

  it('reports unparseable output as a NAMED failure, never as an empty result', () => {
    const r = parseEnvelope({ code: 0, stdout: 'Segmentation fault\n', stderr: '' });
    assert.equal(r.kind, 'unparseable');
    if (r.kind !== 'unparseable') return;
    assert.ok(
      r.message.includes('Segmentation fault'),
      'the raw output must survive into the message',
    );
  });

  it('reports an EMPTY successful run as unparseable rather than inventing a green', () => {
    const r = parseEnvelope({ code: 0, stdout: '   \n', stderr: '' });
    assert.equal(r.kind, 'unparseable');
  });

  it('reports a spawn failure as its own kind, with the launched command named', () => {
    const r = parseEnvelope({ spawnError: 'spawn m ENOENT', code: null, stdout: '', stderr: '' });
    assert.equal(r.kind, 'spawn-failed');
    if (r.kind !== 'spawn-failed') return;
    assert.ok(r.message.includes('ENOENT'));
  });

  it('ignores JSON that is not a clikit envelope', () => {
    const r = parseEnvelope({ code: 0, stdout: '{"hello":"world"}', stderr: '' });
    assert.equal(r.kind, 'unparseable');
  });
});
