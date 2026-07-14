/**
 * Typed same-origin fetch wrappers over the server's /api/* routes. The Devvit
 * webview is served from the app origin, so relative URLs reach the Hono
 * server in src/server. Empty external-fetch allowlist: these are all local.
 *
 * Each call tries the real server first and only falls back to the offline
 * `demo` module when the fetch or JSON parse genuinely FAILS — i.e. there is no
 * Devvit host answering (built client opened directly, static preview, screen
 * recording). A live server always returns JSON, so the fallback never masks a
 * real server response (even an `{status:'error'}` one is honoured). This is
 * what makes the full loop witnessable on load with the seeded demo board.
 */
import type {
  BoardResponse,
  DropResultResponse,
  LeaderboardsResponse,
  PlaceRequest,
  PlaceResponse,
  ReportResponse,
} from '../../shared/protocol';
import type { LeaderboardTab, RunResult } from '../../shared/types';
import { demo } from './demo';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  return (await res.json()) as T; // throws on network failure or non-JSON body
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/** Try the live server; serve the deterministic demo board only if it is absent. */
async function withDemo<T>(live: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await live();
  } catch {
    return fallback();
  }
}

export const api = {
  board: (day?: string): Promise<BoardResponse> =>
    withDemo(
      () => getJson<BoardResponse>(day !== undefined ? `/api/board?day=${encodeURIComponent(day)}` : '/api/board'),
      () => demo.board(day)
    ),
  drop: (run: RunResult): Promise<DropResultResponse> =>
    withDemo(() => postJson<DropResultResponse>('/api/drop-result', run), () => demo.drop(run)),
  place: (req: PlaceRequest): Promise<PlaceResponse> =>
    withDemo(() => postJson<PlaceResponse>('/api/place', req), () => demo.place(req)),
  report: (): Promise<ReportResponse> => withDemo(() => getJson<ReportResponse>('/api/report'), () => demo.report()),
  leaderboards: (tab: LeaderboardTab): Promise<LeaderboardsResponse> =>
    withDemo(() => getJson<LeaderboardsResponse>(`/api/leaderboards?tab=${tab}`), () => demo.leaderboards(tab)),
};
