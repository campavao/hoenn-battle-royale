import { describe, expect, it } from 'vitest';
import fillFile from './data/world-fill.json';
import paintFile from '../../tools/br/map-paint.json';
import world from './data/world.json';
import type { WorldMap } from '../src/bots/world';
import { layout } from './shared/room';
import { CHUNK, ChunkCache, WorldFill, chunksOver, type FillFile } from './worldfill';

const small: FillFile = { x0: -2, y0: -2, w: 4, h: 2, blocks: [[], [null, 1, 2, 3, 4]], rows: '5x0;3x1' };

describe('WorldFill', () => {
  it('reads its cells by world position, and the sea off the file', () => {
    const f = new WorldFill(small);
    expect(f.at(-2, -2)).toBe(0);
    expect(f.at(-1, -1)).toBe(1);
    expect(f.at(100, 100)).toBe(0);
    expect(f.metatile(-2, -2)).toBeNull();
    // x & 1, y & 1 of the world's cell, negative ones too.
    expect(f.metatile(-1, -1)).toEqual({ ref: null, id: 4 });
    expect(f.metatile(0, -1)).toEqual({ ref: null, id: 3 });
  });

  it('calls a chunk of one thing by that thing, and never cuts it', () => {
    const rows = `${CHUNK * CHUNK}x1;${CHUNK * CHUNK}x0`;
    const f = new WorldFill({ x0: 0, y0: 0, w: CHUNK, h: CHUNK * 2, blocks: small.blocks, rows });
    expect(f.chunk(0, 0)).toEqual({ kind: 'block', block: 1 });
    expect(f.chunk(0, 1)).toEqual({ kind: 'sea' });
    expect(f.chunk(50, 50)).toEqual({ kind: 'sea' });
    const mixed = new WorldFill({ x0: 0, y0: 0, w: CHUNK, h: CHUNK, blocks: small.blocks, rows: `1x1;${CHUNK * CHUNK - 1}x0` });
    expect(mixed.chunk(0, 0)).toEqual({ kind: 'cells' });
  });

  it('finds the chunks over a rectangle, either side of the origin', () => {
    expect(chunksOver(-1, 0, 256, 255)).toEqual({ cx0: -1, cy0: 0, cx1: 1, cy1: 0 });
    expect(chunksOver(0, 0, 10, 10, 1)).toEqual({ cx0: -1, cy0: -1, cx1: 1, cy1: 1 });
  });
});

describe('ChunkCache', () => {
  it('drops what has gone longest unseen', () => {
    const c = new ChunkCache<string>(2);
    c.set(1, 'a');
    c.set(2, 'b');
    c.get(1);
    c.set(3, 'c');
    expect(c.get(2)).toBeUndefined();
    expect(c.get(1)).toBe('a');
    expect(c.size).toBe(2);
  });
});

