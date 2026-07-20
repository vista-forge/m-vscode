/**
 * The process boundary, exercised against a FAKE `m` CLI.
 *
 * This is where `make check` stays offline and engine-free: the fake is a real
 * executable that replays recorded `m` output (fixtures/cli/*), so everything
 * above it — argv construction, envelope parsing, failure messaging — runs
 * exactly as it does against the real toolchain, with no engine, no Docker and
 * no network. The LIVE dual-engine run is the separate acceptance evidence.
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runM } from './run.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixtures = join(here, 'fixtures', 'cli');

/** Write an executable fake `m` that replays a fixture (or misbehaves on cue). */
function fakeM(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'm-vscode-fake-'));
  const path = join(dir, 'fake-m');
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('runM', () => {
  it('returns the CLI stdout, stderr and exit code unchanged', async () => {
    const m = fakeM(`cat "${join(fixtures, 'test-pass-ydb.json')}"; exit 0`);
    const r = await runM(m, ['test', '.'], { cwd: here });
    assert.equal(r.code, 0);
    assert.equal(r.spawnError, undefined);
    assert.ok(r.stdout.includes('ZZMVSMATHTST'));
  });

  it('passes argv through verbatim — including arguments containing spaces', async () => {
    const m = fakeM('for a in "$@"; do echo "[$a]"; done');
    const r = await runM(m, ['vista', 'exec', 'write 1 , 2'], { cwd: here });
    assert.ok(r.stdout.includes('[write 1 , 2]'), r.stdout);
  });

  it('captures a NON-ZERO exit without throwing — a red test run is data, not a crash', async () => {
    const m = fakeM(`cat "${join(fixtures, 'test-fail-ydb.json')}"; exit 3`);
    const r = await runM(m, ['test', '.'], { cwd: here });
    assert.equal(r.code, 3);
    assert.ok(r.stdout.includes('TESTS_FAILED'));
  });

  it('reports a missing executable as spawnError, not as an empty success', async () => {
    const r = await runM('/definitely/not/here/m', ['test'], { cwd: here });
    assert.ok(r.spawnError, 'a missing binary must be visible');
    assert.ok(r.spawnError?.includes('ENOENT'));
    assert.equal(r.code, null);
  });

  it('kills a hung CLI at the timeout and says so, rather than hanging the editor', async () => {
    const m = fakeM('sleep 30');
    const r = await runM(m, ['test'], { cwd: here, timeoutMs: 200 });
    assert.ok(r.spawnError, 'a timeout must surface as an error');
    assert.ok(/timed out/i.test(r.spawnError ?? ''));
  });

  it('can be cancelled, and reports the cancellation', async () => {
    const m = fakeM('sleep 30');
    const ac = new AbortController();
    const pending = runM(m, ['test'], { cwd: here, signal: ac.signal });
    ac.abort();
    const r = await pending;
    assert.ok(/cancel/i.test(r.spawnError ?? ''), r.spawnError);
  });

  it('collects large output without truncation (a big suite report must survive)', async () => {
    const m = fakeM(
      'i=0; while [ $i -lt 4000 ]; do echo "0123456789012345678901234567890123456789"; i=$((i+1)); done',
    );
    const r = await runM(m, ['test'], { cwd: here });
    assert.ok(r.stdout.length > 160_000, `got ${r.stdout.length} bytes`);
  });
});
