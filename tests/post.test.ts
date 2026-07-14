import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitCustomPost = vi.fn();

vi.mock('@devvit/web/server', () => ({
  reddit: { submitCustomPost: (...args: unknown[]) => submitCustomPost(...args) },
}));

describe('createDailyPost / dailyPostTitle', () => {
  beforeEach(() => {
    submitCustomPost.mockReset();
  });

  it('builds the daily title from the day number and ISO day', async () => {
    const { dailyPostTitle } = await import('../src/server/core/post');
    expect(dailyPostTitle('2026-07-04')).toBe(
      "Grudgeball — Day 4 · 2026-07-04 · drop, die, plant your revenge"
    );
  });

  it('submits a custom post with the daily title and a text fallback', async () => {
    submitCustomPost.mockResolvedValue({ id: 't3_abc' });
    const { createDailyPost, dailyPostTitle } = await import('../src/server/core/post');
    const post = await createDailyPost('2026-07-04');
    expect(post).toEqual({ id: 't3_abc' });
    expect(submitCustomPost).toHaveBeenCalledWith({
      title: dailyPostTitle('2026-07-04'),
      textFallback: {
        text: 'Grudgeball is an interactive daily gauntlet. Open this post in the Reddit app or new reddit.com to play.',
      },
    });
  });
});
