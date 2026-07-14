/**
 * Mod purge: remove an offensive object from today's live board or from
 * tomorrow's pending queue, by object id or exact (case-insensitive) name.
 * Density is decremented and the action is audit-logged (I4).
 */
import { bandOf } from '../../shared/grid';
import { tomorrow } from '../../shared/day';
import { CATEGORY_OF } from '../../shared/types';
import { readBoard } from './boardRead';
import { keys } from './keys';
import { unpackQueued } from './pack';
import type { RedisLike } from './redisLike';

export type PurgeResult =
  | { status: 'purged'; where: 'board' | 'queue'; objId: string; name: string }
  | { status: 'not-found'; ident: string };

export async function purgeObject(
  redis: RedisLike,
  today: string,
  ident: string,
  moderator: string,
  now: number
): Promise<PurgeResult> {
  const needle = ident.trim().toLowerCase();
  if (needle.length === 0) return { status: 'not-found', ident };

  // ── Today's live board ──────────────────────────────────────────────────
  const board = await readBoard(redis, today);
  if (board !== null) {
    const hit = board.objects.find(
      (o) => o.id.toLowerCase() === needle || o.name.toLowerCase() === needle
    );
    if (hit !== undefined) {
      await redis.hDel(keys.board(today), [
        `obj:${hit.id}`,
        `obj:${hit.id}:kills`,
        `obj:${hit.id}:saves`,
      ]);
      await redis.hSet(keys.board(today), {
        'meta:count': String(Math.max(0, board.objects.length - 1)),
      });
      await redis.hIncrBy(keys.density(today, bandOf(hit.cell.r)), CATEGORY_OF[hit.type], -1);
      await redis.zAdd(keys.audit(today), {
        member: JSON.stringify({ act: 'purge', objId: hit.id, name: hit.name, by: moderator, ts: now }),
        score: now,
      });
      return { status: 'purged', where: 'board', objId: hit.id, name: hit.name };
    }
  }

  // ── Tomorrow's pending queue ────────────────────────────────────────────
  const targetDay = tomorrow(today);
  const queuedRaw = await redis.hGetAll(keys.queued(targetDay));
  for (const [id, raw] of Object.entries(queuedRaw)) {
    const q = unpackQueued(id, raw);
    if (q === null) continue;
    if (q.id.toLowerCase() === needle || q.name.toLowerCase() === needle) {
      await redis.hDel(keys.queued(targetDay), [q.id]);
      await redis.zRem(keys.queue(targetDay), [q.id]);
      await redis.hIncrBy(keys.density(targetDay, bandOf(q.cell.r)), CATEGORY_OF[q.type], -1);
      await redis.zAdd(keys.audit(targetDay), {
        member: JSON.stringify({ act: 'purge', objId: q.id, name: q.name, by: moderator, ts: now }),
        score: now,
      });
      return { status: 'purged', where: 'queue', objId: q.id, name: q.name };
    }
  }

  return { status: 'not-found', ident };
}
