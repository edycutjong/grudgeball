/**
 * Demo board fixture — 60 hand-placed objects with escalating personality:
 * a friendly top third, a mid-board character zone, and the kill zone with
 * "Greg's Regret" (312 victims) on the natural first-drop line (col 4).
 *
 * `data/fixtures/demo-board.json` is generated from this module
 * (`npm run seed:local` regenerates it); a vitest case keeps the two in
 * byte-parity so they can never drift.
 *
 * Authors are 12 clearly-labeled founder accounts (u/gb_founder_*) — seeded
 * data is labeled as such in the README; no fake-user smell.
 */
import { CELL_PX, GRID_ROWS } from '../constants';
import { makeRng, rngInt } from '../rng';
import type { BoardObjectWithCounters, Cell, ObjectType, Rot } from '../types';

export type DemoFixture = {
  version: number;
  label: string;
  trailSeed: number;
  gates: Cell[];
  terrain: Cell[];
  objects: BoardObjectWithCounters[];
  /** Pre-populated "yesterday" report so the morning modal demos instantly. */
  yesterdayReport: {
    objectName: string;
    objectType: ObjectType;
    kills: number;
    saves: number;
    menaceRank: number;
    angelRank: number | null;
    depthRank: number;
    boardKills: number;
    boardSaves: number;
    deadliestName: string;
    deadliestAuthor: string;
    deadliestKills: number;
    builders: number;
  };
};

export const FOUNDERS: readonly { username: string; userId: string }[] = [
  { username: 'gb_founder_greg', userId: 't2_gbf01' },
  { username: 'gb_founder_mira', userId: 't2_gbf02' },
  { username: 'gb_founder_tao', userId: 't2_gbf03' },
  { username: 'gb_founder_ivy', userId: 't2_gbf04' },
  { username: 'gb_founder_ash', userId: 't2_gbf05' },
  { username: 'gb_founder_noor', userId: 't2_gbf06' },
  { username: 'gb_founder_kai', userId: 't2_gbf07' },
  { username: 'gb_founder_rex', userId: 't2_gbf08' },
  { username: 'gb_founder_uma', userId: 't2_gbf09' },
  { username: 'gb_founder_finn', userId: 't2_gbf10' },
  { username: 'gb_founder_zed', userId: 't2_gbf11' },
  { username: 'gb_founder_lyra', userId: 't2_gbf12' },
];

/** [id, type, col, row, rot, founderIdx, name, kills, saves] */
type Row = [string, ObjectType, number, number, Rot, number, string, number, number];

