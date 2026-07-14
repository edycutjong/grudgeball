/**
 * Transactional Placement Engine (COMPLEXITY.md §1 — the crown jewel).
 *
 * One watch/multi/exec transaction guards every placement:
 *
 *   WATCH  queue:{day+1}, queued:{day+1}, user:{id}:{day}, density:{day+1}:{band}
 *   CHECK  placement flag unset · cell vacant · band density < cap ·
 *          A* solvability(board ∪ candidate) passes · name filter
 *   MULTI  zAdd queue · hSet queued payload · hSet user flag ·
 *          hIncrBy density band · zAdd audit log
 *   EXEC   → null ⇒ contested → retry (fresh reads); if the cell is now
 *          taken the player hears "claimed seconds ago" (lore, not error).
 *
 * Invariants:
 *   I1 one placement per user per day (flag checked+written in-tx; the
 *      placement id is also deterministic per user+day as a second lock).
 *   I2 no board state where spawn→goal path count = 0 (A* inside the tx).
 *   I3 density per band <= cap, menace/angel/neutral counted separately.
 *   I4 every placement audit-logged with timestamp + author.
 */
import { BAND_CAP, BOARD_OBJECT_CAP, MARBLES_PER_DAY } from '../../shared/constants';
import { dayOf, tomorrow } from '../../shared/day';
import { bandOf, cellKey, inPlacementZone } from '../../shared/grid';
import { checkName } from '../../shared/names';
import { blockedSetFrom, isSolvable } from '../../shared/solvability';
import { generateTerrain } from '../../shared/terrain';
import { CATEGORY_OF, DEADLY, OBJECT_TYPES } from '../../shared/types';
import type { QueuedPlacement } from '../../shared/types';
import type { PlaceRejectCode, PlaceRequest, PlaceResponse } from '../../shared/protocol';
import { keys } from './keys';
import { packQueued, unpackQueued } from './pack';
import type { RedisLike } from './redisLike';

export type PlaceDeps = {
  redis: RedisLike;
  now: number;
  user: { userId: string; username: string } | null;
};

/** Untrusted wire shape — narrowed inside placeObject. */
export type PlaceWire = {
  type: string;
  cell: { c: number; r: number };
  rot: number;
  name: string;
};

const MAX_ATTEMPTS = 3;

const REJECT_MESSAGES: Record<PlaceRejectCode, string> = {
  ANONYMOUS: 'Log in to hold a grudge.',
  ALREADY_PLACED: 'Your grudge is already planted. It returns at dawn.',
  MARBLES_REMAIN: 'Spend all your marbles first — then you may hold a grudge.',
  BAD_TYPE: 'That is not one of the eight sanctioned instruments.',
  BAD_NAME: 'That name will not survive moderation. Try another.',
  ILLEGAL_CELL: 'That cell is off-limits (spawn apron, goal apron, or reserved).',
  CELL_TAKEN: 'Someone claimed this spot seconds ago.',
  BAND_FULL: 'This depth band is saturated. Spread the cruelty elsewhere.',
  BOARD_FULL: "Tomorrow's board is at capacity.",
  UNSOLVABLE: 'That placement would seal the gauntlet shut. The path must live.',
  CONTESTED: 'The queue is white-hot right now — try again in a moment.',
};

function reject(code: PlaceRejectCode): PlaceResponse {
  return { status: 'rejected', code, message: REJECT_MESSAGES[code] };
}

