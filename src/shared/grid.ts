/**
 * Snap-grid geometry: cells, bands, zones, legality.
 */
import {
  BAND_ROWS,
  GRID_COLS,
  GRID_ROWS,
  PLACE_MAX_ROW,
  PLACE_MIN_ROW,
} from './constants';
import type { Cell } from './types';

export function cellKey(cell: Cell): string {
  return `${cell.c},${cell.r}`;
}

export function parseCellKey(key: string): Cell | null {
  const m = /^(\d+),(\d+)$/.exec(key);
  if (!m) return null;
  const c = Number(m[1]);
  const r = Number(m[2]);
  if (!inBounds({ c, r })) return null;
  return { c, r };
}

export function inBounds(cell: Cell): boolean {
  return (
    Number.isInteger(cell.c) &&
    Number.isInteger(cell.r) &&
    cell.c >= 0 &&
    cell.c < GRID_COLS &&
    cell.r >= 0 &&
    cell.r < GRID_ROWS
  );
}

/** Band index (0-based) of a row. */
export function bandOf(row: number): number {
  return Math.floor(row / BAND_ROWS);
}

/** Is the cell inside the placeable zone (excludes spawn/goal aprons)? */
export function inPlacementZone(cell: Cell): boolean {
  return inBounds(cell) && cell.r >= PLACE_MIN_ROW && cell.r <= PLACE_MAX_ROW;
}

/** All legal placement cells given blocked sets (terrain, gates, occupied). */
export function legalCells(
  terrain: ReadonlySet<string>,
  gates: ReadonlySet<string>,
  occupied: ReadonlySet<string>
): Cell[] {
  const out: Cell[] = [];
  for (let r = PLACE_MIN_ROW; r <= PLACE_MAX_ROW; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const key = `${c},${r}`;
      if (terrain.has(key) || gates.has(key) || occupied.has(key)) continue;
      out.push({ c, r });
    }
  }
  return out;
}
