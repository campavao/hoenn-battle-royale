// The play-a-match spec's eyes and hands (POK-327): what the picture must look like at
// any moment of a match, a recorder that watches it frame by frame, and the presses a
// player makes. Cam's 2026-09-18 video hit four bugs in its first minutes that no spec
// could see, because none of them looked at the screen through a battle: the map
// flashing white around a catch, the band left on the drop map, the picture squashed
// after a battle in Firefox, and a beaten trainer drawn over the field.
//
// The numbers below are the ROM's struct offsets that src/field.ts reads. They are
// copied, not imported: field.ts imports world.json with no import attribute, which
// Playwright's Node loader refuses (tap.spec.ts). devsurface.test.ts holds each one to
// field.ts's own.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import worldData from '../src/data/world.json' with { type: 'json' };

const __dirname = import.meta.dirname;

export const GBA_W = 240;
export const GBA_H = 160;
/** `struct Main`: callback2 at 4; `inBattle` is bit 1 of the byte at 0x439. */
export const MAIN_CALLBACK2 = 4;
export const MAIN_IN_BATTLE = 0x439;
/** `struct PaletteFadeControl`: the palettes it touches at 0 (bits 0..15 are BG), y at
 *  bits 6..10 of the u16 at 4, the colour and `active` in the u16 at 6. */
export const FADE_SELECTED = 0;
export const FADE_Y_WORD = 4;
export const FADE_COLOR_WORD = 6;
export const FADE_BG_PALETTES = 0xffff;
/** The fade's `mode`, bits 8..9 of the u16 at 8: a FAST_FADE (1) steps every palette,
 *  BG and OBJ, whatever the palette mask says (palette.c, BeginFastPaletteFade), towards
 *  the colour its submode names in bits 0..5 -- FAST_FADE_IN_FROM_WHITE 0, OUT_TO_WHITE
 *  1, IN_FROM_BLACK 2, OUT_TO_BLACK 3 (every battle ends on one: battle_main.c). */
export const FADE_MODE_WORD = 8;
export const FAST_FADE = 1;
export const FAST_WHITE_MAX = 1;
/** field.ts holds a finished fade for up to a second (HELD_FADE_MAX): a warp's new map
 *  sits at y 0 for a dozen frames before its fade-in, and must not flash through. */
export const HELD_FRAMES = 60;
/** `struct BrPick`: the drop map is up. */
export const PICK_ACTIVE = 0;
/** `struct BrRing`: outside the ring, and the HP the fog has taken. */
export const RING_OUTSIDE = 5;
export const RING_DAMAGE = 10;
/** `struct SaveBlock1`: pos, then the map. */
export const SB1_MAP_GROUP = 4;
export const SB1_MAP_NUM = 5;
/** `struct BrLoot`: beaten trainers taken off a map. */
export const LOOT_GONE = 0xa3;
/** `struct BattlePokemon` (include/pokemon.h), 0x58 bytes a battler: gBattleMons[0] is
 *  ours and [1] the foe in a single battle. */
export const BMON_SIZE = 0x58;
export const BMON_ATTACK = 0x02;
export const BMON_SP_ATTACK = 0x08;
export const BMON_HP = 0x28;
export const BMON_MAX_HP = 0x2c;
export const BMON_STATUS1 = 0x4c;
export const STATUS1_POISON = 0x08;
/** include/constants/battle.h. */
export const B_OUTCOME_WON = 1;
/** BATTLE_TYPE_SAFARI (include/constants/battle.h). */
export const BATTLE_TYPE_SAFARI = 0x80;

/** Longest the map past the picture may be black with no fade to say so: a still on its
 *  way from the server, and field.ts's own one-second hold after a warp. */
export const BLACK_MAX_FRAMES = 180;

/** The outdoor maps, `group:num`: the only ones the composite draws a map for. */
const OUTDOOR = (worldData as { maps: { group: number; num: number; outdoor: boolean }[] }).maps
  .filter((m) => m.outdoor)
  .map((m) => `${m.group}:${m.num}`);

type Band = { left: number; top: number; right: number; bottom: number };
type Emu = {
  read(addr: number, width: 8 | 16 | 32): number;
  write(addr: number, value: number, width: 8 | 16 | 32): void;
  onFrame(fn: () => void): () => void;
  viewport: Band | null;
};
type EmuWindow = { __hbr: { emu: Emu } };

