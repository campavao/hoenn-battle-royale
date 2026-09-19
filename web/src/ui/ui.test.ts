import { describe, expect, it } from 'vitest';
import { SKIN_GFX, frameTiles, glyphIds, inRect, measure, skinSheet } from './emerald';
import { SKINS } from '../match/career';
import ghostsSource from '../../../src/br/br_ghosts.c?raw';

describe("Emerald's font on the page (POK-320)", () => {
  it('maps characters to charmap bytes, an unknown one to a space', () => {
    expect(glyphIds('A')).toEqual([0xbb]);
    expect(glyphIds('0')).toEqual([0xa1]);
    expect(glyphIds(' ')).toEqual([0x00]);
    expect(glyphIds('é')).toEqual([0x00]);
  });

  it("measures with the ROM's own widths", () => {
    // gFontNormalLatinGlyphWidths: a space is 3, a capital A is 6, a small i is narrower.
    expect(measure(' ')).toBe(3);
    expect(measure('A')).toBe(6);
    expect(measure('i')).toBeLessThan(measure('A'));
    expect(measure('CAM')).toBe(measure('C') + measure('A') + measure('M'));
  });
});

describe('the window frame', () => {
  it('tiles a box from the 3x3 frame: corners once, edges along, the middle inside', () => {
    const tiles = frameTiles(32, 24);
    expect(tiles).toHaveLength(4 * 3);
    expect(tiles[0]).toEqual({ dx: 0, dy: 0, tx: 0, ty: 0 });
    expect(tiles[3]).toEqual({ dx: 24, dy: 0, tx: 2, ty: 0 });
    expect(tiles[5]).toEqual({ dx: 8, dy: 8, tx: 1, ty: 1 });
    expect(tiles[11]).toEqual({ dx: 24, dy: 16, tx: 2, ty: 2 });
  });

  it('a box is at least two tiles each way', () => {
    expect(frameTiles(8, 8)).toHaveLength(4);
  });
});

describe('the wardrobe', () => {
  it("is the ROM's sSkinGraphics, one sheet per skin, as many as career.ts names", () => {
    expect(SKIN_GFX).toHaveLength(SKINS.length);
    const body = ghostsSource.match(/sSkinGraphics\[\]\s*=\s*\{([^}]*)\}/)![1];
    expect(body.match(/OBJ_EVENT_GFX_\w+/g)).toHaveLength(SKIN_GFX.length);
    for (let i = 0; i < SKINS.length; i++) {
      const sheet = skinSheet(i);
      expect(sheet, SKINS[i]).not.toBeNull();
      expect(sheet!.w).toBe(16);
      expect(sheet!.h).toBe(32);
    }
    expect(skinSheet(99)!.gfx, 'a skin the ROM does not know is BRENDAN, the way Spawn clamps').toBe(SKIN_GFX[0]);
  });
});

describe('a tap', () => {
  it('lands in a rectangle or not', () => {
    const r = { x: 10, y: 10, w: 20, h: 8 };
    expect(inRect(r, 10, 10)).toBe(true);
    expect(inRect(r, 29, 17)).toBe(true);
    expect(inRect(r, 30, 10)).toBe(false);
    expect(inRect(r, 9, 12)).toBe(false);
  });
});

describe('the drawn screens (POK-320)', () => {
  it('lays a list out one row per line inside its frame', async () => {
    const { layoutRows, ROW_H } = await import('./screens');
    const lay = layoutRows(24, 5);
    expect(lay.frame).toEqual({ x: 0, y: 24, w: 240, h: 5 * ROW_H + 16 });
    expect(lay.rows[0]).toEqual({ x: 8, y: 32, w: 224, h: ROW_H });
    expect(lay.rows[4].y).toBe(32 + 4 * ROW_H);
  });

  it("seats Kanto's 2x4, and a bigger MAX in more rows", async () => {
    const { layoutSeats, SEAT_W, SEAT_H } = await import('./screens');
    const eight = layoutSeats(24, 8);
    expect(eight.cells).toHaveLength(8);
    expect(eight.cells[0]).toEqual({ x: 8, y: 32, w: SEAT_W, h: SEAT_H });
    expect(eight.cells[3].x).toBe(8 + 3 * SEAT_W);
    expect(eight.cells[4]).toEqual({ x: 8, y: 32 + SEAT_H, w: SEAT_W, h: SEAT_H });
    expect(eight.frame.h).toBe(2 * SEAT_H + 16);
    expect(layoutSeats(24, 12).frame.h).toBe(3 * SEAT_H + 16);
    // Four across fill the 240 exactly with a tile each side.
    expect(4 * SEAT_W + 16).toBe(240);
  });

  it('centres a row of buttons a tile apart, each a whole number of tiles wide', async () => {
    const { layoutButtons, buttonWidth } = await import('./screens');
    expect(buttonWidth('START') % 8).toBe(0);
    const [wear, back] = layoutButtons(100, ['WEAR', 'BACK']);
    expect(wear.y).toBe(100);
    expect(back.x).toBe(wear.x + wear.w + 8);
    expect(wear.x).toBe(240 - (back.x + back.w));
  });

  it("says what the wardrobe's line says: yours, wearable, or the price", async () => {
    const { wardrobeNote } = await import('./screens');
    expect(wardrobeNote(0, 0, 0)).toBe('your sprite');
    expect(wardrobeNote(1, 0, 0)).toBe('press WEAR');
    expect(wardrobeNote(2, 0, 0)).toBe('LOCKED -- 1 win');
    expect(wardrobeNote(4, 3, 0)).toBe('LOCKED -- 5 wins');
    expect(wardrobeNote(4, 5, 0)).toBe('press WEAR');
  });

  it('shows the stage at whole pixels once it can afford two, and at the phone’s own fit below', async () => {
    const { stageScale } = await import('./stage');
    expect(stageScale(1200, 800)).toBe(2);
    expect(stageScale(1200, 1000)).toBe(3);
    expect(stageScale(375, 812)).toBeCloseTo(375 / 240);
    expect(stageScale(200, 300)).toBe(1);
  });

  it('cuts a long line to fit, with an ellipsis the font has', async () => {
    const { fitText, measure } = await import('./emerald');
    const long = 'A LINE THAT IS FAR TOO LONG FOR THE ROW IT IS ON';
    const cut = fitText(long, 100);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(100);
    expect(fitText('SHORT', 100)).toBe('SHORT');
  });
});
