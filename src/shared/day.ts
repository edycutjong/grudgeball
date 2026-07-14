/**
 * UTC day math. A "day" is a YYYY-MM-DD string; the scheduler compiles at
 * 00:00 UTC, so the UTC date IS the game clock.
 */
import { GB_EPOCH } from './constants';

const DAY_MS = 86_400_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayString(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Round-trip to reject things like 2026-02-31.
  return dayOf(t) === s;
}

/** The UTC day containing the given epoch-ms timestamp. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  return dayOf(dayToMs(day) + n * DAY_MS);
}

export function tomorrow(day: string): string {
  return addDays(day, 1);
}

export function yesterday(day: string): string {
  return addDays(day, -1);
}

/** Board "Day N" banner number: days since the epoch date. */
export function dayNumber(day: string): number {
  return Math.round((dayToMs(day) - dayToMs(GB_EPOCH)) / DAY_MS);
}

/** UTC hour of day (0-23) for accretion cohorts. */
export function hourOf(ms: number): number {
  return new Date(ms).getUTCHours();
}
