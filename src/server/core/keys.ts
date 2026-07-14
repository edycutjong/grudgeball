/**
 * Redis key builders — the whole schema in one file (ARCHITECTURE.md).
 * Hashes + zsets only. Data is siloed per subreddit by the platform.
 */
import type { LeaderboardTab } from '../../shared/types';

export const keys = {
  /** hash: obj:{id} → packed object, obj:{id}:kills/saves counters, meta:*. */
  board: (day: string) => `board:${day}`,
  /** zset: placementId scored by timestamp (accretion order). */
  queue: (day: string) => `queue:${day}`,
  /** hash: placementId → packed queued placement payload. */
  queued: (day: string) => `queued:${day}`,
  /** hash: per-band category counts for cap enforcement (I3). */
  density: (day: string, band: number) => `density:${day}:${band}`,
  /** zset: audit log entries scored by timestamp (I4, mod forensics). */
  audit: (day: string) => `audit:${day}`,
  /** zsets: score ladders. */
  lb: (kind: Exclude<LeaderboardTab, 'streak'>, day: string) => `lb:${kind}:${day}`,
  lbStreak: () => `lb:streak`,
  /** hash: marblesUsed, placed, placementId, lastRunId, lastReportSeen. */
  user: (userId: string, day: string) => `user:${userId}:${day}`,
  /** hash: per-user overnight aggregates. */
  report: (day: string, userId: string) => `report:${day}:${userId}`,
  /** hash: board-wide overnight stats. */
  reportMeta: (day: string) => `report:${day}:meta`,
  /** zset: plausibility-flagged runs (leaderboard-hidden, mod-reviewable). */
  shadow: (day: string) => `shadow:${day}`,
  /** hash: current, best, lastDay. */
  streak: (userId: string) => `streak:${userId}`,
  /** hash: postId → day (bound by cron + onPostCreate trigger). */
  postmap: () => `postmap`,
  /** hash: day → postId (idempotent daily post creation). */
  daypost: () => `daypost`,
} as const;
