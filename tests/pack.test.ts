/**
 * Byte-deterministic packing of board objects and queued placements, and
 * every malformed-payload branch each unpacker guards against.
 */
import { describe, expect, it } from 'vitest';
import {
  packCells,
  packObject,
  packQueued,
  unpackCells,
  unpackObject,
  unpackQueued,
} from '../src/server/core/pack';
import type { BoardObject, QueuedPlacement } from '../src/shared/types';

const OBJ: BoardObject = {
  id: 'o1',
  type: 'spike',
  cell: { c: 3, r: 5 },
  rot: 1,
  author: 'alice',
  authorId: 't2_a',
  name: "Alice's Wrath",
  releaseHour: 7,
};

const QUEUED: QueuedPlacement = {
  id: 'q1',
  type: 'cushion',
  cell: { c: 2, r: 9 },
  rot: 2,
  author: 'bob',
  authorId: 't2_b',
  name: 'Soft Landing',
  ts: 12345,
};

describe('packObject / unpackObject round-trip', () => {
  it('round-trips a valid object', () => {
    const raw = packObject(OBJ);
    expect(unpackObject(OBJ.id, raw)).toEqual(OBJ);
  });

  it('rejects invalid JSON', () => {
    expect(unpackObject('id', '{not json')).toBeNull();
  });

  it('rejects a JSON array (not an object)', () => {
    expect(unpackObject('id', '[1,2,3]')).toBeNull();
  });

  it('rejects each malformed field individually', () => {
    const good = JSON.parse(packObject(OBJ)) as Record<string, unknown>;
    const cases: [string, unknown][] = [
      ['t', 'not-a-type'],
      ['c', [1]], // wrong length
      ['c', ['x', 5]], // non-numeric
      ['c', [-1, 5]], // numeric but out of bounds
      ['r', 9], // bad rot
      ['a', 5], // non-string author
      ['aid', 5],
      ['n', 5],
      ['h', -1], // out of range hour
      ['h', 1.5], // non-integer hour
      ['h', 'x'], // non-numeric hour
    ];
    for (const [field, value] of cases) {
      const bad = { ...good, [field]: value };
      expect(unpackObject('id', JSON.stringify(bad))).toBeNull();
    }
  });
});

describe('packQueued / unpackQueued round-trip', () => {
  it('round-trips a valid queued placement', () => {
    const raw = packQueued(QUEUED);
    expect(unpackQueued(QUEUED.id, raw)).toEqual(QUEUED);
  });

  it('rejects invalid JSON', () => {
    expect(unpackQueued('id', 'nope')).toBeNull();
  });

  it('rejects a missing/non-numeric ts', () => {
    const good = JSON.parse(packQueued(QUEUED)) as Record<string, unknown>;
    expect(unpackQueued('id', JSON.stringify({ ...good, ts: '123' }))).toBeNull();
    const { ts: _ts, ...withoutTs } = good;
    expect(unpackQueued('id', JSON.stringify(withoutTs))).toBeNull();
  });

  it('rejects each malformed shared field individually', () => {
    const good = JSON.parse(packQueued(QUEUED)) as Record<string, unknown>;
    const cases: [string, unknown][] = [
      ['t', 'not-a-type'],
      ['c', [1]],
      ['r', 9],
      ['a', 5],
      ['aid', 5],
      ['n', 5],
    ];
    for (const [field, value] of cases) {
      expect(unpackQueued('id', JSON.stringify({ ...good, [field]: value }))).toBeNull();
    }
  });
});

describe('packCells / unpackCells', () => {
  it('round-trips a cell list', () => {
    const cells = [
      { c: 0, r: 0 },
      { c: 8, r: 23 },
    ];
    expect(unpackCells(packCells(cells))).toEqual(cells);
  });

  it('returns [] for undefined input', () => {
    expect(unpackCells(undefined)).toEqual([]);
  });

  it('returns [] for invalid JSON', () => {
    expect(unpackCells('not json')).toEqual([]);
  });

  it('returns [] for a JSON value that is not an array', () => {
    expect(unpackCells('{"a":1}')).toEqual([]);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const raw = JSON.stringify([
      [1, 2],
      ['x', 'y'],
      [3], // wrong length
      [4, 5],
    ]);
    expect(unpackCells(raw)).toEqual([
      { c: 1, r: 2 },
      { c: 4, r: 5 },
    ]);
  });
});
