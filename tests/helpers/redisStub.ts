/**
 * In-memory Redis stub implementing EXACTLY the RedisLike surface the app
 * uses (mirrors @devvit/redis 0.13.6 semantics for that subset):
 *
 * - strings / hashes / zsets (no plain lists/sets — the platform has none)
 * - hGetAll returns {} for missing keys; get returns undefined
 * - zRange by rank with negative indices and reverse
 * - watch/multi/exec with true optimistic concurrency: every mutation bumps
 *   a per-key version; exec compares watched versions and resolves null on
 *   conflict (the documented Devvit `result !== null` idiom)
 * - queued tx ops apply atomically at exec time, never before
 *
 * Test hooks:
 * - onBeforeExec: one-shot callback fired right before exec validates its
 *   watch set — lets tests inject a racing write deterministically.
 * - openWatches: hygiene counter; a well-behaved caller always releases via
 *   exec/discard/unwatch (asserted in placement tests).
 */
import type { RedisLike, TxLike, ZMemberLike, ZRangeOptionsLike } from '../../src/server/core/redisLike';

type StoreValue =
  | { kind: 'string'; value: string }
  | { kind: 'hash'; value: Map<string, string> }
  | { kind: 'zset'; value: Map<string, number> };

export class RedisStub implements RedisLike {
  private store = new Map<string, StoreValue>();
  private versions = new Map<string, number>();
  openWatches = 0;
  onBeforeExec: (() => void) | null = null;

  // ── internals ────────────────────────────────────────────────────────────
  private bump(key: string): void {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }

  version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  private hash(key: string): Map<string, string> {
    const existing = this.store.get(key);
    if (existing !== undefined) {
      if (existing.kind !== 'hash') throw new Error(`WRONGTYPE ${key}`);
      return existing.value;
    }
    const fresh = new Map<string, string>();
    this.store.set(key, { kind: 'hash', value: fresh });
    return fresh;
  }

  private zset(key: string): Map<string, number> {
    const existing = this.store.get(key);
    if (existing !== undefined) {
      if (existing.kind !== 'zset') throw new Error(`WRONGTYPE ${key}`);
      return existing.value;
    }
    const fresh = new Map<string, number>();
    this.store.set(key, { kind: 'zset', value: fresh });
    return fresh;
  }

  // ── sync cores (shared by direct calls and queued tx ops) ────────────────
  setSync(key: string, value: string): string {
    this.store.set(key, { kind: 'string', value });
    this.bump(key);
    return 'OK';
  }

  hSetSync(key: string, fieldValues: Record<string, string>): number {
    const h = this.hash(key);
    let added = 0;
    for (const [f, v] of Object.entries(fieldValues)) {
      if (!h.has(f)) added++;
      h.set(f, v);
    }
    this.bump(key);
    return added;
  }

  hDelSync(key: string, fields: string[]): number {
    const existing = this.store.get(key);
    if (existing === undefined || existing.kind !== 'hash') return 0;
    let n = 0;
    for (const f of fields) {
      if (existing.value.delete(f)) n++;
    }
    if (existing.value.size === 0) this.store.delete(key);
    this.bump(key);
    return n;
  }

  hIncrBySync(key: string, field: string, value: number): number {
    const h = this.hash(key);
    const cur = Number(h.get(field) ?? '0') || 0;
    const next = cur + value;
    h.set(field, String(next));
    this.bump(key);
    return next;
  }

  zAddSync(key: string, ...members: ZMemberLike[]): number {
    const z = this.zset(key);
    let added = 0;
    for (const m of members) {
      if (!z.has(m.member)) added++;
      z.set(m.member, m.score);
    }
    this.bump(key);
    return added;
  }

  zRemSync(key: string, members: string[]): number {
    const existing = this.store.get(key);
    if (existing === undefined || existing.kind !== 'zset') return 0;
    let n = 0;
    for (const m of members) {
      if (existing.value.delete(m)) n++;
    }
    if (existing.value.size === 0) this.store.delete(key);
    this.bump(key);
    return n;
  }

  /** Sorted ascending by (score, member) — Redis ordering. */
  private sortedEntries(key: string): { member: string; score: number }[] {
    const existing = this.store.get(key);
    if (existing === undefined || existing.kind !== 'zset') return [];
    return [...existing.value.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
  }

  // ── RedisLike surface ─────────────────────────────────────────────────────
  async watch(...keys: string[]): Promise<TxLike> {
    this.openWatches++;
    const snapshot = new Map<string, number>(keys.map((k) => [k, this.version(k)]));
    return new TxStub(this, snapshot);
  }

  async get(key: string): Promise<string | undefined> {
    const v = this.store.get(key);
    return v !== undefined && v.kind === 'string' ? v.value : undefined;
  }

  async set(key: string, value: string): Promise<string> {
    return this.setSync(key, value);
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      if (this.store.delete(key)) this.bump(key);
    }
  }

