// HOW TO PLAY's pictures (POK-430), cut from the player's ROM: one sheet, 240 wide, laid out as
// tools/br/export-howto.py laid out the PNG the site shipped until 2026-11-14 (web/src/ui/howto.ts
// reads it by those offsets). Top to bottom, 150 a picture:
//
//   0     the Safari Zone's six areas, shrunk eight times to a bird's-eye view
//   150   Hoenn: the POKéNAV's region map at its own scale
//   300   Rustboro by the Devon building, for the fog to roll over
//   450   BRENDAN and MAY face to face on Slateport's harbour, a "!" over each
//   600   the top of Sky Pillar: RAYQUAZA, two item balls and three gold ones
//   750   twelve frames of the evolution scene's backdrop (sBgAnim_PalIndexes rows 13..24)
//   2550  CHARMANDER, CHARMELEON, CHARIZARD, 64 square; under them, at 2614, the same in white
//   2678  Jagged Pass's grass with three marked patches, BRENDAN about to step on one
//   2828  Lavaridge outside its Center: two item balls, a gold one, a fallen trainer's bag
//
// A sprite's frames are its sheet's (sprites.json): standing south is 0, west 2, east is west
// mirrored, as the ROM draws it.
import spritesData from '../src/data/sprites.json';
import type { RomArt } from './romart';

const SHEETS = spritesData as Record<string, { w: number; h: number; frames: number }>;
const W = 240, H = 150;
const EVO_FRAMES = Array.from({ length: 12 }, (_, i) => 13 + i);
const GFX_BRENDAN = 0, GFX_MAY = 89, GFX_ITEM_BALL = 59, GFX_BIRCHS_BAG = 97, GFX_RAYQUAZA = 207;
/** CHARMANDER, CHARMELEON, CHARIZARD. */
const MONS = [4, 5, 6];
export const HOWTO_SHEET_H = H * 5 + H * EVO_FRAMES.length + 64 * 2 + H * 2;

type MapRef = (id: string) => { group: number; num: number } | undefined;

