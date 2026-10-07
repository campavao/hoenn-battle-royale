import { describe, expect, it } from 'vitest';
import { FIELD_VIEW_SIZE, HEAD_ROOM, LEGACY_BAND, askBand, LEGACY_SPRITE_BAND, type Camera, FieldImages, FieldView, type FieldDeps, SB1_MAP_GROUP, SB1_MAP_NUM, SB1_POS_X, SB1_POS_Y, SHAKE_FRAMES, bandClip, bandOf, ringColumns, ringRows, RING_ABOVE, RING_ROWS, fadeOf, fogOrigin, frameOf, gbaColor, FAST_FADE, heldFade, holdFade, layoutField, mapFade, lcdOrigin, lcdRect, neighbours, oamFlipped, pictureBox, romBand, shakeOffset, subTile, SPR_OAM_HFLIP, seeThroughAlpha, edgeReach } from './field';
import type { Band } from './emu';
import { GhostWalkers, OBJ_LOCAL_ID, OBJ_MAP_GROUP, OBJ_MAP_NUM, SB1_TEMPLATES, SEAT_SIZE, TEMPLATE_SIZE, TPL_GFX, TPL_LOCAL_ID, TPL_MOVEMENT_TYPE, TPL_X, TPL_Y } from './field-ghosts';
import type { RosterEntry } from './match/roster';
import { HOENN } from './bots/hoenn';
import { SKIN_GFX } from './ui/emerald';
import type { WorldMap } from './bots/world';
import fieldHeader from '../../include/br/br_field.h?raw';
import fieldSource from '../../src/br/br_field.c?raw';
import appSource from './app.ts?raw';

