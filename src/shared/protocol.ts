/**
 * HTTP wire types shared by client and server.
 */
import type {
  BoardView,
  Cell,
  GrudgeReport,
  LeaderboardView,
  ObjectType,
  Rot,
  RunResult,
} from './types';

export type ApiError = { status: 'error'; message: string };

export type BoardResponse = { status: 'ok'; board: BoardView };

export type DropResultRequest = RunResult;

export type DropResultResponse =
  | {
      status: 'ok';
      score: number;
      best: number;
      cruelty: number;
      marblesLeft: number;
      canPlace: boolean;
    }
  | { status: 'anonymous' }
  | { status: 'closed' }
  | { status: 'duplicate' }
  | { status: 'out-of-marbles' };

export type PlaceRequest = {
  type: ObjectType;
  cell: Cell;
  rot: Rot;
  name: string;
};

export type PlaceRejectCode =
  | 'ANONYMOUS'
  | 'ALREADY_PLACED'
  | 'MARBLES_REMAIN'
  | 'BAD_TYPE'
  | 'BAD_NAME'
  | 'ILLEGAL_CELL'
  | 'CELL_TAKEN'
  | 'BAND_FULL'
  | 'BOARD_FULL'
  | 'UNSOLVABLE'
  | 'CONTESTED';

export type PlaceResponse =
  | { status: 'ok'; placementId: string; day: string; releasePreviewHour: number }
  | { status: 'rejected'; code: PlaceRejectCode; message: string };

export type ReportResponse =
  | { status: 'ok'; report: GrudgeReport; unseen: boolean }
  | { status: 'none' };

export type LeaderboardsResponse = { status: 'ok'; view: LeaderboardView };