describe('the file export-fill.py wrote', () => {
  const f = new WorldFill(fillFile as unknown as FillFile);
  type M = { id: string; w: number; h: number; outdoor: boolean; seams: { dir: string; to: string; offset: number }[] };
  const maps = (world as unknown as { maps: M[] }).maps;
  const byId = new Map(maps.map((m) => [m.id, m]));
  const at = new Map<string, [number, number]>([['MAP_LITTLEROOT_TOWN', [0, 0]]]);
  for (const id of at.keys()) {
    const m = byId.get(id)!, [gx, gy] = at.get(id)!;
    for (const s of m.seams) {
      const t = byId.get(s.to);
      if (!t?.outdoor || at.has(t.id)) continue;
      at.set(t.id, s.dir === 'north' ? [gx + s.offset, gy - t.h] : s.dir === 'south' ? [gx + s.offset, gy + m.h] : s.dir === 'west' ? [gx - t.w, gy + s.offset] : [gx + m.w, gy + s.offset]);
    }
  }

  it('covers all of the outdoor plane, with the sea past it on every side', () => {
    for (const [id, [gx, gy]] of at) {
      const m = byId.get(id)!;
      expect(gx, id).toBeGreaterThan(f.x0);
      expect(gy, id).toBeGreaterThan(f.y0);
      expect(gx + m.w, id).toBeLessThan(f.x0 + f.w);
      expect(gy + m.h, id).toBeLessThan(f.y0 + f.h);
    }
    for (let x = f.x0; x < f.x0 + f.w; x++) { expect(f.at(x, f.y0)).toBe(0); expect(f.at(x, f.y0 + f.h - 1)).toBe(0); }
    for (let y = f.y0; y < f.y0 + f.h; y++) { expect(f.at(f.x0, y)).toBe(0); expect(f.at(f.x0 + f.w - 1, y)).toBe(0); }
  });

  it('is land round the mainland and sea in the big swaths (Cam: "keep this blue")', () => {
    // The hole between MAUVILLE and PETALBURG is shut in by land.
    const hole = (id: string, dx: number, dy: number) => { const [x, y] = at.get(id)!; return f.at(x + dx, y + dy); };
    expect(hole('MAP_ROUTE117', 30, 40), 'south of Route 117').not.toBe(0);
    // Far south of Slateport and Route 134's sea: open water.
    expect(hole('MAP_ROUTE108', 30, 80), 'the sea south of Route 108').toBe(0);
    expect(hole('MAP_ROUTE134', 40, 80), 'the sea south of Route 134').toBe(0);
  });

  it('cuts most of the plane to nothing: a pattern or the sea, not a canvas', () => {
    let cut = 0, total = 0;
    for (let cy = Math.floor(f.y0 / CHUNK); cy * CHUNK < f.y0 + f.h; cy++) {
      for (let cx = Math.floor(f.x0 / CHUNK); cx * CHUNK < f.x0 + f.w; cx++) {
        total += 1;
        if (f.chunk(cx, cy).kind === 'cells') cut += 1;
      }
    }
    expect(cut / total).toBeLessThan(0.5);
  });
});

// Cam's Map Board, 11-04: "we should never have a hard cut".
describe('the fill and the real maps meet', () => {
  const maps = (world as unknown as { maps: WorldMap[] }).maps;
  const fill = new WorldFill(fillFile as unknown as FillFile);
  const placed = [...layout(maps).values()];
  const at = (id: string, x: number, y: number) => { const p = placed.find((q) => q.m.id === id)!; return { x: p.gx + x, y: p.gy + y }; };

  // Cam's own cells off /map/ (export-fill.py's last step): what Cam painted stands, whatever the
  // generator would have picked there.
  const painted = new Set((paintFile.cells as number[][]).map(([x, y]) => `${x},${y}`));

  it('never half of a round tree', () => {
    // General's round tree: a two by two of these, as [dx to its other side, dy to its other half].
    const halves = new Map<number, [number, number]>([[0x1d4, [1, 1]], [0x1d6, [1, 1]], [0x1d5, [-1, 1]], [0x1d7, [-1, 1]], [0x1dc, [1, -1]], [0x1e4, [1, -1]], [0x1dd, [-1, -1]], [0x1e5, [-1, -1]]]);
    const owned = new Set<string>();
    for (const p of placed) for (let y = 0; y < p.m.h; y++) for (let x = 0; x < p.m.w; x++) owned.add(`${p.gx + x},${p.gy + y}`);
    const piece = (x: number, y: number) => fill.metatile(x, y)?.id;
    const bad: string[] = [];
    let trees = 0;
    for (let y = fill.y0 + 1; y < fill.y0 + fill.h - 1; y++) {
      for (let x = fill.x0 + 1; x < fill.x0 + fill.w - 1; x++) {
        if (owned.has(`${x},${y}`) || painted.has(`${x},${y}`)) continue;
        const h = halves.get(piece(x, y) ?? -1);
        if (!h) continue;
        trees += 1;
        // A real map's cell has no piece here: it is that map's to finish the tree.
        for (const [u, v] of [[x + h[0], y], [x, y + h[1]]]) if (!owned.has(`${u},${v}`) && !halves.has(piece(u, v) ?? -1)) bad.push(`${x},${y}`);
      }
    }
    expect(trees).toBeGreaterThan(1000);
    expect(bad).toEqual([]);
  });

  it('is one range behind ROUTE 114, ROUTE 113 and FALLARBOR, in their rock, not trees', () => {
    const route114 = (x: number, y: number) => fill.metatile(x, y)?.ref;
    for (const [id, x, y] of [['MAP_FALLARBOR_TOWN', 10, -5], ['MAP_ROUTE114', 20, -5], ['MAP_ROUTE113', 10, -6]] as const) {
      const c = at(id, x, y);
      expect(route114(c.x, c.y), `${id} ${x},${y}`).toBe('MAP_ROUTE114');
    }
  });

  it('goes on past ROUTE 114 in its grey rock, and over LAVARIDGE in the ropeway\'s', () => {
    const grey = at('MAP_ROUTE114', 50, 60);
    expect(fill.metatile(grey.x, grey.y)?.ref).toBe('MAP_ROUTE114');
    const red = at('MAP_LAVARIDGE_TOWN', 10, -10);
    expect(fill.metatile(red.x, red.y)?.ref).toBe('MAP_ROUTE112');
  });

  it('has a beach along the river over ROUTE 118, and a front-facing foot over ROUTE 103\'s pond', () => {
    const sand = (id: number) => (id >= 0x118 && id <= 0x12d) || id === 0x13d || id === 0x13e || id === 0x145 || id === 0x146;
    for (const x of [20, 28]) {
      const beach = at('MAP_ROUTE118', x, -3);
      expect(sand(fill.metatile(beach.x, beach.y)?.id ?? -1), `${x}`).toBe(true);
    }
    // ROUTE 103's pond starts at its top row: over it, General's rock stands on its front-facing foot.
    for (let x = 35; x <= 36; x++) {
      const c = at('MAP_ROUTE103', x, -1);
      if (painted.has(`${c.x},${c.y}`)) continue; // Cam painted water there, 11-11
      expect(fill.metatile(c.x, c.y)?.id, `${x}`).toBe(0x79);
    }
  });
});

