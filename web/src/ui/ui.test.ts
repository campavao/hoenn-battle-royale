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
