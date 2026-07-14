import { describe, expect, it } from 'vitest';
import { addDays, dayNumber, dayOf, hourOf, isDayString, tomorrow, yesterday } from '../src/shared/day';

describe('day math (UTC game clock)', () => {
  it('dayOf uses the UTC date', () => {
    expect(dayOf(Date.parse('2026-07-10T00:00:00Z'))).toBe('2026-07-10');
    expect(dayOf(Date.parse('2026-07-10T23:59:59Z'))).toBe('2026-07-10');
    expect(dayOf(Date.parse('2026-07-11T00:00:00Z'))).toBe('2026-07-11');
  });

  it('tomorrow/yesterday roll over month boundaries', () => {
    expect(tomorrow('2026-06-30')).toBe('2026-07-01');
    expect(yesterday('2026-07-01')).toBe('2026-06-30');
    expect(addDays('2026-07-10', -10)).toBe('2026-06-30');
  });

  it('isDayString accepts real dates only', () => {
    expect(isDayString('2026-07-10')).toBe(true);
    expect(isDayString('2026-02-31')).toBe(false);
    expect(isDayString('26-07-10')).toBe(false);
    expect(isDayString('2026-07-10T00:00:00Z')).toBe(false);
    expect(isDayString('')).toBe(false);
    expect(isDayString('9999-99-99')).toBe(false); // regex-shaped but Date.parse → NaN
  });

  it('dayNumber counts from the epoch (2026-06-30)', () => {
    expect(dayNumber('2026-06-30')).toBe(0);
    expect(dayNumber('2026-07-04')).toBe(4);
    expect(dayNumber('2026-08-01')).toBe(32);
  });

  it('hourOf returns the UTC hour', () => {
    expect(hourOf(Date.parse('2026-07-10T00:30:00Z'))).toBe(0);
    expect(hourOf(Date.parse('2026-07-10T23:01:00Z'))).toBe(23);
  });
});
