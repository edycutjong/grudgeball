import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisStub } from '../helpers/redisStub';
import { NOW, TODAY } from '../helpers/factories';
import { keys } from '../../src/server/core/keys';

let redis = new RedisStub();
const mockContext: { userId: string | undefined; subredditName: string | undefined } = {
  userId: undefined,
  subredditName: 'GrudgeballGame',
};
const getCurrentUsername = vi.fn(async (..._args: unknown[]) => undefined as string | undefined);
const submitCustomPost = vi.fn();

vi.mock('@devvit/web/server', () => ({
  context: mockContext,
  get redis() {
    return redis;
  },
  reddit: {
    getCurrentUsername: (...a: unknown[]) => getCurrentUsername(...a),
    submitCustomPost: (...a: unknown[]) => submitCustomPost(...a),
  },
}));

const { menu } = await import('../../src/server/routes/menu');

beforeEach(() => {
  redis = new RedisStub();
  vi.setSystemTime(NOW);
  mockContext.userId = undefined;
  mockContext.subredditName = 'GrudgeballGame';
  getCurrentUsername.mockReset();
  getCurrentUsername.mockResolvedValue(undefined);
  submitCustomPost.mockReset();
  submitCustomPost.mockResolvedValue({ id: 't3_new' });
});

describe('POST /seed', () => {
  it('seeds the demo day with a resolved invoker and reports counts', async () => {
    mockContext.userId = 't2_alice';
    getCurrentUsername.mockResolvedValue('alice');
    const res = await menu.request('/seed', { method: 'POST' });
    const body = await res.json();
    expect(body.showToast).toContain(`Seeded demo day ${TODAY}`);
    expect(await redis.hGet(keys.board(TODAY), 'meta:v')).toBe('1');
  });

  it('seeds with a null invoker when userId or username is unresolved', async () => {
    const res = await menu.request('/seed', { method: 'POST' });
    const body = await res.json();
    expect(body.showToast).toContain('Seeded demo day');
  });

  it('returns a 400 error toast if seeding throws', async () => {
    redis = { hSet: () => Promise.reject(new Error('down')) } as unknown as RedisStub;
    const res = await menu.request('/seed', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.showToast).toContain('Seed failed');
  });
});

describe('POST /purge', () => {
  it('returns a showForm response with the purge field', async () => {
    const res = await menu.request('/purge', { method: 'POST' });
    const body = await res.json();
    expect(body.showForm.name).toBe('purgeForm');
    expect(body.showForm.form.fields[0].name).toBe('ident');
  });
});

describe('POST /post-create', () => {
  it('creates a new daily post and navigates to it', async () => {
    const res = await menu.request('/post-create', { method: 'POST' });
    const body = await res.json();
    expect(body.navigateTo).toBe('https://reddit.com/r/GrudgeballGame/comments/t3_new');
    expect(await redis.hGet(keys.daypost(), TODAY)).toBe('t3_new');
    expect(await redis.hGet(keys.postmap(), 't3_new')).toBe(TODAY);
  });

  it("navigates to today's existing post without creating a duplicate", async () => {
    await redis.hSet(keys.daypost(), { [TODAY]: 't3_existing' });
    const res = await menu.request('/post-create', { method: 'POST' });
    const body = await res.json();
    expect(body.navigateTo).toBe('https://reddit.com/r/GrudgeballGame/comments/t3_existing');
    expect(submitCustomPost).not.toHaveBeenCalled();
  });

  it('returns a 400 error toast if post creation throws', async () => {
    submitCustomPost.mockRejectedValue(new Error('reddit down'));
    const res = await menu.request('/post-create', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.showToast).toBe('Failed to create post');
  });
});