  async exists(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) if (this.store.has(key)) n++;
    return n;
  }

  async hGet(key: string, field: string): Promise<string | undefined> {
    const v = this.store.get(key);
    return v !== undefined && v.kind === 'hash' ? v.value.get(field) : undefined;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const v = this.store.get(key);
    const out: Record<string, string> = {};
    if (v !== undefined && v.kind === 'hash') {
      for (const [f, val] of v.value) out[f] = val;
    }
    return out;
  }

  async hSet(key: string, fieldValues: Record<string, string>): Promise<number> {
    return this.hSetSync(key, fieldValues);
  }

  async hSetNX(key: string, field: string, value: string): Promise<number> {
    const h = this.hash(key);
    if (h.has(field)) return 0;
    h.set(field, value);
    this.bump(key);
    return 1;
  }

  async hDel(key: string, fields: string[]): Promise<number> {
    return this.hDelSync(key, fields);
  }

  async hIncrBy(key: string, field: string, value: number): Promise<number> {
    return this.hIncrBySync(key, field, value);
  }

  async hKeys(key: string): Promise<string[]> {
    const v = this.store.get(key);
    return v !== undefined && v.kind === 'hash' ? [...v.value.keys()] : [];
  }

  async hLen(key: string): Promise<number> {
    const v = this.store.get(key);
    return v !== undefined && v.kind === 'hash' ? v.value.size : 0;
  }

  async zAdd(key: string, ...members: ZMemberLike[]): Promise<number> {
    return this.zAddSync(key, ...members);
  }

  async zRange(
    key: string,
    start: number,
    stop: number,
    options?: ZRangeOptionsLike
  ): Promise<{ member: string; score: number }[]> {
    const by = options?.by ?? 'rank';
    if (by !== 'rank') {
      throw new Error(`RedisStub.zRange: only by:'rank' is implemented (got '${by}')`);
    }
    let entries = this.sortedEntries(key);
    if (options?.reverse === true) entries = entries.reverse();
    const n = entries.length;
    const s = start < 0 ? Math.max(0, n + start) : start;
    let e = stop < 0 ? n + stop : stop;
    if (e >= n) e = n - 1;
    if (s > e || s >= n) return [];
    return entries.slice(s, e + 1);
  }

  async zRem(key: string, members: string[]): Promise<number> {
    return this.zRemSync(key, members);
  }

  async zScore(key: string, member: string): Promise<number | undefined> {
    const existing = this.store.get(key);
    if (existing === undefined || existing.kind !== 'zset') return undefined;
    return existing.value.get(member);
  }

  async zRank(key: string, member: string): Promise<number | undefined> {
    const entries = this.sortedEntries(key);
    const idx = entries.findIndex((e) => e.member === member);
    return idx === -1 ? undefined : idx;
  }

  async zIncrBy(key: string, member: string, value: number): Promise<number> {
    const z = this.zset(key);
    const next = (z.get(member) ?? 0) + value;
    z.set(member, next);
    this.bump(key);
    return next;
  }

  async zCard(key: string): Promise<number> {
    const existing = this.store.get(key);
    return existing !== undefined && existing.kind === 'zset' ? existing.value.size : 0;
  }

  // ── test helpers ─────────────────────────────────────────────────────────
  /** Stable JSON snapshot of one key (byte-identical comparisons). */
  snapshotKey(key: string): string {
    const v = this.store.get(key);
    if (v === undefined) return 'null';
    if (v.kind === 'string') return JSON.stringify({ kind: 'string', value: v.value });
    if (v.kind === 'hash') {
      const obj: Record<string, string> = {};
      for (const f of [...v.value.keys()].sort()) {
        const val = v.value.get(f);
        if (val !== undefined) obj[f] = val;
      }
      return JSON.stringify({ kind: 'hash', value: obj });
    }
    const arr = this.sortedEntries(key);
    return JSON.stringify({ kind: 'zset', value: arr });
  }

  /** Stable snapshot of several keys. */
  snapshot(keys: string[]): string {
    const obj: Record<string, string> = {};
    for (const k of [...keys].sort()) obj[k] = this.snapshotKey(k);
    return JSON.stringify(obj);
  }

  allKeys(): string[] {
    return [...this.store.keys()].sort();
  }
}

class TxStub implements TxLike {
  private ops: (() => unknown)[] = [];
  private released = false;

  constructor(
    private readonly stub: RedisStub,
    private readonly watched: Map<string, number>
  ) {}

  private release(): void {
    if (!this.released) {
      this.released = true;
      this.stub.openWatches--;
    }
  }

  async multi(): Promise<void> {
    // Queueing starts; nothing to do — ops[] captures subsequent writes.
  }

  async exec(): Promise<unknown[] | null> {
    const hook = this.stub.onBeforeExec;
    if (hook !== null) {
      this.stub.onBeforeExec = null;
      hook();
    }
    this.release();
    for (const [key, version] of this.watched) {
      if (this.stub.version(key) !== version) return null;
    }
    return this.ops.map((op) => op());
  }

  async discard(): Promise<void> {
    this.ops = [];
    this.release();
  }

  async unwatch(): Promise<unknown> {
    this.release();
    return this;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.ops.push(() => this.stub.setSync(key, value));
    return this;
  }

  async hSet(key: string, fieldValues: Record<string, string>): Promise<unknown> {
    this.ops.push(() => this.stub.hSetSync(key, fieldValues));
    return this;
  }

  async hDel(key: string, fields: string[]): Promise<unknown> {
    this.ops.push(() => this.stub.hDelSync(key, fields));
    return this;
  }

  async hIncrBy(key: string, field: string, value: number): Promise<unknown> {
    this.ops.push(() => this.stub.hIncrBySync(key, field, value));
    return this;
  }

  async zAdd(key: string, ...members: ZMemberLike[]): Promise<unknown> {
    this.ops.push(() => this.stub.zAddSync(key, ...members));
    return this;
  }

  async zRem(key: string, members: string[]): Promise<unknown> {
    this.ops.push(() => this.stub.zRemSync(key, members));
    return this;
  }
}
