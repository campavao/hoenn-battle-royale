import { describe, expect, it } from 'vitest';
import { FIELD_VIEW_SIZE, measureLayout, widerBand, worldBand, shownArea, wideRing, WIDE_COLUMNS, WIDE_LEFT, LEGACY_BAND, askBand, LEGACY_SPRITE_BAND, type Camera, FieldImages, FieldView, type FieldDeps, SB1_MAP_GROUP, SB1_MAP_NUM, SB1_POS_X, SB1_POS_Y, SHAKE_FRAMES, bandOf, RING_ABOVE, RING_ROWS, fadeOf, fogOrigin, frameOf, gbaColor, FAST_FADE, heldFade, holdFade, layoutField, PAD_GAP, mapFade, lcdOrigin, lcdRect, neighbours, oamFlipped, pictureBox, romBand, shakeOffset, subTile, SPR_OAM_HFLIP, seeThroughAlpha, keyPicture, edgeReach, unseenFade, fieldDimmed, RING_BATTLE_FOG, FOG_EVA, FOG_EVB, WEATHER_CURR, WEATHER_EVA, WEATHER_EVB, WEATHER_FOG_HORIZONTAL } from './field';
import { standsAbove } from './field-extra';
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

  it("the ROM's view is its 512-row ring less the one row a step needs: 184 above the LCD, 152 below, 496 rows (POK-329, POK-378)", () => {
    const view = { left: define('BR_VIEW_LEFT'), top: define('BR_VIEW_TOP'), right: define('BR_VIEW_RIGHT'), bottom: define('BR_VIEW_BOTTOM') };
    const ringRows = define('BR_RING_TILE_ROWS') / 2;
    const above = define('BR_RING_ABOVE');
    expect(ringRows, 'a 256x512 BG: 32 metatile rows').toBe(32);
    expect(above).toBe(9);
    expect(view.top, "the ring's top: the LCD sits 40 below pos.y's top, and the ring runs BR_RING_ABOVE rows above it").toBe(define('BR_SPRITE_TOP') + 16 * above);
    expect(160 + view.top + view.bottom, 'every ring row but the spare one').toBe(16 * ringRows - 16);
    expect(160 + view.top + view.bottom).toBe(496);
    expect(view).toEqual({ left: 0, top: 184, right: 16, bottom: 152 });
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

  it("the wide view (THE WIDE RING): 128 columns each side and 40 rows, the 512x256 ring less its spare column and row, and br_field.c fills gBrFieldViewWide from the header", () => {
    const wide = { left: define('BR_WIDE_VIEW_LEFT'), top: define('BR_WIDE_VIEW_TOP'), right: define('BR_WIDE_VIEW_RIGHT'), bottom: define('BR_WIDE_VIEW_BOTTOM') };
    expect(wide).toEqual({ left: 128, top: 40, right: 128, bottom: 40 });
    expect(define('BR_WIDE_LEFT')).toBe(WIDE_LEFT);
    expect(define('BR_WIDE_COLUMNS')).toBe(WIDE_COLUMNS);
    expect(240 + wide.left + wide.right, 'every ring column but the spare one').toBe(16 * WIDE_COLUMNS - 16);
    expect(wide.left, "the ring's left: WIDE_LEFT columns left of the LCD's").toBe(16 * WIDE_LEFT);
    expect(160 + wide.top + wide.bottom, "pret's 16 rows but the spare one").toBe(16 * 16 - 16);
    const init = fieldSource.match(/const struct BrFieldView gBrFieldViewWide\s*=\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(init.split(',').map((t) => t.trim()).filter(Boolean)).toEqual(['BR_WIDE_VIEW_LEFT', 'BR_WIDE_VIEW_TOP', 'BR_WIDE_VIEW_RIGHT', 'BR_WIDE_VIEW_BOTTOM', 'BR_SPRITE_TOP', 'BR_SPRITE_BOTTOM']);
    // gBrFieldShown's sides follow its rows, and the ROM latches the wide ring on a left.
    const shown = fieldHeader.match(/struct BrFieldShown\s*\{([^}]*)\}/)?.[1] ?? '';
    expect([...shown.matchAll(/u16 (\w+);/g)].map((m) => m[1])).toEqual(['top', 'bottom', 'left', 'right']);
    expect(fieldSource).toMatch(/gBrFieldWide = gBrFieldShown\.left != 0;/);
    expect(wideRing({ left: 8, top: 40, right: 0, bottom: 40 })).toBe(true);
    expect(wideRing(LEGACY_BAND)).toBe(false);
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

    it("reads the wide ring's six u16s at gBrFieldViewWide beside them, when they are a picture the core can draw with the same window", () => {
      const WIDE_AT = AT + 0x20;
      const both = (wide: number[]) => {
        const rom = image([0, 104, 16, 232, 40, 56]);
        wide.forEach((v, i) => {
          rom[WIDE_AT - 0x08000000 + 2 * i] = v & 0xff;
          rom[WIDE_AT - 0x08000000 + 2 * i + 1] = v >> 8;
        });
        return romBand(rom, new Map([['gBrFieldView', AT], ['gBrFieldViewWide', WIDE_AT]]));
      };
      expect(both([128, 40, 128, 40, 40, 56])).toEqual({
        band: { left: 0, top: 104, right: 16, bottom: 232 },
        sprites: { top: 40, bottom: 56 },
        wide: { left: 128, top: 40, right: 128, bottom: 40 },
      });
      expect(both([0, 40, 128, 40, 40, 56]).wide, 'no left: nothing asks the ROM for it').toBeUndefined();
      expect(both([136, 40, 128, 40, 40, 56]).wide, "past the core's 128").toBeUndefined();
      expect(both([128, 40, 128, 40, 32, 64]).wide, 'another window').toBeUndefined();
      expect(romBand(image([0, 104, 16, 232, 40, 56]), syms).wide, 'a ROM without one').toBeUndefined();
    });

    // Cam, 2026-10-14: one zoom everywhere, so a wide screen shows far more map beside the
    // LCD than above and below it. The page asks for whichever ring covers more of it.
    describe('the wide ring on a screen it covers more of (askBand)', () => {
      const rom = { band: { left: 0, top: 104, right: 16, bottom: 232 }, sprites: { top: 40, bottom: 56 }, wide: { left: 128, top: 40, right: 128, bottom: 40 } };
      it('a desktop, 1440x800: 496 x 240 live, not the tall ring 256 x 384', () => {
        const lay = layoutField(1440, 800, 0, 1, 800);
        expect(askBand(lay, rom, true)).toEqual({ left: 128, top: 40, right: 128, bottom: 40 });
        expect(shownArea(lay, rom.wide)).toBe(496 * 240);
        expect(shownArea(lay, askBand(lay, rom, false))).toBe(256 * 384);
      });
      it("a 1920x1080 desktop's box, 1440x1080: the wide ring, though the ROM's tall one is a little more area", () => {
        const real = { ...rom, band: { left: 0, top: 184, right: 16, bottom: 152 } };
        const lay = layoutField(1440, 1080, 0, 1, 1080);
        expect(lay).toMatchObject({ cols: 720, rows: 540, lcdCol: 240, lcdRow: 190 });
        expect(shownArea(lay, askBand(lay, real, false))).toBeGreaterThan(shownArea(lay, real.wide));
        expect(askBand(lay, real, true)).toEqual({ left: 128, top: 40, right: 128, bottom: 40 });
      });
      it('a phone on its side, 844x390: the 140 columns each side it shows, in eights, up to 128', () => {
        const lay = layoutField(844, 390, 0, 3, 390);
        expect(lay).toMatchObject({ cols: 520, rows: 240, lcdCol: 140, lcdRow: 40 });
        expect(askBand(lay, rom, true)).toEqual({ left: 128, top: 40, right: 128, bottom: 40 });
      });
      it('a narrow window asks only the columns it shows, and never a left of 0', () => {
        const lay = { scale: 2, cols: 360, rows: 200, lcdCol: 60, lcdRow: 20 };
        expect(askBand(lay, rom, true)).toEqual({ left: 64, top: 40, right: 64, bottom: 40 });
      });
      it('a portrait phone keeps the tall ring', () => {
        const lay = layoutField(390, 844, 300, 3, 390);
        expect(askBand(lay, rom, true).left).toBe(0);
        expect(askBand(lay, rom, true)).toEqual(askBand(lay, rom, false));
      });
      it('without the side table, or a ROM without it, the tall ring', () => {
        const lay = layoutField(1440, 800, 0, 1, 800);
        expect(askBand(lay, rom, false).left).toBe(0);
        expect(askBand(lay, { band: rom.band, sprites: rom.sprites }, true).left).toBe(0);
      });
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
      const band = fn.indexOf('askBand(matchLayout(), romPicture, shownOk)');
      const sprites = fn.indexOf('emu.setSpriteBand(romPicture.sprites)');
      const viewport = fn.indexOf('emu.setViewport(askedBand)');
      expect(band).toBeGreaterThan(0);
      expect(sprites).toBeGreaterThan(band);
      expect(viewport).toBeGreaterThan(sprites);
      expect(fn).toMatch(/askedBand = asked;/);
      // ...and the whole window over it, from a core that draws the world (HBR-27).
      // The window grown to its screen too: the band is a boot's size (Cam's 2026-10-26 play-test).
      const whole = 'askedBand = widerBand(worldBand(matchLayout()), worldBand(matchLayout(true)))';
      expect(fn.indexOf(whole)).toBeGreaterThan(fn.indexOf('worldOn = emu.setWorld(worldAt)'));
      expect(fn.indexOf(whole)).toBeLessThan(viewport);
      // The match's layout, whatever is up when it is measured: in-match, and docked on a desktop.
      const measure = appSource.slice(appSource.indexOf('function matchLayout('), appSource.indexOf('function askForBand('));
      expect(measure).toMatch(/classList\.add\('in-match'\)/);
      expect(measure).toMatch(/classList\.toggle\('docked', desktop\(\)\)/);
      expect(measure).toMatch(/measureLayout\(\$\('#screen-wrap'\)[^)]*, \$\('#pad'\)[^;]*, grown\)/);
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

  it("the ring's geometry is the ROM's (include/br/br_field.h)", () => {
    expect(RING_ABOVE).toBe(define('BR_RING_ABOVE'));
    expect(RING_ROWS).toBe(define('BR_RING_TILE_ROWS') / 2);
  });

  // How far past each edge the ROM's own picture is the map (bots/world.ts reads it too).
  it('reads how far past an edge the ROM draws the world, side by side', () => {
    const sea = { w: 30, h: 20, seams: [{ dir: 'north' as const }] };
    expect(edgeReach(sea, 'south'), 'nothing joined: the border, all the way').toBe(Infinity);
    expect(edgeReach(sea, 'north')).toBe(0);
    const mixed = { w: 30, h: 20, seams: [{ dir: 'south' as const, same: true }, { dir: 'south' as const }] };
    expect(edgeReach(mixed, 'south'), 'one neighbour drawn wrong cuts the side').toBe(0);
    const side = { w: 30, h: 20, seams: [{ dir: 'west' as const, same: true }, { dir: 'east' as const }] };
    expect(edgeReach(side, 'west'), "MAP_OFFSET cells of a neighbour on the same tilesets").toBe(7 * 16);
    expect(edgeReach(side, 'east')).toBe(0);
  });

  it('FieldView shows the whole band on the field from a core drawing the world, and the LCD alone otherwise, in one clip-path set only when it changes', () => {
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
    let world = true;
    const view = new FieldView({ emu: { viewport: LEGACY_BAND }, lcd, world: () => world } as unknown as FieldDeps);
    const inner = view as unknown as { band: Band | null; lay: { scale: number }; clip(onField: boolean): void };
    inner.band = { ...LEGACY_BAND };
    inner.lay = { ...inner.lay, scale: 2 };

    inner.clip(true);
    inner.clip(true);
    expect(sets, 'on the field: nothing cut, set once').toEqual(['']);
    inner.clip(false);
    expect(clipPath, 'off the field, the whole band').toBe('inset(80px 32px 112px 0px)');
    inner.clip(false);
    expect(sets.length, 'the same cut is not set again').toBe(2);
    world = false;
    inner.clip(true);
    expect(clipPath, 'a core not drawing the world: the LCD alone on the field too').toBe('inset(80px 32px 112px 0px)');
    expect(sets.length).toBe(2);
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
      ({ group: 0, num: 0, x: 0, y: 0, subX: 0, subY: 0, fade, fadeColor: 0, fadeActive, sprites: [], fog: null, outside: false, ringTimer: 0, onField: true });
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

  // Cam's 2026-10-19 play-test: "GARDEVOIR, that's enough! Come back!" over a flat grey
  // field. The switch-out's animation takes the battle's BG palettes 1..3 to white.
  it("keeps the map out of a battle animation's fade of a few BG palettes", () => {
    let s = mapFade({ y: 8, color: 0x7fff, active: true }, 0x0000000e, true);
    expect(s).toEqual({ fade: { y: 0, color: 0x7fff, active: false }, bg: false });
    s = mapFade({ y: 16, color: 0x7fff, active: false }, 0, s.bg);
    expect(s.fade.y, 'nor once it is done').toBe(0);
    // PALETTES_BG alone is the whole map.
    expect(mapFade({ y: 4, color: 0, active: true }, 0x0000ffff, false).fade.y).toBe(4);
  });

  // A wild battle's intro: SpriteCB_WildMon takes the foe's OBJ palette to y 10 in grey,
  // start and target both 10, so the mask is gone before any read; the map sat dark.
  it('drops a fade whose mask no read saw', () => {
    const rest = { y: 0, color: 0, active: false };
    const finishing = { y: 10, color: 0x2108, active: true };
    const wild = { y: 10, color: 0x2108, active: false };
    expect(unseenFade(rest, finishing, 0)).toBe(true);
    expect(unseenFade(rest, wild, 0), 'or that ended between reads').toBe(true);
    expect(unseenFade(wild, wild, 0), 'and holds still after').toBe(false);
    expect(unseenFade(null, wild, 0)).toBe(false);
    expect(unseenFade(rest, { y: 0, color: 0, active: true }, 0xffff), 'a fade seen with its mask').toBe(false);
    // A warp's fade out was seen running to its end.
    expect(unseenFade({ y: 14, color: 0, active: true }, { y: 16, color: 0, active: false }, 0)).toBe(false);
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
      ({ group: 0, num: 17, x: 33, y: 15, subX: 0, subY: 0, fade: fade.y, fadeColor: fade.color, fadeActive: fade.active, sprites: [], fog: null, outside: false, ringTimer: 0, onField: true });
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
      ({ group: 26, num: 13, x: 20, y: 20, subX: 0, subY: 0, fade: fade.y, fadeColor: fade.color, fadeActive: fade.active, sprites: [], fog: null, outside: false, ringTimer: 0, onField: false });
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
  // Feedback #33: START, then POKéMON, in Rustboro -- gPaletteFade frame by frame (a
  // desktop e2e, menu-dim.spec's walk): the field's fade to black over every palette, the
  // party screen's CB2 taking over with the struct reset, and its own fade-in from black.
  // [frame, on the field, y, colour, active, mask, the u16 at 8].
  it('dims the field under a menu, as under a battle, and the fade in still runs over the map', () => {
    const trace: [number, boolean, number, number, number, number, number][] = [
      [79, true, 2, 0, 1, 0xffffffff, 0],
      [93, true, 16, 0, 1, 0xffffffff, 0],
      [95, true, 16, 0, 0, 0, 0],
      [101, false, 16, 0, 0, 0, 0],
      [104, false, 0, 0, 0, 0, 0x80],
      [118, false, 0, 0, 0, 0, 0x80],
      [119, false, 16, 0, 1, 0xffffffff, 0x40],
      [126, false, 8, 0, 1, 0xffffffff, 0x40],
      [134, false, 0, 0, 1, 0xffffffff, 0x40],
      [141, false, 0, 0, 0, 0, 0x40],
    ];
    const cam = (onField: boolean, fade: { y: number; color: number; active: boolean }): Camera =>
      ({ group: 0, num: 3, x: 21, y: 25, subX: 0, subY: 0, fade: fade.y, fadeColor: fade.color, fadeActive: fade.active, sprites: [], fog: null, outside: false, ringTimer: 0, onField });
    let bg = true;
    let prev: Camera | null = null;
    let hold = { on: false, frames: 0 };
    const seen: Record<number, [number, boolean]> = {};
    for (const [frame, onField, y, color, active, mask, mode] of trace) {
      const s = mapFade({ y, color, active: active === 1 }, mask, bg, mode);
      bg = s.bg;
      const cur = cam(onField, s.fade);
      hold = holdFade(prev, cur, hold);
      seen[frame] = [cur.fade, fieldDimmed(cur, false)];
      prev = cur;
    }
    expect(seen).toEqual({
      79: [2, false],
      93: [16, false],
      95: [16, false],
      // The dim comes on under a black screen...
      101: [16, true],
      104: [16, true],
      118: [16, true],
      // ...and the menu fades in over the dimmed map.
      119: [16, true],
      126: [8, true],
      134: [0, true],
      141: [0, true],
    });
    // A keyed battle is dimmed whatever the struct says; nothing read yet is not.
    expect(fieldDimmed(cam(true, { y: 0, color: 0, active: false }), true)).toBe(true);
    expect(fieldDimmed(null, false)).toBe(false);
    expect(fieldDimmed(null, true)).toBe(true);
  });

  it('shows #key-dim off the field and hides it back on it, keyed or not', () => {
    const keyDim = { hidden: true };
    const lcd = { style: { visibility: '', filter: '' }, ownerDocument: null };
    const view = new FieldView({ emu: {}, lcd, keyDim } as unknown as FieldDeps);
    const seeThrough = (c: { onField: boolean } | null) => (view as unknown as { seeThrough(c: { onField: boolean } | null): void }).seeThrough(c);
    seeThrough(null);
    expect(keyDim.hidden, 'nothing read').toBe(true);
    seeThrough({ onField: true });
    expect(keyDim.hidden, 'on the field').toBe(true);
    seeThrough({ onField: false });
    expect(keyDim.hidden, 'a menu').toBe(false);
    seeThrough({ onField: true });
    expect(keyDim.hidden, 'back on the field').toBe(true);
    expect(lcd.style, 'the picture itself untouched without a see-through battle').toEqual({ visibility: '', filter: '' });
  });

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

  it('a floating pad: the picture sits just above it, the map over the top', () => {
    const flat = layoutField(390, 844, 0);
    const lifted = layoutField(390, 844, 300);
    expect(lifted.scale).toBe(flat.scale);
    expect(lifted.lcdRow).toBe(Math.floor((844 - 300) / 1.625 - 160) - PAD_GAP);
    const bottom = (lifted.lcdRow + 160) * lifted.scale;
    expect(bottom, 'clear of the pad').toBeLessThanOrEqual(844 - 300);
    expect(bottom, 'and close to it').toBeGreaterThan(844 - 300 - 8 * lifted.scale);
    // ...but no higher above it than the ROM draws: 170 rows wanted, 104 live, so 104.
    expect(layoutField(390, 844, 300, 1, 390, 104).lcdRow).toBe(104);
    // ...and a glass whose centre is already past that keeps the centre.
    expect(layoutField(390, 844, 200, 1, 390, 104).lcdRow).toBe(Math.round(((844 - 200) / 1.625 - 160) / 2));
    expect(lifted.rows, 'the map still runs under the pad').toBe(flat.rows);
  });

  it("a wide window: a phone's zoom, the widest phone's snapped to whole pixels, and the map all round", () => {
    // 430 / 240 is 1.79 CSS pixels, rounded up to whole device pixels: 2 on a 1x screen.
    const lay = layoutField(1440, 800, 0);
    expect(lay.scale).toBe(2);
    expect(lay).toMatchObject({ cols: 720, rows: 400, lcdCol: 240, lcdRow: 120 });
    expect(layoutField(1440, 800, 0, 2).scale, '3.58 device pixels up to 4').toBe(2);
    expect(layoutField(1440, 800, 0, 1.5).scale, '2.69 device pixels up to 3').toBe(2);
    expect(layoutField(1440, 800, 0, 3).scale, '5.38 device pixels up to 6').toBe(2);
    // Windows' default 125%: 2.24 device pixels up to 3, 2.4 CSS -- never under a phone's.
    expect(layoutField(1440, 800, 0, 1.25).scale).toBe(2.4);
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      expect(layoutField(1440, 800, 0, dpr).scale, `dpr ${dpr}`).toBeGreaterThanOrEqual(430 / 240);
    }
    // ...and no drop past the widest phone: glass 430 is 1.79, glass 431 no less.
    expect(layoutField(1440, 800, 0, 1.25, 430).scale).toBeCloseTo(430 / 240);
    expect(layoutField(1440, 800, 0, 1.25, 431).scale).toBeGreaterThanOrEqual(430 / 240);
  });

  it('a phone on its side keeps the zoom it has upright: its short side is the same', () => {
    expect(layoutField(844, 390).scale).toBe(layoutField(390, 844).scale);
    // ...though its box is the glass less the thumbs either side and the bar under it.
    expect(layoutField(516, 350, 0, 3, 390).scale).toBe(1.625);
    // 480x320: a small phone sideways shows the map round a 320x213 picture.
    expect(layoutField(480, 320)).toMatchObject({ scale: 320 / 240, cols: 360, rows: 240, lcdCol: 60, lcdRow: 40 });
  });

  it('a box too small for the zoom still fits the whole picture', () => {
    // 443x768 (a half-screen window beside its sheet): the widest phone's zoom snaps up to 2,
    // and 443 / 240 is all that fits across.
    expect(layoutField(443, 768).scale).toBe(443 / 240);
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
  // The picture comes down to the pad only as far as those 104 rows above reach.
  describe("the ROM's view covers a portrait phone (POK-329)", () => {
    const VIEW = { top: 104, bottom: 232 };
    const needs = (w: number, h: number, pad: number) => {
      const lay = layoutField(w, h, pad, 1, w, VIEW.top);
      return { top: lay.lcdRow, bottom: lay.rows - lay.lcdRow - 160, lay };
    };
    it("the installed app (390x763) and Safari (390x664): every row past the picture is the core's", () => {
      for (const [w, h] of [[390, 763], [390, 664]]) {
        const n = needs(w, h, 200);
        expect(n.top, `${w}x${h} above`).toBeLessThanOrEqual(VIEW.top);
        expect(n.bottom, `${w}x${h} below`).toBeLessThanOrEqual(VIEW.bottom);
      }
      // Down from centred (93 and 63) towards the pad, to the 104 the ROM draws above.
      expect(needs(390, 763, 200)).toMatchObject({ top: 104, bottom: 206 });
      expect(needs(390, 664, 200)).toMatchObject({ top: 104, bottom: 145 });
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
    it("a desktop: a phone's zoom shows map above and below, so it asks for those rows too", () => {
      // 1280x720 at 2: 360 rows, the LCD at 100 and 100 under it.
      expect(askBand(layoutField(1280, 720, 0), ROM)).toEqual({ left: 0, top: 104, right: 16, bottom: 104 });
      // ...beside the docked sheet (1280 less its 480) the same rows; 1440x800 has 120 each way.
      expect(rows(askBand(layoutField(800, 720, 0), ROM))).toEqual({ top: 104, bottom: 104 });
      expect(rows(askBand(layoutField(1440, 800, 0), ROM))).toEqual({ top: 104, bottom: 120 });
    });
    it("a portrait phone with the pad over the bottom: all the ROM has, and Safari's shorter glass less", () => {
      expect(askBand(layoutField(390, 844, 200, 1, 390, ROM.band.top), ROM), 'short 14 and 10: capped at the ROM').toEqual(ROM.band);
      expect(rows(askBand(layoutField(390, 763, 200, 1, 390, ROM.band.top), ROM)), 'the installed app, 104 and 206, in eights').toEqual({ top: 104, bottom: 208 });
      expect(rows(askBand(layoutField(390, 664, 200, 1, 390, ROM.band.top), ROM)), 'Safari, 104 and 145').toEqual({ top: 104, bottom: 152 });
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

  describe('the whole window covers the window grown to its screen (Cam, 2026-10-26)', () => {
    // A window booted at 1000x900 on a 1278x1392 screen (1.5x), then made bigger: the
    // band is a boot's size, and past it the field showed stills -- still water.
    const pointer = (fine: boolean) => () => ({ matches: fine });
    const view = { devicePixelRatio: 1.5, innerWidth: 1000, innerHeight: 900, screen: { width: 1278, height: 1392, availWidth: 1278, availHeight: 1352 }, matchMedia: pointer(true) };
    const box = { clientWidth: 712, clientHeight: 900, ownerDocument: { defaultView: view } } as unknown as HTMLElement;
    it('measures the box as big as the window can get, and as it is without asking', () => {
      expect(measureLayout(box, null)).toEqual(layoutField(712, 900, 0, 1.5, 1278));
      expect(measureLayout(box, null, undefined, true)).toEqual(layoutField(712 + 278, 900 + 452, 0, 1.5, 1278));
    });
    it('asks for the grown band, each side the wider', () => {
      const now = worldBand(measureLayout(box, null));
      const grown = worldBand(measureLayout(box, null, undefined, true));
      expect(grown.right).toBeGreaterThan(now.right);
      expect(grown.bottom).toBeGreaterThan(now.bottom);
      expect(widerBand(now, grown)).toEqual(grown);
      expect(widerBand({ left: 8, top: 0, right: 0, bottom: 64 }, { left: 0, top: 16, right: 24, bottom: 8 })).toEqual({ left: 8, top: 16, right: 24, bottom: 64 });
    });
    it('a phone on its side asks for what it shows: its screen reads upright (iOS), and its window does not resize', () => {
      const ios = { devicePixelRatio: 3, innerWidth: 844, innerHeight: 350, screen: { width: 390, height: 844, availWidth: 390, availHeight: 844 }, matchMedia: pointer(false) };
      const phone = { clientWidth: 844, clientHeight: 350, ownerDocument: { defaultView: ios } } as unknown as HTMLElement;
      expect(worldBand(measureLayout(phone, null, undefined, true))).toEqual(worldBand(measureLayout(phone, null)));
    });
    it('a window already filling its screen asks for what it shows', () => {
      const full = { ...view, innerWidth: 1278, innerHeight: 1352 };
      const filled = { clientWidth: 990, clientHeight: 1352, ownerDocument: { defaultView: full } } as unknown as HTMLElement;
      expect(measureLayout(filled, null, undefined, true)).toEqual(measureLayout(filled, null));
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
    const emu = { viewport: null, boots: 1, worldDrawn: () => null };
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
  const WEATHER = 0x02010000;
  const OFFSET_Y = 0x02011000;
  const RING = 0x02012000;
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
      ['gWeather', WEATHER], ['gSpriteCoordOffsetY', OFFSET_Y], ['gBrRing', RING],
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
  // HBR-38: a ring that closes mid-fight fogs the fight, and the map's weather stays clear
  // until the field comes back; the map behind the fight is drawn in the fog all the same.
  it('off the field, a fight in the fog has the fog behind it, whatever the weather says', () => {
    const r = ram(HOENN.maps.find((m) => m.outdoor)!);
    r.onField(false);
    expect(r.read()!.fog, 'a clear fight').toBeNull();
    r.w(RING + RING_BATTLE_FOG, 1, 8);
    expect(r.read()!.fog).toEqual({ x: 0, y: 0, eva: FOG_EVA, evb: FOG_EVB });
    r.onField(true);
    expect(r.read()!.fog, 'on the field the map has its own weather').toBeNull();
    r.w(WEATHER + WEATHER_CURR, WEATHER_FOG_HORIZONTAL, 8);
    r.w(WEATHER + WEATHER_EVA, 10, 16);
    r.w(WEATHER + WEATHER_EVB, 6, 16);
    expect(r.read()!.fog).toEqual({ x: 0, y: 0, eva: 10, evb: 6 });
  });

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

  // HBR-42 (10-20 play-test): watching a player on Route 101, another one just south of
  // them in Littleroot was on screen and drawn by nobody.
  it('a walker on a map joined to ours is drawn past our edge, where that map sits', () => {
    const route = HOENN.byId.get('MAP_ROUTE101')!;
    const town = HOENN.byId.get('MAP_LITTLEROOT_TOWN')!;
    const r = ram(route);
    // We stand at (20, 20); Littleroot's (10, 2) is Route 101's (10, 22).
    const drawn = r.step([rowAt(town, 2, 10 + 7, 2 + 7)]).sprites.filter((s) => s.seat === 2);
    expect(drawn).toEqual([{ gfx: SKIN_GFX[0], frame: 0, hFlip: false, x: 112 - 10 * 16, y: 56 + 2 * 16, hidden: true, seat: 2 }]);
    // ...and a map that is not joined to ours draws nobody.
    const far = HOENN.byId.get('MAP_SLATEPORT_CITY')!;
    expect(r.step([rowAt(far, 3, 10 + 7, 2 + 7)]).sprites.filter((s) => s.seat === 3)).toEqual([]);
    // Two tiles east, Littleroot's (12, 2) is inside the ROM's box: the overlay is over the
    // picture, so painted there it would stand on the menus and over the roofs. It is the
    // ROM's (it spawns one across a seam while spectating), so the page leaves it.
    expect(r.step([rowAt(town, 4, 12 + 7, 2 + 7)]).sprites.filter((s) => s.seat === 4)).toEqual([]);
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
  it("keys the page's own copy the same way: Safari draws no url() filter on the WebGL picture", () => {
    const px = new Uint8ClampedArray([0, 0, 248, 255, 0, 0, 255, 0, 8, 0, 255, 0, 0, 0, 0, 0, 120, 200, 64, 9]);
    keyPicture(px);
    expect([px[3], px[7], px[11], px[15], px[19]]).toEqual([0, 0, 255, 255, 255]);
  });
});

// PR #103's review: a cover is BG1's top layer, and the ROM draws an object at elevation
// 4..12 (even) over BG1 -- the Cycling Road's deck is that layer on ROUTE 110, and a
// ghost crossing it past the picture was cut out by the road it rode on.
describe('who stands over BG1', () => {
  const route110 = HOENN.byId.get('MAP_ROUTE110')!;
  // A 16x32 person, gfx 7, whose feet are on cell (x, y) of a map whose top-left is the origin.
  const at = (x: number, y: number) => ({ gfx: 7, x: x * 16, y: y * 16 + 16 - 32 });
  it('on the Cycling Road deck (elevation 4)', () => {
    expect(standsAbove(route110, at(19, 54), { left: 0, top: 0 })).toBe(true);
  });
  it('on the ground beside it (elevation 1 or 3)', () => {
    expect(standsAbove(route110, at(5, 60), { left: 0, top: 0 })).toBe(false);
    expect(standsAbove(route110, at(20, 0), { left: 0, top: 0 })).toBe(false);
  });
});
