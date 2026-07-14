import { describe, expect, it } from 'vitest';
import { GRID_COLS, GRID_ROWS } from '../src/shared/constants';
import { cellKey } from '../src/shared/grid';
import { blockedSetFrom, findPath, isSolvable } from '../src/shared/solvability';
import { generateTerrain } from '../src/shared/terrain';

function wallRow(r: number, except: number[] = []): string[] {
  const out: string[] = [];
  for (let c = 0; c < GRID_COLS; c++) {
    if (!except.includes(c)) out.push(`${c},${r}`);
  }
  return out;
}

describe('A* solvability (invariant I2)', () => {
  it('an empty board is solvable and the path spans top to bottom', () => {
    const path = findPath(new Set());
    expect(path).not.toBeNull();
    expect(path?.[0]?.r).toBe(0);
    expect(path?.[path.length - 1]?.r).toBe(GRID_ROWS - 1);
  });

  it('a full deadly row is unsolvable', () => {
    expect(isSolvable(new Set(wallRow(10)))).toBe(false);
  });

  it('one gap in the wall restores solvability', () => {
    expect(isSolvable(new Set(wallRow(10, [6])))).toBe(true);
  });

  it('two staggered walls with offset gaps are solvable via lateral moves', () => {
    const blocked = new Set([...wallRow(8, [0]), ...wallRow(14, [8])]);
    expect(isSolvable(blocked)).toBe(true);
  });

  it('a sealed pocket (gap over a plugged row below) is unsolvable', () => {
    // Row 8 open only at col 3; row 9 fully sealed under it.
    const blocked = new Set([...wallRow(8, [3]), ...wallRow(9)]);
    expect(isSolvable(blocked)).toBe(false);
  });

  it('the marble cannot climb: a gap reachable only by moving up fails', () => {
    // Row 5 open only at col 0. Column 0 blocked at row 6 → must move right
    // along row 5... but row 5's other cells are blocked, so the only escape
    // would be upward. Unsolvable in the gravity model.
    const blocked = new Set([...wallRow(5, [0]), '0,6']);
    expect(isSolvable(blocked)).toBe(false);
  });

  it('skips a blocked row-0 spawn column but still finds a path from another one', () => {
    const blocked = new Set(['0,0']); // col 0's spawn cell is blocked; 1..8 are open
    const path = findPath(blocked);
    expect(path).not.toBeNull();
    expect(path?.[0]?.c).not.toBe(0);
  });

  it('blockedSetFrom unions terrain and deadly cells', () => {
    const s = blockedSetFrom(['1,1'], ['2,2']);
    expect(s.has('1,1')).toBe(true);
    expect(s.has('2,2')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('generated terrain is always solvable on its own (compile precondition)', () => {
    for (const day of ['2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-12-31']) {
      const t = generateTerrain(day);
      expect(isSolvable(new Set(t.terrain.map(cellKey)))).toBe(true);
    }
  });

  it('is fast enough to run inside the placement transaction', () => {
    // Dense-but-solvable: 2 blocked cells per row.
    const blocked = new Set<string>();
    for (let r = 2; r < GRID_ROWS - 2; r++) {
      blocked.add(`${(r * 3) % GRID_COLS},${r}`);
      blocked.add(`${(r * 5 + 2) % GRID_COLS},${r}`);
    }
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) isSolvable(blocked);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(500); // 200 checks well under half a second
  });
});
