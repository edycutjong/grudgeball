/**
 * Coarse A* solvability check (invariant I2).
 *
 * Model: a marble travels the coarse grid moving DOWN, LEFT, or RIGHT (never
 * up — boosters are a bonus, not a requirement). Blocked cells are terrain
 * pegs and DEADLY objects (spike/crusher). Deflectors (magnet/fan/bumper) and
 * helpers stay passable. The check asks: does at least one spawn column reach
 * the goal row without touching a blocked cell?
 *
 * This is a deliberately conservative approximation of the real physics —
 * documented as such — that gives a hard guarantee: the board can never
 * degenerate into an impassable spike wall.
 */
import { GRID_COLS, GRID_ROWS } from './constants';
import type { Cell } from './types';

type Node = { c: number; r: number; g: number; f: number };

/** blocked: set of "c,r" cell keys. Returns true if any top-row start can
 * reach the bottom row. */
export function isSolvable(blocked: ReadonlySet<string>): boolean {
  return findPath(blocked) !== null;
}

/** A* from any open cell in row 0 to any cell in the last row.
 * Returns the path (list of cells, top to bottom) or null. */
export function findPath(blocked: ReadonlySet<string>): Cell[] | null {
  const goalRow = GRID_ROWS - 1;
  const open: Node[] = [];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();

  for (let c = 0; c < GRID_COLS; c++) {
    if (blocked.has(`${c},0`)) continue;
    const key = `${c},0`;
    gScore.set(key, 0);
    open.push({ c, r: 0, g: 0, f: goalRow });
  }

  while (open.length > 0) {
    // Small frontier (<= GRID_COLS * GRID_ROWS nodes): linear extract-min is fine.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      const oi = open[i];
      const ob = open[bestIdx];
      if (oi !== undefined && ob !== undefined && oi.f < ob.f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    // bestIdx is always a valid index into a non-empty `open` (while-guarded),
    // so splice always returns an element — unreachable by construction,
    // kept only to satisfy noUncheckedIndexedAccess.
    /* v8 ignore next */
    if (current === undefined) break;
    const curKey = `${current.c},${current.r}`;

    if (current.r === goalRow) {
      return reconstruct(cameFrom, curKey);
    }

    // Down, left, right. No up: gravity model.
    const neighbors: Cell[] = [
      { c: current.c, r: current.r + 1 },
      { c: current.c - 1, r: current.r },
      { c: current.c + 1, r: current.r },
    ];
    for (const nb of neighbors) {
      if (nb.c < 0 || nb.c >= GRID_COLS || nb.r < 0 || nb.r >= GRID_ROWS) continue;
      const nbKey = `${nb.c},${nb.r}`;
      if (blocked.has(nbKey)) continue;
      const tentative = current.g + 1;
      const known = gScore.get(nbKey);
      if (known !== undefined && tentative >= known) continue;
      gScore.set(nbKey, tentative);
      cameFrom.set(nbKey, curKey);
      const h = goalRow - nb.r;
      open.push({ c: nb.c, r: nb.r, g: tentative, f: tentative + h });
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<string, string>, endKey: string): Cell[] {
  const path: Cell[] = [];
  let key: string | undefined = endKey;
  while (key !== undefined) {
    const parts = key.split(',');
    const c = Number(parts[0]);
    const r = Number(parts[1]);
    path.push({ c, r });
    key = cameFrom.get(key);
  }
  path.reverse();
  return path;
}

/** Convenience: blocked set = terrain ∪ deadly-object cells. */
export function blockedSetFrom(
  terrainKeys: Iterable<string>,
  deadlyCellKeys: Iterable<string>
): Set<string> {
  const s = new Set<string>();
  for (const k of terrainKeys) s.add(k);
  for (const k of deadlyCellKeys) s.add(k);
  return s;
}