// prettier-ignore
const ROWS: readonly Row[] = [
  // ─── Band 0 (rows 2-5): the friendly third — the judge survives long
  //     enough to invest.
  ['d01', 'booster', 1, 2, 0, 11, "Lyra's Light", 0, 118],
  ['d02', 'booster', 4, 2, 0, 8, 'Uma Lift One', 0, 44],
  ['d03', 'booster', 7, 2, 0, 8, 'Uma Lift Two', 0, 39],
  ['d04', 'booster', 3, 3, 0, 11, 'Second Wind', 0, 21],
  ['d05', 'coin', 0, 2, 0, 3, 'Penny Corner', 0, 12],
  ['d06', 'coin', 8, 2, 0, 3, "Ivy's Stash", 0, 18],
  ['d07', 'coin', 2, 4, 0, 3, 'Loose Change', 0, 9],
  ['d08', 'coin', 6, 4, 0, 3, "Fool's Gold", 0, 26],
  ['d09', 'cushion', 0, 3, 0, 1, 'Soft Landing', 0, 33],
  ['d10', 'cushion', 5, 3, 0, 1, 'Mira Minor', 0, 27],
  ['d11', 'cushion', 8, 3, 0, 1, 'Edge Pillow', 0, 14],
  ['d12', 'bumper', 2, 5, 0, 5, 'Noor Knocker', 0, 0],
  ['d13', 'bumper', 4, 5, 0, 5, 'Center Ping', 0, 0],
  ['d14', 'bumper', 6, 5, 0, 5, 'Ricochet Riz', 0, 0],
  // ─── Band 1 (rows 6-11): the character zone — named magnets and fans.
  ['d15', 'magnet', 1, 6, 1, 5, "Noor's Grip", 9, 0],
  ['d16', 'magnet', 7, 6, 3, 2, 'Tao Pull East', 6, 0],
  ['d17', 'magnet', 4, 7, 2, 2, "Tao's Undertow", 41, 0],
  ['d18', 'magnet', 0, 8, 1, 2, 'Wall Hugger', 4, 0],
  ['d19', 'fan', 2, 8, 0, 4, 'Crosswind', 8, 0],
  ['d20', 'fan', 8, 8, 2, 4, 'Gale Corner', 5, 0],
  ['d21', 'fan', 5, 9, 1, 4, 'Updraft Lie', 11, 0],
  ['d22', 'fan', 3, 10, 3, 4, 'Sidewinder', 7, 0],
  ['d23', 'bumper', 5, 6, 0, 9, 'Finn Flipper', 0, 0],
  ['d24', 'bumper', 1, 7, 0, 9, 'Wobble Stone', 0, 0],
  ['d25', 'bumper', 6, 9, 0, 9, 'Pachinko Pin', 0, 0],
  ['d26', 'bumper', 7, 10, 0, 9, 'Off Ramp', 0, 0],
  ['d27', 'coin', 3, 6, 0, 3, 'High Yield', 0, 31],
  ['d28', 'coin', 2, 9, 0, 3, 'Mid Money', 0, 22],
  ['d29', 'cushion', 8, 7, 0, 1, 'Right Rescue', 0, 41],
  ['d30', 'booster', 5, 10, 0, 8, "Uma's Updraft", 0, 31],
  // ─── Band 2 (rows 12-17): kill zone A. Greg's Regret sits on the natural
  //     first-drop line from the default center aim (col 4).
  ['d31', 'spike', 4, 13, 0, 0, "Greg's Regret", 312, 0],
  ['d32', 'spike', 1, 12, 0, 10, "Zed's Zapper", 5, 0],
  ['d33', 'spike', 6, 12, 0, 0, "Greg's Warmup", 29, 0],
  ['d34', 'spike', 0, 13, 0, 9, "Finn's Left Fang", 17, 0],
  ['d35', 'spike', 8, 13, 0, 9, "Finn's Right Fang", 21, 0],
  ['d36', 'spike', 3, 14, 0, 10, 'Zed Again', 13, 0],
  ['d37', 'spike', 5, 15, 0, 9, "Finn's Fin", 12, 0],
  ['d38', 'spike', 7, 16, 0, 0, "Regret's Echo", 44, 0],
  ['d39', 'crusher', 7, 12, 0, 6, 'Kai Crusher', 77, 0],
  ['d40', 'crusher', 1, 14, 0, 7, 'Rex Wrecker', 48, 0],
  ['d41', 'crusher', 6, 14, 0, 7, 'Rex Redux', 36, 0],
  ['d42', 'fan', 2, 13, 1, 4, 'Ash Vent', 23, 0],
  ['d43', 'fan', 0, 16, 1, 4, 'Ash Exhaust', 9, 0],
  ['d44', 'cushion', 2, 15, 0, 1, "Mira's Mercy", 0, 154],
  ['d45', 'coin', 4, 15, 0, 3, "Ivy's Bait", 0, 66],
  ['d46', 'bumper', 6, 15, 0, 5, 'Last Laugh', 0, 0],
  // ─── Band 3 (rows 18-21): kill zone B — the basement.
  ['d47', 'spike', 1, 18, 0, 0, "Greg's Basement", 61, 0],
  ['d48', 'spike', 5, 18, 0, 10, "Zed's Cellar", 19, 0],
  ['d49', 'spike', 8, 18, 0, 9, "Finn's Floor", 15, 0],
  ['d50', 'spike', 3, 19, 0, 0, 'Regret Row', 33, 0],
  ['d51', 'spike', 6, 19, 0, 10, "Zed's End", 27, 0],
  ['d52', 'spike', 0, 20, 0, 9, "Finn's Farewell", 22, 0],
  ['d53', 'spike', 7, 20, 0, 0, "Greg's Goodbye", 38, 0],
  ['d54', 'spike', 2, 21, 0, 10, "Zed's Last Word", 30, 0],
  ['d55', 'crusher', 3, 18, 0, 6, "Kai's Jaw", 52, 0],
  ['d56', 'crusher', 1, 20, 0, 6, "Kai's Vice", 40, 0],
  ['d57', 'crusher', 5, 21, 0, 7, 'Rex Rematch', 25, 0],
  ['d58', 'booster', 0, 19, 0, 8, 'False Hope', 0, 8],
  ['d59', 'coin', 8, 19, 0, 3, 'Deep Pocket', 0, 11],
  ['d60', 'bumper', 6, 21, 0, 5, 'Door Knocker', 0, 0],
];

