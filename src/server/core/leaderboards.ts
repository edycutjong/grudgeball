/**
 * Leaderboards: daily Depth / Menace / Angel zsets + the global streak zset.
 * Top-10 plus "my row pinned with ±3 neighbors" via zRank windows.
 */
import type { LeaderboardRow, LeaderboardTab, LeaderboardView } from '../../shared/types';
import { keys } from './keys';
import type { RedisLike } from './redisLike';

const TOP_N = 10;
const NEIGHBOR_SPAN = 3;

export async function leaderboardView(
  redis: RedisLike,
  tab: LeaderboardTab,
  day: string,
  username: string | null
): Promise<LeaderboardView> {
  const key = tab === 'streak' ? keys.lbStreak() : keys.lb(tab, day);

  const topRaw = await redis.zRange(key, 0, TOP_N - 1, { by: 'rank', reverse: true });
  const top: LeaderboardRow[] = topRaw.map((e, i) => ({
    member: e.member,
    score: e.score,
    rank: i + 1,
  }));

  let me: LeaderboardRow | null = null;
  let neighbors: LeaderboardRow[] = [];
  if (username !== null) {
    const score = await redis.zScore(key, username);
    const asc = await redis.zRank(key, username);
    if (score !== undefined && asc !== undefined) {
      const card = await redis.zCard(key);
      const rank = card - asc; // 1-based descending rank
      me = { member: username, score, rank };
      const start = Math.max(0, rank - 1 - NEIGHBOR_SPAN);
      const stop = rank - 1 + NEIGHBOR_SPAN;
      const windowRaw = await redis.zRange(key, start, stop, { by: 'rank', reverse: true });
      neighbors = windowRaw.map((e, i) => ({
        member: e.member,
        score: e.score,
        rank: start + i + 1,
      }));
    }
  }

  return { tab, day, top, me, neighbors };
}
