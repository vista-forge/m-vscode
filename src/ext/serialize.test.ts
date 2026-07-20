import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { serialize } from './serialize.ts';

describe('serialize', () => {
  it('runs overlapping calls one after another, never concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const fn = serialize(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(active);
      active--;
    });

    await Promise.all([fn(), fn(), fn(), fn(), fn()]);

    assert.equal(maxActive, 1, 'no two invocations must run concurrently');
    assert.deepEqual(
      order,
      [1, 1, 1, 1, 1],
      'each invocation must fully finish before the next starts',
    );
  });

  it('propagates the return value of each call to its own caller', async () => {
    let n = 0;
    const fn = serialize(async () => {
      n++;
      return n;
    });
    const results = await Promise.all([fn(), fn(), fn()]);
    assert.deepEqual(results, [1, 2, 3]);
  });

  it('keeps serializing later calls even after an earlier call throws', async () => {
    const fn = serialize(async (shouldThrow: boolean) => {
      if (shouldThrow) throw new Error('boom');
      return 'ok';
    });

    await assert.rejects(() => fn(true), /boom/);
    // A prior rejection must not wedge the chain — the next call still runs.
    const result = await fn(false);
    assert.equal(result, 'ok');
  });

  it('the case this exists for: a restart triggered mid-restart must not race the first', async () => {
    // Models `restart()` disposing a running client then starting a new one.
    // Before serialization, a second restart could dispose the first's
    // half-started client out from under it — reproduced against the real
    // extension host by the smoke suite (`src/smoke/suite.ts`) as
    // "Pending response rejected since connection got disposed".
    let started = 0;
    let disposedWhileStarting = false;
    let starting = false;
    const restart = serialize(async () => {
      if (starting) disposedWhileStarting = true;
      starting = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      started++;
      starting = false;
    });

    // Fire two restarts back to back, exactly as activate()'s final
    // `await restart()` racing a config-change-triggered `restart()` would.
    await Promise.all([restart(), restart()]);

    assert.equal(
      disposedWhileStarting,
      false,
      'the second restart must wait for the first to finish',
    );
    assert.equal(started, 2, 'both restarts still complete — settings changes are never dropped');
  });
});
