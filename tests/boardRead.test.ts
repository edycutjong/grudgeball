import { beforeEach, describe, expect, it } from 'vitest';
import { keys } from '../src/server/core/keys';
import { compileBoard } from '../src/server/core/compile';
import {
  activeObjects,
  boardView,
  countActiveTraps,
  previewDayFor,
  readBoard,
  readPlayerDayState,
} from '../src/server/core/boardRead';
import { ALICE, NOW, openCellsFor, queueDirect, TARGET, TODAY } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(() => {
  stub = new RedisStub();
});

describe('readBoard', () => {
  it('returns null when no board is compiled', async () => {
    expect(await readBoard(stub, TODAY)).toBeNull();
  });

  it('skips malformed object payloads but keeps valid ones', async () => {
    const cell = openCellsFor(TODAY)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TODAY, { id: 'good', type: 'spike', cell });
    await compileBoard(stub, TODAY);
    // Corrupt an extra field directly in the hash (simulating drift/corruption).
    await stub.hSet(keys.board(TODAY), { 'obj:ghost': 'not json' });
    const parsed = await readBoard(stub, TODAY);
    expect(parsed?.objects.map((o) => o.id)).toEqual(['good']);
  });

  it('treats a non-numeric kills/saves counter as 0 instead of NaN', async () => {
    const cell = openCellsFor(TODAY)[0];
    if (cell === undefined) throw new Error('need cell');
    const p = await queueDirect(stub, TODAY, { id: 'p1', type: 'spike', cell });
    await compileBoard(stub, TODAY);
    await stub.hSet(keys.board(TODAY), { [`obj:${p.id}:kills`]: 'not-a-number', [`obj:${p.id}:saves`]: 'nope' });
    const parsed = await readBoard(stub, TODAY);
    const obj = parsed?.objects.find((o) => o.id === p.id);
    expect(obj?.kills).toBe(0);
    expect(obj?.saves).toBe(0);
  });

  it('defaults kills/saves to 0 when the counter fields are entirely absent', async () => {
    const cell = openCellsFor(TODAY)[0];
    if (cell === undefined) throw new Error('need cell');
    const p = await queueDirect(stub, TODAY, { id: 'p1', type: 'spike', cell });
    await compileBoard(stub, TODAY);
    await stub.hDel(keys.board(TODAY), [`obj:${p.id}:kills`, `obj:${p.id}:saves`]);
    const parsed = await readBoard(stub, TODAY);
    const obj = parsed?.objects.find((o) => o.id === p.id);
    expect(obj?.kills).toBe(0);
    expect(obj?.saves).toBe(0);
  });

  it('falls back to an empty seed string when meta:seed is absent', async () => {
    await stub.hSet(keys.board(TODAY), { 'meta:v': '1' });
    const parsed = await readBoard(stub, TODAY);
    expect(parsed?.seed).toBe('');
  });

  it('tolerates corrupted meta:trails JSON (falls back to [])', async () => {
    await compileBoard(stub, TODAY);
    await stub.hSet(keys.board(TODAY), { 'meta:trails': 'not json' });
    const parsed = await readBoard(stub, TODAY);
    expect(parsed?.trails).toEqual([]);
  });

  it('falls back to [] when meta:trails is valid JSON but not an array', async () => {
    await compileBoard(stub, TODAY);
    await stub.hSet(keys.board(TODAY), { 'meta:trails': '{"not":"array"}' });
    const parsed = await readBoard(stub, TODAY);
    expect(parsed?.trails).toEqual([]);
  });
});

describe('activeObjects / countActiveTraps', () => {
  it('filters by releaseHour and counts only menace-category traps', () => {
    function obj(id: string, type: 'spike' | 'cushion', releaseHour: number) {
      return { id, type, cell: { c: 0, r: 0 }, rot: 0 as const, author: 'a', authorId: 't2_a', name: id, releaseHour };
    }
    const objs = [obj('a', 'spike', 0), obj('b', 'spike', 12), obj('c', 'cushion', 0)];
    expect(activeObjects(objs, 5).map((o) => o.id)).toEqual(['a', 'c']);
    expect(countActiveTraps(objs, 5)).toBe(1);
    expect(countActiveTraps(objs, 12)).toBe(2);
  });
});

describe('readPlayerDayState', () => {
  it('returns null for an anonymous user', async () => {
    expect(await readPlayerDayState(stub, null, TODAY)).toBeNull();
  });

  it('returns default state for a fresh user', async () => {
    const state = await readPlayerDayState(stub, ALICE, TODAY);
    expect(state).toEqual({
      userId: ALICE.userId,
      username: ALICE.username,
      marblesUsed: 0,
      placed: false,
      hasUnseenReport: false,
    });
  });

  it('caps marblesUsed at MARBLES_PER_DAY and reflects placed/report state', async () => {
    await stub.hSet(keys.user(ALICE.userId, TODAY), { marblesUsed: '99', placed: '1' });
    await stub.hSet(keys.report('2026-07-09', ALICE.userId), { kills: '3' });
    const state = await readPlayerDayState(stub, ALICE, TODAY);
    expect(state?.marblesUsed).toBe(3);
    expect(state?.placed).toBe(true);
    expect(state?.hasUnseenReport).toBe(true);
  });

  it('hasUnseenReport is false once the report has been marked seen', async () => {
    await stub.hSet(keys.report('2026-07-09', ALICE.userId), { kills: '3' });
    await stub.hSet(keys.user(ALICE.userId, TODAY), { lastReportSeen: '2026-07-09' });
    const state = await readPlayerDayState(stub, ALICE, TODAY);
    expect(state?.hasUnseenReport).toBe(false);
  });
});

describe('boardView', () => {
  it('live mode: assembles the compiled board with active-hour filtering', async () => {
    const cell = openCellsFor(TODAY)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TODAY, { id: 'p1', type: 'spike', cell, ts: NOW - 90_000_000 });
    await compileBoard(stub, TODAY);
    const view = await boardView(stub, TODAY, NOW, ALICE, TODAY);
    expect(view.mode).toBe('live');
    expect(view.day).toBe(TODAY);
    expect(view.me?.userId).toBe(ALICE.userId);
    expect(view.trapCap).toBeGreaterThan(0);
  });

  it("live mode for a past/other day uses hour 23 (fully accreted)", async () => {
    await compileBoard(stub, TODAY);
    const view = await boardView(stub, TODAY, NOW, null, TARGET);
    expect(view.activeHour).toBe(23);
  });

  it("preview mode: tomorrow's queue renders over generated terrain", async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, {
      id: 'q1',
      type: 'fan',
      cell,
      author: 'crowd',
      authorId: 't2_crowd',
      name: 'Whirl',
    });
    const view = await boardView(stub, TARGET, NOW, null, TODAY);
    expect(view.mode).toBe('preview');
    expect(view.objects.map((o) => o.id)).toEqual(['q1']);
    expect(view.objects[0]).toMatchObject({ releaseHour: 0, kills: 0, saves: 0 });
    expect(view.activeHour).toBe(0);
  });

  it('preview mode ignores corrupted queued entries', async () => {
    await stub.hSet(keys.queued(TARGET), { ghost: 'not json' });
    const view = await boardView(stub, TARGET, NOW, null, TODAY);
    expect(view.objects).toEqual([]);
  });
});

describe('previewDayFor', () => {
  it("is tomorrow's day string", () => {
    expect(previewDayFor(TODAY)).toBe(TARGET);
  });
});
