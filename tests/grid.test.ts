import { describe, expect, it } from 'vitest';
import { GRID_COLS, GRID_ROWS, PLACE_MAX_ROW, PLACE_MIN_ROW } from '../src/shared/constants';
import { bandOf, cellKey, inBounds, inPlacementZone, legalCells, parseCellKey } from '../src/shared/grid';

describe('grid geometry', () => {
  it('bandOf maps 6-row bands', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(5)).toBe(0);
    expect(bandOf(6)).toBe(1);
    expect(bandOf(11)).toBe(1);
    expect(bandOf(12)).toBe(2);
    expect(bandOf(23)).toBe(3);
  });

  it('placement zone excludes spawn and goal aprons', () => {
    expect(inPlacementZone({ c: 4, r: 0 })).toBe(false);
    expect(inPlacementZone({ c: 4, r: 1 })).toBe(false);
    expect(inPlacementZone({ c: 4, r: PLACE_MIN_ROW })).toBe(true);
    expect(inPlacementZone({ c: 4, r: PLACE_MAX_ROW })).toBe(true);
    expect(inPlacementZone({ c: 4, r: 22 })).toBe(false);
    expect(inPlacementZone({ c: 4, r: 23 })).toBe(false);
  });

  it('inBounds rejects fractional and out-of-range cells', () => {
    expect(inBounds({ c: 0, r: 0 })).toBe(true);
    expect(inBounds({ c: GRID_COLS, r: 0 })).toBe(false);
    expect(inBounds({ c: 0, r: GRID_ROWS })).toBe(false);
    expect(inBounds({ c: -1, r: 3 })).toBe(false);
    expect(inBounds({ c: 1.5, r: 3 })).toBe(false);
  });

  it('cellKey/parseCellKey round-trip; parse rejects junk', () => {
    expect(parseCellKey(cellKey({ c: 3, r: 17 }))).toEqual({ c: 3, r: 17 });
    expect(parseCellKey('9,0')).toBeNull(); // out of bounds col
    expect(parseCellKey('a,b')).toBeNull();
  });

  it('legalCells excludes terrain, gates, and occupied cells', () => {
    const terrain = new Set([cellKey({ c: 0, r: 2 })]);
    const gates = new Set([cellKey({ c: 1, r: 2 })]);
    const occupied = new Set([cellKey({ c: 2, r: 2 })]);
    const cells = legalCells(terrain, gates, occupied);
    const keySet = new Set(cells.map(cellKey));
    expect(keySet.has('0,2')).toBe(false);
    expect(keySet.has('1,2')).toBe(false);
    expect(keySet.has('2,2')).toBe(false);
    expect(keySet.has('3,2')).toBe(true);
    // total = placeable rows * cols - 3 exclusions
    expect(cells.length).toBe((PLACE_MAX_ROW - PLACE_MIN_ROW + 1) * GRID_COLS - 3);
  });
});
