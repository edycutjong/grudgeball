import { beforeEach, describe, expect, it } from 'vitest';
import { keys } from '../src/server/core/keys';
import { compileBoard } from '../src/server/core/compile';
import { buildReports, descRank, readReport, reportHeadline } from '../src/server/core/report';
import { NOW, openCellsFor, queueDirect, TARGET } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(() => {
  stub = new RedisStub();
});

describe('buildReports / readReport / reportHeadline', () => {
  it('returns no-board when the day has not compiled yet', async () => {
    const res = await buildReports(stub, TARGET);
    expect(res).toEqual({ status: 'no-board', day: TARGET });
    expect(await reportHeadline(stub, TARGET)).toBeNull();
  });

  it('aggregates per-author kills/saves and identifies the deadliest object', async () => {
    const cells = openCellsFor(TARGET);
    const spike = cells[0];
    const cushion = cells[1];
    if (spike === undefined || cushion === undefined) throw new Error('need cells');
    await queueDirect(stub, TARGET, {
      id: 'p1',
      type: 'spike',
      cell: spike,
      author: 'greg',
      authorId: 't2_greg',
      name: "Greg's Regret",
      ts: NOW - 2000,
    });
    await queueDirect(stub, TARGET, {
      id: 'p2',
      type: 'cushion',
      cell: cushion,
      author: 'mercy',
      authorId: 't2_mercy',
      name: 'Soft Landing',
      ts: NOW - 1000,
    });
    await compileBoard(stub, TARGET);
    await stub.hIncrBy(keys.board(TARGET), 'obj:p1:kills', 87);
    await stub.hIncrBy(keys.board(TARGET), 'obj:p2:saves', 12);
    await stub.zAdd(keys.lb('menace', TARGET), { member: 'greg', score: 87 });
    await stub.zAdd(keys.lb('angel', TARGET), { member: 'mercy', score: 12 });
    await stub.zAdd(keys.lb('depth', TARGET), { member: 'greg', score: 20 });

    const res = await buildReports(stub, TARGET);
    expect(res).toEqual({ status: 'ok', day: TARGET, users: 2, boardKills: 87, boardSaves: 12 });

    const gregReport = await readReport(stub, TARGET, 't2_greg');
    expect(gregReport).toMatchObject({
      day: TARGET,
      objectName: "Greg's Regret",
      objectType: 'spike',
      kills: 87,
      saves: 0,
      menaceRank: 1,
      angelRank: null,
      depthRank: 1,
      boardKills: 87,
      boardSaves: 12,
      deadliestName: "Greg's Regret",
      deadliestAuthor: 'greg',
      deadliestKills: 87,
      builders: 2,
    });

    const mercyReport = await readReport(stub, TARGET, 't2_mercy');
    expect(mercyReport).toMatchObject({
      objectName: 'Soft Landing',
      objectType: 'cushion',
      kills: 0,
      saves: 12,
      menaceRank: null,
      angelRank: 1,
    });

    const headline = await reportHeadline(stub, TARGET);
    expect(headline).toContain("Greg's Regret");
    expect(headline).toContain('u/greg');
    expect(headline).toContain('87 victims');
    expect(headline).toContain('2 of you');
  });

  it('readReport returns null when the user has no report', async () => {
    expect(await readReport(stub, TARGET, 'ghost')).toBeNull();
  });

  it('descRank returns null for a member absent from the zset', async () => {
    expect(await descRank(stub, keys.lb('menace', TARGET), 'nobody')).toBeNull();
  });

  it('re-running buildReports for the same frozen day overwrites with identical values', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, { id: 'p1', type: 'bumper', cell, author: 'x', authorId: 't2_x' });
    await compileBoard(stub, TARGET);
    const first = await buildReports(stub, TARGET);
    const second = await buildReports(stub, TARGET);
    expect(second).toEqual(first);
  });

  it('readReport treats a corrupted rank field as null (not a crash)', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, { id: 'p1', type: 'bumper', cell, author: 'x', authorId: 't2_x' });
    await compileBoard(stub, TARGET);
    await buildReports(stub, TARGET);
    await stub.hSet(keys.report(TARGET, 't2_x'), { menaceRank: 'not-a-number' });
    const report = await readReport(stub, TARGET, 't2_x');
    expect(report?.menaceRank).toBeNull();
  });

  it('readReport falls back to an empty objectType on corrupted/unknown data', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(stub, TARGET, { id: 'p1', type: 'bumper', cell, author: 'x', authorId: 't2_x' });
    await compileBoard(stub, TARGET);
    await buildReports(stub, TARGET);
    await stub.hSet(keys.report(TARGET, 't2_x'), { objectType: 'not-a-real-type' });
    const report = await readReport(stub, TARGET, 't2_x');
    expect(report?.objectType).toBe('');
  });

  it('readReport defaults builders to 0 when reportMeta has no rows at all', async () => {
    await stub.hSet(keys.report(TARGET, 't2_bare2'), { kills: '0' });
    const report = await readReport(stub, TARGET, 't2_bare2');
    expect(report?.builders).toBe(0);
  });

  it('readReport/reportHeadline default every optional field when only the presence-marker is set', async () => {
    // Minimal report hash: just enough for the `h['kills'] === undefined`
    // presence check to pass, everything else absent → every `?? fallback`
    // and null-rank branch exercised at once.
    await stub.hSet(keys.report(TARGET, 't2_bare'), { kills: '0' });
    await stub.hSet(keys.reportMeta(TARGET), { builders: '1' });
    const report = await readReport(stub, TARGET, 't2_bare');
    expect(report).toMatchObject({
      objectName: '',
      objectType: '',
      saves: 0,
      menaceRank: null,
      angelRank: null,
      depthRank: null,
      boardKills: 0,
      boardSaves: 0,
      deadliestName: '',
      deadliestAuthor: '',
      deadliestKills: 0,
    });
    const headline = await reportHeadline(stub, TARGET);
    expect(headline).toContain('""'); // empty deadliestName quoted
    expect(headline).toContain('0 victims');
    expect(headline).toContain('0 marbles');
  });

  it('only keeps the highest-scoring object per author across multiple placements', async () => {
    const cells = openCellsFor(TARGET);
    const first = cells[0];
    const second = cells[1];
    if (first === undefined || second === undefined) throw new Error('need cells');
    await queueDirect(stub, TARGET, {
      id: 'p1',
      type: 'spike',
      cell: first,
      author: 'greg',
      authorId: 't2_greg',
      name: 'First Trap',
      ts: NOW - 2000,
    });
    await queueDirect(stub, TARGET, {
      id: 'p2',
      type: 'spike',
      cell: second,
      author: 'greg',
      authorId: 't2_greg',
      name: 'Second Trap',
      ts: NOW - 1000,
    });
    await compileBoard(stub, TARGET);
    await stub.hIncrBy(keys.board(TARGET), 'obj:p1:kills', 10); // objScore 10
    await stub.hIncrBy(keys.board(TARGET), 'obj:p2:kills', 3); // objScore 3, lower — must not override
    await buildReports(stub, TARGET);
    const report = await readReport(stub, TARGET, 't2_greg');
    expect(report?.objectName).toBe('First Trap');
    expect(report?.kills).toBe(13); // aggregated across both objects
  });
});