/** One look at the ROM, for the spec's decisions. */
export interface Ram {
  onOverworld: boolean;
  inBattle: boolean;
  battleType: number;
  phase: number;
  pick: boolean;
  map: string;
  x: number;
  y: number;
  balls: number;
  party: number;
  outside: boolean;
  damage: number;
  gone: number;
}

export function ram(page: Page, sym: Record<string, number>): Promise<Ram> {
  return page.evaluate(
    ([s, k]) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      const s16 = (v: number) => (v << 16) >> 16;
      const sb1 = emu.read(s.gSaveBlock1Ptr, 32);
      return {
        onOverworld: (emu.read(s.gMain + k.MAIN_CALLBACK2, 32) & ~1) === s.CB2_Overworld,
        inBattle: ((emu.read(s.gMain + k.MAIN_IN_BATTLE, 8) >> 1) & 1) === 1,
        battleType: emu.read(s.gBattleTypeFlags, 32),
        phase: emu.read(s.gBrMatch, 8),
        pick: emu.read(s.gBrPick + k.PICK_ACTIVE, 8) !== 0,
        map: sb1 ? `${emu.read(sb1 + k.SB1_MAP_GROUP, 8)}:${emu.read(sb1 + k.SB1_MAP_NUM, 8)}` : '',
        x: sb1 ? s16(emu.read(sb1, 16)) : -1,
        y: sb1 ? s16(emu.read(sb1 + 2, 16)) : -1,
        balls: emu.read(s.gNumSafariBalls, 8),
        party: emu.read(s.gPlayerPartyCount, 8),
        outside: emu.read(s.gBrRing + k.RING_OUTSIDE, 8) !== 0,
        damage: emu.read(s.gBrRing + k.RING_DAMAGE, 16),
        gone: emu.read(s.gBrLoot + k.LOOT_GONE, 8),
      };
    },
    [sym, { MAIN_CALLBACK2, MAIN_IN_BATTLE, PICK_ACTIVE, SB1_MAP_GROUP, SB1_MAP_NUM, RING_OUTSIDE, RING_DAMAGE, LOOT_GONE }] as const,
  );
}

// ---- the picture, once -----------------------------------------------------------------

/** Where the picture is on the page: the core's canvas, its band (from the emulator,
 *  never a copy of field.ts's: POK-329 will change it), and the LCD inside it. */
export async function picture(page: Page): Promise<{
  band: Band | null;
  buffer: { w: number; h: number };
  canvas: { x: number; y: number; width: number; height: number };
  lcd: { x: number; y: number; width: number; height: number };
  box: { x: number; y: number; width: number; height: number };
  clip: string;
  objectFit: string;
}> {
  return page.evaluate(([lcdW, lcdH]) => {
    const c = document.querySelector('#canvas') as HTMLCanvasElement;
    const band = (window as unknown as EmuWindow).__hbr.emu.viewport;
    const r = c.getBoundingClientRect();
    const b = (document.querySelector('#screen-wrap') as HTMLElement).getBoundingClientRect();
    const s = r.width / c.width;
    const rect = (x: DOMRect | { x: number; y: number; width: number; height: number }) => ({ x: x.x, y: x.y, width: x.width, height: x.height });
    return {
      band,
      buffer: { w: c.width, h: c.height },
      canvas: rect(r),
      lcd: { x: r.x + (band?.left ?? 0) * s, y: r.y + (band?.top ?? 0) * s, width: lcdW * s, height: lcdH * s },
      box: rect(b),
      clip: c.style.clipPath,
      objectFit: getComputedStyle(c).objectFit,
    };
  }, [GBA_W, GBA_H] as const);
}

/** The picture's layout, checked the way a player would see it (the maths phone.spec.ts
 *  started): the element is the buffer's own aspect and fills its box, the buffer is the
 *  LCD plus the band the emulator was asked for, the LCD is 3:2 and inside the box, and
 *  -- given where the ROM is -- the band is clipped off exactly when it is not on the
 *  field: a battle, a menu, the drop map. (The recorder holds the clip to the ROM on
 *  every other frame; a caller that cannot know where the ROM will be two frames on
 *  leaves `onField` out.) */
