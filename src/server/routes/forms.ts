/**
 * Form submissions (purge confirmation).
 */
import { Hono } from 'hono';
import { context, realtime, reddit, redis } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { REALTIME_CHANNEL } from '../../shared/constants';
import { dayOf } from '../../shared/day';
import { purgeObject } from '../core/purge';

type PurgeFormValues = {
  ident?: string;
};

export const forms = new Hono();

forms.post('/purge-submit', async (c) => {
  try {
    const body = await c.req.json<PurgeFormValues>().catch(() => ({}) as PurgeFormValues);
    const ident = typeof body.ident === 'string' ? body.ident : '';
    const now = Date.now();
    const today = dayOf(now);
    const moderator = (await reddit.getCurrentUsername()) ?? context.userId ?? 'moderator';
    const result = await purgeObject(redis, today, ident, moderator, now);
    if (result.status === 'purged') {
      try {
        await realtime.send(REALTIME_CHANNEL, {
          t: 'purge',
          day: today,
          objId: result.objId,
        });
      } catch (error) {
        console.error('purge realtime failed (non-fatal)', error);
      }
      return c.json<UiResponse>({
        showToast: `Purged "${result.name}" (${result.objId}) from the ${result.where}.`,
      });
    }
    return c.json<UiResponse>({
      showToast: `No object matched "${ident}" on today's board or tomorrow's queue.`,
    });
  } catch (error) {
    console.error('purge submit failed', error);
    return c.json<UiResponse>({ showToast: 'Purge failed — check app logs.' }, 400);
  }
});
