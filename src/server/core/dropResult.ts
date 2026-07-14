/**
 * Drop-result intake — the Anti-Cheat Ledger (COMPLEXITY.md §3, honest tier).
 *
 * - Per-day marble counter lives INSIDE the same watch/multi/exec as the
 *   score write, so the 3/day limit cannot be raced.
 * - Plausibility failures never hard-reject: the run lands in shadow:{day}
 *   (leaderboard-hidden, mod-reviewable), the marble is consumed, and the
 *   client gets a normal-looking ack. Client physics is authoritative for
 *   feel; the server is authoritative for records.
 */
import { MARBLES_PER_DAY } from '../../shared/constants';
import { cruelty } from '../../shared/cruelty';
import { dayOf, hourOf, yesterday } from '../../shared/day';
import { checkPlausibility } from '../../shared/plausibility';
import { scoreRun } from '../../shared/score';
import type { DropResultResponse } from '../../shared/protocol';
import type { BoardObjectWithCounters, RunResult } from '../../shared/types';
import { activeObjects, countActiveTraps, readBoard } from './boardRead';
import { keys } from './keys';
import type { RedisLike } from './redisLike';

export type DropDeps = {
  redis: RedisLike;
  now: number;
  user: { userId: string; username: string } | null;
};

export type DropOutcome = {
  response: DropResultResponse;
  /** Internal-only: true when the run was shadow-flagged. Never sent raw. */
  shadowed: boolean;
  flags: string[];
  /** Kill credits actually applied: objId → author username. */
  killCredits: { objId: string; author: string; name: string }[];
};

const MAX_ATTEMPTS = 3;

export async function submitDropResult(deps: DropDeps, run: RunResult): Promise<DropOutcome> {
  const { redis, now, user } = deps;
  const none: DropOutcome = {
    response: { status: 'anonymous' },
    shadowed: false,
    flags: [],
    killCredits: [],
  };
  if (user === null) return none;

  const day = dayOf(now);
  const board = await readBoard(redis, day);
  if (board === null) {
    return { ...none, response: { status: 'closed' } };
  }

  const hour = hourOf(now);
  const active = activeObjects(board.objects, hour);
  const verdict = checkPlausibility({ run, activeObjects: active });
  const traps = countActiveTraps(board.objects, hour);
  const mult = cruelty(traps);
  const score = scoreRun(run.depth, run.coins, run.reachedGoal, mult);

  const userKey = keys.user(user.userId, day);
  const lbDepthKey = keys.lb('depth', day);

  let marblesUsedAfter = 0;
  let best = 0;
  let committed = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && !committed; attempt++) {
    const txn = await redis.watch(userKey);
    const state = await redis.hGetAll(userKey);
    if (state['lastRunId'] !== undefined && state['lastRunId'] === run.runId) {
      await txn.unwatch();
      return { ...none, response: { status: 'duplicate' } };
    }
    const marblesUsed = Number(state['marblesUsed'] ?? '0') || 0;
    if (marblesUsed >= MARBLES_PER_DAY) {
      await txn.unwatch();
      return { ...none, response: { status: 'out-of-marbles' } };
    }
    const currentBest = (await redis.zScore(lbDepthKey, user.username)) ?? 0;
    best = Math.max(currentBest, verdict.ok ? score : 0);
    marblesUsedAfter = marblesUsed + 1;

    await txn.multi();
    await txn.hSet(userKey, {
      marblesUsed: String(marblesUsedAfter),
      lastRunId: run.runId,
    });
    if (verdict.ok) {
      await txn.zAdd(lbDepthKey, { member: user.username, score: best });
    } else {
      await txn.zAdd(keys.shadow(day), {
        member: JSON.stringify({
          runId: run.runId,
          uid: user.userId,
          user: user.username,
          flags: verdict.flags,
          score,
          depth: run.depth,
          ts: now,
        }),
        score: now,
      });
    }
    const result = await txn.exec();
    if (result !== null) committed = true;
  }

  if (!committed) {
    // Extremely contended user key (only this user writes it) — treat as
    // duplicate-safe failure without consuming anything further.
    return { ...none, response: { status: 'duplicate' } };
  }

  const killCredits: { objId: string; author: string; name: string }[] = [];

  if (verdict.ok) {
    // Credit builders: single-command atomic increments (no tx needed).
    const byId = new Map<string, BoardObjectWithCounters>(active.map((o) => [o.id, o]));
    const killsByObj = new Map<string, number>();
    const savesByObj = new Map<string, number>();
    for (const ev of run.events) {
      if (ev.kind === 'kill') killsByObj.set(ev.objId, (killsByObj.get(ev.objId) ?? 0) + 1);
      if (ev.kind === 'save') savesByObj.set(ev.objId, (savesByObj.get(ev.objId) ?? 0) + 1);
    }
    const boardKey = keys.board(day);
    for (const [objId, n] of killsByObj) {
      const obj = byId.get(objId);
      // Unreachable when verdict.ok: checkPlausibility already flags any
      // event.objId absent from `active` as UNKNOWN_OBJECT (verdict not ok).
      /* v8 ignore next */
      if (obj === undefined) continue;
      await redis.hIncrBy(boardKey, `obj:${objId}:kills`, n);
      await redis.zIncrBy(keys.lb('menace', day), obj.author, n);
      killCredits.push({ objId, author: obj.author, name: obj.name });
    }
    for (const [objId, n] of savesByObj) {
      const obj = byId.get(objId);
      /* v8 ignore next */
      if (obj === undefined) continue;
      await redis.hIncrBy(boardKey, `obj:${objId}:saves`, n);
      await redis.zIncrBy(keys.lb('angel', day), obj.author, n);
    }
  }

  // Streak bookkeeping on the first marble of the day.
  if (marblesUsedAfter === 1) {
    await updateStreak(redis, user, day);
  }

  return {
    response: {
      status: 'ok',
      score,
      best,
      cruelty: mult,
      marblesLeft: Math.max(0, MARBLES_PER_DAY - marblesUsedAfter),
      canPlace: marblesUsedAfter >= MARBLES_PER_DAY,
    },
    shadowed: !verdict.ok,
    flags: verdict.flags,
    killCredits,
  };
}

async function updateStreak(
  redis: RedisLike,
  user: { userId: string; username: string },
  day: string
): Promise<void> {
  const key = keys.streak(user.userId);
  const h = await redis.hGetAll(key);
  // Unreachable via the only caller: submitDropResult invokes this exactly
  // once per user per day (guarded by marblesUsedAfter === 1, which a
  // monotonic per-day counter can only equal once) — kept as a defensive
  // idempotency guard against a future second call site.
  /* v8 ignore next */
  if (h['lastDay'] === day) return; // already counted today (idempotent)
  const prev = Number(h['current'] ?? '0') || 0;
  const wasYesterday = h['lastDay'] === yesterday(day);
  const current = wasYesterday ? prev + 1 : 1;
  const best = Math.max(current, Number(h['best'] ?? '0') || 0);
  await redis.hSet(key, {
    current: String(current),
    best: String(best),
    lastDay: day,
  });
  await redis.zAdd(keys.lbStreak(), { member: user.username, score: current });
}
