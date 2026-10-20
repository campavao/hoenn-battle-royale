// HOW TO PLAY (POK-429): a match in seven panels, clicked through in a few seconds. Cam:
// "something a user can click thru quickly just to give them the broad strokes of how a
// game plays out". Offered once after a player's first ROM import, and a row on the menu.
// POK-430 gave it Cam's own sections and words, each over a picture out of the game's own
// art (tools/br/export-howto.py's sheet), some of them moving.
import { TEXT_BLUE, TEXT_DARK, TEXT_GRAY, measure, skinSheet, wrapText, type EmeraldCanvas, type Rect } from './emerald';
import { ROW_H, W, paintButtons, type ButtonSpec } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

/** What a panel shows above its words: a picture off the sheet, and what moves on it. */
export type Art = 'safari' | 'hoenn' | 'fog' | 'evolve' | 'battle' | 'event' | 'win';

export interface Panel {
  title: string;
  text: string;
  art: Art;
}

export const PANELS: readonly Panel[] = [
  {
    title: 'Start in Safari',
    text: "Catch and collect what you can quickly in the Safari to start the game. You have a set amount of time to build up a party until the timer runs out. Nothing caught means you're out.",
    art: 'safari',
  },
  {
    title: 'Where we flying?',
    text: 'Pick where in Hoenn you want to drop into. You can find items and Pokémon in houses now.',
    art: 'hoenn',
  },
  {
    title: 'Weezing Fog',
    text: "Over time, Weezing's Fog will spread to cover all of Hoenn. Check the Map to see where it's closing in next!",
    art: 'fog',
  },
  {
    title: 'Leveling up',
    text: 'Pokémon automatically level up as the Fog closes in. Additionally any Pokémon can learn any move.',
    art: 'evolve',
  },
  {
    title: 'Battles',
    text: "Defeating another Trainer will drop their bag and their Pokémon for you to pick up! You can only have a max party of 6, so anything you can't carry will be dropped. You can run from a Trainer battle with a POKé DOLL.",
    art: 'battle',
  },
  {
    title: 'Special events',
    text: 'Occasionally events will occur in which you can catch Legendary Pokémon and items.',
    art: 'event',
  },
  {
    title: 'How to win',
    text: 'Be the last one standing! Keep an eye on the map, keep your party strong and healthy, and battle your way to victory.',
    art: 'win',
  },
];

/** tools/br/export-howto.py's sheet: its pictures, the screen's width and this tall. */
export const SHEET = 'howto.png';
export const ART_H = 150;
const ROW: Partial<Record<Art, number>> = { safari: 0, hoenn: 1, fog: 2, battle: 3, event: 4 };
/** The evolution backdrop's twelve frames, from the sheet's sixth picture down. */
const EVO_Y = ART_H * 5;
const EVO_FRAMES = 12;
/** CHARMANDER, CHARMELEON, CHARIZARD, 64 square; the white ones a row under. */
const MONS_Y = EVO_Y + ART_H * EVO_FRAMES;
const MON = 64;

const TEXT_W = W - 24;
const FOG_TILE = 64;
const FOG = '/field-sprites/fog.png';
const MOVING: ReadonlySet<Art> = new Set<Art>(['fog', 'evolve', 'win']);
/** How often a moving panel is drawn again. */
export const FRAME_MS = 50;

/** One stage of the evolution: the old one held, the flashing, the new one held. */
const HOLD_MS = 1500;
const FLASH_MS = 1700;
const AFTER_MS = 800;
const STAGE_MS = HOLD_MS + FLASH_MS + AFTER_MS;
/** CHARMANDER into CHARMELEON, CHARMELEON into CHARIZARD, then CHARIZARD a while. */
export const EVOLVE_MS = STAGE_MS * 2 + HOLD_MS;

// The first-import flag lives in its own module, so the menu can ask it without the
// panels' chunk (app.ts loads that after boot, for main.js's budget).
export { HOWTO_KEY, markHowToDue, takeHowToDue } from './howto-due';

/** Which of the three is on show at `t` ms into the loop, and whether it is the white
 *  flash; Emerald flashes between the old shape and the new, faster and faster. */
