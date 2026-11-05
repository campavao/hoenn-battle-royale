import { describe, expect, it } from 'vitest';
import { ERASER, History, PaintWorld, cellOf, fromFile, fromHash, keyOf, latticeAt, pickStamp, placeAt, setCell, stampCell, toFile, toHash, xOf, yOf, type Cell, type Edit, type Stamp } from './mappaint';
import { SEA_METATILE, WorldFill } from './worldfill';

// 8 x 8 cells from (-4, -4): sea, with a block of symbol 1 (metatiles 10..13 by phase) in the middle.
const rows = Array.from({ length: 64 }, (_, i) => (i % 8 >= 2 && i % 8 < 6 && i >> 3 >= 2 && i >> 3 < 6 ? 1 : 0));
const fill = new WorldFill({ x0: -4, y0: -4, w: 8, h: 8, blocks: [[], [null, 10, 11, 12, 13]], rows: rows.map((v) => `1x${v}`).join(';') });
// A real map at the top left corner, 2 x 2: blocks 600 + its cell.
const world = () => new PaintWorld(fill, [{ id: 'MAP_X', gx: -4, gy: -4, w: 2, h: 2 }], (_, x, y) => 0x4000 | (600 + y * 2 + x));
const grass: Cell = { ref: null, id: 1 };

