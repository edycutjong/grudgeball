/**
 * The exact Redis surface Grudgeball uses, as structural types.
 *
 * The real `redis` from '@devvit/web/server' (RedisClient, @devvit/redis
 * 0.13.6 .d.ts) satisfies RedisLike; so does the in-memory stub in
 * tests/helpers/redisStub.ts. Core logic is written against this contract
 * only — no platform import below the route layer.
 *
 * Devvit redis supports hashes + sorted sets + strings + transactions.
 * No plain lists/sets exist on the platform and none are modeled here.
 */

export type ZMemberLike = { member: string; score: number };

export type ZRangeOptionsLike = {
  by: 'score' | 'lex' | 'rank';
  reverse?: boolean;
  limit?: { offset: number; count: number };
};

/** Transaction client returned by watch(). Writes queue after multi();
 * exec() resolves null when a watched key changed (optimistic-concurrency
 * conflict) — per the Devvit redis docs' `result !== null` idiom. */
export type TxLike = {
  multi(): Promise<void>;
  exec(): Promise<unknown[] | null>;
  discard(): Promise<void>;
  unwatch(): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<unknown>;
  hDel(key: string, fields: string[]): Promise<unknown>;
  hIncrBy(key: string, field: string, value: number): Promise<unknown>;
  zAdd(key: string, ...members: ZMemberLike[]): Promise<unknown>;
  zRem(key: string, members: string[]): Promise<unknown>;
};

export type RedisLike = {
  watch(...keys: string[]): Promise<TxLike>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<string>;
  del(...keys: string[]): Promise<void>;
  exists(...keys: string[]): Promise<number>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<number>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hDel(key: string, fields: string[]): Promise<number>;
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hKeys(key: string): Promise<string[]>;
  hLen(key: string): Promise<number>;
  zAdd(key: string, ...members: ZMemberLike[]): Promise<number>;
  zRange(
    key: string,
    start: number,
    stop: number,
    options?: ZRangeOptionsLike
  ): Promise<{ member: string; score: number }[]>;
  zRem(key: string, members: string[]): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zRank(key: string, member: string): Promise<number | undefined>;
  zIncrBy(key: string, member: string, value: number): Promise<number>;
  zCard(key: string): Promise<number>;
};