export function evolveFrame(t: number): { mon: number; white: boolean; flashing: boolean } {
  const at = ((t % EVOLVE_MS) + EVOLVE_MS) % EVOLVE_MS;
  const stage = Math.floor(at / STAGE_MS);
  if (stage >= 2) return { mon: 2, white: false, flashing: false };
  const s = at - stage * STAGE_MS;
  if (s < HOLD_MS) return { mon: stage, white: false, flashing: false };
  if (s >= HOLD_MS + FLASH_MS) return { mon: stage + 1, white: false, flashing: false };
  // Through the flash the swaps come quicker: 300 ms apart at first, 40 at the end.
  const f = (s - HOLD_MS) / FLASH_MS;
  const k = Math.floor(f * f * 18 + f * 4);
  return { mon: stage + (k % 2), white: true, flashing: true };
}

const CONFETTI = ['#f85858', '#f8d030', '#58a8f8', '#58d058', '#f898c8'];
const CONFETTI_N = 48;
const WIN_SKY = ['#88c8f8', '#98d0f8', '#a8d8f8', '#b8e0f8', '#c8e8f8', '#d8f0f8'];

/** Where each bit of confetti is at `t`: falling at its own speed, swaying, turning. */
export function confetti(t: number, left: number, width: number, h: number): { r: Rect; color: string }[] {
  let seed = 0x2545f491;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x100000000;
  };
  const out: { r: Rect; color: string }[] = [];
  for (let i = 0; i < CONFETTI_N; i++) {
    const x0 = rand() * width;
    const y0 = rand() * (h + 8);
    const speed = 18 + rand() * 30;
    const phase = rand() * Math.PI * 2;
    const color = CONFETTI[i % CONFETTI.length];
    const y = ((y0 + (t * speed) / 1000) % (h + 8)) - 4;
    const x = left + ((x0 + Math.sin(t / 400 + phase) * 4 + width) % width);
    const flat = Math.floor(t / 250 + phase) % 2 === 0;
    out.push({ r: { x: Math.floor(x), y: Math.floor(y), w: flat ? 3 : 2, h: flat ? 2 : 3 }, color });
  }
  return out;
}

export interface HowToModel {
  /** Your sprite: you are the one in the fog, and the one who won. */
  skin: number;
  onDone(): void;
  /** The last panel is up: everything has been read (HBR-30's NEW comes off). */
  onRead?(): void;
  /** Draw again: a moving panel asks every FRAME_MS while it is up. */
  redraw?(): void;
  /** The clock the pictures move by; performance.now unless a test gives one. */
  now?(): number;
}

/** The ROM's fog over `r`, tiled and drifting `drift` pixels left, cut to the rectangle. */
function fogOver(c: EmeraldCanvas, r: Rect, drift: number, alpha: number): void {
  for (let ty = r.y; ty < r.y + r.h; ty += FOG_TILE) {
    const th = Math.min(FOG_TILE, r.y + r.h - ty);
    for (let tx = r.x - drift; tx < r.x + r.w; tx += FOG_TILE) {
      const x0 = Math.max(tx, r.x);
      const x1 = Math.min(tx + FOG_TILE, r.x + r.w);
      if (x1 > x0) c.drawUiPicture(FOG, x0 - tx, 0, x1 - x0, th, x0, ty, alpha);
    }
  }
}

