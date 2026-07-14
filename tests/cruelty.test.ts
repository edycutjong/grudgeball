import { describe, expect, it } from 'vitest';
import { TRAP_CAP } from '../src/shared/constants';
import { cruelty } from '../src/shared/cruelty';

describe('cruelty curve — the intraday wager', () => {
  it('is 1.0 on a naked board', () => {
    expect(cruelty(0)).toBe(1.0);
  });

  it('is 4.0 at the trap cap', () => {
    expect(cruelty(TRAP_CAP)).toBe(4.0);
  });

  it('clamps above the cap (never > 4.0)', () => {
    expect(cruelty(TRAP_CAP * 3)).toBe(4.0);
  });

  it('never dips below 1.0 on nonsense input', () => {
    expect(cruelty(-5)).toBe(1.0);
    expect(cruelty(0, 0)).toBe(1.0);
  });

  it('is monotonic in active traps', () => {
    let prev = 0;
    for (let traps = 0; traps <= TRAP_CAP; traps++) {
      const m = cruelty(traps);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('midpoint lands at ×2.5 with one-decimal display precision', () => {
    expect(cruelty(TRAP_CAP / 2)).toBe(2.5);
  });
});