export async function placeObject(
  deps: PlaceDeps,
  req: PlaceWire | PlaceRequest
): Promise<PlaceResponse> {
  const { redis, now, user } = deps;
  if (user === null) return reject('ANONYMOUS');

  const today = dayOf(now);
  const targetDay = tomorrow(today);

  // ── Static validation (no redis needed) ────────────────────────────────
  const objType = OBJECT_TYPES.find((t) => t === req.type);
  if (objType === undefined) return reject('BAD_TYPE');
  const nameCheck = checkName(req.name);
  if (!nameCheck.ok) return reject('BAD_NAME');
  if (!inPlacementZone(req.cell)) return reject('ILLEGAL_CELL');
  const rot = req.rot === 0 || req.rot === 1 || req.rot === 2 || req.rot === 3 ? req.rot : 0;

  const terrain = generateTerrain(targetDay);
  const terrainKeys = new Set(terrain.terrain.map(cellKey));
  const gateKeys = new Set(terrain.gates.map(cellKey));
  const candidateKey = cellKey(req.cell);
  if (terrainKeys.has(candidateKey) || gateKeys.has(candidateKey)) {
    return reject('ILLEGAL_CELL');
  }

  const band = bandOf(req.cell.r);
  const category = CATEGORY_OF[objType];
  const userKey = keys.user(user.userId, today);
  const queueKey = keys.queue(targetDay);
  const queuedKey = keys.queued(targetDay);
  const densityKey = keys.density(targetDay, band);
  const placementId = `p_${targetDay}_${user.userId}`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const txn = await redis.watch(queueKey, queuedKey, userKey, densityKey);

    // ── Fresh reads under WATCH (plain client; watch guards staleness) ──
    const userState = await redis.hGetAll(userKey);
    if (userState['placed'] === '1') {
      await txn.unwatch();
      return reject('ALREADY_PLACED');
    }
    const marblesUsed = Number(userState['marblesUsed'] ?? '0') || 0;
    if (marblesUsed < MARBLES_PER_DAY) {
      await txn.unwatch();
      return reject('MARBLES_REMAIN');
    }

    const queuedRaw = await redis.hGetAll(queuedKey);
    const queued: QueuedPlacement[] = [];
    for (const [id, raw] of Object.entries(queuedRaw)) {
      const q = unpackQueued(id, raw);
      if (q !== null) queued.push(q);
    }
    if (queued.some((q) => cellKey(q.cell) === candidateKey)) {
      await txn.unwatch();
      return reject('CELL_TAKEN');
    }
    if (queued.length >= BOARD_OBJECT_CAP) {
      await txn.unwatch();
      return reject('BOARD_FULL');
    }

    const bandCount = Number((await redis.hGet(densityKey, category)) ?? '0') || 0;
    if (bandCount >= BAND_CAP[category]) {
      await txn.unwatch();
      return reject('BAND_FULL');
    }

    // ── I2: A* solvability of terrain ∪ queued deadly ∪ candidate ──────
    if (DEADLY.has(objType)) {
      const deadlyCells = queued
        .filter((q) => DEADLY.has(q.type))
        .map((q) => cellKey(q.cell));
      const blocked = blockedSetFrom(terrainKeys, [...deadlyCells, candidateKey]);
      if (!isSolvable(blocked)) {
        await txn.unwatch();
        return reject('UNSOLVABLE');
      }
    }

    // ── Queue the atomic write set ──────────────────────────────────────
    const payload: QueuedPlacement = {
      id: placementId,
      type: objType,
      cell: { c: req.cell.c, r: req.cell.r },
      rot,
      author: user.username,
      authorId: user.userId,
      name: nameCheck.name,
      ts: now,
    };
    const auditEntry = JSON.stringify({
      pid: placementId,
      uid: user.userId,
      cell: candidateKey,
      type: objType,
      name: nameCheck.name,
      ts: now,
    });

    await txn.multi();
    await txn.zAdd(queueKey, { member: placementId, score: now });
    await txn.hSet(queuedKey, { [placementId]: packQueued(payload) });
    await txn.hSet(userKey, { placed: '1', placementId });
    await txn.hIncrBy(densityKey, category, 1);
    await txn.zAdd(keys.audit(targetDay), { member: auditEntry, score: now });
    const result = await txn.exec();

    if (result !== null) {
      const queuePosition = queued.length; // 0-based position before us
      const releasePreviewHour = Math.min(23, Math.floor((queuePosition * 24) / (queuePosition + 1)));
      return { status: 'ok', placementId, day: targetDay, releasePreviewHour };
    }
    // exec === null → a watched key moved. Loop re-reads; if our cell got
    // claimed we exit with the lore message, otherwise retry.
  }
  return reject('CONTESTED');
}
