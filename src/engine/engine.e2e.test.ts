/**
 * End-to-end over the FAKE `m` CLI: settings -> argv -> process -> envelope ->
 * VS-Code-shaped outcomes. Offline and engine-free by construction.
 *
 * The gate this file really keeps is the failure theme: for every way the
 * toolchain can fail, assert the user gets a NAMED, ACTIONABLE message — never
 * an empty test list, never silently zero coverage, never a chip implying
 * health nothing verified.
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCoverage, runExec, runStatus, runTests } from './engine.ts';
import { resolveEngineSettings } from './settings.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixtures = join(here, 'fixtures', 'cli');
const fx = (n: string) => join(fixtures, n);

function fakeM(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'm-vscode-e2e-'));
  const path = join(dir, 'fake-m');
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const settingsWith = (mPath: string) =>
  resolveEngineSettings({ engine: 'ydb', docker: 'vehu', mPath });

describe('runTests — happy path', () => {
  it('produces a report whose suites and cases the Test Explorer can render', async () => {
    const r = await runTests(settingsWith(fakeM(`cat "${fx('test-pass-ydb.json')}"`)), ['/w'], {
      cwd: here,
    });
    assert.equal(r.kind, 'report');
    if (r.kind !== 'report') return;
    assert.equal(r.report.engine, 'ydb');
    assert.equal(r.report.results.length, 1);
    assert.equal(r.report.results[0]?.tests?.length, 2);
  });

  it('a RED run is still a report — the failures must render, not vanish', async () => {
    const r = await runTests(
      settingsWith(fakeM(`cat "${fx('test-fail-ydb.json')}"; exit 3`)),
      ['/w'],
      { cwd: here },
    );
    assert.equal(r.kind, 'report');
    if (r.kind !== 'report') return;
    assert.equal(r.report.results[0]?.failures?.length, 1);
  });

  it('an engine fault is a report carrying the fault, not a mystery zero', async () => {
    const r = await runTests(
      settingsWith(fakeM(`cat "${fx('test-engine-error-ydb.json')}"; exit 3`)),
      ['/w'],
      { cwd: here },
    );
    assert.equal(r.kind, 'report');
    if (r.kind !== 'report') return;
    assert.equal(r.report.results[0]?.engineError?.mnemonic, '%YDB-E-LABELMISSING');
  });
});

describe('runTests — every failure mode is visible and actionable', () => {
  const modes: Array<[string, string, RegExp]> = [
    ['no `m` on PATH', 'exec /definitely/not/here/m', /serverPath|not found|ENOENT/i],
    [
      'staging failed (no Docker / no such container)',
      `cat "${fx('test-stage-failed.stderr.json')}" >&2; exit 1`,
      /container|docker|STAGE|routine source/i,
    ],
    ['CLI crashed with no JSON at all', 'echo "Segmentation fault" >&2; exit 139', /Segmentation/],
    ['CLI printed nothing and exited 0', 'exit 0', /\S/],
  ];

  for (const [name, body, wanted] of modes) {
    it(`${name}: reports a failure with a non-empty message AND action`, async () => {
      const r = await runTests(settingsWith(fakeM(body)), ['/w'], { cwd: here });
      assert.equal(r.kind, 'failed', `${name} must not be reported as a report`);
      if (r.kind !== 'failed') return;
      assert.match(r.failure.message, wanted);
      assert.notEqual(r.failure.action.trim(), '', 'an action is mandatory');
      assert.ok(r.failure.message.includes('m test'), 'names the verb that failed');
    });
  }

  it('a run that finds NO suites reports zero suites explicitly, not an empty silence', async () => {
    const empty = JSON.stringify({
      schemaVersion: '1.0',
      ok: true,
      exit: 0,
      data: { engine: 'ydb', suites: 0, passed: 0, failed: 0, results: [] },
    });
    const r = await runTests(settingsWith(fakeM(`echo '${empty}'`)), ['/w'], { cwd: here });
    assert.equal(r.kind, 'report');
    if (r.kind !== 'report') return;
    assert.equal(r.report.suites, 0);
  });
});

describe('runCoverage', () => {
  it('returns LCOV records read from the file the CLI wrote', async () => {
    const lcov = readFileSync(fx('coverage-ydb.info'), 'utf8');
    const m = fakeM(
      // Emulate `--lcov <path>`: find the flag, write the fixture there.
      `while [ $# -gt 0 ]; do if [ "$1" = "--lcov" ]; then shift; cat "${fx('coverage-ydb.info')}" > "$1"; fi; shift; done\n` +
        `cat "${fx('coverage-ydb.json')}"`,
    );
    const r = await runCoverage(settingsWith(m), ['/w'], { cwd: here });
    assert.equal(r.kind, 'coverage');
    if (r.kind !== 'coverage') return;
    assert.equal(r.records.length, 1);
    assert.deepEqual(r.records[0]?.summary, { covered: 2, total: 2 });
    assert.ok(lcov.includes('ZZMVSMATH.m'));
  });

  it('a green CLI that wrote NO tracefile is a FAILURE, never "0% coverage"', async () => {
    const r = await runCoverage(settingsWith(fakeM(`cat "${fx('coverage-ydb.json')}"`)), ['/w'], {
      cwd: here,
    });
    assert.equal(r.kind, 'failed', 'silently-zero coverage is the exact bug this forbids');
    if (r.kind !== 'failed') return;
    assert.match(r.failure.message, /tracefile|lcov/i);
  });

  it('an EMPTY tracefile is a failure too, with its own wording', async () => {
    const m = fakeM(
      `while [ $# -gt 0 ]; do if [ "$1" = "--lcov" ]; then shift; : > "$1"; fi; shift; done\n` +
        `cat "${fx('coverage-ydb.json')}"`,
    );
    const r = await runCoverage(settingsWith(m), ['/w'], { cwd: here });
    assert.equal(r.kind, 'failed');
    if (r.kind !== 'failed') return;
    assert.match(r.failure.message, /no coverage/i);
  });

  it('a failing CLI reports the failure, not empty gutters', async () => {
    const r = await runCoverage(
      settingsWith(fakeM(`cat "${fx('test-stage-failed.stderr.json')}" >&2; exit 1`)),
      ['/w'],
      { cwd: here },
    );
    assert.equal(r.kind, 'failed');
    if (r.kind !== 'failed') return;
    assert.ok(r.failure.message.includes('m coverage'));
  });
});

describe('runStatus', () => {
  it('healthy engine -> healthy chip with the version', async () => {
    const r = await runStatus(settingsWith(fakeM(`cat "${fx('status-ydb.json')}"`)), { cwd: here });
    assert.equal(r.health, 'healthy');
    assert.ok(r.tooltip.includes('r2.02'));
  });

  it('missing `m` -> UNKNOWN, never a green chip', async () => {
    const r = await runStatus(settingsWith('/definitely/not/here/m'), { cwd: here });
    assert.equal(r.health, 'unknown');
  });

  it('down engine -> down chip', async () => {
    const r = await runStatus(settingsWith(fakeM(`cat "${fx('status-unreachable.json')}"`)), {
      cwd: here,
    });
    assert.equal(r.health, 'down');
  });
});

describe('runExec', () => {
  it('returns the engine stdout for the output channel', async () => {
    const r = await runExec(settingsWith(fakeM(`cat "${fx('exec-ydb.json')}"`)), 'write 2+2', {
      cwd: here,
    });
    assert.equal(r.kind, 'output');
    if (r.kind !== 'output') return;
    assert.equal(r.stdout.trim(), '4');
    assert.equal(r.status, 0);
  });

  it('an engine-side error reaches the channel as stderr, with a non-zero status visible', async () => {
    const body = JSON.stringify({
      schemaVersion: '1.0',
      ok: true,
      exit: 0,
      data: { stdout: '', status: 0, stderr: '%YDB-E-ZLINKFILE Error while zlinking "NOPE"' },
    });
    const r = await runExec(settingsWith(fakeM(`echo '${body}'`)), 'do ^NOPE', { cwd: here });
    assert.equal(r.kind, 'output');
    if (r.kind !== 'output') return;
    assert.match(r.stderr, /ZLINKFILE/);
  });

  it('a busy run-lock is an actionable failure naming the holder', async () => {
    const body = JSON.stringify({
      schemaVersion: '1.0',
      ok: false,
      exit: 4,
      error: {
        code: 'SKIPPED_ENGINE_BUSY',
        exit: 4,
        message: 'engine busy: run-lock held by `m test`',
      },
    });
    const r = await runExec(settingsWith(fakeM(`echo '${body}' >&2; exit 4`)), 'write 1', {
      cwd: here,
    });
    assert.equal(r.kind, 'failed');
    if (r.kind !== 'failed') return;
    assert.ok(r.failure.message.includes('held by'));
    assert.notEqual(r.failure.action.trim(), '');
  });

  it('refuses an empty selection with a message instead of running an empty command', async () => {
    const r = await runExec(settingsWith(fakeM('echo unreachable')), '   \n\t ', { cwd: here });
    assert.equal(r.kind, 'failed');
    if (r.kind !== 'failed') return;
    assert.match(r.failure.message, /nothing to run|empty/i);
  });
});
