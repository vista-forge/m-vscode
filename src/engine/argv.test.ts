import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coverageArgv, execArgv, statusArgv, testArgv } from './argv.ts';
import { resolveEngineSettings } from './settings.ts';

const ydb = resolveEngineSettings({ engine: 'ydb', docker: 'vehu' });
const iris = resolveEngineSettings({ engine: 'iris', docker: 'foia-t12', namespace: 'VISTA' });
const bare = resolveEngineSettings({ engine: 'ydb' });

describe('testArgv', () => {
  it('is `m test` with the engine, container and json output', () => {
    assert.deepEqual(testArgv(ydb, ['/w/A TST.m']), [
      'test',
      '/w/A TST.m',
      '--engine',
      'ydb',
      '--docker',
      'vehu',
      '-o',
      'json',
    ]);
  });

  it('adds --namespace only for iris with one configured', () => {
    assert.ok(testArgv(iris, ['/w']).join(' ').includes('--namespace VISTA'));
    assert.ok(!testArgv(ydb, ['/w']).join(' ').includes('--namespace'));
  });

  it('omits --docker entirely when no container is configured', () => {
    assert.ok(!testArgv(bare, ['/w']).includes('--docker'));
  });

  it('never emits an empty argument (an empty --docker would swallow the next flag)', () => {
    for (const a of testArgv(bare, ['/w'])) assert.notEqual(a, '');
  });
});

describe('coverageArgv', () => {
  it('writes LCOV to the path given and asks for json on stdout', () => {
    const argv = coverageArgv(ydb, ['/w'], '/tmp/c.info');
    assert.equal(argv[0], 'coverage');
    assert.ok(argv.includes('--lcov'));
    assert.equal(argv[argv.indexOf('--lcov') + 1], '/tmp/c.info');
    assert.deepEqual(argv.slice(-2), ['-o', 'json']);
  });

  it('never passes --min-percent — the editor reports coverage, it does not gate it', () => {
    assert.ok(!coverageArgv(ydb, ['/w'], '/tmp/c.info').includes('--min-percent'));
  });
});

describe('statusArgv', () => {
  it('uses --transport docker when a container is configured', () => {
    assert.deepEqual(statusArgv(ydb), [
      'vista',
      'status',
      '--engine',
      'ydb',
      '--transport',
      'docker',
      '-o',
      'json',
    ]);
  });

  it('falls back to the driver default transport with no container', () => {
    assert.ok(!statusArgv(bare).includes('--transport'));
  });
});

describe('execArgv', () => {
  it('passes the command as ONE argument, unsplit', () => {
    const argv = execArgv(ydb, 'write $$foo^BAR(1,2) , 3');
    assert.deepEqual(argv.slice(0, 3), ['vista', 'exec', 'write $$foo^BAR(1,2) , 3']);
  });

  it('carries the bounded lock wait so a busy engine reports, never hangs', () => {
    const argv = execArgv(ydb, 'write 1');
    assert.equal(argv[argv.indexOf('--lock-wait') + 1], '30s');
  });
});
