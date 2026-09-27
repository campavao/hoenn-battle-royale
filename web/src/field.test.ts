import { describe, expect, it } from 'vitest';
import { BAND, type Camera, FieldImages, FieldView, type FieldDeps, SB1_MAP_GROUP, SB1_MAP_NUM, SB1_POS_X, SB1_POS_Y, SHAKE_FRAMES, fadeOf, fogOrigin, frameOf, gbaColor, FAST_FADE, heldFade, holdFade, layoutField, mapFade, lcdOrigin, lcdRect, neighbours, pictureBox, shakeOffset, subTile } from './field';
import { GhostWalkers, OBJ_LOCAL_ID, OBJ_MAP_GROUP, OBJ_MAP_NUM, SB1_TEMPLATES, SEAT_SIZE, TEMPLATE_SIZE, TPL_GFX, TPL_LOCAL_ID, TPL_MOVEMENT_TYPE, TPL_X, TPL_Y } from './field-ghosts';
import type { RosterEntry } from './match/roster';
import { HOENN } from './bots/hoenn';
import { SKIN_GFX } from './ui/emerald';
import type { WorldMap } from './bots/world';
import fieldHeader from '../../include/br/br_field.h?raw';
import appSource from './app.ts?raw';

describe('the picture past the LCD (POK-319)', () => {
  it('the band is the ROM\'s: include/br/br_field.h says the same four numbers', () => {
    const define = (name: string): number => {
      const m = fieldHeader.match(new RegExp(`#define\\s+${name}\\s+(\\d+)`));
      if (!m) throw new Error(`${name} not in br_field.h`);
      return Number(m[1]);
    };
    expect(BAND).toEqual({ left: define('BR_VIEW_LEFT'), top: define('BR_VIEW_TOP'), right: define('BR_VIEW_RIGHT'), bottom: define('BR_VIEW_BOTTOM') });
  });

  it('the band is one ring: 256 rows of the 8-bit sprite y, 256 columns of the tilemap', () => {
    expect(160 + BAND.top + BAND.bottom).toBe(256);
    expect(240 + BAND.left + BAND.right).toBe(256);
    for (const v of Object.values(BAND)) expect(v % 8, 'the core wants multiples of 8').toBe(0);
  });

  it('the core\'s canvas is placed so the LCD lands where the layout put it', () => {
    const lay = layoutField(390, 844, 0);
    const pic = pictureBox(lay, BAND);
    expect(pic).toEqual({ left: lay.lcdCol - BAND.left, top: lay.lcdRow - BAND.top, width: 256, height: 256 });
    expect(pictureBox(lay, null), 'no band: the canvas is the LCD').toEqual({ left: lay.lcdCol, top: lay.lcdRow, width: 240, height: 160 });
  });

  it('a tap or a spec finds the LCD inside the bigger canvas on screen', () => {
    const picture = { left: 10, top: 20, width: 512, height: 512 };
    expect(lcdRect(picture, BAND)).toEqual({ left: 10, top: 20 + 80, width: 480, height: 320 });
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
