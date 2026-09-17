import { describe, expect, it } from 'vitest';
import { MAP_OFFSET, shiftCells, toPageCells, toRomCells } from './cells';
import type { Msg } from './wire';

const MAP = { group: 0, num: 25 };

describe('the seven tiles between the two maps', () => {
  it('moves a walk, because that is a live tile', () => {
    const place = { t: 'place', v: 1, seat: 3, map: MAP, x: 10, y: 4, f: 2, st: 'alive' } as unknown as Msg;
    const out = toRomCells(place);
    const cell = out as unknown as { x: number; y: number };

    expect(cell.x).toBe(10 + MAP_OFFSET);
    expect(cell.y).toBe(4 + MAP_OFFSET);
    // ...and everything else is left exactly as it was.
    expect(out).toMatchObject({ t: 'place', v: 1, seat: 3, map: MAP, f: 2, st: 'alive' });
    expect(toPageCells(out)).toEqual(place);
  });

  it('moves a step the same way', () => {
    const step = { t: 'step', seat: 1, d: 3, map: MAP, x: 0, y: 0 } as unknown as Msg;
    expect(toRomCells(step)).toMatchObject({ x: MAP_OFFSET, y: MAP_OFFSET });
  });

  it('moves every cell a spill puts on the ground, and its bag', () => {
    const spill = {
      t: 'spill',
      seat: 2,
      map: MAP,
      mons: [
        { key: 0x0200, x: 5, y: 6, species: 277, level: 30 },
        { key: 0x0201, x: 5, y: 6, species: 278, level: 30 },
      ],
      bag: { key: 0x02ff, x: 5, y: 6, items: [], money: 0 },
    } as unknown as Msg;
    const out = toRomCells(spill);
    const dropped = out as unknown as {
      mons: { x: number; y: number; key: number }[];
      bag: { key: number; x: number; y: number };
    };

    expect(dropped.mons.map((m) => [m.x, m.y])).toEqual([
      [5 + MAP_OFFSET, 6 + MAP_OFFSET],
      [5 + MAP_OFFSET, 6 + MAP_OFFSET],
    ]);
    expect(dropped.mons[0]).toMatchObject({ key: 0x0200, species: 277, level: 30 });
    expect(dropped.bag).toMatchObject({ key: 0x02ff, x: 5 + MAP_OFFSET, y: 6 + MAP_OFFSET });
    expect(toPageCells(out)).toEqual(spill);
  });

  it('leaves a warp alone: a landing cell is map data on both sides', () => {
    const land = { t: 'land', seat: 0, map: MAP, x: 12, y: 9 } as unknown as Msg;
    expect(toRomCells(land)).toEqual(land);

    const start = { t: 'start', seed: 7, spawns: [{ seat: 0, map: MAP, x: 12, y: 9 }] } as unknown as Msg;
    expect(toRomCells(start)).toEqual(start);
  });

  it('leaves the ring alone: those are region-map sections, not tiles', () => {
    const ring = { t: 'ring', seat: 0, phase: 2, sx: 4, sy: 5, r: 3 } as unknown as Msg;
    expect(toRomCells(ring)).toEqual(ring);
  });

  it('hands back anything with no cell in it, unchanged and the same object', () => {
    const out = { t: 'out', seat: 4 } as unknown as Msg;
    expect(shiftCells(out, 7)).toBe(out);
  });
});
