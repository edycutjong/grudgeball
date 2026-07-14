/**
 * Seed Demo Day (COMPLEXITY.md §6 — Seeding & Reproducibility).
 *
 * Deterministic and idempotent: seeding the same day twice yields a
 * byte-identical board:{day} hash (vitest-verified). Loads the hand-placed
 * 60-object founder board, populated counters, 40 synthetic ghost trails,
 * yesterday's leaderboards, and — when an invoker is present — a
 * pre-populated Grudge Report so the morning modal demos immediately.
 */
import { bandOf } from '../../shared/grid';
import { yesterday } from '../../shared/day';
import { demoFixture, demoTrails, FOUNDERS } from '../../shared/fixtures/demoBoard';
import { CATEGORY_OF } from '../../shared/types';
import type { BoardObjectWithCounters, Category } from '../../shared/types';
import { BAND_COUNT } from '../../shared/constants';
import { keys } from './keys';
import { packCells, packObject } from './pack';
import type { RedisLike } from './redisLike';

export type SeedResult = {
  status: 'ok';
  day: string;
  objects: number;
  trails: number;
  founders: number;
};

export async function seedDemoDay(
  redis: RedisLike,
  day: string,
  invoker: { userId: string; username: string } | null
): Promise<SeedResult> {
  const fixture = demoFixture();
  const trails = demoTrails(fixture.trailSeed);
  const yday = yesterday(day);

  // ── board:{day}: delete-then-write for byte-determinism ────────────────
  const boardKey = keys.board(day);
  await redis.del(boardKey);
  const fields: Record<string, string> = {
    'meta:v': '1',
    'meta:day': day,
    'meta:seed': `demo:${fixture.trailSeed}`,
    'meta:terrain': packCells(fixture.terrain),
    'meta:gates': packCells(fixture.gates),
    'meta:trails': JSON.stringify(trails),
    'meta:count': String(fixture.objects.length),
  };
  // The false branch (a.id >= b.id) is unreachable: the hardcoded ROWS
  // table's ids ("d01", "d02", …) are always already in ascending order.
  /* v8 ignore next */
  const ordered = [...fixture.objects].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const o of ordered) {
    fields[`obj:${o.id}`] = packObject(o);
    fields[`obj:${o.id}:kills`] = String(o.kills);
    fields[`obj:${o.id}:saves`] = String(o.saves);
  }
  await redis.hSet(boardKey, fields);

  // ── density:{day}:{band}: recounted from the fixture ───────────────────
  const densityByBand = new Map<number, Record<Category, number>>();
  for (const o of fixture.objects) {
    const band = bandOf(o.cell.r);
    const counts = densityByBand.get(band) ?? { menace: 0, angel: 0, neutral: 0 };
    counts[CATEGORY_OF[o.type]] += 1;
    densityByBand.set(band, counts);
  }
  for (let band = 0; band < BAND_COUNT; band++) {
    const dKey = keys.density(day, band);
    await redis.del(dKey);
    const counts = densityByBand.get(band);
    // The demo fixture's 60 hand-placed objects populate every band, so this
    // is never undefined in practice — kept for a future fixture with gaps.
    /* v8 ignore next */
    if (counts !== undefined) {
      await redis.hSet(dKey, {
        menace: String(counts.menace),
        angel: String(counts.angel),
        neutral: String(counts.neutral),
      });
    }
  }

  // ── yesterday's leaderboards from founder counters ─────────────────────
  const menaceKey = keys.lb('menace', yday);
  const angelKey = keys.lb('angel', yday);
  await redis.del(menaceKey, angelKey);
  const killsByAuthor = new Map<string, number>();
  const savesByAuthor = new Map<string, number>();
  for (const o of fixture.objects) {
    if (o.kills > 0) killsByAuthor.set(o.author, (killsByAuthor.get(o.author) ?? 0) + o.kills);
    if (o.saves > 0) savesByAuthor.set(o.author, (savesByAuthor.get(o.author) ?? 0) + o.saves);
  }
  for (const [author, kills] of [...killsByAuthor.entries()].sort()) {
    await redis.zAdd(menaceKey, { member: author, score: kills });
  }
  for (const [author, saves] of [...savesByAuthor.entries()].sort()) {
    await redis.zAdd(angelKey, { member: author, score: saves });
  }

  // ── yesterday's report meta + founder reports ──────────────────────────
  const metaKey = keys.reportMeta(yday);
  await redis.del(metaKey);
  const yr = fixture.yesterdayReport;
  await redis.hSet(metaKey, {
    boardKills: String(yr.boardKills),
    boardSaves: String(yr.boardSaves),
    deadliestName: yr.deadliestName,
    deadliestAuthor: yr.deadliestAuthor,
    deadliestKills: String(yr.deadliestKills),
    builders: String(yr.builders),
  });
  for (const founder of FOUNDERS) {
    const kills = killsByAuthor.get(founder.username) ?? 0;
    const saves = savesByAuthor.get(founder.username) ?? 0;
    const rKey = keys.report(yday, founder.userId);
    await redis.del(rKey);
    await redis.hSet(rKey, {
      kills: String(kills),
      saves: String(saves),
      objectName: bestObjectName(fixture.objects, founder.username),
      objectType: bestObjectType(fixture.objects, founder.username),
      menaceRank: '',
      angelRank: '',
      depthRank: '',
    });
  }

  // ── invoker's demo report: "your spike claimed 87 marbles" ─────────────
  if (invoker !== null) {
    const rKey = keys.report(yday, invoker.userId);
    await redis.del(rKey);
    await redis.hSet(rKey, {
      kills: String(yr.kills),
      saves: String(yr.saves),
      objectName: yr.objectName,
      objectType: yr.objectType,
      menaceRank: String(yr.menaceRank),
      // The demo fixture's yesterdayReport.angelRank is always null (the
      // seeded story's invoker report never has an angel rank); non-null
      // isn't reachable through this fixed fixture.
      /* v8 ignore next */
      angelRank: yr.angelRank === null ? '' : String(yr.angelRank),
      depthRank: String(yr.depthRank),
    });
    // Clear the seen-marker so the modal fires on next open.
    await redis.hDel(keys.user(invoker.userId, day), ['lastReportSeen']);
  }

  return {
    status: 'ok',
    day,
    objects: fixture.objects.length,
    trails: trails.length,
    founders: FOUNDERS.length,
  };
}

function bestObjectName(objects: readonly BoardObjectWithCounters[], author: string): string {
  let best = '';
  let bestScore = -1;
  for (const o of objects) {
    if (o.author !== author) continue;
    const s = o.kills + o.saves;
    if (s > bestScore) {
      bestScore = s;
      best = o.name;
    }
  }
  return best;
}

function bestObjectType(objects: readonly BoardObjectWithCounters[], author: string): string {
  let best = '';
  let bestScore = -1;
  for (const o of objects) {
    if (o.author !== author) continue;
    const s = o.kills + o.saves;
    if (s > bestScore) {
      bestScore = s;
      best = o.type;
    }
  }
  return best;
}