export function howToScreen(model: () => HowToModel): DrawnScreen {
  let page = 0;
  let pending = false;
  const done = () => {
    page = 0;
    model().onDone();
  };
  return {
    back: done,
    paint(c, h): Painted {
      const m = model();
      const t = (m.now ?? (() => performance.now()))();
      const panel = PANELS[page];
      const last = page === PANELS.length - 1;
      if (last) m.onRead?.();
      const widgets: Widget[] = [];

      const rows = wrapText(panel.text, TEXT_W);
      // As tall as the longest panel's, so NEXT stays under the thumb from panel to panel.
      const most = Math.max(...PANELS.map((p) => wrapText(p.text, TEXT_W).length));
      const frameH = 8 + ROW_H + 4 + most * ROW_H + 12;
      const total = ART_H + frameH + 4 + 24;
      // The picture, the words and the buttons together, in the middle of a tall screen.
      const top = Math.max(0, Math.floor((h - total) / 2));
      const art = { x: 0, y: top, w: W, h: ART_H };
      // The whole canvas, past the 240 on a wide one.
      const all = { x: -c.origin, y: 0, w: c.width, h };
      const drift = Math.floor(t / 60) % FOG_TILE;

      if (panel.art === 'fog') fogOver(c, all, drift, 0.6);
      // The words, the count and the buttons, kept clear of the confetti.
      const words = { x: 0, y: art.y + ART_H, w: W, h: total - ART_H };
      const clear = (r: Rect) =>
        r.x + r.w <= words.x || r.x >= words.x + words.w || r.y + r.h <= words.y || r.y >= words.y + words.h;
      if (panel.art === 'win') for (const p of confetti(t, all.x, all.w, h)) if (clear(p.r)) c.fillRect(p.r, p.color);

      const row = ROW[panel.art];
      if (row !== undefined) c.drawUiPicture(SHEET, 0, row * ART_H, W, ART_H, art.x, art.y);
      const you = skinSheet(m.skin);
      if (panel.art === 'fog') {
        // You, on Route 101, as the fog rolls over it.
        if (you) c.drawSprite(you.gfx, Math.floor((W - you.w) / 2), art.y + 96 - you.h);
        fogOver(c, art, drift, 0.6);
      } else if (panel.art === 'evolve') {
        const e = evolveFrame(t);
        // The backdrop's colours run while the shapes flash, as the ROM's do.
        const bg = e.flashing ? Math.floor(t / 66) % EVO_FRAMES : 0;
        c.drawUiPicture(SHEET, 0, EVO_Y + bg * ART_H, W, ART_H, art.x, art.y);
        c.drawUiPicture(SHEET, e.mon * MON, MONS_Y + (e.white ? MON : 0), MON, MON, (W - MON) / 2, art.y + Math.floor((ART_H - MON) / 2));
      } else if (panel.art === 'win') {
        // A plain sky, lighter toward the ground, under the confetti.
        WIN_SKY.forEach((color, i) => {
          const y0 = Math.floor((i * ART_H) / WIN_SKY.length);
          const y1 = Math.floor(((i + 1) * ART_H) / WIN_SKY.length);
          c.fillRect({ x: 0, y: art.y + y0, w: W, h: y1 - y0 }, color);
        });
        for (const p of confetti(t, all.x, all.w, h)) if (p.r.y >= art.y && p.r.y + p.r.h <= art.y + art.h) c.fillRect(p.r, p.color);
        if (you) c.drawSprite(you.gfx, Math.floor((W - you.w * 2) / 2), art.y + Math.floor((ART_H - you.h * 2) / 2), 1, 0, 2);
      }
      widgets.push({ rect: art, text: panel.art, id: 'howto-art', cursor: null });

      const frame = { x: 0, y: art.y + ART_H, w: W, h: frameH };
      c.drawFrame(frame);
      let ty = frame.y + 8;
      c.drawTextCentred(panel.title, W / 2, ty, TEXT_BLUE);
      widgets.push({ rect: { x: 8, y: ty, w: W - 16, h: ROW_H }, text: panel.title, id: 'howto-heading', cursor: null });
      // Which panel this is, in the heading's row: a row of its own would leave the
      // longest words (Battles, six lines) no room on a 320-tall screen.
      const count = `${page + 1}/${PANELS.length}`;
      const countX = W - 12 - measure(count);
      c.drawText(count, countX, ty, TEXT_GRAY);
      widgets.push({ rect: { x: countX, y: ty, w: measure(count), h: ROW_H }, text: count, id: 'howto-page', cursor: null });
      ty += ROW_H + 4;
      rows.forEach((line, i) => c.drawText(line, 12, ty + i * ROW_H, TEXT_DARK));
      widgets.push({ rect: { x: 8, y: ty, w: W - 16, h: rows.length * ROW_H }, text: panel.text, id: 'howto-text', cursor: null });
      const y = frame.y + frame.h + 4;

      // NEXT first, and DONE first on the last panel: the cursor starts on the first
      // button, so A alone clicks through and out.
      const buttons: ButtonSpec[] = last
        ? [{ label: 'DONE', id: 'howto-done', onPress: done }]
        : [{ label: 'NEXT', id: 'howto-next', onPress: () => { page += 1; } }];
      if (page > 0) buttons.push({ label: 'BACK', id: 'howto-back', onPress: () => { page -= 1; } });
      if (!last) buttons.push({ label: 'SKIP', id: 'howto-skip', onPress: done });
      widgets.push(...paintButtons(c, Math.min(y, h - 28), buttons));

      // A moving picture asks to be drawn again. Once this screen is gone its owner's
      // redraw paints whatever is up instead, and the asking stops.
      if (MOVING.has(panel.art) && m.redraw && !pending) {
        pending = true;
        setTimeout(() => {
          pending = false;
          m.redraw?.();
        }, FRAME_MS);
      }
      return { widgets };
    },
  };
}
