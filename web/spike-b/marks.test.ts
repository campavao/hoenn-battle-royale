// Who stands for whom drawn small (Cam, 11-21): heads far out, a legendary as itself.
import { describe, expect, it } from 'vitest';
import { FAR_BATTLING, FAR_MINE, HEAD_H, farBadge, farOrder, headRows, liveLegends, liveMarks, markIcon, opaqueBox } from './marks';

describe('far out', () => {
  it("is the minimap's head: 16 rows from 23 above the frame's foot", () => {
    expect(headRows(32)).toEqual({ sy: 9, sh: HEAD_H });
    expect(headRows(16).sy, 'a short frame from its top').toBe(0);
  });
  it('badges mine red and a battle gold, the rest none (no more white and blue boxes)', () => {
    expect(farBadge({ id: 3, battling: false }, 3)).toBe(FAR_MINE);
    expect(farBadge({ id: 3, battling: true }, 3), 'mine, even fighting').toBe(FAR_MINE);
    expect(farBadge({ id: 4, battling: true }, 3)).toBe(FAR_BATTLING);
    expect(farBadge({ id: 4, battling: false }, 3)).toBe(null);
  });
  it('draws mine last, on top', () => {
    const all = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(farOrder(all, 2).map((a) => a.id)).toEqual([1, 3, 2]);
    expect(farOrder(all, 9).map((a) => a.id), 'a spectator, nobody first').toEqual([1, 2, 3]);
  });
});

describe("an event's mark", () => {
  it("is its legendary's icon, and the ball only for a story with none", () => {
    expect(markIcon({ species: 401 })).toBe(401);
    expect(markIcon({ species: 0 })).toBe(null);
  });
  it("is a story's POKeMON when it is no event legendary: MEW, DEOXYS, BELDUM (Cam, 11-22: still a ball)", () => {
    expect(markIcon({ species: 0, mon: 151 })).toBe(151);
    expect(markIcon({ species: 401, mon: 151 }), 'a legendary first').toBe(401);
    const events = [{ key: 10, species: 0, mon: 151 }, { key: 11, species: 0 }, { key: 12, species: 401 }];
    expect(liveMarks(events, new Set([10, 11, 12]), new Set<number>()).map((e) => e.key)).toEqual([10, 12]);
    expect(liveLegends(events, new Set([10, 11, 12]), new Set<number>()).map((e) => e.key), 'the glow is for event legendaries').toEqual([12]);
  });
  it('is live while its legendary stands: dropped, not caught, not gone', () => {
    const events = [{ key: 10, species: 401 }, { key: 11, species: 0 }, { key: 12, species: 402 }, { key: 13, species: 403 }];
    const spills = new Set([10, 11, 12]);
    const picked = new Set([12]);
    // 11 has no legendary, 12 is caught, 13's bag is gone.
    expect(liveLegends(events, spills, picked).map((e) => e.key)).toEqual([10]);
    expect(liveLegends(events, new Set<number>(), new Set<number>())).toEqual([]);
  });
});

describe("a party icon's opaque box", () => {
  it('is the POKeMON, not the air round it', () => {
    const w = 4, h = 3, d = new Uint8Array(w * h * 4);
    d[(1 * w + 1) * 4 + 3] = 255;
    d[(2 * w + 2) * 4 + 3] = 255;
    expect(opaqueBox(d, w, h)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(opaqueBox(new Uint8Array(w * h * 4), w, h), 'nothing in it').toBe(null);
  });
});
