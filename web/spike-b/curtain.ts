// The wipe into a match (Cam, 11-01: "a screen wipe kind of transition ... something in these
// beauty pageants we could reuse"): the contest's own curtain (contest.c
// Task_RaiseCurtainAtStart, graphics/contest/curtain.bin), stretched across the window and
// raised at the contest's 7 pixels a frame. The ROM is never asked: it is the ROM's picture,
// drawn by the page, over the field the match has already started on.
//
// It also comes down over a cut (Cam, 11-02: "the banner wipe that starts it also happen as soon as
// time is zero and so whatever happens under the hood kind of resolves itself"): coverScreen.
import { EmeraldCanvas, TEXT_DARK, measure } from '../src/ui/emerald';

/** Where the curtain's picture lies in gContestCurtainTilemap, in tiles. */
const PLAIN_COL = 19, FRINGE_ROW = 18, FRINGE_ROWS = 2, CREST = { col: 22, row: 7, cols: 4, rows: 4 };
const TILE = 8;
/** How long it hangs before it goes up (contest.c waits a second; a match is on the clock). */
export const HOLD_MS = 350;
/** With a box on it, as long as the box takes to read. */
export const HOLD_BOX_MS = 1500;
/** How long it stays down over a cut once what it covers is ready, and at the most. */
export const COVER_HOLD_MS = 150, COVER_MAX_MS = 8000;
/** gBattle_BG1_Y += 7 a frame. */
export const RISE_PER_FRAME = 7;
const FRAME_MS = 1000 / 60;

/** GBA pixels of curtain for a window, at whole pixels: the picture's 160 rows fill its height. */
export function curtainSize(w: number, h: number): { scale: number; cols: number; rows: number } {
  const scale = Math.max(1, Math.floor(h / 160));
  return { scale, cols: Math.ceil(w / scale), rows: Math.ceil(h / scale) };
}

/** How far it has risen `ms` after the hold began, in GBA pixels. */
export function curtainRise(ms: number, hold = HOLD_MS): number {
  return Math.max(0, ms - hold) / FRAME_MS * RISE_PER_FRAME;
}

/** How much of it has come down `ms` after it began to, the other way at the same pace. */
export function curtainFall(ms: number, rows: number): number {
  return Math.min(rows, Math.max(0, ms) / FRAME_MS * RISE_PER_FRAME);
}

