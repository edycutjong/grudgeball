/**
 * Public /api routes — thin adapters over the pure core.
 */
import { Hono } from 'hono';
import { context, realtime, reddit, redis } from '@devvit/web/server';
import { REALTIME_CHANNEL } from '../../shared/constants';
import { dayOf, isDayString, yesterday } from '../../shared/day';
import type {
  ApiError,
  BoardResponse,
  DropResultResponse,
  LeaderboardsResponse,
  PlaceResponse,
  ReportResponse,
} from '../../shared/protocol';
import { OBJECT_TYPES } from '../../shared/types';
import type { LeaderboardTab, LiveMessage, RunEvent, RunResult } from '../../shared/types';
import { boardView } from '../core/boardRead';
import { submitDropResult } from '../core/dropResult';
import { keys } from '../core/keys';
import { leaderboardView } from '../core/leaderboards';
import { placeObject } from '../core/placement';
import { readReport } from '../core/report';

export const api = new Hono();

async function currentUser(): Promise<{ userId: string; username: string } | null> {
  const userId = context.userId;
  if (userId === undefined) return null;
  const username = await reddit.getCurrentUsername();
  if (username === undefined) return null;
  return { userId, username };
}

async function sendLive(msg: LiveMessage): Promise<void> {
  try {
    await realtime.send(REALTIME_CHANNEL, msg);
  } catch (error) {
    // Realtime is garnish, never load-bearing.
    console.error('realtime send failed', error);
  }
}

api.get('/board', async (c) => {
  try {
    const now = Date.now();
    const today = dayOf(now);
    const q = c.req.query('day');
    let day = today;
    if (q !== undefined && isDayString(q)) {
      day = q;
    } else if (context.postId !== undefined) {
      const bound = await redis.hGet(keys.postmap(), context.postId);
      if (bound !== undefined && isDayString(bound)) day = bound;
    }
    const user = await currentUser();
    const board = await boardView(redis, day, now, user, today);
    return c.json<BoardResponse>({ status: 'ok', board });
  } catch (error) {
    console.error('GET /api/board failed', error);
    return c.json<ApiError>({ status: 'error', message: 'board unavailable' }, 500);
  }
});

api.post('/drop-result', async (c) => {
  try {
    const now = Date.now();
    const user = await currentUser();
    const body = await c.req.json<Partial<RunResult>>();
    const run = normalizeRun(body);
    const outcome = await submitDropResult({ redis, now, user }, run);
    if (outcome.response.status === 'ok' && outcome.killCredits.length > 0 && user !== null) {
      const credit = outcome.killCredits[0];
      // Always defined here: guarded above by killCredits.length > 0.
      /* v8 ignore next */
      if (credit !== undefined) {
        await sendLive({
          t: 'run',
          day: dayOf(now),
          depth: run.depth,
          killerName: credit.name,
          killerAuthor: credit.author,
          by: user.username,
        });
      }
    }
    return c.json<DropResultResponse>(outcome.response);
  } catch (error) {
    console.error('POST /api/drop-result failed', error);
    return c.json<ApiError>({ status: 'error', message: 'drop-result failed' }, 500);
  }
});

api.post('/place', async (c) => {
  try {
    const now = Date.now();
    const user = await currentUser();
    const body = await c.req.json<{
      type?: unknown;
      cell?: { c?: unknown; r?: unknown };
      rot?: unknown;
      name?: unknown;
    }>();
    const type = typeof body.type === 'string' ? body.type : '';
    const cellC = typeof body.cell?.c === 'number' ? body.cell.c : -1;
    const cellR = typeof body.cell?.r === 'number' ? body.cell.r : -1;
    const rotNum = typeof body.rot === 'number' ? body.rot : 0;
    const rot = rotNum === 1 || rotNum === 2 || rotNum === 3 ? rotNum : 0;
    const name = typeof body.name === 'string' ? body.name : '';
    // Type narrowing happens inside placeObject (BAD_TYPE on mismatch).
    const result = await placeObject(
      { redis, now, user },
      { type, cell: { c: cellC, r: cellR }, rot, name }
    );
    const validType = OBJECT_TYPES.find((t) => t === type);
    if (result.status === 'ok' && user !== null && validType !== undefined) {
      await sendLive({
        t: 'placement',
        day: result.day,
        objId: result.placementId,
        objType: validType,
        cell: { c: cellC, r: cellR },
        author: user.username,
        name,
      });
    }
    return c.json<PlaceResponse>(result);
  } catch (error) {
    console.error('POST /api/place failed', error);
    return c.json<ApiError>({ status: 'error', message: 'place failed' }, 500);
  }
});

api.get('/report', async (c) => {
  try {
    const now = Date.now();
    const today = dayOf(now);
    const yday = yesterday(today);
    const user = await currentUser();
    if (user === null) return c.json<ReportResponse>({ status: 'none' });
    const report = await readReport(redis, yday, user.userId);
    if (report === null) return c.json<ReportResponse>({ status: 'none' });
    const userKey = keys.user(user.userId, today);
    const seen = await redis.hGet(userKey, 'lastReportSeen');
    const unseen = seen !== yday;
    await redis.hSet(userKey, { lastReportSeen: yday });
    return c.json<ReportResponse>({ status: 'ok', report, unseen });
  } catch (error) {
    console.error('GET /api/report failed', error);
    return c.json<ApiError>({ status: 'error', message: 'report unavailable' }, 500);
  }
});

api.get('/leaderboards', async (c) => {
  try {
    const now = Date.now();
    const q = c.req.query('day');
    const day = q !== undefined && isDayString(q) ? q : dayOf(now);
    const tabQ = c.req.query('tab');
    const tab: LeaderboardTab =
      tabQ === 'menace' || tabQ === 'angel' || tabQ === 'streak' ? tabQ : 'depth';
    const user = await currentUser();
    const view = await leaderboardView(redis, tab, day, user?.username ?? null);
    return c.json<LeaderboardsResponse>({ status: 'ok', view });
  } catch (error) {
    console.error('GET /api/leaderboards failed', error);
    return c.json<ApiError>({ status: 'error', message: 'leaderboards unavailable' }, 500);
  }
});

function normalizeRun(body: Partial<RunResult>): RunResult {
  const events: RunEvent[] = [];
  if (Array.isArray(body.events)) {
    for (const ev of body.events.slice(0, 64)) {
      if (
        typeof ev === 'object' &&
        ev !== null &&
        typeof ev.objId === 'string' &&
        (ev.kind === 'kill' || ev.kind === 'save' || ev.kind === 'coin')
      ) {
        events.push({ objId: ev.objId, kind: ev.kind });
      }
    }
  }
  const polyline: number[] = [];
  if (Array.isArray(body.polyline)) {
    for (const v of body.polyline.slice(0, 256)) {
      polyline.push(typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
    }
  }
  return {
    runId: typeof body.runId === 'string' ? body.runId.slice(0, 64) : '',
    aimCol: typeof body.aimCol === 'number' ? body.aimCol : 0,
    elapsedMs: typeof body.elapsedMs === 'number' ? body.elapsedMs : 0,
    depth: typeof body.depth === 'number' ? Math.floor(body.depth) : 0,
    coins: typeof body.coins === 'number' ? Math.floor(body.coins) : 0,
    reachedGoal: body.reachedGoal === true,
    polyline,
    events,
  };
}
