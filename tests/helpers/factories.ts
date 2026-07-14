/**
 * Shared test fixtures/builders. A fixed clock keeps everything
 * deterministic: NOW = 2026-07-10T12:00:00Z → today 2026-07-10 (hour 12),
 * placement target 2026-07-11.
 */
import { CELL_PX } from '../../src/shared/constants';
import { legalCells } from '../../src/shared/grid';
import { generateTerrain } from '../../src/shared/terrain';
import { cellKey } from '../../src/shared/grid';
import type { Cell, ObjectType, QueuedPlacement, Rot, RunResult } from '../../src/shared/types';
import { keys } from '../../src/server/core/keys';
import { packQueued } from '../../src/server/core/pack';
import { bandOf } from '../../src/shared/grid';
import { CATEGORY_OF } from '../../src/shared/types';
import type { RedisStub } from './redisStub';

export const NOW = Date.parse('2026-07-10T12:00:00Z');
export const TODAY = '2026-07-10';
export const TARGET = '2026-07-11'; // tomorrow(TODAY)

export const ALICE = { userId: 't2_aaa', username: 'alice' };
export const BOB = { userId: 't2_bbb', username: 'bob' };

/** All legal, unoccupied cells of a day's generated terrain. */
export function openCellsFor(day: string, occupied: readonly Cell[] = []): Cell[] {
  const t = generateTerrain(day);
  const occ = new Set(occupied.map(cellKey));
  return legalCells(new Set(t.terrain.map(cellKey)), new Set(t.gates.map(cellKey)), occ);
}

export async function spendMarbles(stub: RedisStub, user: { userId: string }, day: string) {
  await stub.hSet(keys.user(user.userId, day), { marblesUsed: '3' });
}

let queueSeq = 0;

/** Directly write a queued placement (mirrors the tx write set). */
export async function queueDirect(
  stub: RedisStub,
  day: string,
  partial: {
    id?: string;
    type: ObjectType;
    cell: Cell;
    rot?: Rot;
    author?: string;
    authorId?: string;
    name?: string;
    ts?: number;
  }
): Promise<QueuedPlacement> {
  queueSeq++;
  const p: QueuedPlacement = {
    id: partial.id ?? `q_${String(queueSeq).padStart(3, '0')}`,
    type: partial.type,
    cell: partial.cell,
    rot: partial.rot ?? 0,
    author: partial.author ?? 'crowd',
    authorId: partial.authorId ?? 't2_crowd',
    name: partial.name ?? `Obj ${queueSeq}`,
    ts: partial.ts ?? NOW - 1000_000 + queueSeq * 1000,
  };
  await stub.zAdd(keys.queue(day), { member: p.id, score: p.ts });
  await stub.hSet(keys.queued(day), { [p.id]: packQueued(p) });
  await stub.hIncrBy(keys.density(day, bandOf(p.cell.r)), CATEGORY_OF[p.type], 1);
  return p;
}

/** A plausibility-clean run: depth rows, sane polyline, no events. */
export function makeRun(
  depth: number,
  overrides: Partial<RunResult> = {}
): RunResult {
  queueSeq++;
  const polyline: number[] = [];
  const targetY = depth * CELL_PX + CELL_PX / 2;
  let y = CELL_PX / 2;
  const x = 4 * CELL_PX + CELL_PX / 2;
  while (y < targetY) {
    polyline.push(x, Math.round(y));
    y += 2 * CELL_PX; // 80px steps: within MAX_STEP_PX, never rising
  }
  polyline.push(x, Math.round(targetY));
  return {
    runId: `run_${queueSeq}`,
    aimCol: 4,
    elapsedMs: Math.max(400, depth * 100),
    depth,
    coins: 0,
    reachedGoal: false,
    polyline,
    events: [],
    ...overrides,
  };
}