export async function expectLayout(page: Page, want: { onField?: boolean }, what: string): Promise<void> {
  // Two frames first: field.ts lays the picture out from a ResizeObserver, which runs
  // before the next paint, so a box that has just changed size -- the drawer opening on
  // the results -- is only laid out a frame later. A picture that stays wrong still fails.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
  const p = await picture(page);
  expect(p.band, `${what}: the core draws the band`).not.toBeNull();
  const band = p.band!;
  expect(p.buffer, `${what}: the buffer is the LCD and its band`).toEqual({ w: GBA_W + band.left + band.right, h: GBA_H + band.top + band.bottom });
  expect(p.canvas.width / p.canvas.height, `${what}: the picture is never squashed or stretched`).toBeCloseTo(p.buffer.w / p.buffer.h, 2);
  // Firefox composes object-fit with the band's clip-path into a letterboxed picture
  // (Cam's 2026-09-18 video, "everything got squished"): the canvas draws at its box.
  expect(p.objectFit, `${what}: the picture fills its own box`).toBe('fill');
  expect(p.lcd.width / p.lcd.height, `${what}: the LCD is 3:2`).toBeCloseTo(GBA_W / GBA_H, 2);
  expect(p.lcd.x, `${what}: the LCD is inside the box`).toBeGreaterThanOrEqual(p.box.x - 1);
  expect(p.lcd.y, `${what}: the LCD is inside the box`).toBeGreaterThanOrEqual(p.box.y - 1);
  expect(p.lcd.x + p.lcd.width, `${what}: the LCD is inside the box`).toBeLessThanOrEqual(p.box.x + p.box.width + 1);
  expect(p.lcd.y + p.lcd.height, `${what}: the LCD is inside the box`).toBeLessThanOrEqual(p.box.y + p.box.height + 1);
  if (want.onField === undefined) return;
  if (want.onField) {
    expect(p.clip, `${what}: the band shows on the field`).toBe('');
  } else {
    const s = p.canvas.width / p.buffer.w;
    const inset = /^inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px\)$/.exec(p.clip);
    expect(inset, `${what}: the band is clipped off the field (clip-path "${p.clip}")`).not.toBeNull();
    const [top, right, bottom, left] = inset!.slice(1).map(Number);
    expect(top).toBeCloseTo(band.top * s, 1);
    expect(right).toBeCloseTo(band.right * s, 1);
    expect(bottom).toBeCloseTo(band.bottom * s, 1);
    expect(left).toBeCloseTo(band.left * s, 1);
  }
}

/** The LCD as the page shows it -- composited, so whatever the browser did to the canvas
 *  is in it -- and how much of its left and right edge is black. A battle has no black
 *  edge; a picture letterboxed into the LCD has two. Decoded by the page itself, which
 *  has a PNG decoder and no reason to fetch one. */
