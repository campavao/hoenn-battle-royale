import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

  // Cam, 11-11: "make sure this is also the map that's shown in the background when on the
  // main menu" -- the fill between the maps, painting and all, as the game draws it.
  it('has the ground between the maps under every view of the pan, no black left', { timeout: 60_000 }, () => {
    const fill = pan.fill as { size: number; tiles: [number, number, string][] };
    for (const [, , name] of fill.tiles) expect(existsSync(resolve(__dirname, `../../public/field-maps/fill/${name}.png`)), name).toBe(true);
    const rects = [...fill.tiles.map(([x, y]) => [x, y, fill.size, fill.size]), ...(pan.maps as [string, number, number, number, number][]).map((m) => m.slice(1))];
    const covered = (x: number, y: number) => rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
    // A tall phone's menu (240 x 520 game pixels) and a wide screen's (1280 x 400) round the
    // camera, every few seconds of the tour.
    const black: string[] = [];
    for (const [vw, vh] of [[240, 520], [1280, 400]]) {
      for (let t = 0; t < 1_200_000; t += 2000) {
        const c = panAt(t);
        for (let dy = -vh / 2; dy <= vh / 2; dy += 20) for (let dx = -vw / 2; dx <= vw / 2; dx += 20) if (!covered(c.x + dx, c.y + dy)) black.push(`${vw}x${vh} at ${t} ms, ${c.x + dx},${c.y + dy}`);
      }
    }
    expect(black.slice(0, 5)).toEqual([]);
  });
});
