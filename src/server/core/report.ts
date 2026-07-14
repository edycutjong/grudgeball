/**
 * Grudge Report Pipeline (COMPLEXITY.md §4).
 *
 * Nightly aggregation walks the board hash once → per-user report hashes
 * (kills, saves, ranks, board-wide stats) → morning modal + one app comment
 * on the new day's post. O(objects + authors); re-runnable (overwrites with
 * identical values for a frozen day).
 */
import { dayNumber } from '../../shared/day';
import { OBJECT_TYPES } from '../../shared/types';
import type { GrudgeReport, ObjectType } from '../../shared/types';
import { readBoard } from './boardRead';
import { keys } from './keys';
import type { RedisLike } from './redisLike';

export type BuildReportsResult =
  | { status: 'no-board'; day: string }
  | { status: 'ok'; day: string; users: number; boardKills: number; boardSaves: number };

export async function buildReports(redis: RedisLike, day: string): Promise<BuildReportsResult> {
  const board = await readBoard(redis, day);
  if (board === null) return { status: 'no-board', day };

  type AuthorAgg = {
    author: string;
    kills: number;
    saves: number;
    bestName: string;
    bestType: string;
    bestScore: number;
  };
  const byAuthor = new Map<string, AuthorAgg>();
  let boardKills = 0;
  let boardSaves = 0;
  let deadliestName = '';
  let deadliestAuthor = '';
  let deadliestKills = -1;

  for (const o of board.objects) {
    boardKills += o.kills;
    boardSaves += o.saves;
    if (o.kills > deadliestKills) {
      deadliestKills = o.kills;
      deadliestName = o.name;
      deadliestAuthor = o.author;
    }
    const agg = byAuthor.get(o.authorId) ?? {
      author: o.author,
      kills: 0,
      saves: 0,
      bestName: '',
      bestType: '',
      bestScore: -1,
    };
    agg.kills += o.kills;
    agg.saves += o.saves;
    const objScore = o.kills + o.saves;
    if (objScore > agg.bestScore) {
      agg.bestScore = objScore;
      agg.bestName = o.name;
      agg.bestType = o.type;
    }
    byAuthor.set(o.authorId, agg);
  }

  const builders = byAuthor.size;

  await redis.hSet(keys.reportMeta(day), {
    boardKills: String(boardKills),
    boardSaves: String(boardSaves),
    deadliestName,
    deadliestAuthor,
    deadliestKills: String(Math.max(0, deadliestKills)),
    builders: String(builders),
  });

  for (const [authorId, agg] of byAuthor) {
    const menaceRank = await descRank(redis, keys.lb('menace', day), agg.author);
    const angelRank = await descRank(redis, keys.lb('angel', day), agg.author);
    const depthRank = await descRank(redis, keys.lb('depth', day), agg.author);
    await redis.hSet(keys.report(day, authorId), {
      kills: String(agg.kills),
      saves: String(agg.saves),
      objectName: agg.bestName,
      objectType: agg.bestType,
      menaceRank: menaceRank === null ? '' : String(menaceRank),
      angelRank: angelRank === null ? '' : String(angelRank),
      depthRank: depthRank === null ? '' : String(depthRank),
    });
  }

  return { status: 'ok', day, users: builders, boardKills, boardSaves };
}

/** 1-based descending rank of a member in a zset, or null if absent. */
export async function descRank(
  redis: RedisLike,
  key: string,
  member: string
): Promise<number | null> {
  const asc = await redis.zRank(key, member);
  if (asc === undefined) return null;
  const card = await redis.zCard(key);
  return card - asc;
}

export async function readReport(
  redis: RedisLike,
  day: string,
  userId: string
): Promise<GrudgeReport | null> {
  const h = await redis.hGetAll(keys.report(day, userId));
  if (h['kills'] === undefined) return null;
  const meta = await redis.hGetAll(keys.reportMeta(day));
  return {
    day,
    dayNumber: dayNumber(day),
    objectName: h['objectName'] ?? '',
    objectType: parseObjectType(h['objectType']),
    // The ?? fallback is unreachable here: the guard above already returned
    // null if h['kills'] is undefined, so it's always defined at this point.
    /* v8 ignore next */
    kills: Number(h['kills'] ?? '0') || 0,
    saves: Number(h['saves'] ?? '0') || 0,
    menaceRank: parseRank(h['menaceRank']),
    angelRank: parseRank(h['angelRank']),
    depthRank: parseRank(h['depthRank']),
    boardKills: Number(meta['boardKills'] ?? '0') || 0,
    boardSaves: Number(meta['boardSaves'] ?? '0') || 0,
    deadliestName: meta['deadliestName'] ?? '',
    deadliestAuthor: meta['deadliestAuthor'] ?? '',
    deadliestKills: Number(meta['deadliestKills'] ?? '0') || 0,
    builders: Number(meta['builders'] ?? '0') || 0,
  };
}

function parseObjectType(v: string | undefined): ObjectType | '' {
  for (const t of OBJECT_TYPES) {
    if (v === t) return t;
  }
  return '';
}

function parseRank(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Morning app-comment headline for the new day's post. */
export async function reportHeadline(redis: RedisLike, day: string): Promise<string | null> {
  const meta = await redis.hGetAll(keys.reportMeta(day));
  if (meta['builders'] === undefined) return null;
  const builders = meta['builders'];
  const deadliestName = meta['deadliestName'] ?? '';
  const deadliestAuthor = meta['deadliestAuthor'] ?? '';
  const deadliestKills = meta['deadliestKills'] ?? '0';
  const boardKills = meta['boardKills'] ?? '0';
  return (
    `Yesterday's board was built by ${builders} of you. ` +
    `Deadliest object: "${deadliestName}" by u/${deadliestAuthor} — ${deadliestKills} victims ` +
    `(${boardKills} marbles fell in total). ` +
    `Drop today, die today, and plant your revenge for tomorrow.`
  );
}
