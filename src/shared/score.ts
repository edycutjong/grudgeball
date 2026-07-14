/**
 * Scoring — computed server-side at drop time with the cruelty multiplier.
 */
import { COIN_POINTS, DEPTH_POINTS, GOAL_BONUS } from './constants';

export function scoreRun(
  depth: number,
  coins: number,
  reachedGoal: boolean,
  crueltyMultiplier: number
): number {
  const base = depth * DEPTH_POINTS + coins * COIN_POINTS + (reachedGoal ? GOAL_BONUS : 0);
  return Math.round(base * crueltyMultiplier);
}
