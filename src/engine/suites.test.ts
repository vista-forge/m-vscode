import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coveragePaths, isSuiteFile, suiteIdFor, suiteName } from './suites.ts';

describe('isSuiteFile', () => {
  const cases: Array<[string, boolean]> = [
    ['/w/STDCOLLTST.m', true],
    ['/w/nested/dir/ZZMVSMATHTST.m', true],
    ['/w/STDCOLL.m', false],
    ['/w/TST.m', true],
    ['/w/STDCOLLTST.txt', false],
    ['/w/STDCOLLtst.m', false],
    ['/w/TSTSTDCOLL.m', false],
    ['C:\\w\\ZZTST.m', true],
  ];
  for (const [path, want] of cases) {
    it(`${path} -> ${want}`, () => assert.equal(isSuiteFile(path), want));
  }
});

describe('suiteName', () => {
  it('is the routine name — the key `m test` reports back', () => {
    assert.equal(suiteName('/w/ZZMVSMATHTST.m'), 'ZZMVSMATHTST');
    assert.equal(suiteName('C:\\w\\ZZTST.m'), 'ZZTST');
  });
});

describe('suiteIdFor', () => {
  it('is stable and path-based, so a re-run reuses the same test item', () => {
    assert.equal(suiteIdFor('/w/a/ZZTST.m'), suiteIdFor('/w/a/ZZTST.m'));
    assert.notEqual(suiteIdFor('/w/a/ZZTST.m'), suiteIdFor('/w/b/ZZTST.m'));
  });
});

describe('coveragePaths', () => {
  it('adds the source root, without which `m coverage` measures nothing', () => {
    assert.deepEqual(coveragePaths(['/w/ZZTST.m'], '/w'), ['/w/ZZTST.m', '/w']);
  });

  it('does not duplicate a root that is already in the list', () => {
    assert.deepEqual(coveragePaths(['/w'], '/w'), ['/w']);
  });

  it('keeps every suite — coverage must exercise all the selected suites', () => {
    assert.deepEqual(coveragePaths(['/w/A TST.m', '/w/BTST.m'], '/w'), [
      '/w/A TST.m',
      '/w/BTST.m',
      '/w',
    ]);
  });
});
