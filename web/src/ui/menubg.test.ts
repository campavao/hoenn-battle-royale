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

  it('only stops over maps it has pictures of', () => {
    const maps = pan.maps as [string, number, number, number, number][];
    for (const [x, y] of pan.path) {
      expect(maps.some(([, mx, my, mw, mh]) => x >= mx && x < mx + mw && y >= my && y < my + mh)).toBe(true);
    }
  });
});
