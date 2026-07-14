/**
 * Grudgeball — core domain types. Pure, platform-free.
 */

/** The fixed 8-object palette. No free drawing — this is the moderation model. */
export type ObjectType =
  | 'spike'
  | 'crusher'
  | 'magnet'
  | 'fan'
  | 'bumper'
  | 'cushion'
  | 'booster'
  | 'coin';

export const OBJECT_TYPES: readonly ObjectType[] = [
  'spike',
  'crusher',
  'magnet',
  'fan',
  'bumper',
  'cushion',
  'booster',
  'coin',
];

/** Economy category. Menace earns per kill, Angel per save, Neutral earns lore. */
export type Category = 'menace' | 'angel' | 'neutral';

export const CATEGORY_OF: Readonly<Record<ObjectType, Category>> = {
  spike: 'menace',
  crusher: 'menace',
  magnet: 'menace',
  fan: 'menace',
  bumper: 'neutral',
  cushion: 'angel',
  booster: 'angel',
  coin: 'angel',
};

/** Types that are lethal — these are the cells the A* solvability check treats
 * as impassable. Everything else deflects or helps and stays passable. */
export const DEADLY: ReadonlySet<ObjectType> = new Set(['spike', 'crusher']);

export type Cell = { c: number; r: number };

/** Quarter-turn rotation for directional objects (fan, magnet, booster). */
export type Rot = 0 | 1 | 2 | 3;

/** One placed object on a compiled board (or in tomorrow's queue). */
export type BoardObject = {
  id: string;
  type: ObjectType;
  cell: Cell;
  rot: Rot;
  /** Reddit username of the author (display). */
  author: string;
  /** Reddit user id (t2_*) of the author (report keying). */
  authorId: string;
  /** Player-given name, <= NAME_MAX_LEN, wordlist-filtered. */
  name: string;
  /** Hour of day (0-23 UTC) at which this object becomes active. */
  releaseHour: number;
};

export type BoardObjectWithCounters = BoardObject & {
  kills: number;
  saves: number;
};

/** A compiled board as served to the client. */
export type BoardView = {
  day: string;
  dayNumber: number;
  /** 'live' = compiled board for the requested day; 'preview' = tomorrow's
   * accretion queue rendered in board shape (used by the placement scene). */
  mode: 'live' | 'preview';
  objects: BoardObjectWithCounters[];
  terrain: Cell[];
  gates: Cell[];
  /** Synthetic ghost-trail polylines (seeded demo only; [] otherwise). */
  trails: number[][];
  activeHour: number;
  activeTrapCount: number;
  trapCap: number;
  cruelty: number;
  me: PlayerDayState | null;
};

export type PlayerDayState = {
  userId: string;
  username: string;
  marblesUsed: number;
  placed: boolean;
  hasUnseenReport: boolean;
};

/** A queued placement (tomorrow's board material). */
export type QueuedPlacement = {
  id: string;
  type: ObjectType;
  cell: Cell;
  rot: Rot;
  author: string;
  authorId: string;
  name: string;
  ts: number;
};

/** Per-run collision event reported by the client. */
export type RunEvent = {
  objId: string;
  kind: 'kill' | 'save' | 'coin';
};

/** Client-reported run result (untrusted; passes plausibility gates). */
export type RunResult = {
  runId: string;
  /** Aim: spawn column released from the top rail. */
  aimCol: number;
  elapsedMs: number;
  /** Deepest row reached (0-based). */
  depth: number;
  coins: number;
  reachedGoal: boolean;
  /** Flattened [x0,y0,x1,y1,...] int-quantized, <= POLYLINE_MAX_POINTS pairs. */
  polyline: number[];
  events: RunEvent[];
};

/** Grudge Report served to the morning modal. */
export type GrudgeReport = {
  day: string;
  dayNumber: number;
  objectName: string;
  objectType: ObjectType | '';
  kills: number;
  saves: number;
  menaceRank: number | null;
  angelRank: number | null;
  depthRank: number | null;
  boardKills: number;
  boardSaves: number;
  deadliestName: string;
  deadliestAuthor: string;
  deadliestKills: number;
  builders: number;
};

export type LeaderboardRow = { member: string; score: number; rank: number };

export type LeaderboardTab = 'depth' | 'menace' | 'angel' | 'streak';

export type LeaderboardView = {
  tab: LeaderboardTab;
  day: string;
  top: LeaderboardRow[];
  me: LeaderboardRow | null;
  neighbors: LeaderboardRow[];
};

/** Realtime messages on the board_live channel (garnish, not load-bearing). */
export type LiveMessage =
  | {
      t: 'placement';
      day: string;
      objId: string;
      objType: ObjectType;
      cell: Cell;
      author: string;
      name: string;
    }
  | {
      t: 'run';
      day: string;
      depth: number;
      killerName?: string;
      killerAuthor?: string;
      by: string;
    }
  | { t: 'accrete'; day: string; hour: number; cruelty: number; released: number }
  | { t: 'purge'; day: string; objId: string };
