/**
 * Deterministic terrain + gate generation. compile(day) lays the same
 * terrain for the same day forever: seed = hash32(day + salt).
 *
 * Terrain cells are static solid pegs/ledges. Gate cells are dev-authored
 * reserved-clear cells (I2 support): never terrain, never placeable, so a
 * candidate path always exists. A* remains the authority.
 */
import { GATE_COUNT, GRID_COLS, GRID_ROWS } from './constants';
import { cellKey } from './grid';
import { hash32, makeRng, rngInt } from './rng';
import { isSolvable } from './solvability';
import type { Cell } from './types';

export type Terrain = {
  seed: number;
  terrain: Cell[];
  gates: Cell[];
};

/** Max terrain pegs per row — always leaves >= GRID_COLS - 2 open columns. */
const MAX_PEGS_PER_ROW = 2;
/** Terrain only spawns in these rows (clear spawn & goal aprons). */
const TERRAIN_MIN_ROW = 3;
const TERRAIN_MAX_ROW = GRID_ROWS - 3; // 21

export function generateTerrain(day: string): Terrain {
  // Deterministic retry: if a salt produces bare terrain that A* rejects
  // (cannot happen with <=2 pegs/row, but the check is cheap and absolute),
  // bump the salt. Same day → same salt sequence → same result.
  // The loop only ever runs once — see the comment above — so salt is
  // always 0 and isSolvable is always true on the first pass.
  /* v8 ignore next 5 */
  for (let salt = 0; salt < 16; salt++) {
    const seed = hash32(salt === 0 ? day : `${day}#${salt}`);
    const built = buildOnce(seed);
    const blocked = new Set(built.terrain.map(cellKey));
    if (isSolvable(blocked)) return built;
  }
  // Unreachable by construction; absolute fallback is a bare board.
  /* v8 ignore next */
  return { seed: hash32(day), terrain: [], gates: defaultGates() };
}

/* v8 ignore start -- only called from the unreachable-by-construction fallback above */
function defaultGates(): Cell[] {
  return [
    { c: 3, r: 4 },
    { c: 5, r: 8 },
    { c: 2, r: 12 },
    { c: 6, r: 16 },
    { c: 4, r: 20 },
  ];
}
/* v8 ignore stop */

function buildOnce(seed: number): Terrain {
  const rng = makeRng(seed);

  // Gates: one per GRID_ROWS/GATE_COUNT rows, column jittered.
  const gates: Cell[] = [];
  const stride = Math.floor(GRID_ROWS / (GATE_COUNT + 1)); // 4
  for (let i = 0; i < GATE_COUNT; i++) {
    const r = stride * (i + 1); // rows 4, 8, 12, 16, 20
    const c = 1 + rngInt(rng, GRID_COLS - 2); // avoid extreme walls
    gates.push({ c, r });
  }
  const gateKeys = new Set(gates.map(cellKey));

  const terrain: Cell[] = [];
  for (let r = TERRAIN_MIN_ROW; r <= TERRAIN_MAX_ROW; r++) {
    const pegs = rngInt(rng, MAX_PEGS_PER_ROW + 1); // 0..2
    const usedCols = new Set<number>();
    for (let p = 0; p < pegs; p++) {
      const c = rngInt(rng, GRID_COLS);
      if (usedCols.has(c)) continue;
      const cell = { c, r };
      if (gateKeys.has(cellKey(cell))) continue;
      usedCols.add(c);
      terrain.push(cell);
    }
  }

  return { seed, terrain, gates };
}
