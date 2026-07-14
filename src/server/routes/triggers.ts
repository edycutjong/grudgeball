/**
 * Event triggers. onPostCreate binds day-state to the day's post so
 * /api/board resolves the right board when opened from any surface.
 *
 * Note: onPostCreate fires for EVERY post in the subreddit, and triggers can
 * deliver more than once for one event. We bind only unbound posts whose
 * title carries our exact daily prefix, and writes are idempotent.
 */
import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import type { OnPostCreateRequest, TriggerResponse } from '@devvit/web/shared';
import { dayOf } from '../../shared/day';
import { keys } from '../core/keys';
import { DAILY_TITLE_PREFIX } from '../core/post';

export const triggers = new Hono();

triggers.post('/post-create', async (c) => {
  try {
    const input = await c.req.json<OnPostCreateRequest>();
    const postId = input.post?.id;
    const title = input.post?.title ?? '';
    if (postId === undefined || postId === '') {
      return c.json<TriggerResponse>({ status: 'ok', message: 'no post id' });
    }
    if (!title.startsWith(DAILY_TITLE_PREFIX)) {
      return c.json<TriggerResponse>({ status: 'ok', message: 'not a grudgeball daily' });
    }
    const bound = await redis.hGet(keys.postmap(), postId);
    if (bound !== undefined) {
      return c.json<TriggerResponse>({ status: 'ok', message: 'already bound' });
    }
    const day = dayOf(Date.now());
    await redis.hSet(keys.postmap(), { [postId]: day });
    await redis.hSetNX(keys.daypost(), day, postId);
    return c.json<TriggerResponse>({ status: 'ok', message: `bound ${postId} → ${day}` });
  } catch (error) {
    console.error('trigger post-create failed', error);
    return c.json<TriggerResponse>({ status: 'error', message: 'bind failed' }, 400);
  }
});
