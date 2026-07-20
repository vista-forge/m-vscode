import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEnvelope } from './envelope.ts';
import { describeFailure, failureLine } from './failure.ts';

const env = (error: { code: string; message: string; hint?: string }, exit = 1) =>
  parseEnvelope({
    code: exit,
    stdout: '',
    stderr: JSON.stringify({ schemaVersion: '1.0', ok: false, exit, error: { ...error, exit } }),
  });

describe('describeFailure — every failure names what broke AND what to do', () => {
  it('missing `m` on PATH', () => {
    const f = describeFailure(
      'test',
      parseEnvelope({ spawnError: 'spawn m ENOENT', code: null, stdout: '', stderr: '' }),
    );
    assert.ok(f.message.includes('m'), 'names the executable');
    assert.ok(f.action.includes('mLanguageTools.serverPath'), 'names the setting that fixes it');
  });

  it('unresolved engine', () => {
    const f = describeFailure(
      'test',
      env({ code: 'ENGINE_UNRESOLVED', message: 'no engine resolved' }, 4),
    );
    assert.ok(f.action.includes('mLanguageTools.engine'), 'points at the engine setting');
  });

  it('staging failed (typically no such container / Docker not running)', () => {
    const f = describeFailure(
      'test',
      env({ code: 'STAGE_FAILED', message: 'exec sweep failed: no such container' }),
    );
    assert.ok(f.message.includes('no such container'));
    assert.ok(f.action.includes('mLanguageTools.docker'), 'points at the container setting');
  });

  it('run-lock held by another consumer', () => {
    const f = describeFailure(
      'exec',
      env({ code: 'SKIPPED_ENGINE_BUSY', message: 'engine busy: held by `m test`' }, 4),
    );
    assert.ok(f.message.includes('held by'), 'the holder must reach the user');
    assert.ok(/wait|retry|again/i.test(f.action));
  });

  it('a CLI hint is preferred over our generic advice', () => {
    const f = describeFailure(
      'test',
      env({
        code: 'BAD_CONFIG',
        message: 'bad preset',
        hint: 'valid presets: identity, canonical',
      }),
    );
    assert.equal(f.action, 'valid presets: identity, canonical');
  });

  it('unparseable output is reported verbatim, never swallowed', () => {
    const f = describeFailure('coverage', parseEnvelope({ code: 0, stdout: 'boom', stderr: '' }));
    assert.ok(f.message.includes('boom'));
    assert.notEqual(f.action.trim(), '');
  });

  it('an unknown error code still produces a non-empty message and action', () => {
    const f = describeFailure('test', env({ code: 'WAT_IS_THIS', message: 'something happened' }));
    assert.ok(f.message.includes('something happened'));
    assert.notEqual(f.action.trim(), '');
  });

  it('a non-zero exit with NO error object still produces a message and an action', () => {
    const f = describeFailure(
      'status',
      parseEnvelope({
        code: 1,
        stdout: JSON.stringify({ schemaVersion: '1.0', ok: false, exit: 1 }),
        stderr: '',
      }),
    );
    assert.ok(f.message.includes('exit 1'));
    assert.notEqual(f.action.trim(), '');
  });

  it('an empty hint does not beat the code-specific advice', () => {
    const f = describeFailure('test', env({ code: 'STAGE_FAILED', message: 'x', hint: '   ' }));
    assert.ok(f.action.includes('mLanguageTools.docker'));
  });

  it('names the verb that failed, so the user knows which feature went dark', () => {
    for (const verb of ['test', 'coverage', 'exec', 'status'] as const) {
      const f = describeFailure(verb, env({ code: 'X', message: 'y' }));
      assert.ok(f.message.includes(`m ${verb}`), `verb ${verb} must appear`);
    }
  });
});

describe('failureLine', () => {
  it('joins the message and the action into one renderable line', () => {
    const line = failureLine({ message: 'it broke', action: 'fix it' });
    assert.ok(line.includes('it broke'));
    assert.ok(line.includes('fix it'));
  });
});
