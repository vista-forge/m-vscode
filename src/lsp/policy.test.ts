import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { missingServerMessage, statusText, syncDecision } from './policy.ts';
import { resolveSettings } from './settings.ts';

const settings = (over: Record<string, unknown> = {}) => resolveSettings(over);

describe('syncDecision', () => {
  it('lints live for an ordinary routine', () => {
    const got = syncDecision(15_000, settings());
    assert.equal(got.mode, 'live');
    assert.equal(got.debounceMs, 300);
  });

  it('drops to on-save for a document at the threshold', () => {
    const got = syncDecision(262_144, settings());
    assert.equal(got.mode, 'on-save');
  });

  it('stays live just below the threshold', () => {
    assert.equal(syncDecision(262_143, settings()).mode, 'live');
  });

  it('treats a 0 threshold as "never downgrade"', () => {
    assert.equal(syncDecision(50_000_000, settings({ largeFileBytes: 0 })).mode, 'live');
  });

  it('explains itself — the user must know why a big file stopped updating', () => {
    const got = syncDecision(1_048_576, settings());
    assert.match(got.reason, /1024 KiB/);
    assert.match(got.reason, /on save/i);
  });

  it('reports no debounce delay in on-save mode', () => {
    assert.equal(syncDecision(1_048_576, settings()).debounceMs, 0);
  });

  it('honours a custom debounce in live mode', () => {
    assert.equal(syncDecision(1_000, settings({ debounceMs: 900 })).debounceMs, 900);
  });
});

describe('statusText', () => {
  it('names the server and the live mode', () => {
    const got = statusText({ serverPath: 'm', running: true, mode: 'live' });
    assert.match(got, /m lsp/);
    assert.match(got, /live/);
  });

  it('says plainly when the server is not running', () => {
    const got = statusText({ serverPath: '/opt/m', running: false, mode: 'live' });
    assert.match(got, /not running/i);
    assert.match(got, /\/opt\/m/);
  });

  it('surfaces on-save mode so a frozen-looking editor is explained', () => {
    assert.match(statusText({ serverPath: 'm', running: true, mode: 'on-save' }), /on save/i);
  });
});

describe('missingServerMessage', () => {
  it('names the executable it could not find', () => {
    assert.match(missingServerMessage('m'), /`m`/);
  });

  it('names the setting that fixes it — never a dead end', () => {
    const got = missingServerMessage('m');
    assert.match(got, /mLanguageTools\.serverPath/);
  });

  it('mentions the toolchain the user actually needs to install', () => {
    assert.match(missingServerMessage('m'), /m-cli/);
  });
});