// Cam, 11-04: "it almost looks like I can walk over here but I can't". Nobody stands on the fill.
// Then Cam, on the Map Board: "let's change this to beaches along the water in general". So sand
// where water is near, and otherwise trees, rock or sea.
describe('beside where a trainer can stand', () => {
  it('the fill reads as trees, rock, sea or a beach on the water: open grass off 8 of 367 edge cells', () => {
    const maps = (world as unknown as { maps: WorldMap[] }).maps;
    const fill = new WorldFill(fillFile as unknown as FillFile);
    const open = (id: number) => id === 0x1;
    const placed = [...layout(maps).values()];
    const owned = new Set<string>();
    for (const p of placed) for (let y = 0; y < p.m.h; y++) for (let x = 0; x < p.m.w; x++) owned.add(`${p.gx + x},${p.gy + y}`);
    let edge = 0;
    const onOpen: string[] = [];
    for (const p of placed) {
      const grid: number[] = [];
      for (const run of p.m.grid.split(';')) {
        if (!run) continue;
        const [n, v] = run.split('x').map(Number);
        for (let i = 0; i < n; i++) grid.push(v);
      }
      for (let y = 0; y < p.m.h; y++) {
        for (let x = 0; x < p.m.w; x++) {
          const c = grid[y * p.m.w + x];
          if (c === 1 || c === 2) continue; // a wall, or water
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const wx = p.gx + x + dx, wy = p.gy + y + dy;
            if (owned.has(`${wx},${wy}`)) continue;
            edge += 1;
            const m = fill.metatile(wx, wy);
            if (m && !m.ref && open(m.id)) onOpen.push(`${p.m.id} ${x},${y}`);
          }
        }
      }
    }
    expect(edge).toBeGreaterThan(300);
    // 3 before the ranges: the rest are a cell of grass under the massif over ROUTE 117.
    expect(onOpen.length, onOpen.join('; ')).toBeLessThanOrEqual(8);
  });
});
