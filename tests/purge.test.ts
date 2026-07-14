import { beforeEach, describe, expect, it } from 'vitest';
import { bandOf } from '../src/shared/grid';
import { keys } from '../src/server/core/keys';
import { purgeObject } from '../src/server/core/purge';
import { compileBoard } from '../src/server/core/compile';
import { NOW, openCellsFor, queueDirect, TARGET, TODAY } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(() => {
  stub = new RedisStub();
});

describe('purgeObject', () => {
  it('returns not-found for an empty/whitespace identifier', async () => {
    const res = await purgeObject(stub, TODAY, '   ', 'mod', NOW);
    expect(res).toEqual({ status: 'not-found', ident: '   ' });
  });

  it("purges a live object from today's board by exact id", async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, { id: 'p1', type: 'spike', cell, name: 'Bad Spike' });
    await compileBoard(stub, TARGET);
    const before = await stub.hGet(keys.density(TARGET, bandOf(cell.r)), 'menace');
    expect(before).toBe('1');

    const res = await purgeObject(stub, TARGET, 'p1', 'modAlice', NOW);
    expect(res).toEqual({ status: 'purged', where: 'board', objId: 'p1', name: 'Bad Spike' });
    expect(await stub.hGet(keys.board(TARGET), 'obj:p1')).toBeUndefined();
    expect(await stub.hGet(keys.density(TARGET, bandOf(cell.r)), 'menace')).toBe('0');
    const audit = await stub.zRange(keys.audit(TARGET), 0, -1, { by: 'rank' });
    expect(audit).toHaveLength(1);
    const entry = JSON.parse(audit[0]?.member ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({ act: 'purge', objId: 'p1', name: 'Bad Spike', by: 'modAlice' });
  });

  it('purges a live object from today\'s board by exact (case-insensitive) name', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, { id: 'p2', type: 'cushion', cell, name: 'Soft Spot' });
    await compileBoard(stub, TARGET);
    const res = await purgeObject(stub, TARGET, 'SOFT spot', 'mod', NOW);
    expect(res).toEqual({ status: 'purged', where: 'board', objId: 'p2', name: 'Soft Spot' });
  });

  it("purges a pending object from tomorrow's queue when not yet compiled", async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, { id: 'q1', type: 'fan', cell, name: 'Whirlwind' });
    const res = await purgeObject(stub, TODAY, 'q1', 'mod', NOW);
    expect(res).toEqual({ status: 'purged', where: 'queue', objId: 'q1', name: 'Whirlwind' });
    expect(await stub.hGet(keys.queued(TARGET), 'q1')).toBeUndefined();
    expect(await stub.zScore(keys.queue(TARGET), 'q1')).toBeUndefined();
  });

  it('returns not-found when nothing matches on the board or the queue', async () => {
    const res = await purgeObject(stub, TODAY, 'nonexistent', 'mod', NOW);
    expect(res).toEqual({ status: 'not-found', ident: 'nonexistent' });
  });

  it("falls through to the queue when today's board exists but has no match", async () => {
    const todayCell = openCellsFor(TODAY)[0];
    const queueCell = openCellsFor(TARGET)[0];
    if (todayCell === undefined || queueCell === undefined) throw new Error('need cells');
    await queueDirect(stub, TODAY, { id: 'unrelated', type: 'bumper', cell: todayCell });
    await compileBoard(stub, TODAY); // today's board compiles, but doesn't contain 'q1'
    await queueDirect(stub, TARGET, { id: 'q1', type: 'fan', cell: queueCell, name: 'Whirlwind' });
    const res = await purgeObject(stub, TODAY, 'q1', 'mod', NOW);
    expect(res).toEqual({ status: 'purged', where: 'queue', objId: 'q1', name: 'Whirlwind' });
  });

  it('matches a queued object by exact name, not just id', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, { id: 'q5', type: 'fan', cell, name: 'Named Trap' });
    const res = await purgeObject(stub, TODAY, 'named trap', 'mod', NOW);
    expect(res).toEqual({ status: 'purged', where: 'queue', objId: 'q5', name: 'Named Trap' });
  });

  it('skips a non-matching queued entry before finding the real match', async () => {
    const cells = openCellsFor(TARGET);
    const other = cells[0];
    const real = cells[1];
    if (other === undefined || real === undefined) throw new Error('need cells');
    await queueDirect(stub, TARGET, { id: 'other', type: 'bumper', cell: other, name: 'Not It' });
    await queueDirect(stub, TARGET, { id: 'target', type: 'spike', cell: real, name: 'The One' });
    const res = await purgeObject(stub, TODAY, 'target', 'mod', NOW);
    expect(res).toEqual({ status: 'purged', where: 'queue', objId: 'target', name: 'The One' });
  });

  it('ignores a corrupted queued entry while still finding the real match', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await stub.hSet(keys.queued(TARGET), { ghost: 'not json' });
    await queueDirect(stub, TARGET, { id: 'q9', type: 'spike', cell, name: 'Real Trap' });
    const res = await purgeObject(stub, TODAY, 'q9', 'mod', NOW);
    expect(res).toEqual({ status: 'purged', where: 'queue', objId: 'q9', name: 'Real Trap' });
  });
});
