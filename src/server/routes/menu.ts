/**
 * Moderator menu actions: Seed Demo Day, Purge Object (opens a form), and
 * manual daily-post creation for playtests.
 */
import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { dayOf } from '../../shared/day';
import { keys } from '../core/keys';
import { createDailyPost } from '../core/post';
import { seedDemoDay } from '../core/seed';

export const menu = new Hono();

menu.post('/seed', async (c) => {
  try {
    const now = Date.now();
    const day = dayOf(now);
    const userId = context.userId;
    const username = await reddit.getCurrentUsername();
    const invoker =
      userId !== undefined && username !== undefined ? { userId, username } : null;
    const res = await seedDemoDay(redis, day, invoker);
    return c.json<UiResponse>({
      showToast: `Seeded demo day ${res.day}: ${res.objects} objects, ${res.trails} ghost trails, ${res.founders} founders. Open today's post and drop.`,
    });
  } catch (error) {
    console.error('menu seed failed', error);
    return c.json<UiResponse>({ showToast: 'Seed failed — check app logs.' }, 400);
  }
});

menu.post('/purge', async (c) => {
  return c.json<UiResponse>({
    showForm: {
      name: 'purgeForm',
      form: {
        title: 'Purge an object',
        description:
          "Removes an object from today's board or tomorrow's queue by object id or exact name.",
        acceptLabel: 'Purge',
        fields: [
          {
            name: 'ident',
            label: 'Object id or exact name',
            type: 'string',
            required: true,
          },
        ],
      },
    },
  });
});

menu.post('/post-create', async (c) => {
  try {
    const day = dayOf(Date.now());
    const existing = await redis.hGet(keys.daypost(), day);
    if (existing !== undefined) {
      return c.json<UiResponse>({
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${existing}`,
      });
    }
    const post = await createDailyPost(day);
    await redis.hSet(keys.daypost(), { [day]: post.id });
    await redis.hSet(keys.postmap(), { [post.id]: day });
    return c.json<UiResponse>({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error('menu post-create failed', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
