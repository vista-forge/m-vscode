import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Debouncer } from './debounce.ts';

describe('Debouncer', () => {
  it('collapses a burst into a single trailing call', async () => {
    const seen: string[] = [];
    const d = new Debouncer(20);
    for (const ch of ['a', 'b', 'c']) d.schedule('doc', () => seen.push(ch));
    await sleep(60);
    assert.deepEqual(seen, ['c']);
  });

  it('keys independently, so one document cannot starve another', async () => {
    const seen: string[] = [];
    const d = new Debouncer(20);
    d.schedule('one', () => seen.push('one'));
    d.schedule('two', () => seen.push('two'));
    await sleep(60);
    assert.deepEqual(seen.sort(), ['one', 'two']);
  });

  it('runs immediately when the delay is zero (debouncing is opt-out)', () => {
    let ran = false;
    new Debouncer(0).schedule('doc', () => {
      ran = true;
    });
    assert.equal(ran, true);
  });

  it('flush runs a pending call now', async () => {
    let ran = false;
    const d = new Debouncer(1_000);
    d.schedule('doc', () => {
      ran = true;
    });
    d.flush('doc');
    assert.equal(ran, true);
    await sleep(5);
  });

  it('flush of an unknown key is a no-op, not a crash', () => {
    new Debouncer(10).flush('nothing');
  });

  it('cancel drops a pending call', async () => {
    let ran = false;
    const d = new Debouncer(20);
    d.schedule('doc', () => {
      ran = true;
    });
    d.cancel('doc');
    await sleep(60);
    assert.equal(ran, false);
  });

  it('dispose drops every pending call', async () => {
    let n = 0;
    const d = new Debouncer(20);
    d.schedule('a', () => n++);
    d.schedule('b', () => n++);
    d.dispose();
    await sleep(60);
    assert.equal(n, 0);
  });
});
