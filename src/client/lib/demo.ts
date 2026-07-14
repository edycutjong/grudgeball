/**
 * Offline demo fallback — makes the FULL loop witnessable on load with zero
 * server.
 *
 * Every method here returns the exact same wire types as `src/server/routes/api.ts`
 * and is computed with the SAME pure shared core the server uses
 * (`demoFixture`, `cruelty`, `scoreRun`, day math) — it invents no game logic.
 * It only activates when a real `/api/*` fetch fails (no Devvit host, e.g. the
 * built client opened directly, or a static-hosted preview / screen recording).
 * In the live Reddit webview the server answers with JSON first, so this code
 * is inert. See README "Offline demo mode".
 *
 * Faithfulness notes:
 * - `board()` returns fresh deep copies each call (HTTP semantics): mutating the
 *   persistent board below never aliases a snapshot the game/sim already holds.
 * - `drop()` mirrors `submitDropResult`: cruelty × score, marble decrement,
 *   builder kill/save credit applied to the persistent board.
 */
import { MARBLES_PER_DAY, TRAP_CAP } from '../../shared/constants';
import { cruelty } from '../../shared/cruelty';
import { dayNumber, dayOf, tomorrow, yesterday } from '../../shared/day';
import { demoFixture, demoTrails } from '../../shared/fixtures/demoBoard';
import { scoreRun } from '../../shared/score';
import { CATEGORY_OF } from '../../shared/types';
import type {
  BoardObjectWithCounters,
  BoardView,
  GrudgeReport,
  LeaderboardRow,
  LeaderboardTab,
  RunResult,
} from '../../shared/types';
import type {
  BoardResponse,
  DropResultResponse,
  LeaderboardsResponse,
  PlaceRequest,
  PlaceResponse,
  ReportResponse,
} from '../../shared/protocol';

const fixture = demoFixture();
const DAY = dayOf(Date.now());

// The persistent demo board. Kill/save credit accrues here across drops.
const board: BoardObjectWithCounters[] = fixture.objects.map((o) => ({ ...o, cell: { ...o.cell } }));

const player = { marblesUsed: 0, placed: false, reportSeen: false };

/** True once any real fetch has failed and we have served an offline response. */
let active = false;
export function isDemoActive(): boolean {
  return active;
}
function markActive(): void {
  active = true;
}

function activeTraps(): number {
  return board.filter((o) => CATEGORY_OF[o.type] === 'menace').length;
}

function copyObjects(objs: readonly BoardObjectWithCounters[]): BoardObjectWithCounters[] {
  return objs.map((o) => ({ ...o, cell: { ...o.cell } }));
}

function buildView(day: string, mode: 'live' | 'preview'): BoardView {
  const traps = mode === 'live' ? activeTraps() : 0;
  return {
    day,
    dayNumber: dayNumber(day),
    mode,
    objects: mode === 'live' ? copyObjects(board) : [],
    terrain: fixture.terrain.map((c) => ({ ...c })),
    gates: fixture.gates.map((c) => ({ ...c })),
    trails: mode === 'live' ? demoTrails(fixture.trailSeed) : [],
    activeHour: 23,
    activeTrapCount: traps,
    trapCap: TRAP_CAP,
    cruelty: cruelty(traps),
    me: {
      userId: 't2_demo',
      username: 'you',
      marblesUsed: player.marblesUsed,
      placed: player.placed,
      hasUnseenReport: !player.reportSeen,
    },
  };
}

export const demo = {
  board(day?: string): BoardResponse {
    markActive();
    // No arg → today's live demo board. A day arg is the placement preview
    // (tomorrow), rendered as an empty queue over deterministic terrain.
    return { status: 'ok', board: buildView(day ?? DAY, day === undefined ? 'live' : 'preview') };
  },

  drop(run: RunResult): DropResultResponse {
    markActive();
    if (player.marblesUsed >= MARBLES_PER_DAY) return { status: 'out-of-marbles' };
    const mult = cruelty(activeTraps());
    const score = scoreRun(run.depth, run.coins, run.reachedGoal, mult);
    // Credit builders exactly as the server does (kills/saves on the object).
    for (const ev of run.events) {
      const obj = board.find((o) => o.id === ev.objId);
      if (obj === undefined) continue;
      if (ev.kind === 'kill') obj.kills += 1;
      else if (ev.kind === 'save') obj.saves += 1;
    }
    player.marblesUsed += 1;
    return {
      status: 'ok',
      score,
      best: score,
      cruelty: mult,
      marblesLeft: Math.max(0, MARBLES_PER_DAY - player.marblesUsed),
      canPlace: player.marblesUsed >= MARBLES_PER_DAY,
    };
  },

  place(_req: PlaceRequest): PlaceResponse {
    markActive();
    if (player.placed) {
      return { status: 'rejected', code: 'ALREADY_PLACED', message: 'Your grudge is already planted. It returns at dawn.' };
    }
    player.placed = true;
    return { status: 'ok', placementId: `p_demo_${Date.now()}`, day: tomorrow(DAY), releasePreviewHour: 20 };
  },

  report(): ReportResponse {
    markActive();
    const yr = fixture.yesterdayReport;
    const yday = yesterday(DAY);
    const report: GrudgeReport = {
      day: yday,
      dayNumber: dayNumber(yday),
      objectName: yr.objectName,
      objectType: yr.objectType,
      kills: yr.kills,
      saves: yr.saves,
      menaceRank: yr.menaceRank,
      angelRank: yr.angelRank,
      depthRank: yr.depthRank,
      boardKills: yr.boardKills,
      boardSaves: yr.boardSaves,
      deadliestName: yr.deadliestName,
      deadliestAuthor: yr.deadliestAuthor,
      deadliestKills: yr.deadliestKills,
      builders: yr.builders,
    };
    const unseen = !player.reportSeen;
    player.reportSeen = true;
    return { status: 'ok', report, unseen };
  },

  leaderboards(tab: LeaderboardTab): LeaderboardsResponse {
    markActive();
    // Aggregate the founder board by author; map each tab to a plausible score.
    const agg = new Map<string, { kills: number; saves: number }>();
    for (const o of board) {
      const a = agg.get(o.author) ?? { kills: 0, saves: 0 };
      a.kills += o.kills;
      a.saves += o.saves;
      agg.set(o.author, a);
    }
    const scoreFor = (a: { kills: number; saves: number }, i: number): number => {
      if (tab === 'menace') return a.kills;
      if (tab === 'angel') return a.saves;
      if (tab === 'streak') return Math.min(9, 1 + ((a.kills + i) % 9));
      return a.kills * 100 + a.saves * 25; // 'depth' proxy on the real weights
    };
    const rows: LeaderboardRow[] = [...agg.entries()]
      .map(([member, a], i) => ({ member, score: scoreFor(a, i) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 10)
      .map((r, i) => ({ member: r.member, score: r.score, rank: i + 1 }));
    return { status: 'ok', view: { tab, day: DAY, top: rows, me: null, neighbors: [] } };
  },
};
