/**
 * Board Compiler — determinism, idempotency, defense-in-depth validation,
 * and accretion cohorts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BAND_CAP } from '../src/shared/constants';
import { bandOf, cellKey } from '../src/shared/grid';
import { generateTerrain } from '../src/shared/terrain';
import type { Cell, QueuedPlacement } from '../src/shared/types';
import { keys } from '../src/server/core/keys';
import { accreteTick, boardFields, compileBoard, compilePure } from '../src/server/core/compile';
import { readBoard } from '../src/server/core/boardRead';
import { NOW, openCellsFor, queueDirect, TARGET } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(() => {
  stub = new RedisStub();
});

function qp(id: string, type: QueuedPlacement['type'], cell: Cell, ts: number): QueuedPlacement {
  return { id, type, cell, rot: 0, author: 'crowd', authorId: 't2_crowd', name: id, ts };
}

describe('compilePure', () => {
  it('breaks a same-timestamp tie by id (lexical order)', () => {
    const cells = openCellsFor(TARGET);
    const c1 = cells[0];
    const c2 = cells[1];
    if (c1 === undefined || c2 === undefined) throw new Error('need cells');
    const compiled = compilePure(TARGET, [qp('zzz', 'bumper', c1, NOW), qp('aaa', 'bumper', c2, NOW)]);
    expect(compiled.objects.map((o) => o.id)).toEqual(['aaa', 'zzz']);
  });

  it('boardFields sorts obj: fields into id order regardless of input order', () => {
    const cells = openCellsFor(TARGET);
    const c1 = cells[0];
    const c2 = cells[1];
    if (c1 === undefined || c2 === undefined) throw new Error('need cells');
    // Feed ids in descending order so the sort comparator must flip them.
    const compiled = compilePure(TARGET, [qp('zzz', 'bumper', c1, NOW), qp('aaa', 'bumper', c2, NOW + 1)]);
    const fields = boardFields(compiled);
    const objKeys = Object.keys(fields).filter((k) => k.startsWith('obj:') && !k.includes(':kills') && !k.includes(':saves'));
    expect(objKeys).toEqual(['obj:aaa', 'obj:zzz']);
  });

  it('is deterministic: same day + same queue → deep-equal output', () => {
    const cells = openCellsFor(TARGET);
    const placements = cells.slice(0, 12).map((cell, i) => qp(`p${i}`, 'bumper', cell, NOW + i));
    const a = compilePure(TARGET, placements);
    const b = compilePure(TARGET, placements);
    expect(a).toEqual(b);
    expect(JSON.stringify(boardFields(a))).toBe(JSON.stringify(boardFields(b)));
  });

  it('accepts placements in timestamp order and assigns 1/24th cohorts', () => {
    // 48 admissible placements spread across all 4 bands and all 3 categories,
    // so none trips a per-band density cap (I3) — isolating cohort assignment.
    // (A single category can never reach 48: neutral cap 10 x 4 bands = 40.)
    const byBand = new Map<number, Cell[]>();
    for (const cell of openCellsFor(TARGET)) {
      const b = bandOf(cell.r);
      const list = byBand.get(b) ?? [];
      list.push(cell);
      byBand.set(b, list);
    }
    // fan=menace (cap 14), cushion=angel (cap 14), bumper=neutral (cap 10);
    // none is DEADLY, so no A* solvability skips. 4 of each per band ≤ every cap.
    const placements: QueuedPlacement[] = [];
    for (const band of [0, 1, 2, 3]) {
      const bandCells = byBand.get(band) ?? [];
      for (let i = 0; i < 12; i++) {
        const cell = bandCells[i];
        if (cell === undefined) throw new Error(`band ${band} needs 12 open cells`);
        const n = placements.length;
        const type: QueuedPlacement['type'] = i % 3 === 0 ? 'fan' : i % 3 === 1 ? 'cushion' : 'bumper';
        placements.push(qp(`p${String(n).padStart(2, '0')}`, type, cell, NOW + n));
      }
    }
    const compiled = compilePure(TARGET, placements);
    expect(compiled.objects.length).toBe(48);
    const hours = compiled.objects.map((o) => o.releaseHour);
    // Monotonic, starts at 0, ends at 23, 2 per hour for 48 placements.
    expect(hours[0]).toBe(0);
    expect(hours[hours.length - 1]).toBe(23);
    for (let i = 1; i < hours.length; i++) {
      const prev = hours[i - 1];
      const cur = hours[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
    const perHour = new Map<number, number>();
    for (const h of hours) perHour.set(h, (perHour.get(h) ?? 0) + 1);
    for (const [, n] of perHour) expect(n).toBe(2);
  });

  it('skips duplicate-cell placements (first ts wins)', () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('no cell');
    const compiled = compilePure(TARGET, [
      qp('late', 'spike', cell, NOW + 10),
      qp('early', 'bumper', cell, NOW),
    ]);
    expect(compiled.objects.map((o) => o.id)).toEqual(['early']);
    expect(compiled.skipped).toEqual([{ id: 'late', reason: 'occupied' }]);
  });

  it('skips placements on reserved gate/terrain cells and outside the zone', () => {
    const t = generateTerrain(TARGET);
    const gate = t.gates[0];
    if (gate === undefined) throw new Error('no gate');
    const compiled = compilePure(TARGET, [
      qp('ongate', 'spike', gate, NOW),
      qp('apron', 'spike', { c: 4, r: 0 }, NOW + 1),
    ]);
    expect(compiled.objects).toEqual([]);
    expect(compiled.skipped.map((s) => s.reason).sort()).toEqual(['reserved-cell', 'zone']);
  });

  it('enforces band caps per category at compile time (I3 defense in depth)', () => {
    // Band 1 rows 6-11 minus terrain/gates still has > cap open cells.
    const bandCells = openCellsFor(TARGET).filter((c) => c.r >= 6 && c.r <= 11);
    const placements = bandCells.map((cell, i) => qp(`m${String(i).padStart(2, '0')}`, 'fan', cell, NOW + i));
    const compiled = compilePure(TARGET, placements);
    const accepted = compiled.objects.length;
    expect(accepted).toBe(Math.min(BAND_CAP.menace, bandCells.length));
    expect(compiled.skipped.every((s) => s.reason === 'band-cap')).toBe(true);
  });

  it('refuses a deadly placement that would seal the path (I2)', () => {
    const t = generateTerrain(TARGET);
    const terrainKeys = new Set(t.terrain.map(cellKey));
    const gateKeys = new Set(t.gates.map(cellKey));
    const row = 10;
    const open: number[] = [];
    for (let c = 0; c < 9; c++) {
      const key = `${c},${row}`;
      if (!terrainKeys.has(key) && !gateKeys.has(key)) open.push(c);
    }
    const placements = open.map((c, i) => qp(`w${i}`, 'spike', { c, r: row }, NOW + i));
    const compiled = compilePure(TARGET, placements);
    // The compiler must have skipped at least the sealing spike.
    expect(compiled.objects.length).toBeLessThan(open.length);
    expect(compiled.skipped.some((s) => s.reason === 'unsolvable')).toBe(true);
  });
});

describe('compileBoard (redis adapter)', () => {
  it('compiles the queue into a byte-identical board hash on re-run', async () => {
    const cells = openCellsFor(TARGET);
    for (let i = 0; i < 10; i++) {
      const cell = cells[i];
      if (cell === undefined) throw new Error('cell');
      await queueDirect(stub, TARGET, { type: i % 2 === 0 ? 'spike' : 'cushion', cell });
    }
    const res1 = await compileBoard(stub, TARGET);
    expect(res1.status).toBe('compiled');
    const snap1 = stub.snapshotKey(keys.board(TARGET));

    await stub.del(keys.board(TARGET));
    const res2 = await compileBoard(stub, TARGET);
    expect(res2.status).toBe('compiled');
    const snap2 = stub.snapshotKey(keys.board(TARGET));
    expect(snap2).toBe(snap1); // byte-identical
  });

  it('is idempotent: second run without deletion is a no-op', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('cell');
    await queueDirect(stub, TARGET, { type: 'spike', cell });
    await compileBoard(stub, TARGET);
    const snap1 = stub.snapshotKey(keys.board(TARGET));
    const second = await compileBoard(stub, TARGET);
    expect(second.status).toBe('exists');
    expect(stub.snapshotKey(keys.board(TARGET))).toBe(snap1);
  });

  it('ignores queue entries whose payload is missing (corruption-safe)', async () => {
    await stub.zAdd(keys.queue(TARGET), { member: 'ghost', score: NOW });
    const res = await compileBoard(stub, TARGET);
    expect(res.status).toBe('compiled');
    if (res.status !== 'compiled') return;
    expect(res.objectCount).toBe(0);
    const parsed = await readBoard(stub, TARGET);
    expect(parsed?.objects).toEqual([]);
  });

  it('ignores a queue entry whose payload is present but corrupted', async () => {
    await stub.zAdd(keys.queue(TARGET), { member: 'ghost', score: NOW });
    await stub.hSet(keys.queued(TARGET), { ghost: 'not json' });
    const res = await compileBoard(stub, TARGET);
    expect(res.status).toBe('compiled');
    if (res.status !== 'compiled') return;
    expect(res.objectCount).toBe(0);
  });

  it('an empty queue still compiles terrain + gates deterministically', async () => {
    const res = await compileBoard(stub, TARGET);
    expect(res.status).toBe('compiled');
    const parsed = await readBoard(stub, TARGET);
    const t = generateTerrain(TARGET);
    expect(parsed?.terrain).toEqual(t.terrain);
    expect(parsed?.gates).toEqual(t.gates);
  });

  it('compiled kills/saves counters start at zero', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('cell');
    const p = await queueDirect(stub, TARGET, { type: 'spike', cell });
    await compileBoard(stub, TARGET);
    expect(await stub.hGet(keys.board(TARGET), `obj:${p.id}:kills`)).toBe('0');
    expect(await stub.hGet(keys.board(TARGET), `obj:${p.id}:saves`)).toBe('0');
  });
});

describe('accreteTick', () => {
  it('returns no-board when the day has not compiled yet', async () => {
    const res = await accreteTick(stub, TARGET, NOW);
    expect(res).toEqual({ status: 'no-board', day: TARGET });
  });

  it('reports the active/released/trap counts and cruelty for the current hour', async () => {
    const cells = openCellsFor(TARGET);
    for (let i = 0; i < 6; i++) {
      const cell = cells[i];
      if (cell === undefined) throw new Error('need cells');
      await queueDirect(stub, TARGET, { type: 'spike', cell, ts: NOW + i });
    }
    await compileBoard(stub, TARGET);
    const res = await accreteTick(stub, TARGET, NOW);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.day).toBe(TARGET);
    expect(res.activeCount).toBeGreaterThan(0);
    expect(res.activeTraps).toBe(res.activeCount); // all 6 are spikes (menace)
    expect(res.cruelty).toBeGreaterThanOrEqual(1);
    expect(await stub.hGet(keys.board(TARGET), 'meta:lastAccreteHour')).toBe(String(res.hour));
  });
});
