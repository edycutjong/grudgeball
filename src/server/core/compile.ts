/**
 * Board Compiler & Cruelty Curve (COMPLEXITY.md §2).
 *
 * compile(day) is idempotent and re-runnable:
 *   - already compiled → no-op ('exists');
 *   - otherwise reads queue:{day} in timestamp order, lays deterministic
 *     terrain from seed = hash(day), re-validates every queued placement
 *     (defense in depth — the placement tx already validated them), assigns
 *     hourly release cohorts (1/24th per hour), and emits the board hash in
 *     one deterministic write. Same day + same queue → byte-identical hash.
 *
 * The hourly accretion job releases queued cohorts: activation is computed
 * from the UTC hour (releaseHour <= hour), so a missed cron tick never
 * stalls the board — accrete only materializes stats and the realtime tick.
 */
import { BAND_CAP, BOARD_OBJECT_CAP } from '../../shared/constants';
import { hourOf } from '../../shared/day';
import { cruelty } from '../../shared/cruelty';
import { bandOf, cellKey, inPlacementZone } from '../../shared/grid';
import { blockedSetFrom, isSolvable } from '../../shared/solvability';
import { generateTerrain } from '../../shared/terrain';
import { CATEGORY_OF, DEADLY } from '../../shared/types';
import type { BoardObject, Category, QueuedPlacement } from '../../shared/types';
import { countActiveTraps, readBoard } from './boardRead';
import { keys } from './keys';
import { packCells, packObject, unpackQueued } from './pack';
import type { RedisLike } from './redisLike';

export type CompiledBoard = {
  day: string;
  seed: number;
  terrain: { c: number; r: number }[];
  gates: { c: number; r: number }[];
  objects: BoardObject[];
  skipped: { id: string; reason: string }[];
};

/** Pure compiler: deterministic function of (day, placements). */
export function compilePure(day: string, placements: readonly QueuedPlacement[]): CompiledBoard {
  const t = generateTerrain(day);
  const terrainKeys = new Set(t.terrain.map(cellKey));
  const gateKeys = new Set(t.gates.map(cellKey));

  const ordered = [...placements].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));

  const occupied = new Set<string>();
  const deadlyCells = new Set<string>();
  const density = new Map<string, number>();
  const accepted: QueuedPlacement[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const p of ordered) {
    const key = cellKey(p.cell);
    const band = bandOf(p.cell.r);
    const category: Category = CATEGORY_OF[p.type];
    const densityKey = `${band}:${category}`;
    if (!inPlacementZone(p.cell)) {
      skipped.push({ id: p.id, reason: 'zone' });
      continue;
    }
    if (terrainKeys.has(key) || gateKeys.has(key)) {
      skipped.push({ id: p.id, reason: 'reserved-cell' });
      continue;
    }
    if (occupied.has(key)) {
      skipped.push({ id: p.id, reason: 'occupied' });
      continue;
    }
    if ((density.get(densityKey) ?? 0) >= BAND_CAP[category]) {
      skipped.push({ id: p.id, reason: 'band-cap' });
      continue;
    }
    // Defense-in-depth only: BAND_CAP sums to 152 across all 4 bands
    // (14+14+10 per band), always well under BOARD_OBJECT_CAP (220), so this
    // can never trigger with the current grid — kept as a hard ceiling in
    // case those constants change independently.
    /* v8 ignore next 4 */
    if (accepted.length >= BOARD_OBJECT_CAP) {
      skipped.push({ id: p.id, reason: 'board-cap' });
      continue;
    }
    if (DEADLY.has(p.type)) {
      const candidateBlocked = blockedSetFrom(terrainKeys, [...deadlyCells, key]);
      if (!isSolvable(candidateBlocked)) {
        skipped.push({ id: p.id, reason: 'unsolvable' });
        continue;
      }
      deadlyCells.add(key);
    }
    occupied.add(key);
    density.set(densityKey, (density.get(densityKey) ?? 0) + 1);
    accepted.push(p);
  }

  // Hourly accretion cohorts, 1/24th per hour in timestamp order.
  const n = accepted.length;
  const objects: BoardObject[] = accepted.map((p, i) => ({
    id: p.id,
    type: p.type,
    cell: p.cell,
    rot: p.rot,
    author: p.author,
    authorId: p.authorId,
    name: p.name,
    // n === 0 is unreachable here: .map never invokes its callback on an
    // empty array, so this guard is dead by construction (kept only to keep
    // the expression division-safe if that ever changes).
    /* v8 ignore next */
    releaseHour: n === 0 ? 0 : Math.min(23, Math.floor((i * 24) / n)),
  }));

  return { day, seed: t.seed, terrain: t.terrain, gates: t.gates, objects, skipped };
}

/** Deterministic board-hash field map for a compiled board. */
export function boardFields(compiled: CompiledBoard): Record<string, string> {
  const fields: Record<string, string> = {
    'meta:v': '1',
    'meta:day': compiled.day,
    'meta:seed': String(compiled.seed),
    'meta:terrain': packCells(compiled.terrain),
    'meta:gates': packCells(compiled.gates),
    'meta:trails': '[]',
    'meta:count': String(compiled.objects.length),
  };
  const ordered = [...compiled.objects].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const o of ordered) {
    fields[`obj:${o.id}`] = packObject(o);
    fields[`obj:${o.id}:kills`] = '0';
    fields[`obj:${o.id}:saves`] = '0';
  }
  return fields;
}

export type CompileResult =
  | { status: 'exists'; day: string }
  | {
      status: 'compiled';
      day: string;
      objectCount: number;
      skipped: number;
    };

export async function compileBoard(redis: RedisLike, day: string): Promise<CompileResult> {
  const boardKey = keys.board(day);
  const already = await redis.hGet(boardKey, 'meta:v');
  if (already !== undefined) return { status: 'exists', day };

  const entries = await redis.zRange(keys.queue(day), 0, -1, { by: 'rank' });
  const rawQueued = await redis.hGetAll(keys.queued(day));
  const placements: QueuedPlacement[] = [];
  for (const e of entries) {
    const raw = rawQueued[e.member];
    if (raw === undefined) continue;
    const p = unpackQueued(e.member, raw);
    if (p !== null) placements.push(p);
  }

  const compiled = compilePure(day, placements);
  await redis.hSet(boardKey, boardFields(compiled));
  return {
    status: 'compiled',
    day,
    objectCount: compiled.objects.length,
    skipped: compiled.skipped.length,
  };
}

export type AccreteResult =
  | { status: 'no-board'; day: string }
  | {
      status: 'ok';
      day: string;
      hour: number;
      releasedThisHour: number;
      activeCount: number;
      activeTraps: number;
      cruelty: number;
    };

/** Hourly cohort release. Idempotent per hour (writes the same marker). */
export async function accreteTick(
  redis: RedisLike,
  day: string,
  nowMs: number
): Promise<AccreteResult> {
  const parsed = await readBoard(redis, day);
  if (parsed === null) return { status: 'no-board', day };
  const hour = hourOf(nowMs);
  const releasedThisHour = parsed.objects.filter((o) => o.releaseHour === hour).length;
  const active = parsed.objects.filter((o) => o.releaseHour <= hour).length;
  const traps = countActiveTraps(parsed.objects, hour);
  await redis.hSet(keys.board(day), { 'meta:lastAccreteHour': String(hour) });
  return {
    status: 'ok',
    day,
    hour,
    releasedThisHour,
    activeCount: active,
    activeTraps: traps,
    cruelty: cruelty(traps),
  };
}
