import { describe, expect, it } from 'vitest';
import { CELL_PX, MAX_COINS_PER_FOUNTAIN } from '../src/shared/constants';
import { checkPlausibility } from '../src/shared/plausibility';
import type { BoardObject } from '../src/shared/types';
import { makeRun } from './helpers/factories';

function obj(id: string, type: BoardObject['type'], c: number, r: number): BoardObject {
  return { id, type, cell: { c, r }, rot: 0, author: 'a', authorId: 't2_a', name: id, releaseHour: 0 };
}

const BOARD: BoardObject[] = [
  obj('s1', 'spike', 4, 13),
  obj('c1', 'coin', 2, 4),
  obj('c2', 'coin', 6, 8),
  obj('k1', 'cushion', 2, 15),
  obj('b1', 'booster', 1, 2),
];

describe('plausibility gates (anti-cheat, honest tier)', () => {
  it('passes a clean run', () => {
    const v = checkPlausibility({ run: makeRun(13), activeObjects: BOARD });
    expect(v).toEqual({ ok: true, flags: [] });
  });

  it('flags TOO_FAST when elapsed < depth * MIN_MS_PER_ROW', () => {
    const v = checkPlausibility({
      run: makeRun(20, { elapsedMs: 100 }),
      activeObjects: BOARD,
    });
    expect(v.ok).toBe(false);
    expect(v.flags).toContain('TOO_FAST');
  });

  it('flags COIN_CEILING when coins exceed reachable fountains × max', () => {
    // Depth 6 reaches only fountain c1 (row 4): ceiling = 1 × MAX.
    const v = checkPlausibility({
      run: makeRun(6, { coins: MAX_COINS_PER_FOUNTAIN + 1 }),
      activeObjects: BOARD,
    });
    expect(v.flags).toContain('COIN_CEILING');
    // Same coins at depth 9 (two fountains reachable) is fine.
    const ok = checkPlausibility({
      run: makeRun(9, { coins: MAX_COINS_PER_FOUNTAIN + 1 }),
      activeObjects: BOARD,
    });
    expect(ok.flags).not.toContain('COIN_CEILING');
  });

  it('flags KILL_CAP on more than one kill per run', () => {
    const v = checkPlausibility({
      run: makeRun(14, {
        events: [
          { objId: 's1', kind: 'kill' },
          { objId: 's1', kind: 'kill' },
        ],
      }),
      activeObjects: BOARD,
    });
    expect(v.flags).toContain('KILL_CAP');
  });

  it('flags SAVE_CAP on save spam', () => {
    const events = Array.from({ length: 9 }, () => ({ objId: 'k1', kind: 'save' as const }));
    const v = checkPlausibility({ run: makeRun(16, { events }), activeObjects: BOARD });
    expect(v.flags).toContain('SAVE_CAP');
  });

  it('flags UNKNOWN_OBJECT for events on objects not active on the board', () => {
    const v = checkPlausibility({
      run: makeRun(14, { events: [{ objId: 'ghost', kind: 'kill' }] }),
      activeObjects: BOARD,
    });
    expect(v.flags).toContain('UNKNOWN_OBJECT');
  });

  it('flags EVENT_TYPE_MISMATCH when a save is claimed on a spike', () => {
    const v = checkPlausibility({
      run: makeRun(14, { events: [{ objId: 's1', kind: 'save' }] }),
      activeObjects: BOARD,
    });
    expect(v.flags).toContain('EVENT_TYPE_MISMATCH');
  });

  it('flags TELEPORT_STEP on a discontinuous polyline', () => {
    const run = makeRun(10);
    run.polyline = [180, 20, 180, 700]; // one 680px jump
    const v = checkPlausibility({ run, activeObjects: BOARD });
    expect(v.flags).toContain('TELEPORT_STEP');
  });

  it('flags ANTI_GRAVITY when the marble rises beyond a bounce', () => {
    const run = makeRun(10);
    run.polyline = [180, 20, 180, 100, 180, 180, 180, 30, 180, 420];
    const v = checkPlausibility({ run, activeObjects: BOARD });
    expect(v.flags).toContain('ANTI_GRAVITY');
  });

  it('flags DEPTH_MISMATCH when reported depth outruns the trace', () => {
    const run = makeRun(20);
    run.polyline = [180, 20, 180, 100, 180, 180]; // trace stops at row 4
    const v = checkPlausibility({ run, activeObjects: BOARD });
    expect(v.flags).toContain('DEPTH_MISMATCH');
  });

  it('flags NO_TRACE for depth without a polyline', () => {
    const v = checkPlausibility({
      run: makeRun(10, { polyline: [] }),
      activeObjects: BOARD,
    });
    expect(v.flags).toContain('NO_TRACE');
  });

  it('flags POLYLINE_SHAPE on odd-length or oversized polylines', () => {
    const odd = makeRun(5);
    odd.polyline = [1, 2, 3];
    expect(checkPlausibility({ run: odd, activeObjects: BOARD }).flags).toContain('POLYLINE_SHAPE');
    const huge = makeRun(5);
    huge.polyline = Array.from({ length: 65 * 2 }, (_, i) => (i % 2 === 0 ? 180 : Math.floor(i / 2) * 8));
    expect(checkPlausibility({ run: huge, activeObjects: BOARD }).flags).toContain('POLYLINE_SHAPE');
  });

  it('flags DEPTH_RANGE on impossible depths', () => {
    const v = checkPlausibility({ run: makeRun(99, { elapsedMs: 99 * 100 }), activeObjects: BOARD });
    expect(v.flags).toContain('DEPTH_RANGE');
  });

  it('flags ELAPSED_RANGE on an out-of-bounds elapsed time', () => {
    const tooLong = checkPlausibility({
      run: makeRun(5, { elapsedMs: 6 * 60_000 }),
      activeObjects: BOARD,
    });
    expect(tooLong.flags).toContain('ELAPSED_RANGE');
    const negative = checkPlausibility({
      run: makeRun(5, { elapsedMs: -1 }),
      activeObjects: BOARD,
    });
    expect(negative.flags).toContain('ELAPSED_RANGE');
  });

  it('flags EVENT_COUNT when a run reports more events than the cap', () => {
    const events = Array.from({ length: 33 }, () => ({ objId: 's1', kind: 'kill' as const }));
    const v = checkPlausibility({ run: makeRun(14, { events }), activeObjects: BOARD });
    expect(v.flags).toContain('EVENT_COUNT');
  });

  it('accepts a legitimate coin-pickup event on a coin fountain', () => {
    const v = checkPlausibility({
      run: makeRun(6, { events: [{ objId: 'c1', kind: 'coin' }] }),
      activeObjects: BOARD,
    });
    expect(v.flags).not.toContain('EVENT_TYPE_MISMATCH');
  });

  it('a trivial drop (depth <= 2) with no trace is not flagged NO_TRACE', () => {
    const v = checkPlausibility({
      run: makeRun(2, { polyline: [] }),
      activeObjects: BOARD,
    });
    expect(v.flags).not.toContain('NO_TRACE');
  });

  it('a -Infinity polyline sample never registers as the deepest point', () => {
    const run = makeRun(0, { polyline: [100, -Infinity] });
    const v = checkPlausibility({ run, activeObjects: BOARD });
    expect(v.flags).not.toContain('DEPTH_MISMATCH');
    expect(v.flags).not.toContain('OUT_OF_BOARD');
  });

  it('out-of-board polyline samples are flagged', () => {
    const run = makeRun(4);
    run.polyline = [180, 20, 180, 160, 180, CELL_PX * 24 + 200];
    const v = checkPlausibility({ run, activeObjects: BOARD });
    expect(v.flags).toContain('OUT_OF_BOARD');
  });
});