export async function edgeBlack(page: Page): Promise<{ left: number; right: number }> {
  const p = await picture(page);
  const png = await page.screenshot({ clip: { x: p.lcd.x + 1, y: p.lcd.y + 1, width: p.lcd.width - 2, height: p.lcd.height - 2 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const strip = Math.max(1, Math.floor(c.width / 10));
    const black = (x0: number): number => {
      const d = ctx.getImageData(x0, 0, strip, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 16 && d[i + 1] < 16 && d[i + 2] < 16) n++;
      return n / (d.length / 4);
    };
    return { left: black(0), right: black(c.width - strip) };
  }, png.toString('base64'));
}

// ---- the recorder: every frame, for the whole match -------------------------------------

export interface PlayLog {
  samples: number;
  /** What broke an invariant, with the frame it broke on (the first 40). */
  bad: string[];
  /** The last samples before the first break of each kind: frame, fade (y, a = active,
   *  B/O = the palettes it reaches, fN = a fast fade and its submode, (obj) = the last
   *  fade reached no BG palette, end = a fast fade out has ended), colour, uN = how far
   *  under its fade the map should be, and what the corners showed. */
  trails: Record<string, string[]>;
  counts: Record<string, number>;
  /** How often something the spec wants to have happened was seen. */
  seen: { battle: number; pick: number; shake: number; outside: number; bgFade: number; white: number; black: number; full: number; overlay: number; fastCut: number };
  damage: number;
  longestBlack: number;
}

/** Starts the recorder in the page. It reads the ROM and the page on the same emulated
 *  frame, after field.ts has drawn for it (frame listeners run in the order they were
 *  added, and the field's came first), so the only lag is the one field.ts has by design:
 *  the composite is drawn from the frame before. The fade and the overlay are watched
 *  on every frame; the picture's layout and the composite's corners on every other. */
export async function startRecorder(page: Page, sym: Record<string, number>): Promise<void> {
  await page.evaluate(
    ([s, k, outdoor]) => {
      type Band = { left: number; top: number; right: number; bottom: number };
      const w = window as unknown as {
        __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number; onFrame(fn: () => void): () => void; viewport: Band | null } };
        __play?: unknown;
      };
      const emu = w.__hbr.emu;
      const lcd = document.querySelector('#canvas') as HTMLCanvasElement;
      const field = document.querySelector('#field') as HTMLCanvasElement;
      const overlay = document.querySelector('#overlay') as HTMLCanvasElement;
      const box = document.querySelector('#screen-wrap') as HTMLElement;
      const stall = document.querySelector('#stall') as HTMLElement | null;
      const outdoors = new Set(outdoor);
      const log = {
        samples: 0,
        bad: [] as string[],
        trails: {} as Record<string, string[]>,
        counts: {} as Record<string, number>,
        seen: { battle: 0, pick: 0, shake: 0, outside: 0, bgFade: 0, white: 0, black: 0, full: 0, overlay: 0, fastCut: 0 },
        damage: 0,
        longestBlack: 0,
      };
      w.__play = log;
      let frame = 0;
      let clipOff = 0;
      let blackRun = 0;
      // Whether the fade that ran last reached the BG palettes. A fade names its palettes
      // only while it steps: on reaching its target the ROM clears the mask and runs four
      // more frames with none (palette.c, UpdateNormalPaletteFade), and one that ended at
      // 16 leaves y there until the next begins. So what it reached is taken while it
      // runs and kept after -- on every frame, not every sample, or a short fade could
      // name its palettes between two samples.
      let lastBg = true;
      // Frames in a row the ROM has had the map under a whole fade (y 16).
      let fullRun = 0;
      // A fast fade out that has ended, and how long ago: the picture is its colour until
      // the next fade begins.
      let fastEnd: { color: number; frames: number } | null = null;
      // The composite is drawn from the frame before and holds a finished fade for up
      // to a second, so a fade excuses it for that long after it has moved on.
      const whiteOk: boolean[] = [];
      const blackOk: boolean[] = [];
      const trail: string[] = [];
      const fail = (kind: string, what: string): void => {
        log.counts[kind] = (log.counts[kind] ?? 0) + 1;
        if (log.bad.length < 40) log.bad.push(`frame ${frame}: ${kind}: ${what}`);
        log.trails[kind] ??= trail.slice();
      };
      const pixel = (ctx: CanvasRenderingContext2D, x: number, y: number): number[] => Array.from(ctx.getImageData(x, y, 1, 1).data);
      // Where field.ts put each sprite on the overlay this frame, in the overlay's pixels
      // (through the context's transform: a mirrored sprite is drawn scaled by -1). A
      // sprite over the LCD is caught on the frame it is drawn, whichever frames the
      // samples land on.
      const drawn: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const octx = overlay.getContext('2d');
      if (octx) {
        const drawImage = octx.drawImage as (...a: unknown[]) => void;
        (octx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
          const img = a[0] as { width: number; height: number };
          const [dx, dy, dw, dh] = (a.length >= 9 ? a.slice(5, 9) : a.length >= 5 ? a.slice(1, 5) : [a[1], a[2], img.width, img.height]) as number[];
          const t = this.getTransform();
          const xs = [dx, dx + dw].flatMap((x) => [dy, dy + dh].map((y) => t.a * x + t.c * y + t.e));
          const ys = [dx, dx + dw].flatMap((x) => [dy, dy + dh].map((y) => t.b * x + t.d * y + t.f));
          drawn.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
          drawImage.apply(this, a);
        };
      }
      // Where the LCD sits on the field's and the overlay's canvases (both are the box at
      // the layout's scale, in GBA pixels); null while there is no picture to place.
      const lcdAt = (): { lx: number; ly: number } | null => {
        const band = emu.viewport;
        const r = lcd.getBoundingClientRect();
        const fr = field.getBoundingClientRect();
        if (!band || !(r.width > 0) || !(fr.width > 0)) return null;
        const per = field.width / fr.width;
        const sc = r.width / lcd.width;
        return { lx: Math.round((r.left + band.left * sc - fr.left) * per), ly: Math.round((r.top + band.top * sc - fr.top) * per) };
      };
      emu.onFrame(() => {
        frame++;
        // The watchdog (POK-328) calls no stop anywhere in a match played end to end: its
        // overlay is up on a frame only for a stop it has not yet taken back.
        if (stall && !stall.hidden) fail('stall', document.querySelector('#stall-line')?.textContent ?? '');
        const sprites = drawn.splice(0);
        const fw4 = emu.read(s.gPaletteFade + k.FADE_Y_WORD, 16);
        const fw6 = emu.read(s.gPaletteFade + k.FADE_COLOR_WORD, 16);
        const selected = emu.read(s.gPaletteFade + k.FADE_SELECTED, 32);
        const fadeY = (fw4 >> 6) & 31;
        const fadeActive = (fw6 & 0x8000) !== 0;
        const fadeColor = fw6 & 0x7fff;
        const fw8 = emu.read(s.gPaletteFade + k.FADE_MODE_WORD, 16);
        // A fast fade, while it runs: the ROM puts the mode back to normal on its last
        // step (palette.c, UpdateFastPaletteFade), with y at 0.
        const fastMode = ((fw8 >> 8) & 3) === k.FAST_FADE;
        const fast = fadeActive && fastMode;
        const fastWhite = fastMode && (fw8 & 0x3f) <= k.FAST_WHITE_MAX;
        // ...so one stopped with the mode still fast never took a step: begun inside the
        // last fade's four finishing frames, it is ended by them first (palette.c,
        // UpdateFastPaletteFade). A fade out left the picture as it was; a fade in had
        // filled it with its colour as it began. Until the next normal fade (field.ts
        // mapFade; the end of a Safari catch, in Firefox).
        const fastCut = fastMode && !fadeActive;
        if (fast) lastBg = true;
        else if (fadeActive && selected !== 0) lastBg = (selected & k.FADE_BG_PALETTES) !== 0;
        // How far the map is under the ROM's fade, 0..16, and in what colour. A normal
        // fade reaches it only where it reached the BG palettes. A fast fade reaches every
        // palette with no blend: y runs from 31 down by 2 every other frame, each step
        // moving every channel 2 of 31 towards the submode's colour. One that fades out
        // leaves the whole picture that colour when it ends, until the next fade begins
        // -- which the composite holds for up to HELD_FRAMES (field.ts holdFade). Every
        // battle ends on one to black, and the map stayed lit past a picture gone black.
        if (fast) fastEnd = (fw8 & 1) === 1 ? { color: fastWhite ? 0x7fff : 0, frames: 0 } : null;
        else if (fastCut) fastEnd = null;
        else if (fastEnd && (fadeActive && selected !== 0 || ++fastEnd.frames > k.HELD_FRAMES)) fastEnd = null;
        const bgFaded = fast
          ? ((fw8 & 1) === 1 ? 16 - (fadeY >> 1) : fadeY >> 1)
          : fastCut ? ((fw8 & 1) === 1 ? 0 : 16) : fastEnd ? 16 : lastBg ? fadeY : 0;
        const faded = fast || fastCut ? (fastWhite ? 0x7fff : 0) : fastEnd ? fastEnd.color : fadeColor;
        fullRun = bgFaded >= 16 ? fullRun + 1 : 0;
        whiteOk.push(bgFaded >= 12 && faded >= 0x7000);
        blackOk.push(bgFaded >= 12 && faded <= 0x0421);
        if (whiteOk.length > k.HELD_FRAMES + 4) whiteOk.shift();
        if (blackOk.length > k.HELD_FRAMES + 4) blackOk.shift();
        if (fast || (fadeActive && (selected & k.FADE_BG_PALETTES) !== 0)) log.seen.bgFade++;
        if (fastCut) log.seen.fastCut++;
        const sb1 = emu.read(s.gSaveBlock1Ptr, 32);
        const map = sb1 ? `${emu.read(sb1 + k.SB1_MAP_GROUP, 8)}:${emu.read(sb1 + k.SB1_MAP_NUM, 8)}` : '';

        // The overlay carries only the people the ROM hid for being past its band: never
        // one over the LCD, where the ROM draws everybody itself (the video's beaten
        // trainer flashing over the field). One drawn there under a full fade is a flat
        // colour over a picture the same colour, which nobody sees, so the pixels decide,
        // on the frame it was drawn.
        const at = sprites.length && octx ? lcdAt() : null;
        if (at && octx) {
          log.seen.overlay++;
          let lit = 0;
          for (const b of sprites) {
            const x0 = Math.max(Math.floor(b.x0), at.lx, 0);
            const y0 = Math.max(Math.floor(b.y0), at.ly, 0);
            const x1 = Math.min(Math.ceil(b.x1), at.lx + k.GBA_W, overlay.width);
            const y1 = Math.min(Math.ceil(b.y1), at.ly + k.GBA_H, overlay.height);
            if (x1 <= x0 || y1 <= y0) continue;
            const d = octx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
            for (let i = 0; i < d.length; i += 4) {
              const flat = (d[i] <= 8 && d[i + 1] <= 8 && d[i + 2] <= 8) || (d[i] >= 248 && d[i + 1] >= 248 && d[i + 2] >= 248);
              if (d[i + 3] !== 0 && !flat) lit++;
            }
          }
          if (lit > 0) fail('overlay', `${lit} overlay pixels over the LCD on map ${map}, fade y ${fadeY}`);
        }

        if (frame % 2) return;
        log.samples++;
        const band = emu.viewport;
        const cb2 = emu.read(s.gMain + k.MAIN_CALLBACK2, 32);
        const pick = emu.read(s.gBrPick + k.PICK_ACTIVE, 8) !== 0;
        const onField = (cb2 & ~1) === s.CB2_Overworld && !pick;
        const inBattle = ((emu.read(s.gMain + k.MAIN_IN_BATTLE, 8) >> 1) & 1) === 1;
        if (inBattle) log.seen.battle++;
        if (pick) log.seen.pick++;
        if (emu.read(s.gBrRing + k.RING_OUTSIDE, 8)) log.seen.outside++;
        log.damage = Math.max(log.damage, emu.read(s.gBrRing + k.RING_DAMAGE, 16));
        if (box.style.transform) log.seen.shake++;

        // The picture: the buffer's own aspect, the band the emulator was asked for, and
        // the band clipped off exactly when the ROM is not on the field.
        const r = lcd.getBoundingClientRect();
        if (!(r.width > 0)) return;
        if (Math.abs(r.width / r.height - lcd.width / lcd.height) > 0.01) {
          fail('aspect', `element ${r.width.toFixed(1)}x${r.height.toFixed(1)} for a ${lcd.width}x${lcd.height} buffer`);
        }
        if (band && (lcd.width !== k.GBA_W + band.left + band.right || lcd.height !== k.GBA_H + band.top + band.bottom)) {
          fail('buffer', `${lcd.width}x${lcd.height} with a band ${JSON.stringify(band)}`);
        }
        if (band) {
          const clipped = lcd.style.clipPath !== '' && lcd.style.clipPath !== 'none';
          clipOff = clipped === onField ? clipOff + 1 : 0;
          if (clipOff > 1) fail('clip', `clip-path "${lcd.style.clipPath}" with cb2 ${cb2.toString(16)}, pick ${pick}`);
        }
        const place = lcdAt();
        if (!place) return;
        const { lx, ly } = place;
        const inLcd = (x: number, y: number) => x >= lx - 1 && x <= lx + k.GBA_W && y >= ly - 1 && y <= ly + k.GBA_H;

        // The composite around the picture follows the ROM's fade, and only a fade that
        // reaches the BG palettes: a catch's flash whitens the OBJ palettes alone, and
        // the map going white around a battle picture that had not was the video's first
        // bug. Read at the field canvas's corners, wherever they are clear of the LCD.
        const ctx = field.getContext('2d');
        if (ctx) {
          const pts = [
            [2, 2],
            [field.width - 3, 2],
            [2, field.height - 3],
            [field.width - 3, field.height - 3],
          ].filter(([x, y]) => !inLcd(x, y));
          if (pts.length >= 2) {
            const px = pts.map(([x, y]) => pixel(ctx, x, y));
            const white = px.every((p) => p[0] >= 248 && p[1] >= 248 && p[2] >= 248);
            const black = px.every((p) => p[0] <= 8 && p[1] <= 8 && p[2] <= 8);
            trail.push(
              `${frame} y${fadeY}${fadeActive ? 'a' : ''}${selected & k.FADE_BG_PALETTES ? 'B' : ''}${selected >>> 16 ? 'O' : ''}${fastMode ? `f${fw8 & 0x3f}` : ''}` +
                `${lastBg ? '' : ' (obj)'}${fastCut ? ' cut' : !fast && fastEnd ? ' end' : ''} c${fadeColor.toString(16)} u${bgFaded} ${white ? 'WHITE' : black ? 'BLACK' : '-'}${inBattle ? ' battle' : ''}`,
            );
            if (trail.length > 40) trail.shift();
            if (white) {
              log.seen.white++;
              if (!whiteOk.some(Boolean)) fail('white', `map ${map}, fade y ${fadeY} colour ${fadeColor.toString(16)} active ${fadeActive} palettes ${selected.toString(16)}`);
            }
            // Black past the picture on an outdoor map, with no fade to black to say
            // so, is the map missing: a still still loading, or the fade the ROM never
            // finished (the field went black after a battle). The first is short.
            // ...and when the whole picture is under a fade, so is the map: the composite
            // is the fade's own colour, flat, once the ROM has held it for the frame the
            // composite is drawn from.
            if (fullRun >= 3) {
              log.seen.full++;
              const up = (v: number) => (v << 3) | (v >> 2);
              const want = [up(faded & 31), up((faded >> 5) & 31), up((faded >> 10) & 31)];
              if (!px.every((p) => p.slice(0, 3).every((v, i) => Math.abs(v - want[i]) <= 8))) {
                fail('unfaded', `map ${map} shows under a whole fade to ${faded.toString(16)}${fast ? ' (fast)' : fastCut ? ' (a fast fade ended before it began)' : fastEnd ? ' (a fast fade ended)' : ''}: corners ${JSON.stringify(px.map((p) => p.slice(0, 3)))}`);
              }
            }
            if (black) log.seen.black++;
            blackRun = black && outdoors.has(map) && !blackOk.some(Boolean) ? blackRun + 2 : 0;
            log.longestBlack = Math.max(log.longestBlack, blackRun);
            if (blackRun > k.BLACK_MAX_FRAMES && blackRun - 2 <= k.BLACK_MAX_FRAMES) fail('black', `map ${map} black for ${k.BLACK_MAX_FRAMES} frames, fade y ${fadeY} colour ${fadeColor.toString(16)}`);
          }
        }
      });
    },
    [
      sym,
      {
        GBA_W,
        GBA_H,
        MAIN_CALLBACK2,
        MAIN_IN_BATTLE,
        FADE_SELECTED,
        FADE_Y_WORD,
        FADE_COLOR_WORD,
        FADE_BG_PALETTES,
        FADE_MODE_WORD,
        FAST_FADE,
        FAST_WHITE_MAX,
        HELD_FRAMES,
        PICK_ACTIVE,
        RING_OUTSIDE,
        RING_DAMAGE,
        SB1_MAP_GROUP,
        SB1_MAP_NUM,
        BLACK_MAX_FRAMES,
      },
      OUTDOOR,
    ] as const,
  );
}

