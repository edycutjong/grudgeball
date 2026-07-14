/**
 * Drop-result intake — the Anti-Cheat Ledger. Marble spend, plausibility
 * shadow-flagging, kill/save credit, and streak bookkeeping, all under the
 * per-user watch/multi/exec.
 *
 * submitDropResult reads/writes the board for dayOf(now) === TODAY (not
 * TARGET/tomorrow) — the live board a marble is dropped into today.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MARBLES_PER_DAY } from '../src/shared/constants';
import { yesterday } from '../src/shared/day';
import { keys } from '../src/server/core/keys';
import { compileBoard } from '../src/server/core/compile';
import { submitDropResult } from '../src/server/core/dropResult';
import { packObject, unpackObject } from '../src/server/core/pack';
import { ALICE, makeRun, NOW, openCellsFor, queueDirect, TODAY } from './helpers/factories';
import { RedisStub } from './helpers/redisStub';

let stub: RedisStub;

beforeEach(() => {
  stub = new RedisStub();
});

function deps(user: { userId: string; username: string } | null = ALICE) {
  return { redis: stub, now: NOW, user };
}

async function seedLiveBoard() {
  const cells = openCellsFor(TODAY);
  const spike = cells[0];
  const cushion = cells[1];
  const coin = cells[2];
  if (spike === undefined || cushion === undefined || coin === undefined) {
    throw new Error('need cells');
  }
  await queueDirect(stub, TODAY, {
    id: 'trap1',
    type: 'spike',
    cell: spike,
    author: 'greg',
    authorId: 't2_greg',
    name: "Greg's Regret",
    ts: NOW - 90_000_000, // hour 0 cohort
  });
  await queueDirect(stub, TODAY, {
    id: 'mercy1',
    type: 'cushion',
    cell: cushion,
    author: 'kind',
    authorId: 't2_kind',
    name: 'Mercy',
    ts: NOW - 90_000_000,
  });
  await queueDirect(stub, TODAY, {
    id: 'coin1',
    type: 'coin',
    cell: coin,
    author: 'crowd',
    authorId: 't2_crowd',
    ts: NOW - 90_000_000,
  });
  await compileBoard(stub, TODAY);
  // Force all 3 into the hour-0 cohort so they're active regardless of which
  // hourly release cohort the compiler happened to assign them (compilePure
  // spreads accepted placements 1/24th-per-hour by order, independent of the
  // caller's chosen NOW).
  for (const id of ['trap1', 'mercy1', 'coin1']) {
    const raw = await stub.hGet(keys.board(TODAY), `obj:${id}`);
    if (raw === undefined) throw new Error(`missing obj:${id}`);
    const obj = unpackObject(id, raw);
    if (obj === null) throw new Error(`bad obj:${id}`);
    await stub.hSet(keys.board(TODAY), { [`obj:${id}`]: packObject({ ...obj, releaseHour: 0 }) });
  }
  return { spike: 'trap1', cushion: 'mercy1', coin: 'coin1' };
}

describe('submitDropResult', () => {
  it('returns anonymous for a logged-out user', async () => {
    const outcome = await submitDropResult(deps(null), makeRun(5));
    expect(outcome.response).toEqual({ status: 'anonymous' });
  });

  it('returns closed when the target day has no compiled board', async () => {
    const outcome = await submitDropResult(deps(), makeRun(5));
    expect(outcome.response).toEqual({ status: 'closed' });
  });

  it('records a clean run: score, best, marbles left, and streak', async () => {
    await seedLiveBoard();
    const outcome = await submitDropResult(deps(), makeRun(5));
    expect(outcome.response).toMatchObject({ status: 'ok', marblesLeft: MARBLES_PER_DAY - 1, canPlace: false });
    expect(outcome.shadowed).toBe(false);
    const lb = await stub.zScore(keys.lb('depth', TODAY), ALICE.username);
    expect(lb).toBeGreaterThan(0);
    const streak = await stub.hGetAll(keys.streak(ALICE.userId));
    expect(streak['current']).toBe('1');
  });

  it('credits the killer and saver on a run with kill/save events', async () => {
    const { spike, cushion } = await seedLiveBoard();
    const outcome = await submitDropResult(deps(), makeRun(6, {
      events: [
        { objId: spike, kind: 'kill' },
        { objId: cushion, kind: 'save' },
      ],
    }));
    expect(outcome.response.status).toBe('ok');
    expect(outcome.killCredits).toEqual([{ objId: spike, author: 'greg', name: "Greg's Regret" }]);
    expect(await stub.hGet(keys.board(TODAY), `obj:${spike}:kills`)).toBe('1');
    expect(await stub.zScore(keys.lb('menace', TODAY), 'greg')).toBe(1);
    expect(await stub.hGet(keys.board(TODAY), `obj:${cushion}:saves`)).toBe('1');
    expect(await stub.zScore(keys.lb('angel', TODAY), 'kind')).toBe(1);
  });

  it('shadow-flags an implausible run instead of hard-rejecting it', async () => {
    await seedLiveBoard();
    const run = makeRun(20, { elapsedMs: 10 }); // way too fast → TOO_FAST
    const outcome = await submitDropResult(deps(), run);
    expect(outcome.response.status).toBe('ok');
    expect(outcome.shadowed).toBe(true);
    expect(outcome.flags).toContain('TOO_FAST');
    // Not on the public leaderboard...
    expect(await stub.zScore(keys.lb('depth', TODAY), ALICE.username)).toBeUndefined();
    // ...but present in the shadow zset for mod review.
    const shadow = await stub.zRange(keys.shadow(TODAY), 0, -1, { by: 'rank' });
    expect(shadow).toHaveLength(1);
    const entry = JSON.parse(shadow[0]?.member ?? '{}') as Record<string, unknown>;
    expect(entry['runId']).toBe(run.runId);
    expect(entry['flags']).toContain('TOO_FAST');
  });

  it('rejects a duplicate resubmission of the same runId', async () => {
    await seedLiveBoard();
    const run = makeRun(5);
    await submitDropResult(deps(), run);
    const again = await submitDropResult(deps(), run);
    expect(again.response).toEqual({ status: 'duplicate' });
  });

  it('rejects once the daily marble allowance is spent', async () => {
    await seedLiveBoard();
    for (let i = 0; i < MARBLES_PER_DAY; i++) {
      await submitDropResult(deps(), makeRun(3));
    }
    const outcome = await submitDropResult(deps(), makeRun(3));
    expect(outcome.response).toEqual({ status: 'out-of-marbles' });
  });

  it('the 3rd marble unlocks placement (canPlace: true)', async () => {
    await seedLiveBoard();
    let last;
    for (let i = 0; i < MARBLES_PER_DAY; i++) {
      last = await submitDropResult(deps(), makeRun(3));
    }
    expect(last?.response).toMatchObject({ status: 'ok', canPlace: true, marblesLeft: 0 });
  });

  it('only counts the streak once per day even with multiple runs', async () => {
    await seedLiveBoard();
    await submitDropResult(deps(), makeRun(3));
    await submitDropResult(deps(), makeRun(4));
    const streak = await stub.hGetAll(keys.streak(ALICE.userId));
    expect(streak['current']).toBe('1');
  });

  it('extends the streak on a consecutive day and resets after a gap', async () => {
    await seedLiveBoard();
    await stub.hSet(keys.streak(ALICE.userId), {
      current: '4',
      best: '4',
      lastDay: yesterday(TODAY),
    });
    await submitDropResult(deps(), makeRun(3));
    const streak = await stub.hGetAll(keys.streak(ALICE.userId));
    expect(streak['current']).toBe('5');
    expect(streak['best']).toBe('5');
  });

  it('resets the streak after a missed day', async () => {
    await seedLiveBoard();
    await stub.hSet(keys.streak(ALICE.userId), {
      current: '9',
      best: '9',
      lastDay: '2026-07-01', // long gap
    });
    await submitDropResult(deps(), makeRun(3));
    const streak = await stub.hGetAll(keys.streak(ALICE.userId));
    expect(streak['current']).toBe('1');
    expect(streak['best']).toBe('9'); // best is preserved
  });

  it('retries after an unrelated conflict on the user key and still commits', async () => {
    await seedLiveBoard();
    let armed = true;
    stub.onBeforeExec = () => {
      if (armed) {
        armed = false;
        // Bump the watched user key via an unrelated concurrent write.
        stub.hSetSync(keys.user(ALICE.userId, TODAY), { unrelated: '1' });
      }
    };
    const outcome = await submitDropResult(deps(), makeRun(4));
    expect(outcome.response.status).toBe('ok');
  });

  it('treats exhausted retries (every attempt contended) as a safe duplicate-style failure', async () => {
    await seedLiveBoard();
    const sabotage = () => {
      stub.hSetSync(keys.user(ALICE.userId, TODAY), { sabotage: String(Math.random()) });
      stub.onBeforeExec = sabotage; // re-arm for every attempt
    };
    stub.onBeforeExec = sabotage;
    const outcome = await submitDropResult(deps(), makeRun(4));
    expect(outcome.response).toEqual({ status: 'duplicate' });
  });
});
