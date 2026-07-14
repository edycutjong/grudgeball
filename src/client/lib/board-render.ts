/**
 * Canvas 2D board renderer. Logical coordinate space is BOARD_W×BOARD_H
 * (360×960); the element is CSS-scaled to fit the portrait webview. No
 * external assets — everything is drawn, so the bundle stays self-contained.
 */
import { BOARD_H, BOARD_W, CELL_PX, GRID_COLS, GRID_ROWS, PALETTE } from '../../shared/constants';
import { cellKey } from '../../shared/grid';
import { CATEGORY_OF } from '../../shared/types';
import type { BoardObjectWithCounters, Cell } from '../../shared/types';

const CATEGORY_COLOR: Record<'menace' | 'angel' | 'neutral', string> = {
  menace: PALETTE.red,
  angel: PALETTE.green,
  neutral: PALETTE.brass,
};

const GLYPH: Record<string, string> = {
  spike: '▲', // ▲
  crusher: '▬', // ▬
  magnet: 'U',
  fan: '≈', // ≈
  bumper: 'O',
  cushion: '⌣', // ⌣
  booster: '↑', // ↑
  coin: '$',
};

export type MarblePos = { x: number; y: number };

export type BoardScene = {
  objects: readonly BoardObjectWithCounters[];
  terrain: readonly Cell[];
  gates: readonly Cell[];
  trails: readonly number[][];
};

export type DrawOpts = {
  /** Highlight legal placement cells (PLACE state). */
  highlightCells?: ReadonlySet<string> | null;
  /** Aim column preview arc (DROP state). */
  aimCol?: number | null;
  /** Live marble position in logical px. */
  marble?: MarblePos | null;
  /** Dim the board (PLACE / modal states). */
  dim?: boolean;
  /** Cell currently selected for placement. */
  selected?: Cell | null;
};

export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, Math.max(1, Math.floor(globalThis.devicePixelRatio || 1)));
  canvas.width = BOARD_W * dpr;
  canvas.height = BOARD_H * dpr;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function cellCenter(cell: Cell): MarblePos {
  return { x: (cell.c + 0.5) * CELL_PX, y: (cell.r + 0.5) * CELL_PX };
}

export function pxToCol(clientX: number, rect: DOMRect): number {
  const rel = (clientX - rect.left) / Math.max(1, rect.width);
  return Math.max(0, Math.min(GRID_COLS - 1, Math.floor(rel * GRID_COLS)));
}

export function pxToCell(clientX: number, clientY: number, rect: DOMRect): Cell {
  const c = pxToCol(clientX, rect);
  const relY = (clientY - rect.top) / Math.max(1, rect.height);
  const r = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(relY * GRID_ROWS)));
  return { c, r };
}

export function drawBoard(ctx: CanvasRenderingContext2D, scene: BoardScene, opts: DrawOpts = {}): void {
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);

  // Backdrop + apron shading.
  ctx.fillStyle = PALETTE.base;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  ctx.fillStyle = 'rgba(139,135,160,0.06)';
  ctx.fillRect(0, 0, BOARD_W, 2 * CELL_PX); // spawn apron
  ctx.fillRect(0, (GRID_ROWS - 2) * CELL_PX, BOARD_W, 2 * CELL_PX); // goal apron

  // Faint grid.
  ctx.strokeStyle = 'rgba(139,135,160,0.08)';
  ctx.lineWidth = 1;
  for (let c = 1; c < GRID_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL_PX, 0);
    ctx.lineTo(c * CELL_PX, BOARD_H);
    ctx.stroke();
  }

  // Ghost trails (seeded overlays) — faint red threads of the dead.
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = 'rgba(239,68,68,0.12)';
  for (const trail of scene.trails) {
    if (trail.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo(trail[0] ?? 0, trail[1] ?? 0);
    for (let i = 2; i + 1 < trail.length; i += 2) ctx.lineTo(trail[i] ?? 0, trail[i + 1] ?? 0);
    ctx.stroke();
  }

  // Legal-zone highlight (PLACE state).
  if (opts.highlightCells != null) {
    ctx.fillStyle = 'rgba(52,211,153,0.10)';
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (opts.highlightCells.has(`${c},${r}`)) ctx.fillRect(c * CELL_PX + 2, r * CELL_PX + 2, CELL_PX - 4, CELL_PX - 4);
      }
    }
  }

  if (opts.dim === true) {
    ctx.fillStyle = 'rgba(7,6,11,0.45)';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  }

  // Terrain pegs.
  for (const t of scene.terrain) {
    const p = cellCenter(t);
    ctx.fillStyle = '#2A2536';
    roundRect(ctx, p.x - CELL_PX / 2 + 6, p.y - CELL_PX / 2 + 6, CELL_PX - 12, CELL_PX - 12, 4);
    ctx.fill();
  }

  // Gates — reserved-clear cells (I2 support).
  ctx.strokeStyle = 'rgba(52,211,153,0.35)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  for (const g of scene.gates) {
    ctx.strokeRect(g.c * CELL_PX + 5, g.r * CELL_PX + 5, CELL_PX - 10, CELL_PX - 10);
  }
  ctx.setLineDash([]);

  // Objects.
  for (const o of scene.objects) {
    const p = cellCenter(o.cell);
    const color = CATEGORY_COLOR[CATEGORY_OF[o.type]];
    ctx.fillStyle = withAlpha(color, 0.18);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    roundRect(ctx, p.x - CELL_PX / 2 + 4, p.y - CELL_PX / 2 + 4, CELL_PX - 8, CELL_PX - 8, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '16px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(GLYPH[o.type] ?? '?', p.x, p.y);
  }

  // Selected placement cell ring.
  if (opts.selected != null) {
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(opts.selected.c * CELL_PX + 3, opts.selected.r * CELL_PX + 3, CELL_PX - 6, CELL_PX - 6);
  }

  // Aim guide.
  if (opts.aimCol != null) {
    const x = (opts.aimCol + 0.5) * CELL_PX;
    ctx.strokeStyle = withAlpha(PALETTE.brass, 0.5);
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, CELL_PX * 0.5);
    ctx.lineTo(x, BOARD_H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Live marble.
  if (opts.marble != null) {
    ctx.fillStyle = PALETTE.text;
    ctx.beginPath();
    ctx.arc(opts.marble.x, opts.marble.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = withAlpha(PALETTE.text, 0.25);
    ctx.beginPath();
    ctx.arc(opts.marble.x, opts.marble.y, 13, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draw a compact, static snapshot for the inline splash card. */
export function drawSnapshot(ctx: CanvasRenderingContext2D, scene: BoardScene): void {
  drawBoard(ctx, scene, { dim: false });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) return hex;
  const n = parseInt(m[1] ?? '000000', 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

export const objectColorFor = (type: BoardObjectWithCounters['type']): string => CATEGORY_COLOR[CATEGORY_OF[type]];
export const glyphFor = (type: string): string => GLYPH[type] ?? '?';
export const cellId = cellKey;
