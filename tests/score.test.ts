import { describe, expect, it } from 'vitest';
import { scoreRun } from '../src/shared/score';

describe('scoreRun', () => {
  it('scores depth + coins, no goal bonus, at cruelty 1.0', () => {
    expect(scoreRun(3, 2, false, 1.0)).toBe(3 * 100 + 2 * 25);
  });

  it('adds the goal bonus when reachedGoal is true', () => {
    expect(scoreRun(0, 0, true, 1.0)).toBe(500);
  });

  it('applies the cruelty multiplier and rounds', () => {
    // 13 * 100 * 2.7 = 3510 exactly (the deterministic demo beat).
    expect(scoreRun(13, 0, false, 2.7)).toBe(3510);
  });

  it('rounds fractional results to the nearest integer', () => {
    expect(scoreRun(1, 0, false, 1.005)).toBe(Math.round(100 * 1.005));
  });
});
