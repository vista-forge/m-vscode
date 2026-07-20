import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseLcov } from './lcov.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

describe('parseLcov — real `m coverage --lcov` output', () => {
  const records = parseLcov(
    readFileSync(join(here, 'fixtures', 'cli', 'coverage-ydb.info'), 'utf8'),
  );

  it('yields one record per SF with its DA lines', () => {
    assert.equal(records.length, 1);
    const [r] = records;
    assert.ok(r);
    assert.ok(r.file.endsWith('ZZMVSMATH.m'));
    assert.deepEqual(r.lines, [
      { line: 4, hits: 2 },
      { line: 7, hits: 1 },
    ]);
    assert.deepEqual(r.summary, { covered: 2, total: 2 });
  });
});

describe('parseLcov — shapes the fixture does not cover', () => {
  it('handles multiple records', () => {
    const records = parseLcov(
      ['SF:/a/A.m', 'DA:1,1', 'end_of_record', 'SF:/a/B.m', 'DA:2,0', 'end_of_record', ''].join(
        '\n',
      ),
    );
    assert.deepEqual(
      records.map((r) => r.file),
      ['/a/A.m', '/a/B.m'],
    );
  });

  it('keeps zero-hit lines — an uncovered line is the whole point of the gutter', () => {
    const [r] = parseLcov('SF:/a/A.m\nDA:1,0\nDA:2,3\nend_of_record\n');
    assert.ok(r);
    assert.deepEqual(r.lines, [
      { line: 1, hits: 0 },
      { line: 2, hits: 3 },
    ]);
    assert.deepEqual(r.summary, { covered: 1, total: 2 });
  });

  it('prefers explicit LF/LH over the counted DA lines when present', () => {
    const [r] = parseLcov('SF:/a/A.m\nDA:1,1\nLF:9\nLH:4\nend_of_record\n');
    assert.ok(r);
    assert.deepEqual(r.summary, { covered: 4, total: 9 });
  });

  it('tolerates CRLF and a missing trailing end_of_record', () => {
    const records = parseLcov('SF:/a/A.m\r\nDA:1,1\r\n');
    assert.equal(records.length, 1);
    assert.equal(records[0]?.file, '/a/A.m');
  });

  it('ignores malformed DA lines instead of producing NaN gutters', () => {
    const [r] = parseLcov('SF:/a/A.m\nDA:x,y\nDA:3,1\nend_of_record\n');
    assert.ok(r);
    assert.deepEqual(r.lines, [{ line: 3, hits: 1 }]);
  });

  it('returns nothing for empty input — the caller must treat that as "no coverage measured"', () => {
    assert.deepEqual(parseLcov(''), []);
    assert.deepEqual(parseLcov('TN:\n'), []);
  });
});
