import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisStub } from '../helpers/redisStub';
import { NOW, TODAY } from '../helpers/factories';
import { keys } from '../../src/server/core/keys';
import { DAILY_TITLE_PREFIX } from '../../src/server/core/post';

let redis = new RedisStub();

vi.mock('@devvit/web/server', () => ({
  get redis() {
    return redis;
  },
}));

const { triggers } = await import('../../src/server/routes/triggers');

beforeEach(() => {
  redis = new RedisStub();
  vi.setSystemTime(NOW);
});

function post(body: unknown) {
  return triggers.request('/post-create', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /post-create trigger', () => {
  it('ignores an event with no post id', async () => {
    const res = await post({ post: {} });
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', message: 'no post id' });
  });

  it('ignores an empty-string post id', async () => {
    const res = await post({ post: { id: '', title: `${DAILY_TITLE_PREFIX} whatever` } });
    const body = await res.json();
    expect(body.message).toBe('no post id');
  });

  it('ignores a post whose title lacks the daily prefix', async () => {
    const res = await post({ post: { id: 't3_x', title: 'some other post' } });
    const body = await res.json();
    expect(body.message).toBe('not a grudgeball daily');
  });

  it('treats a missing title as not-a-daily', async () => {
    const res = await post({ post: { id: 't3_x' } });
    const body = await res.json();
    expect(body.message).toBe('not a grudgeball daily');
  });

  it('binds a fresh daily post to postmap + daypost', async () => {
    const res = await post({ post: { id: 't3_new', title: `${DAILY_TITLE_PREFIX} 4 · ${TODAY} · x` } });
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', message: `bound t3_new → ${TODAY}` });
    expect(await redis.hGet(keys.postmap(), 't3_new')).toBe(TODAY);
    expect(await redis.hGet(keys.daypost(), TODAY)).toBe('t3_new');
  });

  it('is a no-op (idempotent) if the post is already bound', async () => {
    await redis.hSet(keys.postmap(), { t3_dup: TODAY });
    const res = await post({ post: { id: 't3_dup', title: `${DAILY_TITLE_PREFIX} 4 · ${TODAY} · x` } });
    const body = await res.json();
    expect(body.message).toBe('already bound');
  });

  it('does not clobber an existing daypost mapping (hSetNX)', async () => {
    await redis.hSet(keys.daypost(), { [TODAY]: 't3_first' });
    await post({ post: { id: 't3_second', title: `${DAILY_TITLE_PREFIX} 4 · ${TODAY} · x` } });
    expect(await redis.hGet(keys.daypost(), TODAY)).toBe('t3_first');
    expect(await redis.hGet(keys.postmap(), 't3_second')).toBe(TODAY);
  });

  it('returns a 400 error envelope if the body is unparsable JSON', async () => {
    const res = await triggers.request('/post-create', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ status: 'error', message: 'bind failed' });
  });
});
