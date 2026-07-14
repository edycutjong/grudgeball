/**
 * Client marble-drop simulation (authoritative for FEEL, not records).
 *
 * Deterministic coarse-grid pachinko: the marble falls row by row from the
 * aim column, glances off deflectors/terrain toward or through the centre,
 * banks coins and saves, and dies on the first DEADLY object it enters. The
 * server re-scores and plausibility-checks whatever this produces
 * (COMPLEXITY.md §3) — so the physics here only needs to be plausible, and
 * the polyline it emits is built to clear every gate in `plausibility.ts`
 * (≤64 points, ≤1-cell steps, never rising, depth reconciles with maxY).
 */
import { CELL_PX, GRID_COLS, GRID_ROWS, MAX_SAVES_PER_RUN, MIN_MS_PER_ROW } from '../../shared/constants';
import { cellKey } from '../../shared/grid';
import { DEADLY } from '../../shared/types';
import type { BoardObjectWithCounters, Cell, RunEvent, RunResult } from '../../shared/types';

const CENTER = (GRID_COLS - 1) / 2;

export type SimInput = {
  aimCol: number;
  objects: readonly BoardObjectWithCounters[];
  terrain: readonly Cell[];
};

export type SimResult = {
  run: RunResult;
  /** The object the marble died on (for the killer card), or null if it lived. */
  killer: BoardObjectWithCounters | null;
  /** Cell-space path the renderer animates. */
  path: { c: number; r: number }[];
};

function clampCol(c: number): number {
  return Math.max(0, Math.min(GRID_COLS - 1, c));
}

/** Deflectors nudge the marble toward the centre; a dead-centre hit passes
 * straight through (head-on bounce). Deterministic and stable. */
function deflectDir(col: number): number {
  return Math.sign(CENTER - col);
}

/** Terrain is solid — the marble must sidestep. Prefer centre-ward; fall back
 * to the other side; stay put only if fully boxed (gates make that impossible). */
function deflectAroundTerrain(col: number, r: number, terrain: ReadonlySet<string>): number {
  const bias = Math.sign(CENTER - col) || 1;
  const first = clampCol(col + bias);
  if (first !== col && !terrain.has(`${first},${r}`)) return first;
  const other = clampCol(col - bias);
  if (other !== col && !terrain.has(`${other},${r}`)) return other;
  return col;
}

export function simulateDrop(input: SimInput, runId: string): SimResult {
  const objAt = new Map<string, BoardObjectWithCounters>();
  for (const o of input.objects) objAt.set(cellKey(o.cell), o);
  const terrain = new Set(input.terrain.map(cellKey));

  const aimCol = clampCol(Math.round(input.aimCol));
  let col = aimCol;
  const path: { c: number; r: number }[] = [{ c: col, r: 0 }];
  const events: RunEvent[] = [];
  let coins = 0;
  let saves = 0;
  let depth = 0;
  let reachedGoal = false;
  let killer: BoardObjectWithCounters | null = null;

  for (let r = 1; r < GRID_ROWS; r++) {
    if (terrain.has(`${col},${r}`)) col = deflectAroundTerrain(col, r, terrain);
    depth = r;
    const here = objAt.get(`${col},${r}`);
    if (here !== undefined) {
      if (DEADLY.has(here.type)) {
        events.push({ objId: here.id, kind: 'kill' });
        killer = here;
        path.push({ c: col, r });
        break;
      } else if (here.type === 'coin') {
        coins += 1;
        events.push({ objId: here.id, kind: 'coin' });
      } else if (here.type === 'cushion' || here.type === 'booster') {
        if (saves < MAX_SAVES_PER_RUN) {
          saves += 1;
          events.push({ objId: here.id, kind: 'save' });
        }
      } else {
        col = clampCol(col + deflectDir(col));
      }
    }
    path.push({ c: col, r });
    if (r === GRID_ROWS - 1) {
      reachedGoal = true;
      break;
    }
  }

  const polyline: number[] = [];
  for (const p of path) {
    polyline.push(Math.round((p.c + 0.5) * CELL_PX), Math.round((p.r + 0.5) * CELL_PX));
  }

  const run: RunResult = {
    runId,
    aimCol,
    // Comfortably above the server's MIN_MS_PER_ROW freefall floor.
    elapsedMs: Math.max(400, Math.round(depth * MIN_MS_PER_ROW * 2.5)),
    depth,
    coins,
    reachedGoal,
    polyline,
    events,
  };
  return { run, killer, path };
}