/** The curtain on the page, hung, with nothing moving it yet. */
function hang(art: HTMLCanvasElement, parent: HTMLElement): { el: HTMLElement; scale: number; rows: number } {
  document.getElementById('curtain')?.remove();
  const { scale, cols, rows } = curtainSize(innerWidth, innerHeight);
  const el = document.createElement('div');
  el.id = 'curtain';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;left:0;top:0;width:${cols * scale}px;height:${rows * scale}px;z-index:9;pointer-events:none`;
  const cv = document.createElement('canvas');
  cv.width = cols;
  cv.height = rows;
  cv.style.cssText = `display:block;width:100%;height:100%;image-rendering:pixelated`;
  el.append(cv);
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const fringeTop = rows - FRINGE_ROWS * TILE;
  for (let x = 0; x < cols; x += TILE) {
    for (let y = 0; y < fringeTop; y += TILE) c.drawImage(art, PLAIN_COL * TILE, 0, TILE, TILE, x, y, TILE, TILE);
    c.drawImage(art, PLAIN_COL * TILE, FRINGE_ROW * TILE, TILE, FRINGE_ROWS * TILE, x, fringeTop, TILE, FRINGE_ROWS * TILE);
  }
  const cw = CREST.cols * TILE, ch = CREST.rows * TILE;
  c.drawImage(art, CREST.col * TILE, CREST.row * TILE, cw, ch, Math.floor((cols - cw) / 2), Math.floor((fringeTop - ch) / 2), cw, ch);
  parent.append(el);
  return { el, scale, rows };
}

const SAYINGS = ['Only one walks away.', 'The fog waits for nobody.', 'Catch fast. Trust nobody.', 'Good luck out there!', 'Last one standing wins.', 'Mind the purple stuff.'];
/** What the box says as a match starts (Cam, 11-02: "a box that appears on the banner at first that
 *  says how many people are gonna play and I don't know, maybe like a fun message"). */
export function curtainLines(trainers: number, seed: number): [string, string] {
  return [`${trainers} TRAINER${trainers === 1 ? '' : 'S'}`, SAYINGS[(seed >>> 0) % SAYINGS.length]];
}

/** The box on the curtain as a match starts, its own pixels, as big as fits: on a phone the
 *  curtain's are too big for a line of words. */
function boxOn(el: HTMLElement, scale: number, lines: readonly [string, string]): void {
  const cv = document.createElement('canvas');
  const box = new EmeraldCanvas(cv);
  const w = Math.ceil((Math.max(...lines.map(measure)) + 24) / 8) * 8, h = 48;
  const s = Math.max(1, Math.min(scale, Math.floor((innerWidth - 16) / w)));
  const paint = () => {
    box.resize(w, h, s);
    box.clearAll();
    box.drawFrame({ x: 0, y: 0, w, h });
    box.drawTextCentred(lines[0], w / 2, 8, TEXT_DARK);
    box.drawTextCentred(lines[1], w / 2, 26, TEXT_DARK);
  };
  box.onLoad = paint;
  paint();
  cv.id = 'curtain-box';
  cv.dataset.text = lines.join('|');
  cv.style.cssText = `position:absolute;left:50%;top:60%;transform:translate(-50%,-50%);image-rendering:pixelated`;
  el.append(cv);
}

/** Hangs the curtain over the page, raises it, and takes it away. `art` is the tilemap drawn
 *  out (romart.ts contestCurtain); `box`, two lines to read on it first. */
export function raiseCurtain(art: HTMLCanvasElement, parent: HTMLElement, onRise?: () => void, box?: readonly [string, string]): void {
  const { el, scale, rows } = hang(art, parent);
  if (box) boxOn(el, scale, box);
  const hold = box ? HOLD_BOX_MS : HOLD_MS;
  const t0 = performance.now();
  let rising = false;
  const step = (now: number) => {
    const up = curtainRise(now - t0, hold);
    if (up > 0 && !rising) { rising = true; onRise?.(); }
    if (up >= rows) { el.remove(); return; }
    el.style.transform = `translateY(${-Math.round(up) * scale}px)`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // A hidden tab has no frames: it must not come back to a curtain still down.
  setTimeout(() => el.remove(), hold + (rows / RISE_PER_FRAME) * FRAME_MS + 1000);
}

/** The curtain coming down behind the page's top layer and hanging there, over the field, the
 *  HUD and whatever shakes on them (Cam, 11-04, of the Hall of Fame: "maybe we have the banner
 *  come down behind"). What it hands back takes it up again and away. */
export function curtainBehind(art: HTMLCanvasElement, parent: HTMLElement): () => void {
  const { el, scale, rows } = hang(art, parent);
  el.style.zIndex = '1';
  el.style.transform = `translateY(${-rows * scale}px)`;
  const t0 = performance.now();
  let upFrom = 0;
  const step = (now: number) => {
    if (!el.isConnected) return;
    if (!upFrom) el.style.transform = `translateY(${-(rows - Math.round(curtainFall(now - t0, rows))) * scale}px)`;
    else {
      const up = curtainRise(now - upFrom, 0);
      if (up >= rows) { el.remove(); return; }
      el.style.transform = `translateY(${-Math.round(up) * scale}px)`;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return () => {
    upFrom = performance.now();
    // A hidden tab has no frames: it must not come back to a curtain still down.
    setTimeout(() => el.remove(), (rows / RISE_PER_FRAME) * FRAME_MS + 1000);
  };
}

/** A curtain coming down over a cut: `isDown` once nothing behind it can be seen. */
export interface Cover { isDown(): boolean }

/** Brings the curtain down, and raises it again once `ready` says what it covers is done. It goes
 *  by the clock, so a hidden tab's page (no frames) is not kept waiting on it. */
export function coverScreen(art: HTMLCanvasElement, parent: HTMLElement, ready: () => boolean, sound?: { fall?: () => void; rise?: () => void }): Cover {
  const { el, scale, rows } = hang(art, parent);
  el.style.transform = `translateY(${-rows * scale}px)`;
  const t0 = performance.now();
  const fallMs = (rows / RISE_PER_FRAME) * FRAME_MS;
  sound?.fall?.();
  let upFrom = 0;
  const step = (now: number) => {
    if (!el.isConnected) return;
    const since = now - t0;
    if (since < fallMs) {
      el.style.transform = `translateY(${-(rows - Math.round(curtainFall(since, rows))) * scale}px)`;
    } else if (!upFrom) {
      el.style.transform = 'translateY(0)';
      if ((ready() && since >= fallMs + COVER_HOLD_MS) || since >= COVER_MAX_MS) { upFrom = now; sound?.rise?.(); }
    } else {
      const up = curtainRise(now - upFrom, 0);
      if (up >= rows) { el.remove(); return; }
      el.style.transform = `translateY(${-Math.round(up) * scale}px)`;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => el.remove(), COVER_MAX_MS + fallMs * 2 + 1000);
  return { isDown: () => performance.now() - t0 >= fallMs };
}
