// The map painter's numbers (map-page.ts, /map/; Cam, 11-05: "use a tile editor or something on
// mobile to clean up the map", "in such a way that I can do it on my computer too"). What is
// painted is metatiles over the land between the maps: a real map is locked, since it is what
// people walk on. It lives on this device until a link or a file hands it over, for
// tools/br/apply-map-paint.py to lay over export-fill.py's cells.
import { SEA_METATILE, type WorldFill } from './worldfill';

/** A metatile, and the map whose tilesets draw it: null for General's, the same on any map. */
export interface Cell { ref: string | null; id: number }

/** A map on Hoenn's plane. */
export interface PlaneSpot { id: string; gx: number; gy: number; w: number; h: number }

/** What a brush lays: a block of cells, from where it was picked up. A null cell takes the paint
 *  off. `sx`, `sy` say where it came from: a tree's two rows and columns have a phase, and a
 *  stamp laid out of phase with the trees beside it is a tree cut in half. */
export interface Stamp { w: number; h: number; cells: (Cell | null)[]; sx: number; sy: number }

export const ERASER: Stamp = { w: 1, h: 1, cells: [null], sx: 0, sy: 0 };
/** The largest block a pick takes: more than a cliff's face, less than a phone's memory. */
export const STAMP_MAX = 32;

const SEA: Cell = { ref: null, id: SEA_METATILE };
/** Past the world's edge in any direction, so a key stays positive. */
const PAD = 4096;
const STRIDE = 8192;

export const keyOf = (x: number, y: number): number => (y + PAD) * STRIDE + x + PAD;
export const xOf = (k: number): number => k % STRIDE - PAD;
export const yOf = (k: number): number => Math.floor(k / STRIDE) - PAD;
export const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined): boolean => !!a && !!b && a.ref === b.ref && a.id === b.id;

/** A cell's ref as it is stored: a primary metatile looks the same on any map (General has no
 *  secondary palette in it, tools/br/export-fill.py keeps the same rule). */
export const cellOf = (mapId: string, block: number): Cell => {
  const id = block & 0x3ff;
  return { ref: id >= 512 ? mapId : null, id };
};

/** Hoenn as the painter sees it: the file's cells, the real maps over them, the paint over those. */
export class PaintWorld {
  private owners: Int16Array;
  readonly maps: PlaneSpot[];

  constructor(readonly fill: WorldFill, maps: PlaneSpot[], private blockAt: (map: PlaneSpot, x: number, y: number) => number) {
    this.maps = maps;
    this.owners = new Int16Array(fill.w * fill.h).fill(-1);
    maps.forEach((m, n) => {
      for (let y = m.gy; y < m.gy + m.h; y++) {
        for (let x = m.gx; x < m.gx + m.w; x++) {
          const i = this.index(x, y);
          if (i >= 0 && this.owners[i] < 0) this.owners[i] = n;
        }
      }
    });
  }

  private index(x: number, y: number): number {
    const cx = x - this.fill.x0, cy = y - this.fill.y0;
    return cx < 0 || cy < 0 || cx >= this.fill.w || cy >= this.fill.h ? -1 : cy * this.fill.w + cx;
  }

  /** The real map at a world cell, or null. */
  mapAt(x: number, y: number): PlaneSpot | null {
    const i = this.index(x, y);
    return i < 0 || this.owners[i] < 0 ? null : this.maps[this.owners[i]];
  }

  /** On a real map, or off the end of the file. */
  locked(x: number, y: number): boolean {
    const i = this.index(x, y);
    return i < 0 || this.owners[i] >= 0;
  }

  /** What is there with no paint on it. */
  base(x: number, y: number): Cell {
    const m = this.mapAt(x, y);
    if (m) return cellOf(m.id, this.blockAt(m, x - m.gx, y - m.gy));
    return this.fill.metatile(x, y) ?? SEA;
  }

  shown(x: number, y: number, paint: ReadonlyMap<number, Cell>): Cell {
    return paint.get(keyOf(x, y)) ?? this.base(x, y);
  }
}