export function readLog(page: Page): Promise<PlayLog> {
  return page.evaluate(() => (window as unknown as { __play: PlayLog }).__play);
}

/** Nothing has broken an invariant so far: checked at the end of every step, so a break
 *  fails the step it happened in, with the samples that led up to it. */
export async function expectClean(page: Page, what: string): Promise<PlayLog> {
  const log = await readLog(page);
  const trails = Object.entries(log.trails).map(([kind, t]) => `before the first ${kind}:\n  ${t.join('\n  ')}`);
  expect(log.bad, [`${what}: ${JSON.stringify(log.counts)}`, ...trails].join('\n')).toEqual([]);
  return log;
}

/** Every invariant over the whole match. */
export async function assertLog(page: Page): Promise<PlayLog> {
  const log = await expectClean(page, 'the whole match');
  expect(log.samples, 'the recorder ran').toBeGreaterThan(1000);
  return log;
}

// ---- hands -------------------------------------------------------------------------------

/** A fight the same way every run. `weak`: the foe's HP at 1, and nothing else -- a
 *  Safari foe, which has to stay catchable. `won` as well: the foe poisoned, so it goes
 *  down at the end of the turn even against a move it is immune to (a Ghost against the
 *  TREECKO's POUND), and hitting for next to nothing, and ours kept full -- the one
 *  trainer the spec comes for, fought with the first move. `called`: B_OUTCOME_WON,
 *  which the battle reads before the turn's first action (the drivers' way), for a fight
 *  the spec did not come for: a bot that walks up to us late in the match is far above
 *  a level-5 TREECKO, and such a fight, left to A, twice never ended. */
