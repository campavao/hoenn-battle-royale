// What stands past the edge of a map (POK-431): tools/br/export-fill.py's cells over the holes
// in Hoenn, so the world goes on, and the sea past it. Cam, 11-02: "fill this in ... kind of
// like matching the seams", "these large swaths ... we can just keep this blue". It is the same
// wherever the camera came from: the old filler was the border block of the map under the
// camera, and changed as you crossed a seam.
//
// This is the numbers. The page cuts the pictures from the player's ROM (romart.ts), a chunk at
// a time and only where somebody looks: a chunk of open sea, or all one forest, is never cut at
// all (main.ts drawFill lays those as a pattern).

/** Cells a side of a chunk. Small, so cutting one is a few milliseconds of a frame. */
export const CHUNK = 16;
/** The sea's metatile (General's), whichever map's tilesets draw it. */
export const SEA_METATILE = 0x170;

interface PlaneMap { id: string; w: number; h: number; outdoor?: boolean; seams: { to: string; dir: string; offset: number }[] }

/** BFS over the seams from Littleroot: a neighbour's origin is this map's, shifted by the
 *  connection's offset along the shared edge (World.landAcross is the same sum backwards). The
 *  maps joined up by their seams are Hoenn's plane, which this file carries on past the edges. */
export function mainlandPlane<M extends PlaneMap>(maps: readonly M[], loose: (a: string, b: string) => boolean): Map<string, { m: M; gx: number; gy: number }> {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const start = byId.get('MAP_LITTLEROOT_TOWN')!;
  const placed = new Map([[start.id, { m: start, gx: 0, gy: 0 }]]);
  const queue = [start.id];
  while (queue.length) {
    const p = placed.get(queue.shift()!)!;
    for (const s of p.m.seams) {
      const to = byId.get(s.to);
      if (!to || !to.outdoor || placed.has(to.id) || loose(p.m.id, to.id)) continue;
      let gx = p.gx;
      let gy = p.gy;
      if (s.dir === 'north') { gx += s.offset; gy -= to.h; }
      else if (s.dir === 'south') { gx += s.offset; gy += p.m.h; }
      else if (s.dir === 'west') { gx -= to.w; gy += s.offset; }
      else { gx += p.m.w; gy += s.offset; }
      placed.set(to.id, { m: to, gx, gy });
      queue.push(to.id);
    }
  }
  return placed;
}

/** One symbol of the file: its metatiles by world x & 1, y & 1, and the map whose tilesets
 *  draw them (null: General's, the same on any). */
export interface FillBlock { ref: string | null; ids: [number, number, number, number] }

export interface FillFile { x0: number; y0: number; w: number; h: number; blocks: unknown[][]; rows: string }

export type FillChunk =
  | { kind: 'sea' }
  | { kind: 'block'; block: number }
  | { kind: 'cells' };

export class WorldFill {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly blocks: (FillBlock | null)[];
  private cells: Uint16Array;
  private chunks = new Map<number, FillChunk>();

  constructor(file: FillFile) {
    this.x0 = file.x0;
    this.y0 = file.y0;
    this.w = file.w;
    this.h = file.h;
    this.blocks = file.blocks.map((b) => (b.length ? { ref: b[0] as string | null, ids: b.slice(1, 5) as FillBlock['ids'] } : null));
    this.cells = new Uint16Array(file.w * file.h);
    let i = 0;
    for (const run of file.rows.split(';')) {
      const [n, v] = run.split('x').map(Number);
      this.cells.fill(v, i, i + n);
      i += n;
    }
  }

  /** The symbol at a world cell: 0, the sea, anywhere off the file. */
  at(x: number, y: number): number {
    const cx = x - this.x0, cy = y - this.y0;
    return cx < 0 || cy < 0 || cx >= this.w || cy >= this.h ? 0 : this.cells[cy * this.w + cx];
  }

  /** The metatile at a world cell, or null for the open sea. */
  metatile(x: number, y: number): { ref: string | null; id: number } | null {
    const b = this.blocks[this.at(x, y)];
    return b ? { ref: b.ref, id: b.ids[((y & 1) << 1) | (x & 1)] } : null;
  }

  /** Chunk (cx, cy), which covers world cells cx * CHUNK.. (negative ones too). */
  chunk(cx: number, cy: number): FillChunk {
    const key = (cy + 4096) * 8192 + cx + 4096;
    let c = this.chunks.get(key);
    if (c) return c;
    const first = this.at(cx * CHUNK, cy * CHUNK);
    let same = true;
    for (let y = 0; y < CHUNK && same; y++) for (let x = 0; x < CHUNK && same; x++) same = this.at(cx * CHUNK + x, cy * CHUNK + y) === first;
    c = !same ? { kind: 'cells' } : first === 0 ? { kind: 'sea' } : { kind: 'block', block: first };
    this.chunks.set(key, c);
    return c;
  }
}

/** The chunks a world rectangle (in pixels) touches, `pad` more on every side. */
export function chunksOver(x0: number, y0: number, x1: number, y1: number, pad = 0): { cx0: number; cy0: number; cx1: number; cy1: number } {
  const size = CHUNK * 16;
  return {
    cx0: Math.floor(x0 / size) - pad,
    cy0: Math.floor(y0 / size) - pad,
    cx1: Math.floor(x1 / size) + pad,
    cy1: Math.floor(y1 / size) + pad,
  };
}

/** The canvases cut so far, oldest dropped first: every chunk a window can see at the farthest
 *  zoom (zoom.ts roomFloor: 96 x 96 tiles, 49 chunks) and the walk's worth round it, about
 *  32 MB at most. */
export class ChunkCache<T> {
  private m = new Map<number, T>();
  constructor(private limit = 128) {}
  get size(): number { return this.m.size; }
  get(key: number): T | undefined {
    const v = this.m.get(key);
    if (v !== undefined) { this.m.delete(key); this.m.set(key, v); }
    return v;
  }
  set(key: number, v: T): void {
    this.m.set(key, v);
    if (this.m.size > this.limit) this.m.delete(this.m.keys().next().value as number);
  }
  clear(): void { this.m.clear(); }
}
