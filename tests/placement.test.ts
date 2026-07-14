/**
 * Transactional Placement Engine — invariants I1-I4 under contention.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BAND_CAP, BOARD_OBJECT_CAP, GRID_COLS } from '../src/shared/constants';
import { bandOf, cellKey } from '../src/shared/grid';
import { generateTerrain } from '../src/shared/terrain';
import type { Cell } from '../src/shared/types';
import { keys } from '../src/server/core/keys';
import { packQueued } from '../src/server/core/pack';
import { placeObject } from '../src/server/core/placement';
import { unpackQueued } from '../src/server/core/pack';
import { ALICE, BOB, NOW, openCellsFor, queueDirect, spendMarbles, TARGET, TODAY } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(async () => {
  stub = new RedisStub();
  await spendMarbles(stub, ALICE, TODAY);
  await spendMarbles(stub, BOB, TODAY);
});

function deps(user: { userId: string; username: string } | null = ALICE) {
  return { redis: stub, now: NOW, user };
}

function firstOpenCell(occupied: Cell[] = []): Cell {
  const cell = openCellsFor(TARGET, occupied)[0];
  if (cell === undefined) throw new Error('no open cell');
  return cell;
}

describe('placeObject: happy path', () => {
  it('writes queue entry, payload, user flag, density, and audit atomically', async () => {
    const cell = firstOpenCell();
    const res = await placeObject(deps(), { type: 'spike', cell, rot: 0, name: 'First Blood' });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.day).toBe(TARGET);
    expect(res.placementId).toBe(`p_${TARGET}_${ALICE.userId}`);

    const queue = await stub.zRange(keys.queue(TARGET), 0, -1, { by: 'rank' });
    expect(queue.map((e) => e.member)).toEqual([res.placementId]);
    expect(queue[0]?.score).toBe(NOW);

    const raw = await stub.hGet(keys.queued(TARGET), res.placementId);
    expect(raw).toBeDefined();
    const payload = unpackQueued(res.placementId, raw ?? '');
    expect(payload).toMatchObject({
      type: 'spike',
      cell,
      author: ALICE.username,
      authorId: ALICE.userId,
      name: 'First Blood',
      ts: NOW,
    });

    expect(await stub.hGet(keys.user(ALICE.userId, TODAY), 'placed')).toBe('1');
    expect(await stub.hGet(keys.density(TARGET, bandOf(cell.r)), 'menace')).toBe('1');

    const audit = await stub.zRange(keys.audit(TARGET), 0, -1, { by: 'rank' });
    expect(audit.length).toBe(1);
    const entry = JSON.parse(audit[0]?.member ?? '{}') as Record<string, unknown>;
    expect(entry['uid']).toBe(ALICE.userId);
    expect(entry['cell']).toBe(cellKey(cell));
    expect(entry['ts']).toBe(NOW);
  });

  it('trims and keeps the filtered name', async () => {
    const cell = firstOpenCell();
    const res = await placeObject(deps(), { type: 'cushion', cell, rot: 0, name: '  Soft   Spot ' });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    const raw = await stub.hGet(keys.queued(TARGET), res.placementId);
    expect(unpackQueued(res.placementId, raw ?? '')?.name).toBe('Soft Spot');
  });
});

describe('placeObject: static rejections', () => {
  it('rejects anonymous users', async () => {
    const res = await placeObject(deps(null), { type: 'spike', cell: firstOpenCell(), rot: 0, name: 'X' });
    expect(res).toMatchObject({ status: 'rejected', code: 'ANONYMOUS' });
  });

  it('rejects before all marbles are spent (placement unlocks after play)', async () => {
    await stub.hSet(keys.user(BOB.userId, TODAY), { marblesUsed: '2' });
    const res = await placeObject(deps(BOB), { type: 'spike', cell: firstOpenCell(), rot: 0, name: 'X' });
    expect(res).toMatchObject({ status: 'rejected', code: 'MARBLES_REMAIN' });
  });

  it('rejects a brand-new user with no marblesUsed field at all (defaults to 0)', async () => {
    const stranger = { userId: 't2_stranger', username: 'stranger' };
    const res = await placeObject({ redis: stub, now: NOW, user: stranger }, {
      type: 'spike',
      cell: firstOpenCell(),
      rot: 0,
      name: 'X',
    });
    expect(res).toMatchObject({ status: 'rejected', code: 'MARBLES_REMAIN' });
  });

  it('rejects unknown object types', async () => {
    const res = await placeObject(deps(), { type: 'lava', cell: firstOpenCell(), rot: 0, name: 'X' });
    expect(res).toMatchObject({ status: 'rejected', code: 'BAD_TYPE' });
  });

  it('rejects filtered names', async () => {
    const res = await placeObject(deps(), { type: 'spike', cell: firstOpenCell(), rot: 0, name: 'sh1t pit' });
    expect(res).toMatchObject({ status: 'rejected', code: 'BAD_NAME' });
  });

  it('accepts every legal rotation and falls back to 0 for an out-of-range one', async () => {
    const cells = openCellsFor(TARGET);
    for (const rot of [0, 1, 2, 3, 9] as const) {
      const stub2 = new RedisStub();
      await spendMarbles(stub2, ALICE, TODAY);
      const cell = cells[rot];
      if (cell === undefined) throw new Error('need cell');
      const res = await placeObject(
        { redis: stub2, now: NOW, user: ALICE },
        { type: 'spike', cell, rot, name: 'Rotator' }
      );
      expect(res.status).toBe('ok');
    }
  });

  it('rejects the spawn apron, goal apron, and out-of-bounds cells', async () => {
    for (const cell of [
      { c: 4, r: 0 },
      { c: 4, r: 1 },
      { c: 4, r: 22 },
      { c: 4, r: 23 },
      { c: -1, r: 10 },
      { c: GRID_COLS, r: 10 },
    ]) {
      const res = await placeObject(deps(), { type: 'spike', cell, rot: 0, name: 'X' });
      expect(res).toMatchObject({ status: 'rejected', code: 'ILLEGAL_CELL' });
    }
  });

  it("rejects tomorrow's terrain pegs and reserved gate cells", async () => {
    const t = generateTerrain(TARGET);
    const peg = t.terrain.find((c) => c.r >= 3 && c.r <= 21);
    const gate = t.gates[0];
    expect(peg).toBeDefined();
    expect(gate).toBeDefined();
    if (peg === undefined || gate === undefined) return;
    const res1 = await placeObject(deps(), { type: 'spike', cell: peg, rot: 0, name: 'X' });
    expect(res1).toMatchObject({ status: 'rejected', code: 'ILLEGAL_CELL' });
    const res2 = await placeObject(deps(), { type: 'spike', cell: gate, rot: 0, name: 'X' });
    expect(res2).toMatchObject({ status: 'rejected', code: 'ILLEGAL_CELL' });
  });
});

describe('placeObject: transactional invariants', () => {
  it('I1: one placement per user per day, enforced in-tx', async () => {
    const cells = openCellsFor(TARGET);
    const c1 = cells[0];
    const c2 = cells[1];
    if (c1 === undefined || c2 === undefined) throw new Error('need cells');
    const first = await placeObject(deps(), { type: 'spike', cell: c1, rot: 0, name: 'One' });
    expect(first.status).toBe('ok');
    const second = await placeObject(deps(), { type: 'fan', cell: c2, rot: 0, name: 'Two' });
    expect(second).toMatchObject({ status: 'rejected', code: 'ALREADY_PLACED' });
    expect(await stub.zCard(keys.queue(TARGET))).toBe(1);
  });

  it('rejects a cell already claimed in the queue (pre-read)', async () => {
    const cell = firstOpenCell();
    await queueDirect(stub, TARGET, { type: 'bumper', cell });
    const res = await placeObject(deps(), { type: 'spike', cell, rot: 0, name: 'X' });
    expect(res).toMatchObject({ status: 'rejected', code: 'CELL_TAKEN' });
  });

  it('ignores a corrupted queued entry while validating a fresh placement', async () => {
    await stub.hSet(keys.queued(TARGET), { ghost: 'not json' });
    const res = await placeObject(deps(), { type: 'spike', cell: firstOpenCell(), rot: 0, name: 'X' });
    expect(res.status).toBe('ok');
  });

  it('treats a non-numeric marblesUsed value as 0 (still locked out of placement)', async () => {
    await stub.hSet(keys.user(ALICE.userId, TODAY), { marblesUsed: 'not-a-number' });
    const res = await placeObject(deps(), { type: 'spike', cell: firstOpenCell(), rot: 0, name: 'X' });
    expect(res).toMatchObject({ status: 'rejected', code: 'MARBLES_REMAIN' });
  });

  it('I3: enforces the per-band density cap at the boundary', async () => {
    const cell = firstOpenCell();
    const band = bandOf(cell.r);
    await stub.hSet(keys.density(TARGET, band), { menace: String(BAND_CAP.menace) });
    const res = await placeObject(deps(), { type: 'spike', cell, rot: 0, name: 'X' });
    expect(res).toMatchObject({ status: 'rejected', code: 'BAND_FULL' });
    // Angel counts separately: same band, same cell, angel type passes.
    const res2 = await placeObject(deps(), { type: 'cushion', cell, rot: 0, name: 'Mercy' });
    expect(res2.status).toBe('ok');
  });

  it('rejects once the board-wide queued object cap is reached', async () => {
    // The cap is a raw count of queued entries, not distinct legal cells —
    // stack them all on one already-open cell (other than the candidate's).
    const cells = openCellsFor(TARGET);
    const stacked = cells[0];
    const cell = cells[1];
    if (stacked === undefined || cell === undefined) throw new Error('need cells');
    for (let i = 0; i < BOARD_OBJECT_CAP; i++) {
      await queueDirect(stub, TARGET, { type: 'bumper', cell: stacked });
    }
    const res = await placeObject(deps(), { type: 'bumper', cell, rot: 0, name: 'One Too Many' });
    expect(res).toMatchObject({ status: 'rejected', code: 'BOARD_FULL' });
  });

  it('I2: rejects a deadly placement that would seal the last gap', async () => {
    // Build a deadly wall across row 10 leaving exactly one open column.
    const t = generateTerrain(TARGET);
    const terrainKeys = new Set(t.terrain.map(cellKey));
    const gateKeys = new Set(t.gates.map(cellKey));
    const row = 10;
    const openCols: number[] = [];
    for (let c = 0; c < GRID_COLS; c++) {
      const key = `${c},${row}`;
      if (!terrainKeys.has(key) && !gateKeys.has(key)) openCols.push(c);
    }
    expect(openCols.length).toBeGreaterThan(1);
    const lastGap = openCols[openCols.length - 1];
    if (lastGap === undefined) return;
    for (const c of openCols.slice(0, -1)) {
      await queueDirect(stub, TARGET, { type: 'spike', cell: { c, r: row } });
    }
    // Sealing the last gap with a spike is rejected...
    const seal = await placeObject(deps(), {
      type: 'spike',
      cell: { c: lastGap, r: row },
      rot: 0,
      name: 'The Seal',
    });
    expect(seal).toMatchObject({ status: 'rejected', code: 'UNSOLVABLE' });
    // ...but a cushion in the same gap is fine (passable), and legal.
    const mercy = await placeObject(deps(), {
      type: 'cushion',
      cell: { c: lastGap, r: row },
      rot: 0,
      name: 'Mercy Gap',
    });
    expect(mercy.status).toBe('ok');
  });

  it('surfaces the lore message when the cell is stolen mid-transaction', async () => {
    const cell = firstOpenCell();
    // Bob's tx passes validation; right before EXEC, Alice's placement lands.
    const alicePayload = {
      id: `p_${TARGET}_${ALICE.userId}`,
      type: 'spike' as const,
      cell,
      rot: 0 as const,
      author: ALICE.username,
      authorId: ALICE.userId,
      name: 'Sniped',
      ts: NOW - 1,
    };
    stub.onBeforeExec = () => {
      stub.zAddSync(keys.queue(TARGET), { member: alicePayload.id, score: alicePayload.ts });
      stub.hSetSync(keys.queued(TARGET), { [alicePayload.id]: packQueued(alicePayload) });
    };
    const res = await placeObject(deps(BOB), { type: 'spike', cell, rot: 0, name: 'Late' });
    expect(res).toMatchObject({ status: 'rejected', code: 'CELL_TAKEN' });
    if (res.status === 'rejected') {
      expect(res.message).toContain('claimed');
    }
    // Exactly one placement won the cell.
    const queued = await stub.hGetAll(keys.queued(TARGET));
    expect(Object.keys(queued)).toEqual([alicePayload.id]);
  });

  it('retries after an unrelated conflict and succeeds', async () => {
    const cells = openCellsFor(TARGET);
    const target = cells[0];
    const other = cells[cells.length - 1];
    if (target === undefined || other === undefined) throw new Error('need cells');
    // A different placement (different cell) bumps the watched queue key
    // right before exec — first attempt conflicts, retry succeeds.
    stub.onBeforeExec = () => {
      const p = {
        id: 'p_other',
        type: 'bumper' as const,
        cell: other,
        rot: 0 as const,
        author: 'crowd',
        authorId: 't2_crowd',
        name: 'Elsewhere',
        ts: NOW - 5,
      };
      stub.zAddSync(keys.queue(TARGET), { member: p.id, score: p.ts });
      stub.hSetSync(keys.queued(TARGET), { [p.id]: packQueued(p) });
    };
    const res = await placeObject(deps(), { type: 'spike', cell: target, rot: 0, name: 'Persistent' });
    expect(res.status).toBe('ok');
    expect(await stub.zCard(keys.queue(TARGET))).toBe(2);
  });

  it('never leaks watches on any rejection path', async () => {
    const cell = firstOpenCell();
    await queueDirect(stub, TARGET, { type: 'bumper', cell });
    await placeObject(deps(), { type: 'spike', cell, rot: 0, name: 'X' }); // CELL_TAKEN
    await placeObject(deps(BOB), { type: 'lava', cell, rot: 0, name: 'X' }); // BAD_TYPE (no watch)
    await stub.hSet(keys.user(BOB.userId, TODAY), { marblesUsed: '0' });
    await placeObject(deps(BOB), { type: 'spike', cell, rot: 0, name: 'X' }); // MARBLES_REMAIN
    expect(stub.openWatches).toBe(0);
  });

  it('I4: rejected placements leave no audit entries or density drift', async () => {
    const cell = firstOpenCell();
    await queueDirect(stub, TARGET, { type: 'bumper', cell });
    const before = await stub.hGetAll(keys.density(TARGET, bandOf(cell.r)));
    await placeObject(deps(), { type: 'spike', cell, rot: 0, name: 'X' });
    const after = await stub.hGetAll(keys.density(TARGET, bandOf(cell.r)));
    expect(after).toEqual(before);
    expect(await stub.zCard(keys.audit(TARGET))).toBe(0);
  });
});
