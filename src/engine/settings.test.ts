import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { engineLabel, resolveEngineSettings } from './settings.ts';

describe('resolveEngineSettings', () => {
  it('defaults to ydb with no container', () => {
    const s = resolveEngineSettings({});
    assert.equal(s.engine, 'ydb');
    assert.equal(s.docker, '');
    assert.equal(s.mPath, 'm');
    assert.equal(s.lockWaitSeconds, 30);
  });

  const cases: Array<[string, unknown, 'ydb' | 'iris']> = [
    ['iris kept', 'iris', 'iris'],
    ['ydb kept', 'ydb', 'ydb'],
    ['garbage falls back', 'oracle', 'ydb'],
    ['empty falls back', '', 'ydb'],
    ['non-string falls back', 42, 'ydb'],
  ];
  for (const [name, raw, want] of cases) {
    it(`engine: ${name}`, () => {
      assert.equal(resolveEngineSettings({ engine: raw }).engine, want);
    });
  }

  it('trims the container name and keeps the namespace', () => {
    const s = resolveEngineSettings({ engine: 'iris', docker: '  foia-t12 ', namespace: 'VISTA' });
    assert.equal(s.docker, 'foia-t12');
    assert.equal(s.namespace, 'VISTA');
  });

  it('clamps a nonsense lock wait rather than passing it through', () => {
    assert.equal(resolveEngineSettings({ lockWaitSeconds: -5 }).lockWaitSeconds, 0);
    assert.equal(resolveEngineSettings({ lockWaitSeconds: 'soon' }).lockWaitSeconds, 30);
  });
});

describe('engineLabel', () => {
  it('names the engine and the container it will reach', () => {
    assert.equal(engineLabel(resolveEngineSettings({ engine: 'ydb', docker: 'vehu' })), 'ydb/vehu');
  });
  it('says local when no container is configured — never implies one', () => {
    assert.equal(engineLabel(resolveEngineSettings({ engine: 'iris' })), 'iris/local');
  });
});