describe('the picture past the LCD (POK-319)', () => {
  const define = (name: string): number => {
    const m = fieldHeader.match(new RegExp(`#define\\s+${name}\\s+(\\d+)`));
    if (!m) throw new Error(`${name} not in br_field.h`);
    return Number(m[1]);
  };

  it("the ROM's picture (include/br/br_field.h): a sprite window of one OAM period, every side in eights, the view's top inside the ring", () => {
    const view = { left: define('BR_VIEW_LEFT'), top: define('BR_VIEW_TOP'), right: define('BR_VIEW_RIGHT'), bottom: define('BR_VIEW_BOTTOM') };
    const sprites = { top: define('BR_SPRITE_TOP'), bottom: define('BR_SPRITE_BOTTOM') };
    expect(160 + sprites.top + sprites.bottom, 'one reading of each 8-bit OAM y').toBe(256);
    for (const v of [...Object.values(view), ...Object.values(sprites)]) expect(v % 8, 'the core wants multiples of 8').toBe(0);
    expect(view.top, 'no higher than the ring reaches').toBeLessThanOrEqual(sprites.top + 16 * define('BR_RING_ABOVE'));
    // The window is the legacy band's rows, whatever the view: it is where the ROM keeps
    // every sprite's y to one reading.
    expect(sprites).toEqual(LEGACY_SPRITE_BAND);
  });

  it("the ROM's view is its 512-row ring less the one row a step needs: 104 above the LCD, 232 below, 496 rows (POK-329)", () => {
    const view = { left: define('BR_VIEW_LEFT'), top: define('BR_VIEW_TOP'), right: define('BR_VIEW_RIGHT'), bottom: define('BR_VIEW_BOTTOM') };
    const ringRows = define('BR_RING_TILE_ROWS') / 2;
    const above = define('BR_RING_ABOVE');
    expect(ringRows, 'a 256x512 BG: 32 metatile rows').toBe(32);
    expect(above).toBe(4);
    expect(view.top, "the ring's top: the LCD sits 40 below pos.y's top, and the ring runs BR_RING_ABOVE rows above it").toBe(define('BR_SPRITE_TOP') + 16 * above);
    expect(160 + view.top + view.bottom, 'every ring row but the spare one').toBe(16 * ringRows - 16);
    expect(160 + view.top + view.bottom).toBe(496);
    expect(view).toEqual({ left: 0, top: 104, right: 16, bottom: 232 });
    // Sideways it is the ring's 256 columns, as the legacy band's.
    expect({ left: view.left, right: view.right }).toEqual({ left: LEGACY_BAND.left, right: LEGACY_BAND.right });
    // ...and it is a band romBand takes, not one it would turn down for the legacy one.
    const rom = new Uint8Array(12);
    [view.left, view.top, view.right, view.bottom, define('BR_SPRITE_TOP'), define('BR_SPRITE_BOTTOM')].forEach((v, i) => {
      rom[2 * i] = v & 0xff;
      rom[2 * i + 1] = v >> 8;
    });
    expect(romBand(rom, new Map([['gBrFieldView', 0x08000000]]))).toEqual({ band: view, sprites: LEGACY_SPRITE_BAND });
  });

  it('gBrFieldView is six u16s in the order romBand reads them, and br_field.c fills them from the header', () => {
    const struct = fieldHeader.match(/struct BrFieldView\s*\{([^}]*)\}/)?.[1] ?? '';
    expect([...struct.matchAll(/u16 (\w+);/g)].map((m) => m[1])).toEqual(['left', 'top', 'right', 'bottom', 'spriteTop', 'spriteBottom']);
    expect(FIELD_VIEW_SIZE).toBe(6 * 2);
    const init = fieldSource.match(/const struct BrFieldView gBrFieldView\s*=\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(init.split(',').map((t) => t.trim()).filter(Boolean)).toEqual(['BR_VIEW_LEFT', 'BR_VIEW_TOP', 'BR_VIEW_RIGHT', 'BR_VIEW_BOTTOM', 'BR_SPRITE_TOP', 'BR_SPRITE_BOTTOM']);
  });

  it('the legacy band is one ring: 256 rows of the 8-bit sprite y, 256 columns of the tilemap, and its window is its own rows', () => {
    expect(LEGACY_BAND).toEqual({ left: 0, top: 40, right: 16, bottom: 56 });
    expect(160 + LEGACY_BAND.top + LEGACY_BAND.bottom).toBe(256);
    expect(240 + LEGACY_BAND.left + LEGACY_BAND.right).toBe(256);
    expect(LEGACY_SPRITE_BAND).toEqual({ top: LEGACY_BAND.top, bottom: LEGACY_BAND.bottom });
  });

  describe('the ROM declares its picture, and the page asks for what it declares (POK-329)', () => {
    const AT = 0x08000100;
    const image = (words: number[]): Uint8Array => {
      const rom = new Uint8Array(0x200);
      words.forEach((v, i) => {
        rom[AT - 0x08000000 + 2 * i] = v & 0xff;
        rom[AT - 0x08000000 + 2 * i + 1] = v >> 8;
      });
      return rom;
    };
    const syms = new Map([['gBrFieldView', AT]]);

    it('reads the six u16s at gBrFieldView out of the patched image', () => {
      expect(romBand(image([0, 104, 16, 232, 40, 56]), syms)).toEqual({ band: { left: 0, top: 104, right: 16, bottom: 232 }, sprites: { top: 40, bottom: 56 } });
      expect(romBand(image([8, 40, 24, 56, 16, 80]), syms)).toEqual({ band: { left: 8, top: 40, right: 24, bottom: 56 }, sprites: { top: 16, bottom: 80 } });
    });

    it('a ROM that does not say -- or says what no core can draw -- gets the legacy band', () => {
      const legacy = { band: LEGACY_BAND, sprites: LEGACY_SPRITE_BAND };
      expect(romBand(image([0, 104, 16, 232, 40, 56]), new Map()), 'no symbol').toEqual(legacy);
      expect(romBand(image([0, 104, 16, 232, 40, 56]), null), 'no table').toEqual(legacy);
      expect(romBand(null, syms), 'no image').toEqual(legacy);
      expect(romBand(new Uint8Array(0x100 + 6), syms), 'off the end of the image').toEqual(legacy);
      expect(romBand(image([0, 100, 16, 232, 40, 56]), syms), 'not in eights').toEqual(legacy);
      expect(romBand(image([0, 264, 16, 232, 40, 56]), syms), 'a side past 256').toEqual(legacy);
      expect(romBand(image([0, 104, 16, 232, 40, 64]), syms), 'a window that is not one OAM period').toEqual(legacy);
      // ...and a fresh copy each time: nobody's edit reaches the constant.
      const got = romBand(null, null);
      got.band.top = 0;
      expect(LEGACY_BAND.top).toBe(40);
    });

    it('main() asks after the ROM is patched and the playing screen is up, before it boots: the window, then the band, both read off the bytes it boots', () => {
      const main = appSource.slice(appSource.indexOf('async function main()'));
      const patched = main.indexOf('await runPatchingScreen(emu)');
      const read = main.indexOf('romPicture = romBand(bytes, symbols);');
      const shown = main.indexOf("showScreen('playing')");
      const ask = main.indexOf('askForBand(emu);');
      expect(patched).toBeGreaterThan(0);
      expect(read).toBeGreaterThan(patched);
      expect(shown, 'measured on the playing screen').toBeGreaterThan(read);
      expect(ask).toBeGreaterThan(shown);
      expect(main.indexOf('emu.startBytes(')).toBeGreaterThan(ask);
      expect(main.indexOf('emu.start()')).toBeGreaterThan(ask);
      expect(main.slice(0, patched), 'nothing asked before the ROM is known').not.toMatch(/setViewport|setSpriteBand|askForBand/);
      // askForBand: the layout's band inside the ROM's, then the window, then the band.
      const fn = appSource.slice(appSource.indexOf('function askForBand('), appSource.indexOf('async function main()'));
      const band = fn.indexOf('askBand(matchLayout(), romPicture)');
      const sprites = fn.indexOf('emu.setSpriteBand(romPicture.sprites)');
      const viewport = fn.indexOf('emu.setViewport(askedBand)');
      expect(band).toBeGreaterThan(0);
      expect(sprites).toBeGreaterThan(band);
      expect(viewport).toBeGreaterThan(sprites);
      expect(fn).toMatch(/askedBand = devBand\(romPicture\.band\) \?\? asked;/);
      // The match's layout, whatever is up when it is measured: in-match, and docked on a desktop.
      const measure = appSource.slice(appSource.indexOf('function matchLayout('), appSource.indexOf('function askForBand('));
      expect(measure).toMatch(/classList\.add\('in-match'\)/);
      expect(measure).toMatch(/classList\.toggle\('docked', desktop\(\)\)/);
      expect(measure).toMatch(/measureLayout\(\$\('#screen-wrap'\)[^)]*, \$\('#pad'\)/);
      // PLAY AGAIN asks again, before the boot that takes it.
      const again = appSource.slice(appSource.indexOf('async function returnToRoom()'));
      expect(again.indexOf('askForBand(emu);')).toBeGreaterThan(0);
      expect(again.indexOf('askForBand(emu);')).toBeLessThan(again.indexOf('await rebootIntoBr('));
      // The field lays out with what was last asked when the emulator has nothing to say.
      expect(appSource).toMatch(/new FieldView\(\{[^}]*\bband: \(\) => askedBand,/);
    });

    it('lays out with what the core draws, else -- a buffer plainly bigger than the LCD -- with what was asked', () => {
      const tall: Band = { left: 0, top: 104, right: 16, bottom: 232 };
      expect(bandOf(LEGACY_BAND, { width: 256, height: 256 }, tall)).toBe(LEGACY_BAND);
      expect(bandOf(null, { width: 256, height: 496 }, tall)).toBe(tall);
      expect(bandOf(null, { width: 256, height: 496 })).toBeNull();
      expect(bandOf(null, { width: 240, height: 160 }, tall), 'an LCD-sized buffer has no band').toBeNull();
    });
  });

  describe("the band stops at the map's edge (POK-329)", () => {
    const map = { w: 20, h: 20 };
    const at = (x: number, y: number, subX = 0, subY = 0) => ({ x, y, subX, subY });
    const none = { left: 0, top: 0, right: 0, bottom: 0 };

    it('mid-map, nothing is cut', () => {
      expect(bandClip(at(10, 10), { w: 30, h: 30 }, LEGACY_BAND)).toEqual(none);
    });

    it('near the last row, the rows past it are cut -- never more than the band has', () => {
      // At rest on row y the picture's top is map row 16y - 72, so the band's last row
      // is 16y - 72 + 160 + 56 = 16y + 144: row 11 ends it on the edge (320).
      expect(bandClip(at(10, 11), map, LEGACY_BAND).bottom, 'the band ends on the edge').toBe(0);
      expect(bandClip(at(10, 12), map, LEGACY_BAND).bottom).toBe(16);
      expect(bandClip(at(10, 13), map, LEGACY_BAND).bottom).toBe(32);
      expect(bandClip(at(10, 19), map, LEGACY_BAND).bottom, 'on the last row, all of it').toBe(LEGACY_BAND.bottom);
      // A taller band: on the last row all of it goes (the LCD's own 72 rows past the
      // edge stay), and on row 14 the rows from the edge down.
      expect(bandClip(at(10, 19), map, { left: 0, top: 104, right: 16, bottom: 232 }).bottom).toBe(232);
      expect(bandClip(at(10, 14), map, { left: 0, top: 104, right: 16, bottom: 232 }).bottom).toBe(14 * 16 + 88 + 232 - 320);
    });

    it('mid-step, from the camera the picture was drawn from: the tile has moved, the offset walks it back', () => {
      // A step down onto row 13: the offset runs 4, 8, 12 and the step lands at 0.
      expect([4, 8, 12, 0].map((sub) => bandClip(at(10, 13, 0, sub), map, LEGACY_BAND).bottom)).toEqual([20, 24, 28, 32]);
      // ...and back up onto row 12, the offset negative.
      expect([-4, -8, -12, 0].map((sub) => bandClip(at(10, 12, 0, sub), map, LEGACY_BAND).bottom)).toEqual([28, 24, 20, 16]);
    });

    it('the right edge, at rest and mid-step', () => {
      expect(bandClip(at(11, 10), map, LEGACY_BAND).right).toBe(0);
      expect(bandClip(at(12, 10), map, LEGACY_BAND).right).toBe(16);
      expect(bandClip(at(12, 10, 8, 0), map, LEGACY_BAND).right, 'half a step onto column 12').toBe(8);
      expect(bandClip(at(19, 10), map, LEGACY_BAND).right).toBe(LEGACY_BAND.right);
    });

    // gBrRingStale: bit (dy + 4) is ring row pos.y + dy, not yet drawn -- after a whole-map
    // draw every row past pret's pos.y..pos.y+15, after a map connection every row past
    // pret's pos.y..pos.y+14 but a step up's new top row. The band stops short of them and
    // the composite shows the map there (Rustboro -> Route 115 in picture.spec: the top
    // four rows were Rustboro's border for four frames).
    describe("rows the ROM has still to draw are cut (ringRows)", () => {
      const tall: Band = { left: 0, top: 104, right: 16, bottom: 232 };
      const mid = { w: 60, h: 60 };
      const bit = (dy: number) => 2 ** (dy + 4);
      const rows = (...dys: number[]) => dys.reduce((m, dy) => m + bit(dy), 0);
      const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
      it('none stale: nothing cut', () => {
        expect(ringRows(at(20, 20), 0)).toEqual({ top: -Infinity, bottom: Infinity });
        expect(bandClip(at(20, 20), mid, tall, 0)).toEqual(none);
      });
      it('after a whole-map draw, the band is pret\'s sixteen rows: the sprite window above the LCD, 56 rows below', () => {
        const wholeMap = rows(...range(-4, -1), ...range(16, 27));
        expect(bandClip(at(20, 20), mid, tall, wholeMap)).toEqual({ ...none, top: 64, bottom: 176 });
        // ...and as they are drawn, nearest first, the cuts shrink a row at a time.
        expect(bandClip(at(20, 20), mid, tall, rows(-4, -3, -2, ...range(17, 27)))).toEqual({ ...none, top: 48, bottom: 160 });
        expect(bandClip(at(20, 20), mid, tall, rows(-4, 26, 27)), 'the last two').toEqual({ ...none, top: 16, bottom: 16 });
        expect(bandClip(at(20, 20), mid, tall, rows(27)), 'the far row is past the band').toEqual(none);
      });
      it("over a connection going up: the new top row is fresh, the three under it the last map's border, so all four are cut", () => {
        const crossedUp = rows(...range(-3, -1), ...range(15, 26));
        // Two pixels into the step: the picture's top is map row 158, ring row -1 ends at
        // 208; its bottom is 654, ring row 15 starts at 448.
        expect(bandClip(at(20, 20, 0, -2), mid, tall, crossedUp)).toEqual({ ...none, top: 50, bottom: 206 });
      });
      it("mid-step down the far row waits in the slot the band's top shows: that is not a row the band shows at the bottom", () => {
        expect([2, 4, 8, 14].map((sub) => bandClip(at(20, 20, 0, sub), mid, tall, rows(27)))).toEqual(Array(4).fill(none));
      });
      it("never pret's rows, so never the LCD: the nearest stale rows leave the sprite window above it and 40 rows below", () => {
        const cut = bandClip(at(20, 20), mid, tall, rows(-1, 15));
        expect(cut).toEqual({ ...none, top: 64, bottom: 192 });
        expect(tall.top - cut.top, 'rows left above the LCD').toBe(40);
        expect(tall.bottom - cut.bottom, 'and below').toBe(40);
      });
    });

    it("the top edge keeps HEAD_ROOM rows: the heads of the map's first row", () => {
      expect(HEAD_ROOM).toBe(16);
      expect(bandClip(at(10, 6), map, LEGACY_BAND).top).toBe(0);
      // Row 5: the band runs from map row -32 to 8; -32..-16 go, -16..8 stay.
      expect(bandClip(at(10, 5), map, LEGACY_BAND).top).toBe(16);
      expect(bandClip(at(10, 0), map, LEGACY_BAND).top).toBe(LEGACY_BAND.top);
    });

    it("a band left of the LCD is past the ring's columns, which start at the LCD's left: cut on any map", () => {
      const wide: Band = { left: 16, top: 40, right: 16, bottom: 56 };
      expect(bandClip(at(7, 10), map, wide).left, 'past the map edge too').toBe(16);
      expect(bandClip(at(8, 10), map, wide).left, "past the ring's first column").toBe(16);
      expect(bandClip(at(8, 10), map, wide).right, "and the right edge is the ring's last column").toBe(0);
    });

    // The ring is 16 metatile columns, 256 pixels, and the band 256 wide: mid-step the
    // picture straddles 17, and the 17th is another column's slot (Cam's play-test's
    // sliver at the picture's right, walking either way; picture.spec's Rustboro walk).
    describe("mid-step sideways, the band's right columns past the ring's are cut (ringColumns)", () => {
      const mid = { w: 60, h: 60 };
      it('at rest the picture is the ring, exactly', () => {
        expect(ringColumns(at(20, 20))).toEqual({ left: 20 * 16 - 112, right: 20 * 16 + 144 });
        expect(bandClip(at(20, 20), mid, LEGACY_BAND)).toEqual(none);
      });
      it("a step right: the far column waits for the landing, so the ring is pos.x-1..pos.x+14 and the band's last subX columns are past it", () => {
        expect(ringColumns(at(20, 20, 4, 0))).toEqual({ left: 19 * 16 - 112, right: 19 * 16 + 144 });
        expect([2, 4, 8, 12, 14].map((sub) => bandClip(at(20, 20, sub, 0), mid, LEGACY_BAND).right)).toEqual([2, 4, 8, 12, 14]);
      });
      it("a step left: the new column is drawn into the slot the band's right edge shows, the last 16 + subX columns", () => {
        expect(ringColumns(at(20, 20, -4, 0))).toEqual({ left: 20 * 16 - 112, right: 20 * 16 + 144 });
        expect([-2, -4, -8, -12, -14].map((sub) => bandClip(at(20, 20, sub, 0), mid, LEGACY_BAND).right)).toEqual([14, 12, 8, 4, 2]);
      });
      it("the ROM's tall band the same, never the LCD, and up and down nothing: the 512-row ring holds all 496 rows mid-step", () => {
        const tall: Band = { left: 0, top: 104, right: 16, bottom: 232 };
        expect(bandClip(at(20, 20, -2, 0), mid, tall)).toEqual({ ...none, right: 14 });
        expect([4, 8, 12, -4, -8, -12].map((sub) => bandClip(at(20, 20, 0, sub), mid, tall))).toEqual(Array(6).fill(none));
      });
      it('on a map the page does not know, the ring is cut all the same, and no edge', () => {
        expect(bandClip(at(2, 2, 4, 0), null, LEGACY_BAND)).toEqual({ ...none, right: 4 });
        expect(bandClip(at(2, 2), null, LEGACY_BAND)).toEqual(none);
      });
      it("the ring's geometry is the ROM's (include/br/br_field.h)", () => {
        expect(RING_ABOVE).toBe(define('BR_RING_ABOVE'));
        expect(RING_ROWS).toBe(define('BR_RING_TILE_ROWS') / 2);
        expect(fieldSource, 'the page reads the stale rows by their gBr name').toMatch(/EWRAM_DATA u32 gBrRingStale\b/);
      });
      it("near the right edge, the larger of the two cuts", () => {
        // Row 10 of a 20-wide map at column 12: 16 past the edge at rest; half a step on, 8.
        expect(bandClip(at(12, 10, 8, 0), map, LEGACY_BAND).right).toBe(8);
        expect(bandClip(at(11, 10, 4, 0), map, LEGACY_BAND).right, 'the edge cuts nothing, the ring 4').toBe(4);
      });
    });

    // 2026-10-07 play-test: "in certain areas the water animation isn't present" -- the
    // still under the band, past an edge the ROM draws right itself.
    it('runs past an edge with nothing joined to it: the ROM draws the border, animated', () => {
      const sea = { w: 30, h: 20, seams: [{ dir: 'north' as const }] };
      expect(bandClip(at(10, 19), sea, LEGACY_BAND).bottom, 'no neighbour south').toBe(0);
      expect(bandClip(at(10, 19), { w: 30, h: 20 }, LEGACY_BAND).bottom, 'a bare size cuts as it did').toBe(LEGACY_BAND.bottom);
      expect(bandClip(at(10, 0), sea, LEGACY_BAND).top, 'a neighbour north: cut past the head room').toBe(LEGACY_BAND.top);
      expect(edgeReach(sea, 'south')).toBe(Infinity);
      expect(edgeReach(sea, 'north')).toBe(0);
    });

    it("runs MAP_OFFSET cells into a neighbour that shares the tilesets, the ROM's own copy of it", () => {
      const tall: Band = { left: 0, top: 104, right: 16, bottom: 232 };
      const joined = { w: 30, h: 20, seams: [{ dir: 'south' as const, same: true }, { dir: 'north' as const, same: true }] };
      // The band's last row at y 19: 19*16 - 72 + 160 + 232 = 624, the edge 320, 7 cells 112.
      expect(bandClip(at(10, 19), joined, tall).bottom).toBe(624 - 320 - 112);
      expect(bandClip(at(10, 13), joined, tall).bottom, 'within the seven: nothing').toBe(Math.max(0, 13 * 16 - 72 + 160 + 232 - 320 - 112));
      // At the top: 104 rows above a picture whose top is map row -72: 176 past, 112 kept.
      expect(bandClip(at(10, 0), joined, tall).top).toBe(176 - 112);
      const mixed = { w: 30, h: 20, seams: [{ dir: 'south' as const, same: true }, { dir: 'south' as const }] };
      expect(edgeReach(mixed, 'south'), 'one neighbour drawn wrong cuts the side').toBe(0);
    });

    it('never cuts into the LCD, however small the map', () => {
      const tall: Band = { left: 8, top: 104, right: 16, bottom: 232 };
      expect(bandClip(at(2, 2), { w: 5, h: 5 }, tall)).toEqual(tall);
      expect(bandClip(at(2, 2), { w: 5, h: 5 }, LEGACY_BAND)).toEqual(LEGACY_BAND);
    });

    it('FieldView puts it and the off-field cut in one clip-path, set only when it changes', () => {
      // Verdanturf, south of Route 116, is drawn with other tilesets: cut at the edge.
      const route = HOENN.byId.get('MAP_ROUTE116')!;
      expect({ h: route.h, south: route.seams.filter((s) => s.dir === 'south').map((s) => s.same ?? false) }).toEqual({ h: 20, south: [false] });
      const sets: string[] = [];
      let clipPath = '';
      const style = {} as { clipPath: string };
      Object.defineProperty(style, 'clipPath', {
        get: () => clipPath,
        set: (v: string) => {
          clipPath = v;
          sets.push(v);
        },
      });
      const lcd = { width: 256, height: 256, style };
      const view = new FieldView({ emu: { viewport: LEGACY_BAND }, lcd } as unknown as FieldDeps);
      const inner = view as unknown as { band: Band | null; lay: { scale: number }; clip(onField: boolean, cam: Camera | null): void };
      inner.band = { ...LEGACY_BAND };
      inner.lay = { ...inner.lay, scale: 2 };
      const cam = (y: number, where: { group: number; num: number } = route) => ({ group: where.group, num: where.num, x: 10, y, subX: 0, subY: 0 }) as Camera;

      inner.clip(true, cam(8));
      inner.clip(true, cam(9));
      expect(sets, 'mid-map: no clip, set once').toEqual(['']);
      inner.clip(true, cam(13));
      expect(clipPath, 'the 32 rows past the last row, at the scale').toBe('inset(0px 0px 64px 0px)');
      inner.clip(true, cam(13));
      expect(sets.length, 'the same cut is not set again').toBe(2);
      inner.clip(false, cam(13));
      expect(clipPath, 'off the field, the whole band').toBe('inset(80px 32px 112px 0px)');
      inner.clip(true, cam(13, { group: 99, num: 99 }));
      expect(clipPath, 'a map the page does not know: nothing cut').toBe('');
      inner.clip(true, null);
      expect(sets.length, 'no camera yet: nothing cut, and nothing set again').toBe(4);
    });
  });

  it('the core\'s canvas is placed so the LCD lands where the layout put it', () => {
    const lay = layoutField(390, 844, 0);
    const pic = pictureBox(lay, LEGACY_BAND);
    expect(pic).toEqual({ left: lay.lcdCol - LEGACY_BAND.left, top: lay.lcdRow - LEGACY_BAND.top, width: 256, height: 256 });
    expect(pictureBox(lay, null), 'no band: the canvas is the LCD').toEqual({ left: lay.lcdCol, top: lay.lcdRow, width: 240, height: 160 });
  });

  it('a tap or a spec finds the LCD inside the bigger canvas on screen', () => {
    const picture = { left: 10, top: 20, width: 512, height: 512 };
    expect(lcdRect(picture, LEGACY_BAND)).toEqual({ left: 10, top: 20 + 80, width: 480, height: 320 });
    expect(lcdRect(picture, null)).toBe(picture);
  });
});

describe('where the picture sits on the map', () => {
  // The numbers are tools/br/drivers/field-scroll.txt's, matched against the Littleroot
  // render: at rest at pos (5,9) the picture's top-left was map pixel (-32, 72).
  it('at rest, the pos tile is 112 in and 72 down from the picture', () => {
    expect(lcdOrigin({ x: 5, y: 9, subX: 0, subY: 0 })).toEqual({ left: -32, top: 72 });
    expect(lcdOrigin({ x: 7, y: 11, subX: 0, subY: 0 })).toEqual({ left: 0, top: 104 });
  });

  // field-scroll-trace.txt: the tile advances on the step's first frame, and the shots
  // at pos 7 and 8 with the camera at 6 matched at -10 and 6.
  it('mid-step, the tile has already moved and the offset walks it back', () => {
    expect(lcdOrigin({ x: 7, y: 9, subX: 6, subY: 0 }).left).toBe(-10);
    expect(lcdOrigin({ x: 8, y: 9, subX: 6, subY: 0 }).left).toBe(6);
    expect(subTile(4)).toBe(-12);
    expect(subTile(12)).toBe(-4);
    expect(subTile(0)).toBe(0);
    expect(subTile(-4), 'walking left or up, the offset is negative').toBe(12);
  });
});

describe('the fade', () => {
  // tools/br/drivers/fade-trace.txt: 0x8080/0x8000 two frames into a fade to black
  // (y 2, target 16, black, active), 0x0400/0x8000 as the fade-in starts.
  it('reads y, the blend colour and active off the packed words', () => {
    expect(fadeOf(0x8080, 0x8000)).toEqual({ y: 2, color: 0, active: true });
    expect(fadeOf(0x0400, 0x8000)).toEqual({ y: 16, color: 0, active: true });
    expect(fadeOf(0, 0xffff)).toEqual({ y: 0, color: 0x7fff, active: true });
    expect(fadeOf(0x8400, 0x0000), 'faded and finished').toEqual({ y: 16, color: 0, active: false });
  });

  it('holds black across a map load until the fade-in starts', () => {
    const cam = (fade: number, fadeActive: boolean): Camera =>
      ({ group: 0, num: 0, x: 0, y: 0, subX: 0, subY: 0, fade, fadeColor: 0, fadeActive, sprites: [], fog: null, outside: false, ringTimer: 0, stale: 0, onField: true });
    expect(heldFade(cam(16, false), cam(0, false), false), 'the reset').toBe(true);
    expect(heldFade(cam(0, false), cam(0, false), true), 'still loading').toBe(true);
    expect(heldFade(cam(0, false), cam(16, true), true), 'the fade-in begins').toBe(false);
    expect(heldFade(cam(14, true), cam(12, true), false), 'an ordinary fade').toBe(false);
    expect(heldFade(null, cam(0, false), false), 'the first frame').toBe(false);
  });

  // POK-327's play spec, in the frames it saw after a Safari catch: the ball's palette
  // fading to white (OBJ palette 6), its last steps with the mask cleared, then done at
  // 16 -- where the map went white for up to a second.
  it("keeps the map out of a fade that never reached it, running or done", () => {
    const white = (y: number, active: boolean) => ({ y, color: 0x7fff, active });
    let s = mapFade(white(12, true), 0x400000, true);
    expect(s).toEqual({ fade: { y: 0, color: 0x7fff, active: false }, bg: false });
    s = mapFade(white(16, true), 0, s.bg);
    expect(s.fade.y, 'its last steps').toBe(0);
    s = mapFade(white(16, false), 0, s.bg);
    expect(s.fade.y, 'done').toBe(0);
    expect(s.bg).toBe(false);
    // A fade to black over everything: followed, and still followed once it is done.
    s = mapFade({ y: 8, color: 0, active: true }, 0xffffffff, s.bg);
    expect(s).toEqual({ fade: { y: 8, color: 0, active: true }, bg: true });
    s = mapFade({ y: 16, color: 0, active: false }, 0, s.bg);
    expect(s.fade).toEqual({ y: 16, color: 0, active: false });
  });

  // The end of a trainer battle on Route 102, gPaletteFade frame by frame (a driver: the
  // first move, then A): the battle's fast fade to black (mode 1, submode 3, the mask
  // left at 0 and the colour at the white of the move's flash), its finish, the reset,
  // and the field's fade-in from black. [frame, y, colour, active, mask, the u16 at 8].
  it('follows a fast fade over every palette, and holds the black a battle ends on until the field fades in', () => {
    const trace: [number, number, number, number, number, number][] = [
      [1056, 25, 0x7fff, 1, 0, 0x0143],
      [1063, 17, 0x7fff, 1, 0, 0x0143],
      [1077, 3, 0x7fff, 1, 0, 0x0143],
      [1079, 1, 0x7fff, 1, 0, 0x0143],
      [1081, 0, 0x7fff, 1, 0, 0x0043],
      [1086, 0, 0x7fff, 0, 0, 0x0043],
      [1092, 0, 0, 0, 0, 0],
      [1097, 16, 0, 1, 0xffffffff, 0x0040],
      [1104, 10, 0, 1, 0xffffffff, 0x0040],
      [1114, 0, 0, 1, 0xffffffff, 0x0040],
      [1116, 0, 0, 1, 0, 0x0040],
      [1121, 0, 0, 0, 0, 0x0040],
    ];
    const cam = (fade: { y: number; color: number; active: boolean }): Camera =>
      ({ group: 0, num: 17, x: 33, y: 15, subX: 0, subY: 0, fade: fade.y, fadeColor: fade.color, fadeActive: fade.active, sprites: [], fog: null, outside: false, ringTimer: 0, stale: 0, onField: true });
    let bg = true; // the move's flash reached BG palettes 1..3 (mask 0xe)
    let prev: Camera | null = null;
    let hold = { on: false, frames: 0 };
    const seen: Record<number, [number, number]> = {};
    for (const [frame, y, color, active, mask, mode] of trace) {
      const s = mapFade({ y, color, active: active === 1 }, mask, bg, mode);
      bg = s.bg;
      const cur = cam(s.fade);
      hold = holdFade(prev, cur, hold);
      seen[frame] = [cur.fade, cur.fadeColor];
      prev = cur;
    }
    // Black, a sixteenth a step, whatever the stale colour and mask say...
    expect(seen[1056]).toEqual([4, 0]);
    expect(seen[1063]).toEqual([8, 0]);
    expect(seen[1077]).toEqual([15, 0]);
    expect(seen[1079], 'the last step: every channel is 0').toEqual([16, 0]);
    // ...held black through the finish and the reset, not the white the struct names...
    expect(seen[1081]).toEqual([16, 0]);
    expect(seen[1086]).toEqual([16, 0]);
    expect(seen[1092]).toEqual([16, 0]);
    // ...and then the field's own fade-in, to the map.
    expect(seen[1097]).toEqual([16, 0]);
    expect(seen[1104]).toEqual([10, 0]);
    expect(seen[1116][0]).toBe(0);
    expect(seen[1121][0]).toBe(0);
    // A fast fade in from white is white, going.
    expect(mapFade({ y: 31, color: 0, active: true }, 0, false, (FAST_FADE << 8) | 0).fade).toEqual({ y: 15, color: 0x7fff, active: true });
    expect(mapFade({ y: 1, color: 0, active: true }, 0, false, (FAST_FADE << 8) | 0).fade.y).toBe(0);
  });

  // Firefox's play spec, the end of a Safari catch (frames 1268..1300): the ball fades its
  // OBJ palette to white, and the battle's fast fade to black begins inside that fade's
  // four finishing frames -- which end it before its first step (palette.c). The mode
  // stays fast, y stays 31, and nothing on the picture moved.
  it('leaves the map as it was under a fast fade that was ended before it began', () => {
    const trace: [number, number, number, number, number, number][] = [
      [1268, 2, 0x7fff, 1, 0xffff0000, 0],
      [1282, 16, 0x7fff, 1, 0xffff0000, 0],
      [1284, 16, 0x7fff, 1, 0, 0],
      [1286, 31, 0x7fff, 1, 0, 0x0143],
      [1288, 31, 0x7fff, 0, 0, 0x0143],
      [1292, 31, 0x7fff, 0, 0, 0x0143],
      [1294, 0, 0, 0, 0, 0x0143],
      [1298, 0, 0, 0, 0, 0x0143],
      [1300, 16, 0, 1, 0xffffffff, 0x0003],
    ];
    const cam = (fade: { y: number; color: number; active: boolean }): Camera =>
      ({ group: 26, num: 13, x: 20, y: 20, subX: 0, subY: 0, fade: fade.y, fadeColor: fade.color, fadeActive: fade.active, sprites: [], fog: null, outside: false, ringTimer: 0, stale: 0, onField: false });
    let bg = true;
    let prev: Camera | null = null;
    let hold = { on: false, frames: 0 };
    const seen: Record<number, number> = {};
    for (const [frame, y, color, active, mask, mode] of trace) {
      const s = mapFade({ y, color, active: active === 1 }, mask, bg, mode);
      bg = s.bg;
      const cur = cam(s.fade);
      hold = holdFade(prev, cur, hold);
      seen[frame] = cur.fade;
      prev = cur;
    }
    expect(seen[1282], 'the ball is an OBJ fade: the map stays lit').toBe(0);
    expect(seen[1286], 'the fast fade as it starts, a sixteenth').toBe(1);
    // Not the white of y 31 in the struct's colour, and nothing held from it.
    for (const frame of [1288, 1292, 1294, 1298]) expect(seen[frame], `frame ${frame}`).toBe(0);
    expect(seen[1300], 'the next real fade').toBe(16);
    // A fast fade IN ended before it began is its colour: Begin filled the palettes.
    expect(mapFade({ y: 31, color: 0x7fff, active: false }, 0, false, (FAST_FADE << 8) | 2).fade).toEqual({ y: 16, color: 0, active: false });
  });

  // An object facing east is its west frame with the animation's flip, which the sprite
  // code puts in the OAM (SetSpriteOamFlipBits) and never in Sprite.hFlip: read from
  // Sprite.hFlip, the ROM's people past the picture faced west whenever they faced east.
  it("reads a ROM sprite's flip where the hardware does, from its OAM", () => {
    const x = 120;
    expect(oamFlipped(0, SPR_OAM_HFLIP | x), 'facing east').toBe(true);
    expect(oamFlipped(0, x), 'facing west').toBe(false);
    // An affine sprite's matrixNum is a matrix: no flips there.
    expect(oamFlipped(1, SPR_OAM_HFLIP | x)).toBe(false);
    expect(oamFlipped(3, SPR_OAM_HFLIP | x)).toBe(false);
    // ST_OAM_AFFINE_ERASE only hides it; the bits are still flips.
    expect(oamFlipped(2, SPR_OAM_HFLIP | x)).toBe(true);
  });

  it('shows a GBA colour the way mGBA does', () => {
    expect(gbaColor(0)).toBe('rgb(0,0,0)');
    expect(gbaColor(0x7fff)).toBe('rgb(255,255,255)');
    expect(gbaColor(31)).toBe('rgb(255,0,0)');
  });
});

describe('the picture in the box', () => {
  it('a phone: the picture spans the width, the map above and below', () => {
    const lay = layoutField(390, 844, 0);
    expect(lay.scale).toBeCloseTo(1.625);
    expect(lay.cols).toBe(240);
    expect(lay.rows).toBe(Math.ceil(844 / 1.625));
    expect(lay.lcdCol).toBe(0);
    expect(lay.lcdRow, 'centred').toBe(Math.round((844 / 1.625 - 160) / 2));
  });

  it('a floating pad lifts the picture into the space above it', () => {
    const flat = layoutField(390, 844, 0);
    const lifted = layoutField(390, 844, 220);
    expect(lifted.scale).toBe(flat.scale);
    expect(lifted.lcdRow).toBeLessThan(flat.lcdRow);
    expect(lifted.lcdRow).toBe(Math.round(((844 - 220) / 1.625 - 160) / 2));
    expect(lifted.rows, 'the map still runs under the pad').toBe(flat.rows);
  });

  it('a wide window: the picture takes the height, the map either side', () => {
    const lay = layoutField(1440, 800, 0);
    expect(lay.scale).toBe(5);
    expect(lay.rows).toBe(160);
    expect(lay.lcdRow).toBe(0);
    expect(lay.cols).toBe(288);
    expect(lay.lcdCol).toBe(24);
  });

  it('a 3:2 box is the picture and nothing else', () => {
    expect(layoutField(480, 320)).toEqual({ scale: 2, cols: 240, rows: 160, lcdCol: 0, lcdRow: 0 });
  });

  it('a pad taller than the box leaves cannot push the picture off the top', () => {
    const lay = layoutField(390, 400, 380);
    expect(lay.lcdRow).toBeGreaterThanOrEqual(0);
    expect(lay.lcdRow + 160).toBeLessThanOrEqual(lay.rows);
  });

  it('no box, no layout', () => {
    expect(layoutField(0, 0).scale).toBe(0);
  });

  // Why the ROM's view is 104 above and 232 below (include/br/br_field.h): what a portrait
  // phone shows past the picture with the pad floating over the bottom (~200 CSS px).
  describe("the ROM's view covers a portrait phone (POK-329)", () => {
    const VIEW = { top: 104, bottom: 232 };
    const needs = (w: number, h: number, pad: number) => {
      const lay = layoutField(w, h, pad);
      return { top: lay.lcdRow, bottom: lay.rows - lay.lcdRow - 160, lay };
    };
    it("the installed app (390x763) and Safari (390x664): every row past the picture is the core's", () => {
      for (const [w, h] of [[390, 763], [390, 664]]) {
        const n = needs(w, h, 200);
        expect(n.top, `${w}x${h} above`).toBeLessThanOrEqual(VIEW.top);
        expect(n.bottom, `${w}x${h} below`).toBeLessThanOrEqual(VIEW.bottom);
      }
      expect(needs(390, 763, 200)).toMatchObject({ top: 93, bottom: 217 });
      expect(needs(390, 664, 200)).toMatchObject({ top: 63, bottom: 186 });
    });
    it("Playwright's 390x844: the LCD at canvas row 118, 14 rows short above and 10 below, under the status bar and the home bar", () => {
      const n = needs(390, 844, 200);
      expect(n.lay).toMatchObject({ scale: 1.625, rows: 520, lcdRow: 118 });
      expect({ top: n.top - VIEW.top, bottom: n.bottom - VIEW.bottom }).toEqual({ top: 14, bottom: 10 });
      // ...and the core's picture, placed by the layout, starts on the canvas, not above it.
      expect(pictureBox(n.lay, { left: 0, top: VIEW.top, right: 16, bottom: VIEW.bottom })).toEqual({ left: 0, top: 14, width: 256, height: 496 });
    });
  });

  // POK-329: the core draws, and the page uploads, every row it is asked for, every frame.
  describe('the page asks for the rows its layout shows, inside what the ROM declares (askBand)', () => {
    const ROM = { band: { left: 0, top: 104, right: 16, bottom: 232 }, sprites: { top: 40, bottom: 56 } };
    const rows = (b: Band) => ({ top: b.top, bottom: b.bottom });
    it('a desktop: the picture takes the height, so the band is the sprite window', () => {
      expect(askBand(layoutField(1280, 720, 0), ROM)).toEqual({ left: 0, top: 40, right: 16, bottom: 56 });
      // ...and beside the docked sheet (1280 less its 480), 28 rows each way, still inside it.
      expect(rows(askBand(layoutField(800, 720, 0), ROM))).toEqual({ top: 40, bottom: 56 });
      expect(rows(askBand(layoutField(1440, 800, 0), ROM))).toEqual({ top: 40, bottom: 56 });
    });
    it("a portrait phone with the pad over the bottom: all the ROM has, and Safari's shorter glass less", () => {
      expect(askBand(layoutField(390, 844, 200), ROM), 'short 14 and 10: capped at the ROM').toEqual(ROM.band);
      expect(rows(askBand(layoutField(390, 763, 200), ROM)), 'the installed app, 93 and 217, in eights').toEqual({ top: 96, bottom: 224 });
      expect(rows(askBand(layoutField(390, 664, 200), ROM)), 'Safari, 63 and 186').toEqual({ top: 64, bottom: 192 });
    });
    it('a half-screen desktop window beside its sheet: what it shows, in eights', () => {
      // 683x768 less the 240 dock: 443x768 at 1.846, 417 rows, the LCD at 128 and 129 under it.
      expect(rows(askBand(layoutField(443, 768, 0), ROM))).toEqual({ top: 104, bottom: 136 });
    });
    it('never below the sprite window, never past the ROM, the sides the ROM has', () => {
      expect(askBand(layoutField(480, 320, 0), ROM), 'a box the picture fills').toEqual({ left: 0, top: 40, right: 16, bottom: 56 });
      expect(askBand(layoutField(200, 2000, 0), ROM), 'a tower').toEqual(ROM.band);
      const legacy = { band: LEGACY_BAND, sprites: LEGACY_SPRITE_BAND };
      expect(askBand(layoutField(390, 844, 200), legacy), 'a ROM before gBrFieldView: its ring, whatever the glass').toEqual(LEGACY_BAND);
      const sides = { band: { left: 8, top: 104, right: 24, bottom: 232 }, sprites: ROM.sprites };
      expect(askBand(layoutField(390, 844, 200), sides)).toMatchObject({ left: 8, right: 24 });
    });
    it("a box with no size says nothing: the ROM's whole band, as before", () => {
      expect(askBand(layoutField(0, 0), ROM)).toEqual(ROM.band);
      const got = askBand(layoutField(0, 0), ROM);
      got.top = 0;
      expect(ROM.band.top, 'a copy').toBe(104);
    });
  });

  it('FieldView lays out again after a boot, even at the same buffer size: PLAY AGAIN asks for its band again', () => {
    const emu = { viewport: { left: 0, top: 64, right: 16, bottom: 192 } as Band, boots: 1 };
    const style = {} as Record<string, string>;
    const lcd = { width: 256, height: 416, style };
    const field = { width: 0, height: 0, style: {} };
    const view = new FieldView({ emu, box: { clientWidth: 390, clientHeight: 664 }, lcd, field, symbols: null } as unknown as FieldDeps);
    const inner = view as unknown as { frame(): void };
    const lay = layoutField(390, 664, 0);
    inner.frame();
    expect(style.top).toBe(`${(lay.lcdRow - 64) * lay.scale}px`);
    // The next boot's band is the same 416 rows, split another way.
    emu.viewport = { left: 0, top: 72, right: 16, bottom: 184 };
    emu.boots = 2;
    inner.frame();
    expect(style.top, "the LCD where the new band puts it").toBe(`${(lay.lcdRow - 72) * lay.scale}px`);
  });
});

describe('a field canvas in error state', () => {
  it("throws, reallocates its store, and draws whole again (Firefox's \"Canvas is already in error state\")", () => {
    const emu = { viewport: null, boots: 1 };
    const lcd = { width: 240, height: 160, style: {} };
    const widths: number[] = [];
    let w = 0;
    const field = {
      get width() { return w; },
      set width(v: number) { w = v; widths.push(v); },
      height: 0, style: {},
      getContext: () => { throw new DOMException('Canvas is already in error state.', 'InvalidStateError'); },
    };
    const view = new FieldView({ emu, box: { clientWidth: 390, clientHeight: 664 }, lcd, field, symbols: null } as unknown as FieldDeps);
    const inner = view as unknown as { lay: { cols: number }; draw(c: unknown): void };
    view.layout();
    expect(inner.lay.cols).toBeGreaterThan(0);
    inner.draw({ group: 0, num: 0, x: 0, y: 0, subX: 0, subY: 0, fade: 0, fadeColor: 0, sprites: [], onField: true });
    expect(widths.slice(-2), 'emptied, then its size again').toEqual([0, inner.lay.cols]);
  });
});

describe('which frame a sprite is on', () => {
  // A ROM of 64 bytes at 0x08000000: anims table at +0x10 (two anims), the second
  // anim's commands at +0x20: FRAME(3, 8), FRAME(0, 8), JUMP(0).
  const rom = new Uint8Array(64);
  const w32 = (o: number, v: number) => { rom[o] = v & 255; rom[o + 1] = (v >>> 8) & 255; rom[o + 2] = (v >>> 16) & 255; rom[o + 3] = (v >>> 24) & 255; };
  w32(0x10, 0x08000030);
  w32(0x14, 0x08000020);
  w32(0x20, (8 << 16) | 3);
  w32(0x24, (8 << 16) | 0);
  w32(0x28, 0xfffe);
  w32(0x30, (16 << 16) | 1);

  it('reads anims[animNum][cmd].imageValue off the ROM', () => {
    expect(frameOf(rom, 0x08000010, 1, 0)).toBe(3);
    expect(frameOf(rom, 0x08000010, 1, 1)).toBe(0);
    expect(frameOf(rom, 0x08000010, 0, 0)).toBe(1);
  });

  it('a jump is not a frame, and nothing past the ROM is', () => {
    expect(frameOf(rom, 0x08000010, 1, 2)).toBeNull();
    expect(frameOf(rom, 0x08000010, 5, 0)).toBeNull();
    expect(frameOf(rom, 0x02000000, 0, 0)).toBeNull();
  });
});

describe('the fog and the shake', () => {
  it('the fog tiles start at the scroll position, rows on the camera, modulo 64', () => {
    expect(fogOrigin(0, 0)).toEqual({ x: 0, y: 0 });
    expect(fogOrigin(200, -40)).toEqual({ x: 8, y: (256 - 40) % 64 });
    expect(fogOrigin(64, 64)).toEqual({ x: 0, y: 0 });
  });

  it('a shake goes side to side and dies out to nothing', () => {
    expect(shakeOffset(0)).toEqual({ dx: 0, dy: 0 });
    const first = shakeOffset(SHAKE_FRAMES);
    const late = shakeOffset(2);
    expect(Math.abs(first.dx)).toBeGreaterThan(Math.abs(late.dx));
    expect(Math.sign(shakeOffset(SHAKE_FRAMES).dx)).not.toBe(Math.sign(shakeOffset(SHAKE_FRAMES - 2).dx));
    for (let n = 1; n <= SHAKE_FRAMES; n++) expect(Math.abs(shakeOffset(n).dx)).toBeLessThanOrEqual(3);
  });
});

describe('the maps next door', () => {
  const map = (id: string, w: number, h: number, seams: WorldMap['seams'] = []): WorldMap =>
    ({ id, group: 0, num: 0, w, h, section: '', outdoor: true, grid: '', seams, warps: [], centre: null }) as unknown as WorldMap;

  it('sit along the edge the seam names, shifted by its offset', () => {
    const north = map('N', 30, 20);
    const east = map('E', 10, 60);
    const here = map('H', 20, 20, [
      { dir: 'north', to: 'N', offset: -4 },
      { dir: 'east', to: 'E', offset: 3 },
      { dir: 'south', to: 'missing', offset: 0 },
    ]);
    const byId = new Map([['N', north], ['E', east], ['H', here]]);
    expect(neighbours(here, byId)).toEqual([
      { map: north, x: -64, y: -320 },
      { map: east, x: 320, y: 48 },
    ]);
  });
});

describe('the PNGs past the picture (POK-330 #65)', () => {
  class FakeImage {
    src = '';
    complete = false;
    naturalWidth = 0;
    private heard: Record<string, Array<() => void>> = { load: [], error: [] };
    addEventListener(type: 'load' | 'error', listener: () => void): void {
      this.heard[type].push(listener);
    }
    fire(type: 'load' | 'error'): void {
      this.complete = true;
      if (type === 'load') this.naturalWidth = 64;
      for (const l of this.heard[type]) l();
    }
  }

  it('a failed image settles instead of being waited on every frame, and is asked for again on request', () => {
    const made: FakeImage[] = [];
    let loads = 0;
    const images = new FieldImages(() => {
      const img = new FakeImage();
      made.push(img);
      return img;
    }, () => void loads++);

    expect(images.get('field-maps/A', '/field-maps/A.png')).toBeNull();
    expect(made[0].src).toBe('/field-maps/A.png');
    expect(images.settled).toBe(false); // on its way: the picture keeps redrawing for it

    made[0].fire('error');
    expect(images.settled).toBe(true); // nothing to wait for: the picture can rest
    expect(images.get('field-maps/A', '/field-maps/A.png')).toBeNull();
    expect(made).toHaveLength(1); // and it is not asked for again every frame

    images.retry(); // the map changed
    expect(images.get('field-maps/A', '/field-maps/A.png')).toBeNull();
    expect(made).toHaveLength(2);
    made[1].fire('load');
    expect(loads).toBe(1);
    expect(images.get('field-maps/A', '/field-maps/A.png')).toBe(made[1]);
    expect(images.settled).toBe(true);
  });
});

describe('the people the ROM let go of reach the overlay (POK-318)', () => {
  // A RAM with a save block, the object table and the seats, read the way FieldView reads
  // a frame. We stand at (20, 20); a trainer twelve rows down, a second inside the box
  // with no object (the ROM's to leave out), a third with its object live, and seat 1's
  // ghost thirteen rows down.
  const SB = 0x02000000;
  const SB1 = 0x02010000;
  const CAM = 0x02000100;
  const OBJS = 0x02000200;
  const SEATS = 0x02001000;
  const MAIN = 0x02000800;
  /** CB2_Overworld, a Thumb function: gMain.callback2 holds it with the low bit set. */
  const CB2_OVERWORLD = 0x080862fc;
  function frame(map: WorldMap): Camera | null {
    return ram(map).read();
  }
  /** The RAM below, and a FieldView reading it. `onField` flips gMain.callback2. */
  function ram(map: WorldMap) {
    const mem = new Uint8Array(0x20000);
    const at = (a: number) => a - 0x02000000;
    const emu = {
      read: (a: number, width: 8 | 16 | 32 = 32) => {
        let v = 0;
        for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | mem[at(a) + i];
        return v >>> 0;
      },
      bytes: (a: number, len: number) => mem.subarray(at(a), at(a) + len),
    };
    const w = (a: number, v: number, width: 8 | 16 | 32) => { for (let i = 0; i < width / 8; i++) mem[at(a) + i] = (v >>> (8 * i)) & 0xff; };
    w(MAIN + 4, CB2_OVERWORLD | 1, 32);
    w(SB, SB1, 32);
    w(SB1 + SB1_POS_X, 20, 16);
    w(SB1 + SB1_POS_Y, 20, 16);
    w(SB1 + SB1_MAP_GROUP, map.group, 8);
    w(SB1 + SB1_MAP_NUM, map.num, 8);
    const template = (i: number, localId: number, y: number) => {
      const t = SB1 + SB1_TEMPLATES + i * TEMPLATE_SIZE;
      w(t + TPL_LOCAL_ID, localId, 8);
      w(t + TPL_GFX, 7, 8);
      w(t + TPL_X, 20, 16);
      w(t + TPL_Y, y, 16);
      w(t + TPL_MOVEMENT_TYPE, 1, 8);
    };
    template(0, 1, 32);
    template(1, 2, 25);
    template(2, 3, 33);
    w(OBJS, 1, 8); // active
    w(OBJS + OBJ_LOCAL_ID, 3, 8);
    w(OBJS + OBJ_MAP_NUM, map.num, 8);
    w(OBJS + OBJ_MAP_GROUP, map.group, 8);
    const seat = SEATS + 1 * SEAT_SIZE;
    w(seat, 1, 8);
    w(seat + 2, map.group, 8);
    w(seat + 3, map.num, 8);
    w(seat + 4, 20 + 7, 16);
    w(seat + 6, 33 + 7, 16);
    w(seat + 8, 1, 8);
    const symbols = new Map([
      ['gSaveBlock1Ptr', SB], ['gFieldCamera', CAM], ['gObjectEvents', OBJS], ['gBrSeats', SEATS], ['gMain', MAIN], ['CB2_Overworld', CB2_OVERWORLD],
    ]);
    const view = new FieldView({ emu, symbols } as unknown as FieldDeps);
    const inner = view as unknown as { read(): Camera | null; walkers: GhostWalkers; prev: Camera | null };
    return {
      w,
      read: () => inner.read(),
      /** An emulator frame, as frame() runs one: the walkers step on the roster, then the RAM is read. */
      step: (rows: RosterEntry[]): Camera => {
        inner.walkers.update(rows);
        inner.prev = inner.read()!;
        return inner.prev;
      },
      peek: () => view.peek(),
      onField: (on: boolean) => w(MAIN + 4, on ? CB2_OVERWORLD | 1 : 0x08000001, 32),
    };
  }
  /** A roster row on `map`, at a live cell (MAP_OFFSET included). */
  const rowAt = (map: WorldMap, seat: number, x: number, y: number, over: Partial<RosterEntry> = {}): RosterEntry =>
    ({ seat, name: '', alive: true, isMe: false, map: { group: map.group, num: map.num }, x, y, dir: 1, skin: '0', ...over });

  it('outdoors, everybody past the box is on the camera, on the overlay, where the ROM would stand them', () => {
    const map = HOENN.maps.find((m) => m.outdoor)!;
    const cam = frame(map)!;
    expect(cam.sprites).toEqual([
      { gfx: 7, frame: 0, hFlip: false, x: 112, y: 56 + 12 * 16, hidden: true },
      { gfx: SKIN_GFX[0], frame: 0, hFlip: false, x: 112, y: 56 + 13 * 16, hidden: true, seat: 1 },
    ]);
  });

  it('indoors, nobody', () => {
    expect(frame(HOENN.maps.find((m) => !m.outdoor)!)!.sprites).toEqual([]);
  });

  // POK-323: the page walks the other seats off its own roster.
  it("a seat the page walks is its walker's past the box, and not gBrSeats' standing copy as well", () => {
    const map = HOENN.maps.find((m) => m.outdoor)!;
    // The roster has seat 1 a row further on than the ROM's copy does: only the walker's is drawn.
    const seats = ram(map).step([rowAt(map, 1, 20 + 7, 34 + 7)]).sprites.filter((s) => s.seat === 1);
    expect(seats).toEqual([{ gfx: SKIN_GFX[0], frame: 0, hFlip: false, x: 112, y: 56 + 14 * 16, hidden: true, seat: 1 }]);
  });

  it("peek keeps the ROM's objects apart from what the page drew, and names every seat it walks", () => {
    const map = HOENN.maps.find((m) => m.outdoor)!;
    const other = HOENN.maps.find((m) => m.outdoor && m.num !== map.num)!;
    const r = ram(map);
    // Seat 1 is only in gBrSeats, thirteen rows down; seat 2 is on the roster, on another map.
    r.step([rowAt(other, 2, 20 + 7, 20 + 7)]);
    const p = r.peek()!;
    // The ROM has an object for nobody: seat 1's standing copy is the page's drawing.
    expect(p.rom).toEqual([]);
    expect(p.drawn).toEqual([{ gfx: SKIN_GFX[0], frame: 0, hFlip: false, x: 112, y: 56 + 13 * 16, hidden: true, seat: 1 }]);
    expect(p.walkers, 'nobody walks this map').toEqual([]);
    expect(p.seats, 'the roster reached the walkers all the same').toEqual([2]);
  });

  it("on the field a walker inside the box, or one whose ghost the ROM still has an object for, is the ROM's", () => {
    const map = HOENN.maps.find((m) => m.outdoor)!;
    const r = ram(map);
    const obj = OBJS + 1 * 0x24;
    r.w(obj, 1, 8);
    r.w(obj + OBJ_LOCAL_ID, 0xc8 + 3, 8);
    r.w(obj + OBJ_MAP_NUM, map.num, 8);
    r.w(obj + OBJ_MAP_GROUP, map.group, 8);
    const cam = r.step([rowAt(map, 2, 22 + 7, 20 + 7), rowAt(map, 3, 24 + 7, 35 + 7), rowAt(map, 4, 26 + 7, 35 + 7)]);
    expect(cam.sprites.filter((s) => s.seat !== undefined && s.seat !== 1).map((s) => [s.seat, s.hidden])).toEqual([[4, true]]);
  });

  it('off the field the map\'s people stand where they stood and the ghosts walk on, all of them, under the picture', () => {
    const map = HOENN.maps.find((m) => m.outdoor)!;
    const r = ram(map);
    const far = rowAt(map, 1, 20 + 7, 33 + 7);
    const near = rowAt(map, 2, 22 + 7, 20 + 7);
    r.step([far, near]);
    // The battle: callback2 is somebody else's, and the tables the field was read from
    // are nobody's to read -- the template the field drew is gone from them.
    r.onField(false);
    r.w(SB1 + SB1_TEMPLATES + TPL_LOCAL_ID, 0, 8);
    const cam = r.step([far, near]);
    expect(cam.onField).toBe(false);
    expect(cam.sprites).toEqual([
      { gfx: 7, frame: 0, hFlip: false, x: 112, y: 56 + 12 * 16, hidden: false },
      { gfx: SKIN_GFX[0], frame: 0, hFlip: false, x: 112, y: 56 + 13 * 16, hidden: false, seat: 1 },
      { gfx: SKIN_GFX[0], frame: 0, hFlip: false, x: 144, y: 56, hidden: false, seat: 2 },
    ]);
    // A step east, in the middle of the fight.
    const walking = r.step([{ ...far, x: far.x! + 1, dir: 4 }, near]).sprites.find((s) => s.seat === 1);
    expect(walking).toMatchObject({ x: 113, frame: 7, hFlip: true });
    // A seat that goes out goes.
    expect(r.step([near]).sprites.some((s) => s.seat === 1)).toBe(false);
  });

  it('off the field on another map, or with nobody read on the field first, nobody stands still', () => {
    const map = HOENN.maps.find((m) => m.outdoor)!;
    const r = ram(map);
    r.onField(false);
    expect(r.step([]).sprites, 'never on the field').toEqual([]);
    r.onField(true);
    r.step([]);
    r.onField(false);
    const other = HOENN.maps.find((m) => m.outdoor && m.num !== map.num)!;
    r.w(SB1 + SB1_MAP_GROUP, other.group, 8);
    r.w(SB1 + SB1_MAP_NUM, other.num, 8);
    expect(r.step([]).sprites, 'a whiteout warps').toEqual([]);
  });
});

describe("the match's roster reaches the field (POK-323)", () => {
  // app.ts runs on the page and no unit test drives it, and the e2e hands the field a
  // roster of its own: without these two lines the other seats stand still in a battle,
  // and nothing else fails.
  /** A top-level function's body, up to the next one. */
  const body = (name: string): string => {
    const from = appSource.indexOf(`\nfunction ${name}(`);
    expect(from, name).toBeGreaterThan(0);
    const to = appSource.indexOf('\nfunction ', from + 1);
    return appSource.slice(from, to < 0 ? undefined : to);
  };

  it("solo hands it solo's roster, and a room its Bridge's, whichever is current", () => {
    expect(body('runSolo')).toMatch(/\n\s*fieldView\?\.setPeople\(\(\) => roster\.all\(\)\);/);
    expect(body('wireRoom')).toMatch(/\n\s*fieldView\?\.setPeople\(\(\) => bridge\?\.roster\.all\(\) \?\? \[\]\);/);
  });

  it('the field is made before either asks for it', () => {
    expect(body('wirePlayScreen')).toMatch(/\n\s*fieldView = new FieldView\(/);
    const made = appSource.indexOf('\n  wirePlayScreen(emu, ');
    expect(made).toBeGreaterThan(0);
    expect(appSource.indexOf('runSolo(emu, mailboxBase, symbols, ')).toBeGreaterThan(made);
    expect(appSource.indexOf('wireRoom(emu, mailboxBase, ')).toBeGreaterThan(made);
  });
});

// The battle over the map, an experiment (2026-10-05 play-test). The ROM paints a
// see-through battle's backdrop BR_SEE_THROUGH_KEY, pure blue; the page's filter has to
// clear that and nothing a battle actually draws.
describe('the see-through battle', () => {
  it("clears the key, however the core widens 31 to eight bits", () => {
    expect(seeThroughAlpha(0, 0, 1)).toBe(0);
    expect(seeThroughAlpha(0, 0, 248 / 255)).toBe(0);
  });

  it('leaves a pixel with any red or green in it, and blacks and navies, whole', () => {
    expect(seeThroughAlpha(0, 0, 0)).toBe(1);
    expect(seeThroughAlpha(8 / 255, 0, 1)).toBe(1);
    expect(seeThroughAlpha(0, 8 / 255, 1)).toBe(1);
    expect(seeThroughAlpha(0, 0, 0.5)).toBe(1);
    expect(seeThroughAlpha(1, 1, 1)).toBe(1);
  });
});
