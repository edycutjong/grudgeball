/**
 * Cruelty Multiplier — the intraday wager.
 * cruelty(t) = 1.0 + 3.0 * (active_traps(t) / trap_cap), clamped to [1, 4].
 * Applied server-side to scores at drop time; displayed in the HUD; argued
 * about in the comments.
 */
import { CRUELTY_MAX, CRUELTY_MIN, TRAP_CAP } from './constants';

export function cruelty(activeTraps: number, trapCap: number = TRAP_CAP): number {
  if (trapCap <= 0) return CRUELTY_MIN;
  const raw = CRUELTY_MIN + (CRUELTY_MAX - CRUELTY_MIN) * (activeTraps / trapCap);
  const clamped = Math.min(CRUELTY_MAX, Math.max(CRUELTY_MIN, raw));
  // One decimal of display precision, deterministic.
  return Math.round(clamped * 10) / 10;
}