export async function rig(page: Page, sym: Record<string, number>, how: 'weak' | 'won' | 'called'): Promise<void> {
  await page.evaluate(
    ([mons, outcome, k, mode]) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      if (mode === 'called') {
        if (emu.read(outcome, 8) === 0) emu.write(outcome, k.B_OUTCOME_WON, 8);
        return;
      }
      const foe = mons + k.BMON_SIZE;
      if (emu.read(foe + k.BMON_HP, 16) > 1) emu.write(foe + k.BMON_HP, 1, 16);
      if (mode === 'weak') return;
      if (!(emu.read(foe + k.BMON_STATUS1, 32) & k.STATUS1_POISON)) emu.write(foe + k.BMON_STATUS1, k.STATUS1_POISON, 32);
      emu.write(foe + k.BMON_ATTACK, 1, 16);
      emu.write(foe + k.BMON_SP_ATTACK, 1, 16);
      // Never one that has fainted: the battle has already taken it off.
      const hp = emu.read(mons + k.BMON_HP, 16);
      const max = emu.read(mons + k.BMON_MAX_HP, 16);
      if (hp > 0 && hp < max) emu.write(mons + k.BMON_HP, max, 16);
    },
    [sym.gBattleMons, sym.gBattleOutcome, { BMON_SIZE, BMON_ATTACK, BMON_SP_ATTACK, BMON_HP, BMON_MAX_HP, BMON_STATUS1, STATUS1_POISON, B_OUTCOME_WON }, how] as const,
  );
}

