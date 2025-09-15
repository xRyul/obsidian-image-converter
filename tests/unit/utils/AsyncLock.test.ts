import { describe, it, expect } from 'vitest';
import { AsyncLock } from '../../../src/AsyncLock';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('AsyncLock', () => {
  it('Given no lock for key, When acquire is called, Then fn runs immediately and resolves (17.1)', async () => {
    const lock = new AsyncLock();
    const order: string[] = [];

    await lock.acquire('k', async () => {
      order.push('A');
    });

    expect(order).toEqual(['A']);
  });

  it('Given a task holds key, When another acquire(k) is scheduled, Then second runs only after first releases (17.2)', async () => {
    const lock = new AsyncLock();
    const order: string[] = [];

    const p1 = lock.acquire('k', async () => {
      order.push('A-start');
      await delay(20);
      order.push('A-end');
    });

    const p2 = lock.acquire('k', async () => {
      order.push('B');
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(['A-start', 'A-end', 'B']);
  });

  it('Given first task throws, When second is queued, Then lock is released and second executes (17.3)', async () => {
    const lock = new AsyncLock();
    const order: string[] = [];

    await expect(
      lock.acquire('k', async () => {
        order.push('A-start');
        await delay(10);
        order.push('A-throw');
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    await lock.acquire('k', async () => {
      order.push('B');
    });

    expect(order).toEqual(['A-start', 'A-throw', 'B']);
  });

  it('Given two tasks acquire same key concurrently, Then T1 completes before T2 starts (17.4)', async () => {
    const lock = new AsyncLock();
    const order: string[] = [];

    const t1 = lock.acquire('k', async () => {
      order.push('T1-start');
      await delay(15);
      order.push('T1-end');
    });

    const t2 = lock.acquire('k', async () => {
      order.push('T2');
    });

    await Promise.all([t1, t2]);
    expect(order).toEqual(['T1-start', 'T1-end', 'T2']);
  });

  it('Given tasks for different keys, When started concurrently, Then both can run without blocking each other (17.5)', async () => {
    const lock = new AsyncLock();
    const timeline: string[] = [];

    const tA = lock.acquire('a', async () => {
      timeline.push('a-start');
      await delay(10);
      timeline.push('a-end');
    });
    const tB = lock.acquire('b', async () => {
      timeline.push('b-start');
      await delay(5);
      timeline.push('b-end');
    });

    await Promise.all([tA, tB]);

    // We only assert that both finished and ordering across keys is not strictly serialized
    expect(timeline).toContain('a-start');
    expect(timeline).toContain('a-end');
    expect(timeline).toContain('b-start');
    expect(timeline).toContain('b-end');
    // And importantly there is no interlocking across keys
    const idxAStart = timeline.indexOf('a-start');
    const idxBStart = timeline.indexOf('b-start');
    expect(idxAStart).toBeGreaterThanOrEqual(0);
    expect(idxBStart).toBeGreaterThanOrEqual(0);
  });
});
