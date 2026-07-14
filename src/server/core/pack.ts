/**
 * Stable (byte-deterministic) packing of board objects and queued placements
 * into Redis hash fields. Field order inside the JSON is fixed by literal
 * construction — compile idempotency tests compare raw bytes.
 */
import { OBJECT_TYPES } from '../../shared/types';
import type {
  BoardObject,
  Cell,
  ObjectType,
  QueuedPlacement,
  Rot,
} from '../../shared/types';
import { inBounds } from '../../shared/grid';

export function packObject(o: BoardObject): string {
  return JSON.stringify({
    t: o.type,
    c: [o.cell.c, o.cell.r],
    r: o.rot,
    a: o.author,
    aid: o.authorId,
    n: o.name,
    h: o.releaseHour,
  });
}

export function unpackObject(id: string, raw: string): BoardObject | null {
  const parsed = safeParse(raw);
  if (parsed === null) return null;
  const type = asType(parsed['t']);
  const cell = asCell(parsed['c']);
  const rot = asRot(parsed['r']);
  const author = asString(parsed['a']);
  const authorId = asString(parsed['aid']);
  const name = asString(parsed['n']);
  const releaseHour = asHour(parsed['h']);
  if (
    type === null ||
    cell === null ||
    rot === null ||
    author === null ||
    authorId === null ||
    name === null ||
    releaseHour === null
  ) {
    return null;
  }
  return { id, type, cell, rot, author, authorId, name, releaseHour };
}

export function packQueued(p: QueuedPlacement): string {
  return JSON.stringify({
    t: p.type,
    c: [p.cell.c, p.cell.r],
    r: p.rot,
    a: p.author,
    aid: p.authorId,
    n: p.name,
    ts: p.ts,
  });
}

export function unpackQueued(id: string, raw: string): QueuedPlacement | null {
  const parsed = safeParse(raw);
  if (parsed === null) return null;
  const type = asType(parsed['t']);
  const cell = asCell(parsed['c']);
  const rot = asRot(parsed['r']);
  const author = asString(parsed['a']);
  const authorId = asString(parsed['aid']);
  const name = asString(parsed['n']);
  const ts = typeof parsed['ts'] === 'number' ? parsed['ts'] : null;
  if (
    type === null ||
    cell === null ||
    rot === null ||
    author === null ||
    authorId === null ||
    name === null ||
    ts === null
  ) {
    return null;
  }
  return { id, type, cell, rot, author, authorId, name, ts };
}

export function packCells(cells: readonly Cell[]): string {
  return JSON.stringify(cells.map((c) => [c.c, c.r]));
}

export function unpackCells(raw: string | undefined): Cell[] {
  if (raw === undefined) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: Cell[] = [];
    for (const item of arr) {
      const cell = asCell(item);
      if (cell !== null) out.push(cell);
    }
    return out;
  } catch {
    return [];
  }
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asType(v: unknown): ObjectType | null {
  return typeof v === 'string' && (OBJECT_TYPES as readonly string[]).includes(v)
    ? (v as ObjectType)
    : null;
}

function asCell(v: unknown): Cell | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const c = v[0];
  const r = v[1];
  if (typeof c !== 'number' || typeof r !== 'number') return null;
  const cell = { c, r };
  return inBounds(cell) ? cell : null;
}

function asRot(v: unknown): Rot | null {
  return v === 0 || v === 1 || v === 2 || v === 3 ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asHour(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null;
}
