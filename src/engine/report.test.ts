import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnvelope } from './envelope.ts';
import { caseOutcomes, readTestReport, suiteOutcome, unreportedSuites } from './report.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const load = (name: string) => {
  const r = parseEnvelope({
    code: 0,
    stdout: readFileSync(join(here, 'fixtures', 'cli', name), 'utf8'),
    stderr: '',
  });
  if (r.kind !== 'envelope') throw new Error(`fixture ${name} did not parse`);
  return readTestReport(r.envelope);
};

describe('readTestReport — green run (real `m test -o json` output)', () => {
  for (const [engine, file] of [
    ['ydb', 'test-pass-ydb.json'],
    ['iris', 'test-pass-iris.json'],
  ] as const) {
    it(`${engine}: maps suites and per-case rows`, () => {
      const report = load(file);
      assert.ok(report, 'report must parse');
      if (!report) return;
      assert.equal(report.engine, engine);
      assert.equal(report.suites, 1);
      assert.equal(report.passed, 3);
      assert.equal(report.failed, 0);
      const [suite] = report.results;
      assert.ok(suite);
      assert.equal(suite.suite, 'ZZMVSMATHTST');
      assert.equal(suite.ok, true);
      assert.deepEqual(
        suite.tests?.map((t) => [t.label, t.passed, t.failed]),
        [
          ['tAdd', 2, 0],
          ['tDbl', 1, 0],
        ],
      );
    });
  }
});

describe('suiteOutcome', () => {
  it('passes a green suite with no message', () => {
    const suite = load('test-pass-ydb.json')?.results[0];
    assert.ok(suite);
    const o = suiteOutcome(suite);
    assert.equal(o.state, 'passed');
    assert.equal(o.messages.length, 0);
  });

  it('reports each failed assertion with its expected and actual', () => {
    const suite = load('test-fail-ydb.json')?.results[0];
    assert.ok(suite);
    const o = suiteOutcome(suite);
    assert.equal(o.state, 'failed');
    assert.equal(o.messages.length, 1);
    const [m] = o.messages;
    assert.ok(m);
    assert.ok(m.includes('1+2 should be 99'));
    assert.ok(m.includes('=99'), 'expected value must reach the UI');
    assert.ok(m.includes('=3'), 'actual value must reach the UI');
  });

  it('turns an engine fault into a located, mnemonic-carrying message — not a silent 0/0', () => {
    const suite = load('test-engine-error-ydb.json')?.results[0];
    assert.ok(suite);
    const o = suiteOutcome(suite);
    assert.equal(o.state, 'errored');
    const text = o.messages.join('\n');
    assert.ok(text.includes('%YDB-E-LABELMISSING'), 'mnemonic');
    assert.ok(text.includes('ZZMVSERRTST'), 'routine');
    assert.ok(text.includes('4'), 'line');
    assert.equal(o.location?.routine, 'ZZMVSERRTST');
    assert.equal(o.location?.line, 4);
  });

  it('surfaces a reconcile violation (a declared case that never asserted) as a failure', () => {
    const o = suiteOutcome({
      suite: 'ZZTST',
      passed: 0,
      failed: 0,
      total: 0,
      ok: false,
      reconcileError: 'suite ZZTST: 2 @TEST case(s) ran but made no assertions',
    });
    assert.equal(o.state, 'failed');
    assert.ok(o.messages.join('\n').includes('made no assertions'));
  });

  it('NEVER reports a not-ok suite as passing, even with nothing else to say', () => {
    const o = suiteOutcome({ suite: 'ZZTST', passed: 0, failed: 0, total: 0, ok: false });
    assert.notEqual(o.state, 'passed');
    assert.ok(o.messages.length > 0, 'a red suite with no detail still needs a message');
  });
});

describe('caseOutcomes', () => {
  it('maps each orchestrated @TEST case to a state', () => {
    const suite = load('test-pass-ydb.json')?.results[0];
    assert.ok(suite);
    assert.deepEqual(
      caseOutcomes(suite).map((c) => [c.label, c.state]),
      [
        ['tAdd', 'passed'],
        ['tDbl', 'passed'],
      ],
    );
  });

  it('marks a case with failed assertions red and points at the suite for detail', () => {
    const suite = load('test-fail-ydb.json')?.results[0];
    assert.ok(suite);
    const [c] = caseOutcomes(suite);
    assert.ok(c);
    assert.equal(c.state, 'failed');
    assert.ok(c.message?.includes('ZZMVSREDTST'));
  });

  it('a case that ran but asserted NOTHING is red, not green', () => {
    const outcomes = caseOutcomes({
      suite: 'ZZTST',
      passed: 0,
      failed: 0,
      total: 0,
      ok: false,
      tests: [{ label: 'tSilent', passed: 0, failed: 0 }],
    });
    assert.equal(outcomes[0]?.state, 'failed');
    assert.ok(outcomes[0]?.message?.includes('no assertions'));
  });

  it('is empty for an entry-driven suite (the CLI reported no per-case rows)', () => {
    assert.deepEqual(
      caseOutcomes({ suite: 'ZZTST', passed: 1, failed: 0, total: 1, ok: true }),
      [],
    );
  });
});

describe('unreportedSuites', () => {
  it('names a requested suite the report never mentioned — stale green is the worst outcome', () => {
    const report = load('test-pass-ydb.json');
    assert.ok(report);
    assert.deepEqual(unreportedSuites(['ZZMVSMATHTST', 'ZZGHOSTTST'], report), ['ZZGHOSTTST']);
  });

  it('is empty when everything requested came back', () => {
    const report = load('test-pass-ydb.json');
    assert.ok(report);
    assert.deepEqual(unreportedSuites(['ZZMVSMATHTST'], report), []);
  });
});

describe('readTestReport — refusals', () => {
  it('returns undefined when the envelope carries no report (so callers cannot render an empty green)', () => {
    const r = parseEnvelope({
      code: 1,
      stdout: '',
      stderr: readFileSync(join(here, 'fixtures', 'cli', 'test-stage-failed.stderr.json'), 'utf8'),
    });
    assert.equal(r.kind, 'envelope');
    if (r.kind !== 'envelope') return;
    assert.equal(readTestReport(r.envelope), undefined);
  });
});

describe('readTestReport — malformed data is a refusal too', () => {
  const cases: Array<[string, unknown]> = [
    ['data is not an object', 'nope'],
    ['data is null', null],
    ['no engine field', { results: [] }],
    ['results is not an array', { engine: 'ydb', results: 'lots' }],
    ['results missing entirely', { engine: 'ydb' }],
  ];
  for (const [name, data] of cases) {
    it(`${name} -> undefined, so the caller cannot render an empty green`, () => {
      assert.equal(readTestReport({ data }), undefined);
    });
  }
});
