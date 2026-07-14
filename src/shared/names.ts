/**
 * Object-name filter. Fixed palette means nothing obscene is drawable; the
 * only free text in the game is the 24-char object name, so it gets a
 * conservative filter: charset allowlist + normalized-substring wordlist.
 * Report-to-hide and the mod purge action back this up (defense in depth).
 */
import { NAME_MAX_LEN } from './constants';

export type NameCheck = { ok: true; name: string } | { ok: false; code: NameRejectCode };

export type NameRejectCode = 'EMPTY' | 'TOO_LONG' | 'BAD_CHARS' | 'BLOCKED_WORD';

/** Allowed characters: letters, digits, space, and light punctuation. */
const CHARSET = /^[A-Za-z0-9 '’\-!.,?]+$/;

/**
 * Compact blocklist, matched against a leetspeak-normalized, delimiter-free
 * lowercase form. Deliberately conservative — mods hold the purge hammer for
 * everything a list can't catch.
 */
const BLOCKED: readonly string[] = [
  'fuck',
  'shit',
  'cunt',
  'nigg',
  'fagg',
  'kike',
  'spic',
  'chink',
  'wetback',
  'tranny',
  'retard',
  'rape',
  'nazi',
  'hitler',
  'kys',
  'killyourself',
  'porn',
  'penis',
  'vagina',
  'cock',
  'dick',
  'boob',
  'tits',
  'cum',
  'jizz',
  'whore',
  'slut',
];

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's',
  '!': 'i',
};

export function normalizeForFilter(raw: string): string {
  let out = '';
  for (const ch of raw.toLowerCase()) {
    const mapped = LEET[ch] ?? ch;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
}

export function checkName(raw: string): NameCheck {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return { ok: false, code: 'EMPTY' };
  if (trimmed.length > NAME_MAX_LEN) return { ok: false, code: 'TOO_LONG' };
  if (!CHARSET.test(trimmed)) return { ok: false, code: 'BAD_CHARS' };
  const normalized = normalizeForFilter(trimmed);
  for (const word of BLOCKED) {
    if (normalized.includes(word)) return { ok: false, code: 'BLOCKED_WORD' };
  }
  return { ok: true, name: trimmed };
}
