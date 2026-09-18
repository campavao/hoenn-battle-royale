import { describe, expect, it } from 'vitest';
import { type Camera, SHAKE_FRAMES, fadeOf, fogOrigin, frameOf, gbaColor, heldFade, layoutField, lcdOrigin, neighbours, shakeOffset, subTile } from './field';
import type { WorldMap } from './bots/world';

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
      ({ group: 0, num: 0, x: 0, y: 0, subX: 0, subY: 0, fade, fadeColor: 0, fadeActive, sprites: [], fog: null, outside: false, ringTimer: 0 });
    expect(heldFade(cam(16, false), cam(0, false), false), 'the reset').toBe(true);
    expect(heldFade(cam(0, false), cam(0, false), true), 'still loading').toBe(true);
    expect(heldFade(cam(0, false), cam(16, true), true), 'the fade-in begins').toBe(false);
    expect(heldFade(cam(14, true), cam(12, true), false), 'an ordinary fade').toBe(false);
    expect(heldFade(null, cam(0, false), false), 'the first frame').toBe(false);
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
