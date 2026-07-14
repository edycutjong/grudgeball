/**
 * The stub must faithfully model the Devvit redis subset the app relies on —
 * these tests pin the semantics the whole suite stands on.
 */
import { describe, expect, it } from 'vitest';
import { RedisStub } from './helpers/redisStub';

describe('RedisStub: strings & keys', () => {
  it('get returns undefined for missing keys, set/get round-trips', async () => {
    const r = new RedisStub();
    expect(await r.get('nope')).toBeUndefined();
    await r.set('k', 'v');
    expect(await r.get('k')).toBe('v');
  });

  it('del removes and exists counts', async () => {
    const r = new RedisStub();
    await r.set('a', '1');
    await r.set('b', '2');
    expect(await r.exists('a', 'b', 'c')).toBe(2);
    await r.del('a', 'c');
    expect(await r.exists('a', 'b')).toBe(1);
  });
});

describe('RedisStub: hashes', () => {
  it('hGetAll returns {} for a missing key (Devvit semantics)', async () => {
    const r = new RedisStub();
    expect(await r.hGetAll('missing')).toEqual({});
  });

  it('hSet/hGet/hKeys/hLen round-trip', async () => {
    const r = new RedisStub();
    await r.hSet('h', { a: '1', b: '2' });
    expect(await r.hGet('h', 'a')).toBe('1');
    expect((await r.hKeys('h')).sort()).toEqual(['a', 'b']);
    expect(await r.hLen('h')).toBe(2);
  });

  it('hSetNX only writes absent fields', async () => {
    const r = new RedisStub();
    expect(await r.hSetNX('h', 'f', 'first')).toBe(1);
    expect(await r.hSetNX('h', 'f', 'second')).toBe(0);
    expect(await r.hGet('h', 'f')).toBe('first');
  });

  it('hIncrBy creates and increments; hDel removes', async () => {
    const r = new RedisStub();
    expect(await r.hIncrBy('h', 'n', 2)).toBe(2);
    expect(await r.hIncrBy('h', 'n', -1)).toBe(1);
    expect(await r.hDel('h', ['n', 'ghost'])).toBe(1);
    expect(await r.hGet('h', 'n')).toBeUndefined();
  });
});

describe('RedisStub: sorted sets', () => {
  it('zRange by rank sorts by (score, member) ascending', async () => {
    const r = new RedisStub();
    await r.zAdd('z', { member: 'b', score: 2 }, { member: 'a', score: 1 }, { member: 'c', score: 2 });
    const all = await r.zRange('z', 0, -1, { by: 'rank' });
    expect(all.map((e) => e.member)).toEqual(['a', 'b', 'c']);
  });

  it('zRange reverse returns highest first with rank indices', async () => {
    const r = new RedisStub();
    await r.zAdd('z', { member: 'low', score: 1 }, { member: 'mid', score: 5 }, { member: 'top', score: 9 });
    const top2 = await r.zRange('z', 0, 1, { by: 'rank', reverse: true });
    expect(top2.map((e) => e.member)).toEqual(['top', 'mid']);
  });

  it('zRank is ascending 0-based; zScore/zCard/zIncrBy behave', async () => {
    const r = new RedisStub();
    await r.zAdd('z', { member: 'a', score: 10 }, { member: 'b', score: 20 });
    expect(await r.zRank('z', 'a')).toBe(0);
    expect(await r.zRank('z', 'missing')).toBeUndefined();
    expect(await r.zScore('z', 'b')).toBe(20);
    expect(await r.zIncrBy('z', 'a', 15)).toBe(25);
    expect(await r.zCard('z')).toBe(2);
    await r.zRem('z', ['a']);
    expect(await r.zCard('z')).toBe(1);
  });
});

describe('RedisStub: watch/multi/exec optimistic concurrency', () => {
  it('exec applies queued ops atomically and only at exec time', async () => {
    const r = new RedisStub();
    const tx = await r.watch('h');
    await tx.multi();
    await tx.hSet('h', { f: '1' });
    await tx.zAdd('z', { member: 'm', score: 1 });
    expect(await r.hGet('h', 'f')).toBeUndefined(); // not yet applied
    const res = await tx.exec();
    expect(res).not.toBeNull();
    expect(await r.hGet('h', 'f')).toBe('1');
    expect(await r.zScore('z', 'm')).toBe(1);
  });

  it('exec resolves null when a watched key changed after watch', async () => {
    const r = new RedisStub();
    await r.hSet('h', { f: '0' });
    const tx = await r.watch('h');
    await r.hSet('h', { f: 'raced' }); // concurrent writer
    await tx.multi();
    await tx.hSet('h', { f: '1' });
    expect(await tx.exec()).toBeNull();
    expect(await r.hGet('h', 'f')).toBe('raced'); // queued ops NOT applied
  });

  it('unwatch/discard release the watch (hygiene counter)', async () => {
    const r = new RedisStub();
    const t1 = await r.watch('a');
    const t2 = await r.watch('b');
    expect(r.openWatches).toBe(2);
    await t1.unwatch();
    await t2.discard();
    expect(r.openWatches).toBe(0);
  });

  it('changes to non-watched keys do not abort the transaction', async () => {
    const r = new RedisStub();
    const tx = await r.watch('watched');
    await r.hSet('unrelated', { x: '1' });
    await tx.multi();
    await tx.hSet('watched', { ok: '1' });
    expect(await tx.exec()).not.toBeNull();
  });
});