const GATES: Cell[] = [
  { c: 3, r: 4 },
  { c: 5, r: 8 },
  { c: 2, r: 12 },
  { c: 6, r: 16 },
  { c: 4, r: 20 },
];

const TERRAIN: Cell[] = [
  { c: 1, r: 3 },
  { c: 7, r: 3 },
  { c: 0, r: 5 },
  { c: 8, r: 5 },
  { c: 2, r: 7 },
  { c: 6, r: 7 },
  { c: 4, r: 9 },
  { c: 1, r: 11 },
  { c: 7, r: 11 },
  { c: 0, r: 15 },
  { c: 8, r: 15 },
  { c: 3, r: 17 },
];

export function demoFixture(): DemoFixture {
  const objects: BoardObjectWithCounters[] = ROWS.map((row) => {
    const [id, type, c, r, rot, founderIdx, name, kills, saves] = row;
    const founder = FOUNDERS[founderIdx];
    // Unreachable: every founderIdx in the hardcoded ROWS table below is a
    // valid FOUNDERS index — a data-integrity guard, not a runtime path.
    /* v8 ignore next */
    if (founder === undefined) throw new Error(`bad founder index ${founderIdx}`);
    return {
      id,
      type,
      cell: { c, r },
      rot,
      author: founder.username,
      authorId: founder.userId,
      name,
      releaseHour: 0, // demo board is fully active — judges see peak cruelty
      kills,
      saves,
    };
  });
  return {
    version: 1,
    label: 'Grudgeball demo board — hand-placed founder set (seeded data, labeled)',
    trailSeed: 1337,
    gates: GATES.map((g) => ({ ...g })),
    terrain: TERRAIN.map((t) => ({ ...t })),
    objects,
    yesterdayReport: {
      objectName: 'First Grudge',
      objectType: 'spike',
      kills: 87,
      saves: 3,
      menaceRank: 3,
      angelRank: null,
      depthRank: 14,
      boardKills: 1240,
      boardSaves: 460,
      deadliestName: "Greg's Regret",
      deadliestAuthor: 'gb_founder_greg',
      deadliestKills: 312,
      builders: 214,
    },
  };
}

/**
 * 40 synthetic ghost-trail polylines (recorded-playtest stand-ins),
 * deterministic from the fixture's trailSeed. ~30% of dying trails end on
 * Greg's Regret so the crowd is visible even at 3am.
 */
export function demoTrails(trailSeed: number): number[][] {
  const rng = makeRng(trailSeed);
  const trails: number[][] = [];
  const gregX = (4 + 0.5) * CELL_PX;
  const gregY = 13 * CELL_PX + CELL_PX / 2;
  for (let i = 0; i < 40; i++) {
    const dies = rng() < 0.7;
    const towardGreg = dies && rng() < 0.42;
    const endRow = towardGreg ? 13 : dies ? 10 + rngInt(rng, 11) : GRID_ROWS - 1;
    const startCol = 2 + rngInt(rng, 5); // center-weighted spawns
    let x = (startCol + 0.5) * CELL_PX;
    const pts: number[] = [];
    for (let r = 0; r <= endRow; r += 2) {
      const targetX = towardGreg && r > 8 ? gregX : x + (rng() - 0.5) * 2 * CELL_PX;
      x = Math.max(8, Math.min(CELL_PX * 9 - 8, targetX));
      pts.push(Math.round(x), Math.round(r * CELL_PX + CELL_PX / 2));
    }
    if (towardGreg) {
      pts.push(Math.round(gregX), Math.round(gregY));
    }
    trails.push(pts);
  }
  return trails;
}
