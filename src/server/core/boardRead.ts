/**
 * Board reads: parse the board:{day} hash into typed structures and build
 * the client-facing BoardView (live boards + tomorrow-preview for the
 * placement scene).
 */
import { MARBLES_PER_DAY } from '../../shared/constants';
import { cruelty } from '../../shared/cruelty';
import { dayNumber, hourOf, tomorrow, yesterday } from '../../shared/day';
import { generateTerrain } from '../../shared/terrain';
import { TRAP_CAP } from '../../shared/constants';
import { CATEGORY_OF } from '../../shared/types';
import type {
  BoardObject,
  BoardObjectWithCounters,
  BoardView,
  Cell,
  PlayerDayState,
} from '../../shared/types';
import { keys } from './keys';
import { unpackCells, unpackObject, unpackQueued } from './pack';
import type { RedisLike } from './redisLike';

export type ParsedBoard = {
  day: string;
  seed: string;
  terrain: Cell[];
  gates: Cell[];
  trails: number[][];
  objects: BoardObjectWithCounters[];
};

export async function readBoard(redis: RedisLike, day: string): Promise<ParsedBoard | null> {
  const all = await redis.hGetAll(keys.board(day));
  if (all['meta:v'] === undefined) return null;
  const objects: BoardObjectWithCounters[] = [];
  for (const [field, raw] of Object.entries(all)) {
    if (!field.startsWith('obj:') || field.endsWith(':kills') || field.endsWith(':saves')) {
      continue;
    }
    const id = field.slice(4);
    const base = unpackObject(id, raw);
    if (base === null) continue;
    const kills = Number(all[`obj:${id}:kills`] ?? '0');
    const saves = Number(all[`obj:${id}:saves`] ?? '0');
    objects.push({
      ...base,
      kills: Number.isFinite(kills) ? kills : 0,
      saves: Number.isFinite(saves) ? saves : 0,
    });
  }
  // Deterministic order for rendering + tests.
  // The tie case (equal ids) is unreachable: ids come from unique Redis hash
  // field keys, so two objects can never share one.
  /* v8 ignore next */
  objects.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let trails: number[][] = [];
  const rawTrails = all['meta:trails'];
  if (rawTrails !== undefined) {
    try {
      const parsed: unknown = JSON.parse(rawTrails);
      if (Array.isArray(parsed)) trails = parsed as number[][];
    } catch {
      trails = [];
    }
  }
  return {
    day,
    seed: all['meta:seed'] ?? '',
    terrain: unpackCells(all['meta:terrain']),
    gates: unpackCells(all['meta:gates']),
    trails,
    objects,
  };
}

export function activeObjects<T extends BoardObject>(objects: readonly T[], hour: number): T[] {
  return objects.filter((o) => o.releaseHour <= hour);
}

export function countActiveTraps(objects: readonly BoardObject[], hour: number): number {
  return activeObjects(objects, hour).filter((o) => CATEGORY_OF[o.type] === 'menace').length;
}

export async function readPlayerDayState(
  redis: RedisLike,
  user: { userId: string; username: string } | null,
  day: string
): Promise<PlayerDayState | null> {
  if (user === null) return null;
  const h = await redis.hGetAll(keys.user(user.userId, day));
  const marblesUsed = Math.min(MARBLES_PER_DAY, Number(h['marblesUsed'] ?? '0') || 0);
  const yday = yesterday(day);
  const hasReport = (await redis.hGet(keys.report(yday, user.userId), 'kills')) !== undefined;
  return {
    userId: user.userId,
    username: user.username,
    marblesUsed,
    placed: h['placed'] === '1',
    hasUnseenReport: hasReport && h['lastReportSeen'] !== yday,
  };
}

/**
 * Assemble the BoardView the client renders.
 * - live: the compiled board for `day`, filtered to the active accretion set.
 * - preview: `day` has no compiled board yet (it is tomorrow) — render the
 *   queued placements over tomorrow's deterministic terrain so the placement
 *   scene shows what the player is committing into.
 */
export async function boardView(
  redis: RedisLike,
  day: string,
  nowMs: number,
  user: { userId: string; username: string } | null,
  todayDay: string
): Promise<BoardView> {
  const activeHour = day === todayDay ? hourOf(nowMs) : 23;
  const parsed = await readBoard(redis, day);
  const me = await readPlayerDayState(redis, user, todayDay);

  if (parsed !== null) {
    const act = activeObjects(parsed.objects, activeHour);
    const traps = act.filter((o) => CATEGORY_OF[o.type] === 'menace').length;
    return {
      day,
      dayNumber: dayNumber(day),
      mode: 'live',
      objects: act,
      terrain: parsed.terrain,
      gates: parsed.gates,
      trails: parsed.trails,
      activeHour,
      activeTrapCount: traps,
      trapCap: TRAP_CAP,
      cruelty: cruelty(traps),
      me,
    };
  }

  // Preview mode (tomorrow's queue).
  const terrain = generateTerrain(day);
  const queuedRaw = await redis.hGetAll(keys.queued(day));
  const objects: BoardObjectWithCounters[] = [];
  for (const [id, raw] of Object.entries(queuedRaw)) {
    const q = unpackQueued(id, raw);
    if (q === null) continue;
    objects.push({
      id: q.id,
      type: q.type,
      cell: q.cell,
      rot: q.rot,
      author: q.author,
      authorId: q.authorId,
      name: q.name,
      releaseHour: 0,
      kills: 0,
      saves: 0,
    });
  }
  // The tie case (equal ids) is unreachable: ids come from unique Redis hash
  // field keys, so two objects can never share one.
  /* v8 ignore next */
  objects.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const traps = objects.filter((o) => CATEGORY_OF[o.type] === 'menace').length;
  return {
    day,
    dayNumber: dayNumber(day),
    mode: 'preview',
    objects,
    terrain: terrain.terrain,
    gates: terrain.gates,
    trails: [],
    activeHour: 0,
    activeTrapCount: traps,
    trapCap: TRAP_CAP,
    cruelty: cruelty(traps),
    me,
  };
}

export function previewDayFor(todayDay: string): string {
  return tomorrow(todayDay);
}