/** Where a battle that will not end is, for the message: the battle's main function,
 *  each side's controller, the outcome, a bot fight's own state (staged, seat,
 *  fighting, mons), and what the battle waits on. The functions are bus addresses -- look them up in the build's .map. */
export function battleState(page: Page, sym: Record<string, number>): Promise<string> {
  return page.evaluate((s) => {
    const emu = (window as unknown as EmuWindow).__hbr.emu;
    const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;
    return [
      `gBattleMainFunc ${hex(emu.read(s.gBattleMainFunc, 32))}`,
      `controllers ${hex(emu.read(s.gBattlerControllerFuncs, 32))} ${hex(emu.read(s.gBattlerControllerFuncs + 4, 32))}`,
      `callback2 ${hex(emu.read(s.gMain + 4, 32))}`,
      `outcome ${emu.read(s.gBattleOutcome, 8)}`,
      `bot fight ${[0, 1, 2, 3].map((i) => emu.read(s.gBrBotFight + i, 8)).join('/')}`,
      // What a battle waits on: a move's animation (its script and its sprite and sound
      // tasks -- a sprite destroyed out from under it never counts itself off) or a
      // controller.
      `anim ${emu.read(s.gAnimScriptActive, 8)} visual ${emu.read(s.gAnimVisualTaskCount, 8)} sound ${emu.read(s.gAnimSoundTaskCount, 8)}`,
      `exec ${hex(emu.read(s.gBattleControllerExecFlags, 32))}`,
    ].join(', ');
  }, sym);
}

/** A key, pressed and let go the way a finger does it. */
export async function tap(page: Page, key: string, holdMs = 90): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
}

/** A screenshot per step, numbered, under e2e/out/play/<browser>/: this run's, and none
 *  left over from the last one. */
export function shooter(page: Page, browser: string): (name: string) => Promise<void> {
  const dir = path.resolve(__dirname, 'out', 'play', browser);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return async (name) => {
    n++;
    await page.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${name}.png`) });
  };
}
