import { describe, expect, it } from 'vitest';
import pan from '../data/menupan.json';
import { panAt } from './menubg';

describe("the main menu's pan over Hoenn (HBR-30)", () => {
  it('starts in Littleroot and goes town to town', () => {
    expect(panAt(0)).toEqual({ x: pan.path[0][0], y: pan.path[0][1] });
    const a = panAt(10_000);
    expect(a).not.toEqual(panAt(0));
  });

  it('moves slowly and never jumps, there and back again', () => {
    let prev = panAt(0);
    for (let t = 50; t < 600_000; t += 50) {
      const p = panAt(t);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y), `at ${t} ms`).toBeLessThanOrEqual(3);
      prev = p;
    }
  });

  it('follows the road in straight lines (Cam, 11-01: the diagonals show black corners)', () => {
    for (let i = 1; i < pan.path.length; i++) {
      const [ax, ay] = pan.path[i - 1], [bx, by] = pan.path[i];
      expect(ax === bx || ay === by, `${ax},${ay} to ${bx},${by}`).toBe(true);
    }
    const maps = pan.maps as [string, number, number, number, number][];
    const on = (x: number, y: number, id: string) => maps.some(([n, mx, my, mw, mh]) => n === id && x >= mx && x < mx + mw && y >= my && y < my + mh);
    const start = maps.find(([n]) => n === 'LITTLEROOT_TOWN')!;
    expect(on(pan.path[0][0], pan.path[0][1], start[0])).toBe(true);
    // Littleroot, 101, Oldale, 103: the game's own first steps.
    const seen: string[] = [];
    for (const [x, y] of pan.path) {
      const m = maps.find(([, mx, my, mw, mh]) => x >= mx && x < mx + mw && y >= my && y < my + mh)?.[0];
      if (m && seen[seen.length - 1] !== m) seen.push(m);
    }
    expect(seen.slice(0, 4)).toEqual(['LITTLEROOT_TOWN', 'ROUTE101', 'OLDALE_TOWN', 'ROUTE103']);
  });

  it('only stops over maps it has pictures of', () => {
    const maps = pan.maps as [string, number, number, number, number][];
    for (const [x, y] of pan.path) {
      expect(maps.some(([, mx, my, mw, mh]) => x >= mx && x < mx + mw && y >= my && y < my + mh)).toBe(true);
    }
  });
});
