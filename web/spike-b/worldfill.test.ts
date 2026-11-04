import { describe, expect, it } from 'vitest';
import fillFile from './data/world-fill.json';
import world from './data/world.json';
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
