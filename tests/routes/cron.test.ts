import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisStub } from '../helpers/redisStub';
import { NOW, openCellsFor, queueDirect, TODAY } from '../helpers/factories';
import { keys } from '../../src/server/core/keys';
import { yesterday } from '../../src/shared/day';

let redis = new RedisStub();
const submitCustomPost = vi.fn();
const submitComment = vi.fn();
const distinguish = vi.fn();
const realtimeSend = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@devvit/web/server', () => ({
  get redis() {
    return redis;
  },
  reddit: {
    submitCustomPost: (...a: unknown[]) => submitCustomPost(...a),
    submitComment: (...a: unknown[]) => submitComment(...a),
  },
  realtime: { send: (...a: unknown[]) => realtimeSend(...a) },
}));

const { cron } = await import('../../src/server/routes/cron');

beforeEach(() => {
  redis = new RedisStub();
  vi.setSystemTime(NOW);
  submitCustomPost.mockReset();
  submitComment.mockReset();
  distinguish.mockReset();
  submitComment.mockResolvedValue({ distinguish });
  submitCustomPost.mockResolvedValue({ id: 't3_new' });
  realtimeSend.mockReset();
  realtimeSend.mockResolvedValue(undefined);
});

describe('POST /compile', () => {
  it("compiles today's board, aggregates yesterday's reports, and creates the daily post + stickied headline", async () => {
    const yday = yesterday(TODAY);
    const cell = openCellsFor(yday)[0];
    if (cell === undefined) throw new Error('need cell');
    // Seed yesterday's board so buildReports has something to aggregate and
    // reportHeadline has a non-null headline to post.
    await queueDirect(redis, yday, { id: 'p1', type: 'spike', cell, author: 'greg', authorId: 't2_greg', name: 'Regret' });
    const { compileBoard } = await import('../../src/server/core/compile');
    await compileBoard(redis, yday);
    await redis.hIncrBy(keys.board(yday), 'obj:p1:kills', 5);

    const res = await cron.request('/compile', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await redis.hGet(keys.board(TODAY), 'meta:v')).toBe('1');
    expect(submitCustomPost).toHaveBeenCalledOnce();
    expect(submitComment).toHaveBeenCalledOnce();
    expect(distinguish).toHaveBeenCalledWith(true);
    expect(await redis.hGet(keys.daypost(), TODAY)).toBe('t3_new');
    expect(await redis.hGet(keys.postmap(), 't3_new')).toBe(TODAY);
  });

  it('does not create a second daily post if one already exists for today', async () => {
    await redis.hSet(keys.daypost(), { [TODAY]: 't3_existing' });
    const res = await cron.request('/compile', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(submitCustomPost).not.toHaveBeenCalled();
  });

  it('is non-fatal if the daily post / comment call throws', async () => {
    submitCustomPost.mockRejectedValue(new Error('reddit down'));
    const res = await cron.request('/compile', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('skips the stickied comment when there is no headline (no prior report)', async () => {
    const res = await cron.request('/compile', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(submitCustomPost).toHaveBeenCalledOnce();
    expect(submitComment).not.toHaveBeenCalled();
  });
});

describe('POST /accrete', () => {
  it('broadcasts an accrete tick when a board exists', async () => {
    const { compileBoard } = await import('../../src/server/core/compile');
    await compileBoard(redis, TODAY);
    const res = await cron.request('/accrete', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(realtimeSend).toHaveBeenCalledOnce();
  });

  it('is a no-op (still 200) when no board exists yet', async () => {
    const res = await cron.request('/accrete', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(realtimeSend).not.toHaveBeenCalled();
  });

  it('is non-fatal if the realtime broadcast throws', async () => {
    const { compileBoard } = await import('../../src/server/core/compile');
    await compileBoard(redis, TODAY);
    realtimeSend.mockRejectedValue(new Error('realtime down'));
    const res = await cron.request('/accrete', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
