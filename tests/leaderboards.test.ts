import { beforeEach, describe, expect, it } from 'vitest';
import { keys } from '../src/server/core/keys';
import { leaderboardView } from '../src/server/core/leaderboards';
import { TODAY } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(() => {
  stub = new RedisStub();
});

async function seedDepth(day: string) {
  const key = keys.lb('depth', day);
  for (let i = 0; i < 20; i++) {
    await stub.zAdd(key, { member: `player${i}`, score: i });
  }
}

describe('leaderboardView', () => {
  it('returns the top 10 in descending score order, ranked 1..10', async () => {
    await seedDepth(TODAY);
    const view = await leaderboardView(stub, 'depth', TODAY, null);
    expect(view.top).toHaveLength(10);
    expect(view.top[0]).toEqual({ member: 'player19', score: 19, rank: 1 });
    expect(view.top[9]).toEqual({ member: 'player10', score: 10, rank: 10 });
    expect(view.me).toBeNull();
    expect(view.neighbors).toEqual([]);
  });

  it('reads the streak tab from the global streak key, ignoring day', async () => {
    await stub.zAdd(keys.lbStreak(), { member: 'alice', score: 5 });
    const view = await leaderboardView(stub, 'streak', TODAY, null);
    expect(view.top).toEqual([{ member: 'alice', score: 5, rank: 1 }]);
  });

  it('returns null "me" when the requested user has no score', async () => {
    await seedDepth(TODAY);
    const view = await leaderboardView(stub, 'depth', TODAY, 'ghost');
    expect(view.me).toBeNull();
  });

  it("includes me + a window of neighbors when the user is ranked", async () => {
    await seedDepth(TODAY);
    // player15 → 1-based descending rank: 20 members, score 15 → rank 5.
    const view = await leaderboardView(stub, 'depth', TODAY, 'player15');
    expect(view.me).toEqual({ member: 'player15', score: 15, rank: 5 });
    expect(view.neighbors.map((n) => n.member)).toContain('player15');
    expect(view.neighbors.every((n, i, arr) => i === 0 || arr[i - 1]!.rank < n.rank)).toBe(true);
  });

  it('clamps the neighbor window at the top of the board', async () => {
    await seedDepth(TODAY);
    const view = await leaderboardView(stub, 'depth', TODAY, 'player19'); // rank 1
    expect(view.me?.rank).toBe(1);
    expect(view.neighbors[0]?.rank).toBe(1);
  });

  it('an empty leaderboard returns an empty top list', async () => {
    const view = await leaderboardView(stub, 'menace', TODAY, null);
    expect(view.top).toEqual([]);
  });
});
