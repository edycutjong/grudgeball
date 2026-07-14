/**
 * Plausibility gates — the honest anti-cheat tier.
 *
 * Client physics is authoritative for FEEL; the server is authoritative for
 * RECORDS. Every run report passes these pure gates. Failures never hard-
 * reject: the run lands in the shadow zset (leaderboard-hidden, mod-
 * reviewable) and the marble is still consumed. Documented plainly in the
 * README's trust model.
 */
import {
  BOARD_H,
  CELL_PX,
  GRID_ROWS,
  MAX_COINS_PER_FOUNTAIN,
  MAX_EVENTS_PER_RUN,
  MAX_KILLS_PER_RUN,
  MAX_RISE_PX,
  MAX_RUN_MS,
  MAX_SAVES_PER_RUN,
  MAX_STEP_PX,
  MIN_MS_PER_ROW,
  POLYLINE_MAX_POINTS,
} from './constants';
import { DEADLY } from './types';
import type { BoardObject, RunResult } from './types';

export type PlausibilityInput = {
  run: RunResult;
  /** Objects active at drop time (releaseHour <= activeHour). */
  activeObjects: readonly BoardObject[];
};

export type PlausibilityVerdict = {
  ok: boolean;
  flags: string[];
};

export function checkPlausibility(input: PlausibilityInput): PlausibilityVerdict {
  const { run, activeObjects } = input;
  const flags: string[] = [];

  // Structural sanity.
  if (!Number.isInteger(run.depth) || run.depth < 0 || run.depth > GRID_ROWS) {
    flags.push('DEPTH_RANGE');
  }
  if (!Number.isFinite(run.elapsedMs) || run.elapsedMs < 0 || run.elapsedMs > MAX_RUN_MS) {
    flags.push('ELAPSED_RANGE');
  }
  if (run.polyline.length % 2 !== 0 || run.polyline.length / 2 > POLYLINE_MAX_POINTS) {
    flags.push('POLYLINE_SHAPE');
  }
  if (run.events.length > MAX_EVENTS_PER_RUN) {
    flags.push('EVENT_COUNT');
  }

  // Gate: minimum elapsed time per depth. A marble cannot cross a row faster
  // than MIN_MS_PER_ROW even in freefall.
  if (run.depth > 0 && run.elapsedMs < run.depth * MIN_MS_PER_ROW) {
    flags.push('TOO_FAST');
  }

  // Gate: coin ceiling — coins cannot exceed what active fountains at or
  // above the reached depth could plausibly emit.
  const reachableFountains = activeObjects.filter(
    (o) => o.type === 'coin' && o.cell.r <= run.depth
  ).length;
  if (run.coins > reachableFountains * MAX_COINS_PER_FOUNTAIN) {
    flags.push('COIN_CEILING');
  }

  // Gate: event caps + event/object referential integrity.
  const kills = run.events.filter((e) => e.kind === 'kill').length;
  const saves = run.events.filter((e) => e.kind === 'save').length;
  if (kills > MAX_KILLS_PER_RUN) flags.push('KILL_CAP');
  if (saves > MAX_SAVES_PER_RUN) flags.push('SAVE_CAP');
  const byId = new Map(activeObjects.map((o) => [o.id, o]));
  for (const ev of run.events) {
    const obj = byId.get(ev.objId);
    if (obj === undefined) {
      flags.push('UNKNOWN_OBJECT');
      break;
    }
    // Kind/type integrity: kills only on deadly objects, saves only on
    // cushion/booster, coins only on coin fountains.
    const kindOk =
      (ev.kind === 'kill' && DEADLY.has(obj.type)) ||
      (ev.kind === 'save' && (obj.type === 'cushion' || obj.type === 'booster')) ||
      (ev.kind === 'coin' && obj.type === 'coin');
    if (!kindOk) {
      flags.push('EVENT_TYPE_MISMATCH');
      break;
    }
  }

  // Gate: velocity continuity across the decimated polyline. Steps are
  // bounded; the marble never teleports and never rises more than a bounce.
  const pl = run.polyline;
  for (let i = 0; i + 3 < pl.length; i += 2) {
    const x0 = pl[i];
    const y0 = pl[i + 1];
    const x1 = pl[i + 2];
    const y1 = pl[i + 3];
    // The loop guard (i + 3 < pl.length) already proves all four indices are
    // in range for a dense number[]; this only satisfies noUncheckedIndexedAccess.
    /* v8 ignore next */
    if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) break;
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.hypot(dx, dy) > MAX_STEP_PX) {
      flags.push('TELEPORT_STEP');
      break;
    }
    if (dy < -MAX_RISE_PX) {
      flags.push('ANTI_GRAVITY');
      break;
    }
  }

  // Gate: reported depth must reconcile with the polyline's deepest sample.
  if (pl.length >= 2) {
    let maxY = -Infinity;
    for (let i = 1; i < pl.length; i += 2) {
      const y = pl[i];
      if (y !== undefined && y > maxY) maxY = y;
    }
    if (maxY > -Infinity) {
      const polylineDepth = Math.min(GRID_ROWS, Math.floor(Math.max(0, maxY) / CELL_PX));
      if (run.depth > polylineDepth + 2) flags.push('DEPTH_MISMATCH');
      if (maxY > BOARD_H + CELL_PX) flags.push('OUT_OF_BOARD');
    }
  } else if (run.depth > 2) {
    // Depth without a trace is suspicious beyond trivial drops.
    flags.push('NO_TRACE');
  }

  return { ok: flags.length === 0, flags };
}
