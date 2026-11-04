import { describe, expect, it } from 'vitest';
import { mapFit, snapCell } from './mapwindow';
import { CELL, GRID_X, GRID_Y } from './ringmap';

const px = (cx: number, cy: number) => ({ x: GRID_X + cx * CELL + CELL / 2, y: GRID_Y + cy * CELL + CELL / 2 });

describe('the MAP on a screen', () => {
  it('fills a phone upright, to its width', () => {
    const f = mapFit(true, { w: 375, h: 812 }, 1.5);
    expect(f.s * 240).toBeCloseTo(367);
    expect(f.col).toBe(0);
  });
  it('fills a phone on its side, to its height, its words in a column beside it', () => {
    const f = mapFit(true, { w: 712, h: 327 }, 2);
    expect(f.s * 160).toBeCloseTo(319);
    expect(f.col).toBeGreaterThanOrEqual(104);
    expect((240 + f.col) * f.s + 4).toBeLessThanOrEqual(712);
  });
  it('keeps whole pixels with a mouse', () => {
    expect(mapFit(false, { w: 1920, h: 1080 }, 3)).toEqual({ s: 3, col: 0 });
  });
});

describe("the MAP's cursor under a mouse", () => {
  const none = { events: [], gyms: [] };
  const town = (x: number, y: number) => x === 5 && y === 5;

  it('stays on the place it is over', () => {
    const p = px(5, 5);
    expect(snapCell(p.x, p.y, none, town)).toEqual({ x: 5, y: 5 });
  });

  it('over open sea, goes to the nearest place; with nothing near, nowhere', () => {
    const near = px(7, 5);
    expect(snapCell(near.x, near.y, none, town)).toEqual({ x: 5, y: 5 });
    const far = px(12, 5);
    expect(snapCell(far.x, far.y, none, town)).toBeNull();
  });

  it("a mark takes it from the place under it, or from nothing: a legendary's ball", () => {
    const ball = px(9, 9);
    const by = { x: ball.x + 3, y: ball.y - 2 };
    expect(snapCell(by.x, by.y, { events: [ball], gyms: [] } as never, () => false)).toEqual({ x: 9, y: 9 });
  });

  it('off the grid is nothing', () => {
    expect(snapCell(-5, -5, none, () => true)).toBeNull();
  });
});
