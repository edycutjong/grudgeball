import { describe, expect, it } from 'vitest';
import { checkName, normalizeForFilter } from '../src/shared/names';

describe('object-name filter (the only free text in the game)', () => {
  it("accepts flavorful names like \"Greg's Regret\"", () => {
    const res = checkName("Greg's Regret");
    expect(res).toEqual({ ok: true, name: "Greg's Regret" });
  });

  it('collapses whitespace and trims', () => {
    const res = checkName('  Deep   Pocket  ');
    expect(res).toEqual({ ok: true, name: 'Deep Pocket' });
  });

  it('rejects empty and whitespace-only names', () => {
    expect(checkName('')).toEqual({ ok: false, code: 'EMPTY' });
    expect(checkName('    ')).toEqual({ ok: false, code: 'EMPTY' });
  });

  it('rejects names over 24 characters', () => {
    expect(checkName('A'.repeat(25))).toEqual({ ok: false, code: 'TOO_LONG' });
    expect(checkName('A'.repeat(24)).ok).toBe(true);
  });

  it('rejects disallowed characters (emoji, angle brackets, slashes)', () => {
    expect(checkName('<script>')).toEqual({ ok: false, code: 'BAD_CHARS' });
    expect(checkName('u/someone')).toEqual({ ok: false, code: 'BAD_CHARS' });
    expect(checkName('💀 pit')).toEqual({ ok: false, code: 'BAD_CHARS' });
  });

  it('blocks slurs and profanity as substrings', () => {
    expect(checkName('total fuckery')).toEqual({ ok: false, code: 'BLOCKED_WORD' });
    expect(checkName('NaZi trap')).toEqual({ ok: false, code: 'BLOCKED_WORD' });
  });

  it('catches leetspeak evasion via normalization', () => {
    expect(normalizeForFilter('F0ckery')).toBe('fockery');
    expect(checkName('sh1t chute')).toEqual({ ok: false, code: 'BLOCKED_WORD' });
    expect(checkName('r4pe room')).toEqual({ ok: false, code: 'BLOCKED_WORD' });
  });

  it('does not false-positive on innocent words', () => {
    expect(checkName('Grass Blade').ok).toBe(true);
    expect(checkName('Class Act').ok).toBe(true);
    expect(checkName('Therapist Chair').ok).toBe(true);
  });
});
