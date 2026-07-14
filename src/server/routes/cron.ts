/**
 * Scheduler endpoints. compile-board runs at 00:00 UTC; hourly-accrete on
 * the hour. Both are idempotent: re-delivery or manual re-runs are safe.
 */
import { Hono } from 'hono';
import { realtime, reddit, redis } from '@devvit/web/server';
// TaskResponse ships from @devvit/scheduler, re-exported by @devvit/web/server
// (NOT /shared, which only re-exports @devvit/shared + payments).
import type { TaskResponse } from '@devvit/web/server';
import { REALTIME_CHANNEL } from '../../shared/constants';
import { dayOf, yesterday } from '../../shared/day';
import { accreteTick, compileBoard } from '../core/compile';
import { keys } from '../core/keys';
import { createDailyPost } from '../core/post';
import { buildReports, reportHeadline } from '../core/report';

export const cron = new Hono();

cron.post('/compile', async (c) => {
  const now = Date.now();
  const day = dayOf(now);
  const yday = yesterday(day);

  // 1. Compile today's board from the overnight queue (idempotent).
  const compiled = await compileBoard(redis, day);
  console.log('[cron/compile]', JSON.stringify(compiled));

  // 2. Aggregate yesterday's Grudge Reports (re-runnable; day is frozen).
  const reports = await buildReports(redis, yday);
  console.log('[cron/compile] reports', JSON.stringify(reports));

  // 3. Create today's post exactly once, then sticky the report headline.
  //    Reddit API failures are non-fatal: the board still compiled.
  const existing = await redis.hGet(keys.daypost(), day);
  if (existing === undefined) {
    try {
      const post = await createDailyPost(day);
      await redis.hSet(keys.daypost(), { [day]: post.id });
      await redis.hSet(keys.postmap(), { [post.id]: day });
      const headline = await reportHeadline(redis, yday);
      if (headline !== null) {
        const comment = await reddit.submitComment({
          id: post.id,
          text: headline,
          runAs: 'APP',
        });
        await comment.distinguish(true); // stickied report comment
      }
    } catch (error) {
      console.error('[cron/compile] daily post/comment failed (non-fatal)', error);
    }
  }

  return c.json<TaskResponse>({ status: 'ok' });
});

cron.post('/accrete', async (c) => {
  const now = Date.now();
  const day = dayOf(now);
  const res = await accreteTick(redis, day, now);
  console.log('[cron/accrete]', JSON.stringify(res));
  if (res.status === 'ok') {
    try {
      await realtime.send(REALTIME_CHANNEL, {
        t: 'accrete',
        day,
        hour: res.hour,
        cruelty: res.cruelty,
        released: res.releasedThisHour,
      });
    } catch (error) {
      console.error('[cron/accrete] realtime failed (non-fatal)', error);
    }
  }
  return c.json<TaskResponse>({ status: 'ok' });
});