/** What a pick takes up: the cells of a rectangle, whichever way it was dragged. */
export function pickStamp(world: PaintWorld, paint: ReadonlyMap<number, Cell>, ax: number, ay: number, bx: number, by: number): Stamp {
  const x0 = Math.min(ax, bx), y0 = Math.min(ay, by);
  const w = Math.min(STAMP_MAX, Math.abs(ax - bx) + 1), h = Math.min(STAMP_MAX, Math.abs(ay - by) + 1);
  const cells: Cell[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(world.shown(x0 + x, y0 + y, paint));
  return { w, h, cells, sx: x0, sy: y0 };
}

/** Where a stamp's corner goes for a press at (x, y): the stamp round the finger, in phase with
 *  where it came from when `snap` says so. A single row or column has no phase to keep. */
export function placeAt(s: Stamp, x: number, y: number, snap: boolean): { x: number; y: number } {
  const ax = x - (s.w >> 1), ay = y - (s.h >> 1);
  if (!snap) return { x: ax, y: ay };
  return { x: s.w > 1 ? ax + ((ax - s.sx) & 1) : ax, y: s.h > 1 ? ay + ((ay - s.sy) & 1) : ay };
}

/** The whole stamps a stroke has reached by a cell, on the lattice of its first one. */
export function latticeAt(s: Stamp, first: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
  return { x: first.x + Math.floor((x - first.x) / s.w) * s.w, y: first.y + Math.floor((y - first.y) / s.h) * s.h };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The stamp's cell for world cell (x, y), laid repeatedly from (ax, ay). */
export function stampCell(s: Stamp, ax: number, ay: number, x: number, y: number): Cell | null {
  return s.cells[mod(y - ay, s.h) * s.w + mod(x - ax, s.w)];
}

/** One undoable step: each key touched, and what was there before it. */
export type Edit = Map<number, Cell | undefined>;

/** Sets a cell of the paint, noting what it was. A locked cell stays out of it, and a cell
 *  painted back to what the file has is no paint at all. True if anything changed. */
export function setCell(world: PaintWorld, paint: Map<number, Cell>, edit: Edit, x: number, y: number, c: Cell | null): boolean {
  if (world.locked(x, y)) return false;
  const k = keyOf(x, y), had = paint.get(k);
  const next = c && !sameCell(c, world.base(x, y)) ? c : undefined;
  if (next === had || (next && sameCell(next, had))) return false;
  if (!edit.has(k)) edit.set(k, had);
  if (next) paint.set(k, next);
  else paint.delete(k);
  return true;
}

/** Puts an edit's "before" back, and returns the edit that would undo that. */
export function revert(paint: Map<number, Cell>, edit: Edit): Edit {
  const back: Edit = new Map();
  for (const [k, had] of edit) {
    back.set(k, paint.get(k));
    if (had) paint.set(k, had);
    else paint.delete(k);
  }
  return back;
}

/** Undo and redo: what a slip costs on a phone. */
export class History {
  private undos: Edit[] = [];
  private redos: Edit[] = [];
  constructor(private limit = 200) {}
  get canUndo(): boolean { return this.undos.length > 0; }
  get canRedo(): boolean { return this.redos.length > 0; }
  push(edit: Edit): void {
    if (!edit.size) return;
    this.undos.push(edit);
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }
  undo(paint: Map<number, Cell>): Edit | null {
    const e = this.undos.pop();
    if (!e) return null;
    this.redos.push(revert(paint, e));
    return e;
  }
  redo(paint: Map<number, Cell>): Edit | null {
    const e = this.redos.pop();
    if (!e) return null;
    this.undos.push(revert(paint, e));
    return e;
  }
}

/** The file: what tools/br/map-paint.json holds, and what a link carries. `r` is an index into
 *  `refs`, -1 for General's. */
export interface PaintFile { v: 1; refs: string[]; cells: [x: number, y: number, r: number, id: number][] }

export function toFile(paint: ReadonlyMap<number, Cell>): PaintFile {
  const refs = [...new Set([...paint.values()].flatMap((c) => (c.ref ? [c.ref] : [])))].sort();
  const cells = [...paint].sort((a, b) => a[0] - b[0]).map(([k, c]) => [xOf(k), yOf(k), c.ref ? refs.indexOf(c.ref) : -1, c.id] as PaintFile['cells'][number]);
  return { v: 1, refs, cells };
}

/** A file's cells, or null if it isn't one. */
export function fromFile(raw: unknown): Map<number, Cell> | null {
  const f = raw as Partial<PaintFile> | null;
  if (!f || f.v !== 1 || !Array.isArray(f.refs) || !Array.isArray(f.cells)) return null;
  const out = new Map<number, Cell>();
  for (const row of f.cells) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(Number.isInteger)) return null;
    const [x, y, r, id] = row;
    if (r !== -1 && typeof f.refs[r] !== 'string') return null;
    if (id < 0 || id >= 1024) return null;
    out.set(keyOf(x, y), { ref: r < 0 ? null : f.refs[r], id });
  }
  return out;
}

const toB64 = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function through(bytes: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes).then(() => w.close()).catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** The paint as a link's hash, deflated (`p=`) where the browser can, else as it is (`j=`). The
 *  hash never goes to a server. */
export async function toHash(file: PaintFile): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(file));
  if (typeof CompressionStream === 'undefined') return `j=${toB64(json)}`;
  return `p=${toB64(await through(json, new CompressionStream('deflate-raw') as never))}`;
}

/** A hash's paint, or null if it carries none (or a broken one). */
export async function fromHash(hash: string): Promise<Map<number, Cell> | null> {
  const m = /^#?([pj])=([\w-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const raw = fromB64(m[2]);
    const json = m[1] === 'j' ? raw : await through(raw, new DecompressionStream('deflate-raw') as never);
    return fromFile(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}
