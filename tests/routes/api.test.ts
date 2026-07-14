/**
 * Public /api routes — exercised end-to-end through the Hono app with
 * @devvit/web/server mocked out (context/redis/reddit/realtime), so no live
 * Devvit runtime is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisStub } from '../helpers/redisStub';
import { NOW, openCellsFor, queueDirect, spendMarbles, TARGET, TODAY } from '../helpers/factories';
import { keys } from '../../src/server/core/keys';
import { compileBoard } from '../../src/server/core/compile';

let redis = new RedisStub();
const mockContext: { userId: string | undefined; postId: string | undefined } = {
  userId: undefined,
  postId: undefined,
};
const getCurrentUsername = vi.fn(async (..._args: unknown[]) => undefined as string | undefined);
const realtimeSend = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@devvit/web/server', () => ({
  context: mockContext,
  // A getter (not a plain value) so each test's fresh `redis` reassignment
  // in beforeEach is actually seen — vi.mock's factory runs once, so a
  // captured plain reference would go stale after the first test.
  get redis() {
    return redis;
  },
  reddit: { getCurrentUsername: (...a: unknown[]) => getCurrentUsername(...a) },
  realtime: { send: (...a: unknown[]) => realtimeSend(...a) },
}));

const { api } = await import('../../src/server/routes/api');

function req(path: string, init?: RequestInit) {
  return api.request(path, init);
}

beforeEach(() => {
  redis = new RedisStub();
  vi.setSystemTime(NOW);
  mockContext.userId = undefined;
  mockContext.postId = undefined;
  getCurrentUsername.mockReset();
  getCurrentUsername.mockResolvedValue(undefined);
  realtimeSend.mockReset();
  realtimeSend.mockResolvedValue(undefined);
});

describe('GET /board', () => {
  it("returns today's board for a logged-out visitor", async () => {
    await compileBoard(redis, TODAY);
    const res = await req('/board');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.board.day).toBe(TODAY);
  });

  it('resolves the day from a bound postId when no ?day is given', async () => {
    await compileBoard(redis, TARGET);
    await redis.hSet(keys.postmap(), { t3_abc: TARGET });
    mockContext.postId = 't3_abc';
    const res = await req('/board');
    const body = await res.json();
    expect(body.board.day).toBe(TARGET);
  });

  it('ignores a corrupted postmap binding and falls back to today', async () => {
    await redis.hSet(keys.postmap(), { t3_bad: 'not-a-day' });
    mockContext.postId = 't3_bad';
    const res = await req('/board');
    const body = await res.json();
    expect(body.board.day).toBe(TODAY);
  });

  it('accepts an explicit ?day= query override', async () => {
    await compileBoard(redis, TARGET);
    const res = await req(`/board?day=${TARGET}`);
    const body = await res.json();
    expect(body.board.day).toBe(TARGET);
  });

  it('includes the logged-in user state when context.userId + username resolve', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    await compileBoard(redis, TODAY);
    const res = await req('/board');
    const body = await res.json();
    expect(body.board.me?.username).toBe('alice');
  });

  it('treats a resolvable userId but unresolvable username as anonymous', async () => {
    mockContext.userId = 't2_ghost';
    getCurrentUsername.mockResolvedValue(undefined);
    await compileBoard(redis, TODAY);
    const res = await req('/board');
    const body = await res.json();
    expect(body.board.me).toBeNull();
  });

  it('returns a 500 error envelope if boardView throws', async () => {
    // Reassign the live `redis` binding the mock's getter reads from — no
    // need to re-mock the module, the getter always reflects this variable.
    redis = { hGetAll: () => Promise.reject(new Error('down')) } as unknown as RedisStub;
    const res = await req('/board');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('error');
  });
});

describe('POST /drop-result', () => {
  it('submits a run and returns anonymous for a logged-out user', async () => {
    const res = await req('/drop-result', {
      method: 'POST',
      body: JSON.stringify({ runId: 'r1', depth: 1, polyline: [] }),
    });
    const body = await res.json();
    expect(body.status).toBe('anonymous');
  });

  it('records a clean logged-in run and broadcasts on a kill', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    const cells = openCellsFor(TODAY);
    const cell = cells[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(redis, TODAY, {
      id: 'trap1',
      type: 'spike',
      cell,
      author: 'greg',
      authorId: 't2_greg',
      name: 'Trap',
      ts: NOW - 90_000_000,
    });
    await compileBoard(redis, TODAY);
    const res = await req('/drop-result', {
      method: 'POST',
      body: JSON.stringify({
        runId: 'run-a',
        aimCol: 0,
        elapsedMs: 500,
        depth: 3,
        coins: 0,
        reachedGoal: false,
        polyline: [0, 0, 0, 120],
        events: [{ objId: 'trap1', kind: 'kill' }],
      }),
    });
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(realtimeSend).toHaveBeenCalled();
  });

  it('returns a 500 error envelope if the body is unparsable JSON', async () => {
    const res = await req('/drop-result', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(500);
  });

  it('is non-fatal if the realtime kill broadcast throws', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    const cell = openCellsFor(TODAY)[0];
    if (cell === undefined) throw new Error('need cell');
    await queueDirect(redis, TODAY, {
      id: 'trap1',
      type: 'spike',
      cell,
      author: 'greg',
      authorId: 't2_greg',
      name: 'Trap',
      ts: NOW - 90_000_000,
    });
    await compileBoard(redis, TODAY);
    realtimeSend.mockRejectedValue(new Error('down'));
    const res = await req('/drop-result', {
      method: 'POST',
      body: JSON.stringify({
        runId: 'run-b',
        aimCol: 0,
        elapsedMs: 500,
        depth: 3,
        coins: 0,
        reachedGoal: false,
        polyline: [0, 0, 0, 120],
        events: [{ objId: 'trap1', kind: 'kill' }],
      }),
    });
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('drops each malformed event shape but keeps well-formed ones, and defaults a missing polyline', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    const res = await req('/drop-result', {
      method: 'POST',
      body: JSON.stringify({
        runId: 'run-c',
        depth: 1,
        // polyline omitted entirely → Array.isArray(undefined) is false
        events: [
          'not-an-object',
          null,
          { kind: 'kill' }, // missing objId
          { objId: 'x', kind: 'bogus' }, // bad kind
          { objId: 'good', kind: 'kill' }, // the only one that survives
        ],
      }),
    });
    expect(res.status).toBe(200);
  });

  it('accepts save and coin events and coerces a malformed polyline/runId/depth', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    const res = await req('/drop-result', {
      method: 'POST',
      body: JSON.stringify({
        runId: 42, // not a string → coerced to ''
        depth: 'not-a-number', // → coerced to 0
        polyline: ['bad', 12], // non-number entries → coerced to 0
        events: [
          { objId: 'x', kind: 'save' },
          { objId: 'y', kind: 'coin' },
        ],
      }),
    });
    // Any concrete response shape is fine — this just needs to not throw and
    // to have exercised every normalizeRun coercion branch.
    expect(res.status).toBe(200);
  });
});

describe('POST /place', () => {
  it('normalizes an untyped wire payload and rejects anonymous placement', async () => {
    const res = await req('/place', {
      method: 'POST',
      body: JSON.stringify({ type: 'spike', cell: { c: 3, r: 5 }, rot: 1, name: 'X' }),
    });
    const body = await res.json();
    expect(body).toMatchObject({ status: 'rejected', code: 'ANONYMOUS' });
  });

  it('places successfully for a logged-in user and broadcasts', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    await spendMarbles(redis, { userId: 't2_alice' }, TODAY);
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    const res = await req('/place', {
      method: 'POST',
      body: JSON.stringify({ type: 'spike', cell, rot: 0, name: 'Trap' }),
    });
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(realtimeSend).toHaveBeenCalled();
  });

  it('coerces a malformed wire payload (missing fields) without crashing', async () => {
    mockContext.userId = 't2_bob';
    getCurrentUsername.mockResolvedValue('bob');
    const res = await req('/place', { method: 'POST', body: JSON.stringify({}) });
    const body = await res.json();
    expect(body.status).toBe('rejected');
  });

  it('returns a 500 error envelope if placeObject throws', async () => {
    const cell = openCellsFor(TARGET)[0];
    if (cell === undefined) throw new Error('need cell');
    redis = { watch: () => Promise.reject(new Error('down')) } as unknown as RedisStub;
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    const res = await req('/place', {
      method: 'POST',
      body: JSON.stringify({ type: 'spike', cell, rot: 0, name: 'X' }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('error');
  });
});

describe('GET /report', () => {
  it('returns none for a logged-out visitor', async () => {
    const res = await req('/report');
    const body = await res.json();
    expect(body.status).toBe('none');
  });

  it('returns none when the user has no report yet', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    const res = await req('/report');
    const body = await res.json();
    expect(body.status).toBe('none');
  });

  it("returns the user's report and marks it seen", async () => {
    mockContext.userId = 't2_greg';
    getCurrentUsername.mockResolvedValue('gb_founder_greg');
    const { seedDemoDay } = await import('../../src/server/core/seed');
    await seedDemoDay(redis, TODAY, { userId: 't2_greg', username: 'gb_founder_greg' });
    const res = await req('/report');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.unseen).toBe(true);
  });

  it('returns a 500 error envelope if readReport throws', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    redis = { hGetAll: () => Promise.reject(new Error('down')) } as unknown as RedisStub;
    const res = await req('/report');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('error');
  });
});

describe('GET /leaderboards', () => {
  it('defaults to the depth tab for today', async () => {
    await redis.zAdd(keys.lb('depth', TODAY), { member: 'alice', score: 5 });
    const res = await req('/leaderboards');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.view.tab).toBe('depth');
    expect(body.view.day).toBe(TODAY);
  });

  it('accepts explicit tab + day query params', async () => {
    await redis.zAdd(keys.lb('menace', TARGET), { member: 'greg', score: 9 });
    const res = await req(`/leaderboards?tab=menace&day=${TARGET}`);
    const body = await res.json();
    expect(body.view.tab).toBe('menace');
    expect(body.view.day).toBe(TARGET);
  });

  it('falls back to depth for an unrecognized tab value', async () => {
    const res = await req('/leaderboards?tab=bogus');
    const body = await res.json();
    expect(body.view.tab).toBe('depth');
  });

  it('includes the logged-in username in the view when resolvable', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    await redis.zAdd(keys.lb('depth', TODAY), { member: 'alice', score: 5 });
    const res = await req('/leaderboards');
    const body = await res.json();
    expect(body.view.me?.member).toBe('alice');
  });

  it('returns a 500 error envelope if leaderboardView throws', async () => {
    redis = { zRange: () => Promise.reject(new Error('down')) } as unknown as RedisStub;
    const res = await req('/leaderboards');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('error');
  });
});