describe('the map painter', () => {
  it('keys come back as the cell they were, negative ones too', () => {
    for (const [x, y] of [[0, 0], [-354, -192], [750, 300], [-1, 5]]) expect([xOf(keyOf(x, y)), yOf(keyOf(x, y))]).toEqual([x, y]);
  });

  it('sees the real map, the file and the sea under the paint', () => {
    const w = world();
    expect(w.mapAt(-3, -3)?.id).toBe('MAP_X');
    expect(w.base(-4, -4)).toEqual({ ref: 'MAP_X', id: 600 });
    expect(w.base(-3, -3)).toEqual({ ref: 'MAP_X', id: 603 });
    expect(w.base(-2, -2)).toEqual({ ref: null, id: 10 });
    expect(w.base(-1, -2)).toEqual({ ref: null, id: 11 });
    expect(w.base(3, 3)).toEqual({ ref: null, id: SEA_METATILE });
    expect(w.shown(3, 3, new Map([[keyOf(3, 3), grass]]))).toEqual(grass);
  });

  it('a primary metatile is the same on any map, so it names none', () => {
    expect(cellOf('MAP_X', 0x4000 | 12)).toEqual({ ref: null, id: 12 });
    expect(cellOf('MAP_X', 0x4000 | 512)).toEqual({ ref: 'MAP_X', id: 512 });
  });

  it("won't paint a real map or past the file's edge", () => {
    const w = world(), paint = new Map<number, Cell>(), edit: Edit = new Map();
    expect(setCell(w, paint, edit, -4, -4, grass)).toBe(false);
    expect(setCell(w, paint, edit, 4, 0, grass)).toBe(false);
    expect(paint.size).toBe(0);
    expect(edit.size).toBe(0);
    expect(setCell(w, paint, edit, 3, 3, grass)).toBe(true);
    expect(paint.size).toBe(1);
  });

  it('painting what the file has, or erasing, is no paint', () => {
    const w = world(), paint = new Map<number, Cell>(), edit: Edit = new Map();
    expect(setCell(w, paint, edit, 3, 3, { ref: null, id: SEA_METATILE })).toBe(false);
    setCell(w, paint, edit, 3, 3, grass);
    expect(setCell(w, paint, edit, 3, 3, grass), 'the same again').toBe(false);
    expect(setCell(w, paint, edit, 3, 3, { ref: null, id: SEA_METATILE })).toBe(true);
    expect(paint.size).toBe(0);
    setCell(w, paint, edit, 2, 3, grass);
    expect(setCell(w, paint, edit, 2, 3, ERASER.cells[0])).toBe(true);
    expect(paint.size).toBe(0);
  });

  it('undo and redo walk a stroke back and forth, keeping what it first overwrote', () => {
    const w = world(), paint = new Map<number, Cell>(), h = new History();
    const a: Edit = new Map();
    setCell(w, paint, a, 3, 3, grass);
    h.push(a);
    const b: Edit = new Map();
    setCell(w, paint, b, 3, 3, { ref: null, id: 7 });
    setCell(w, paint, b, 3, 3, { ref: null, id: 8 });
    setCell(w, paint, b, 2, 3, { ref: null, id: 9 });
    h.push(b);
    h.undo(paint);
    expect(paint.get(keyOf(3, 3))).toEqual(grass);
    expect(paint.has(keyOf(2, 3))).toBe(false);
    h.redo(paint);
    expect(paint.get(keyOf(3, 3))?.id).toBe(8);
    expect(paint.get(keyOf(2, 3))?.id).toBe(9);
    h.undo(paint);
    h.undo(paint);
    expect(paint.size).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.undo(paint)).toBeNull();
    h.redo(paint);
    h.push(new Map([[keyOf(0, 0), undefined]]));
    expect(h.canRedo, 'a new stroke ends the redo').toBe(false);
  });

  it('picks up a block whichever way it was dragged, the paint and the real map included', () => {
    const w = world(), paint = new Map([[keyOf(-2, -3), grass]]);
    const s = pickStamp(w, paint, -2, -3, -3, -4);
    expect([s.w, s.h, s.sx, s.sy]).toEqual([2, 2, -3, -4]);
    expect(s.cells).toEqual([{ ref: 'MAP_X', id: 601 }, { ref: null, id: SEA_METATILE }, { ref: 'MAP_X', id: 603 }, grass]);
  });

  describe('where a stamp lands', () => {
    const tree: Stamp = { w: 2, h: 2, cells: [grass, grass, grass, grass], sx: 4, sy: 8 };
    const one: Stamp = { w: 1, h: 1, cells: [grass], sx: 5, sy: 9 };

    it('stays in step with where it was picked up, so a tree is never cut in half', () => {
      for (let x = -5; x < 5; x++) {
        for (let y = -5; y < 5; y++) {
          const at = placeAt(tree, x, y, true);
          expect(((at.x - 4) % 2 + 2) % 2, `${x},${y}`).toBe(0);
          expect(((at.y - 8) % 2 + 2) % 2, `${x},${y}`).toBe(0);
          expect(x >= at.x && x < at.x + 2, 'and under the finger').toBe(true);
        }
      }
    });
    it('anywhere at all with SNAP off, and a lone tile has no step to keep', () => {
      expect(placeAt(tree, 3, 3, false)).toEqual({ x: 2, y: 2 });
      expect(placeAt(one, 3, 4, true)).toEqual({ x: 3, y: 4 });
    });
    it('a stroke lays whole stamps side by side, never overlapping', () => {
      const first = { x: 10, y: 20 };
      expect(latticeAt(tree, first, 10, 20)).toEqual(first);
      expect(latticeAt(tree, first, 11, 21)).toEqual(first);
      expect(latticeAt(tree, first, 12, 21)).toEqual({ x: 12, y: 20 });
      expect(latticeAt(tree, first, 9, 19)).toEqual({ x: 8, y: 18 });
    });
    it('a box repeats it from the anchor, past the anchor on every side', () => {
      const s: Stamp = { w: 2, h: 1, cells: [grass, null], sx: 0, sy: 0 };
      expect(stampCell(s, 0, 0, 0, 5)).toEqual(grass);
      expect(stampCell(s, 0, 0, 1, 5)).toBeNull();
      expect(stampCell(s, 0, 0, -1, -3)).toBeNull();
      expect(stampCell(s, 0, 0, -2, -3)).toEqual(grass);
    });
  });

  describe('the file and the link', () => {
    const paint = new Map<number, Cell>([
      [keyOf(-100, -50), { ref: 'MAP_ROUTE110', id: 600 }],
      [keyOf(7, 9), grass],
      [keyOf(8, 9), { ref: 'MAP_ROUTE104', id: 513 }],
    ]);

    it('a file names its maps once and comes back as it went', () => {
      const f = toFile(paint);
      expect(f.refs).toEqual(['MAP_ROUTE104', 'MAP_ROUTE110']);
      expect(f.cells[0]).toEqual([-100, -50, 1, 600]);
      expect(fromFile(JSON.parse(JSON.stringify(f)))).toEqual(paint);
    });
    it('turns away what is not a painting', () => {
      for (const bad of [null, {}, { v: 2, refs: [], cells: [] }, { v: 1, refs: [], cells: [[1, 2, 0, 3]] }, { v: 1, refs: [], cells: [[1, 2]] }, { v: 1, refs: [], cells: [[1, 2, -1, 5000]] }, { v: 1, refs: [], cells: [[1.5, 2, -1, 5]] }]) {
        expect(fromFile(bad), JSON.stringify(bad)).toBeNull();
      }
    });
    it('a link carries it, with no + / = to break in a chat', async () => {
      const hash = await toHash(toFile(paint));
      expect(hash).toMatch(/^p=[\w-]+$/);
      expect(await fromHash(`#${hash}`)).toEqual(paint);
    });
    it('a link stays short enough to send: a thousand cells of a painted coast', async () => {
      const big = new Map<number, Cell>();
      for (let i = 0; i < 1000; i++) big.set(keyOf(i % 40, i >> 5), { ref: i % 3 ? null : 'MAP_ROUTE110', id: 500 + (i % 8) });
      expect((await toHash(toFile(big))).length).toBeLessThan(8000);
    });
    it('a broken link is no paint', async () => {
      for (const h of ['', '#', '#p=', '#p=notdeflate', '#j=bm90anNvbg', '#x=abc']) expect(await fromHash(h), h).toBeNull();
    });
  });
});