export function howtoSheet(art: RomArt, mapRef: MapRef): HTMLCanvasElement | null {
  const ground = (id: string) => {
    const ref = mapRef(`MAP_${id}`);
    return ref ? art.map(ref.group, ref.num).ground : null;
  };
  const frame = (gfx: number, n: number, mirror = false): HTMLCanvasElement => {
    const info = SHEETS[String(gfx)];
    const cv = document.createElement('canvas');
    cv.width = info.w;
    cv.height = info.h;
    const ctx = cv.getContext('2d')!;
    if (mirror) {
      ctx.translate(info.w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(art.sprite(gfx, info.frames), n * info.w, 0, info.w, info.h, 0, 0, info.w, info.h);
    return cv;
  };
  /** A 240 x 150 piece of map `id` from (x, y), and a way to stand things on its whole tiles: a
   *  16 wide piece fills its tile, a wider one stands centred on it, a taller one with its feet on it. */
  const onMap = (id: string, x: number, y: number) => {
    const g = ground(id);
    if (!g) return null;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(g, x, y, W, H, 0, 0, W, H);
    const put = (piece: CanvasImageSource & { width: number; height: number }, tx: number, ty: number) =>
      ctx.drawImage(piece, tx * 16 - Math.floor((piece.width - 16) / 2), (ty + 1) * 16 - piece.height);
    return { cv, ctx, put };
  };

  const bang = art.exclamation(GFX_BRENDAN), gold = art.goldBall(GFX_ITEM_BALL), region = art.regionMap();
  const evo = art.evolutionBackdrops(EVO_FRAMES, [8, 5, W, H]);
  const mons = MONS.map((s) => art.monStill(s, false));
  const patches = art.patchSheets();
  if (!bang || !gold || !region || !evo || mons.some((m) => !m)) return null;

  const sheet = document.createElement('canvas');
  sheet.width = W;
  sheet.height = HOWTO_SHEET_H;
  const out = sheet.getContext('2d')!;

  // The Safari Zone: its six areas, 640 square each, in the maps' own arrangement, shrunk by eight
  // (each pixel the mean of an 8 x 8 block), its middle 150 rows.
  const zone = ['NORTHWEST', 'NORTH', 'NORTHEAST', 'SOUTHWEST', 'SOUTH', 'SOUTHEAST'].map((n) => ground(`SAFARI_ZONE_${n}`));
  if (zone.some((z) => !z)) return null;
  const big = document.createElement('canvas');
  big.width = 640 * 3;
  big.height = 640 * 2;
  const bctx = big.getContext('2d', { willReadFrequently: true })!;
  zone.forEach((z, i) => bctx.drawImage(z!, (i % 3) * 640, Math.floor(i / 3) * 640));
  const src = bctx.getImageData(0, 0, big.width, big.height).data;
  const shrunk = document.createElement('canvas');
  shrunk.width = W;
  shrunk.height = 160;
  const sctx = shrunk.getContext('2d')!;
  const small = sctx.createImageData(W, 160);
  for (let y = 0; y < 160; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) sum += src[((y * 8 + dy) * big.width + x * 8 + dx) * 4 + c];
        small.data[(y * W + x) * 4 + c] = Math.round(sum / 64);
      }
      small.data[(y * W + x) * 4 + 3] = 255;
    }
  }
  sctx.putImageData(small, 0, 0);
  out.drawImage(shrunk, 0, 5, W, H, 0, 0, W, H);

  // Hoenn, as the POKéNAV lays it out.
  out.drawImage(region, 7, 0, W, H, 0, H, W, H);

  const rustboro = onMap('RUSTBORO_CITY', 96, 192);
  const battle = onMap('SLATEPORT_CITY', 392, 560);
  const event = onMap('SKY_PILLAR_TOP', 96, 48);
  const encounter = onMap('JAGGED_PASS', 16, 320);
  const pickup = onMap('LAVARIDGE_TOWN', 48, 48);
  if (!rustboro || !battle || !event || !encounter || !pickup) return null;

  // Three steps apart either side of the middle, BRENDAN facing east and MAY west.
  for (const [gfx, x, mirror] of [[GFX_BRENDAN, 88, true], [GFX_MAY, 136, false]] as const) {
    battle.ctx.drawImage(frame(gfx, 2, mirror), x, 96 - 32);
    battle.ctx.drawImage(bang, x, 96 - 32 - 16);
  }
  const ball = frame(GFX_ITEM_BALL, 0);
  event.put(frame(GFX_RAYQUAZA, 0), 7, 4);
  for (const [tx, ty, piece] of [[4, 4, ball], [10, 4, ball], [7, 6, gold], [8, 6, gold], [9, 6, gold]] as const) event.put(piece, tx, ty);
  // The rustle's second frame, the grass at its widest.
  const patch = document.createElement('canvas');
  patch.width = patch.height = 16;
  patch.getContext('2d')!.drawImage(patches.grass, 16, 0, 16, 16, 0, 0, 16, 16);
  for (const [tx, ty] of [[8, 4], [10, 5], [8, 3]]) encounter.put(patch, tx, ty);
  encounter.put(frame(GFX_BRENDAN, 2, true), 7, 4);
  for (const [tx, ty, piece] of [[3, 5, ball], [9, 6, ball], [13, 7, gold], [7, 6, frame(GFX_BIRCHS_BAG, 0)]] as const) pickup.put(piece, tx, ty);
  pickup.put(frame(GFX_BRENDAN, 2), 7, 4);

  [rustboro, battle, event].forEach((p, i) => out.drawImage(p.cv, 0, H * (2 + i)));
  evo.forEach((f, i) => out.drawImage(f, 0, H * 5 + i * H));
  const monsY = H * 5 + H * EVO_FRAMES.length;
  mons.forEach((m, i) => {
    out.drawImage(m!, i * 64, monsY);
    // The same in white, the way it flashes while it changes.
    const white = document.createElement('canvas');
    white.width = white.height = 64;
    const w = white.getContext('2d')!;
    w.drawImage(m!, 0, 0);
    w.globalCompositeOperation = 'source-in';
    w.fillStyle = '#fff';
    w.fillRect(0, 0, 64, 64);
    out.drawImage(white, i * 64, monsY + 64);
  });
  out.drawImage(encounter.cv, 0, monsY + 128);
  out.drawImage(pickup.cv, 0, monsY + 128 + H);
  return sheet;
}
