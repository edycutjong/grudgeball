/**
 * Grudgeball — global game constants.
 * Pure data. Imported by client, server, and tests alike.
 */

/** Board grid: portrait gauntlet. Columns x rows of the coarse snap-grid. */
export const GRID_COLS = 9;
export const GRID_ROWS = 24;

/** Pixel size of one grid cell in the client's logical coordinate space. */
export const CELL_PX = 40;
export const BOARD_W = GRID_COLS * CELL_PX; // 360
export const BOARD_H = GRID_ROWS * CELL_PX; // 960

/** Placement is only legal in these rows (inclusive). Rows 0-1 are the spawn
 * apron, rows 22-23 are the goal apron — both are exclusion zones. */
export const PLACE_MIN_ROW = 2;
export const PLACE_MAX_ROW = 21;

/** Density bands: 4 horizontal bands of 6 rows each. */
export const BAND_ROWS = 6;
export const BAND_COUNT = GRID_ROWS / BAND_ROWS; // 4

/** Per-band density caps, enforced inside the placement transaction (I3). */
export const BAND_CAP = {
  menace: 14,
  angel: 14,
  neutral: 10,
} as const;

/** Hard cap on total objects in one board (payload + physics budget). */
export const BOARD_OBJECT_CAP = 220;

/** Number of dev-authored guaranteed gates (reserved-clear cells) per board. */
export const GATE_COUNT = 5;

/** Marbles per player per day. */
export const MARBLES_PER_DAY = 3;

/** Object name constraints. */
export const NAME_MAX_LEN = 24;

/** Scoring. */
export const DEPTH_POINTS = 100; // per row of depth reached
export const COIN_POINTS = 25;
export const GOAL_BONUS = 500;

/** Cruelty curve: score multiplier 1.0 → 4.0 as active traps approach cap. */
export const CRUELTY_MIN = 1.0;
export const CRUELTY_MAX = 4.0;
/** trap cap used by the cruelty curve = total menace cap across bands. */
export const TRAP_CAP = BAND_CAP.menace * BAND_COUNT; // 56

/** Plausibility gates (anti-cheat, honest tier). */
export const POLYLINE_MAX_POINTS = 64;
export const MIN_MS_PER_ROW = 45; // a marble cannot fall faster than this
export const MAX_RUN_MS = 5 * 60_000; // runs longer than 5 min are noise
export const MAX_COINS_PER_FOUNTAIN = 3;
export const MAX_KILLS_PER_RUN = 1; // dying ends the run
export const MAX_SAVES_PER_RUN = 8;
export const MAX_EVENTS_PER_RUN = 32;
/** Max displacement between two consecutive polyline samples (px). */
export const MAX_STEP_PX = 220;
/** Max upward travel between two consecutive samples (px) — bounces only. */
export const MAX_RISE_PX = 120;

/** Realtime channel (single, 1Hz-batched by the client renderer). */
export const REALTIME_CHANNEL = 'board_live';

/** Day numbering epoch: dayNumber = days since this date (UTC). */
export const GB_EPOCH = '2026-06-30';

/** UI palette (UI.md): near-black base, grudge red, brass. */
export const PALETTE = {
  base: '#07060B',
  red: '#EF4444',
  brass: '#F59E0B',
  panel: '#12101A',
  text: '#E7E5F0',
  dim: '#8B87A0',
  green: '#34D399',
} as const;
