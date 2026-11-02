// The wipe into a match (Cam, 11-01: "a screen wipe kind of transition ... something in these
// beauty pageants we could reuse"): the contest's own curtain (contest.c
// Task_RaiseCurtainAtStart, graphics/contest/curtain.bin), stretched across the window and
// raised at the contest's 7 pixels a frame. The ROM is never asked: it is the ROM's picture,
// drawn by the page, over the field the match has already started on.

/** Where the curtain's picture lies in gContestCurtainTilemap, in tiles. */
const PLAIN_COL = 19, FRINGE_ROW = 18, FRINGE_ROWS = 2, CREST = { col: 22, row: 7, cols: 4, rows: 4 };
const TILE = 8;
/** How long it hangs before it goes up (contest.c waits a second; a match is on the clock). */
export const HOLD_MS = 350;
/** gBattle_BG1_Y += 7 a frame. */
export const RISE_PER_FRAME = 7;
const FRAME_MS = 1000 / 60;

/** GBA pixels of curtain for a window, at whole pixels: the picture's 160 rows fill its height. */
export function curtainSize(w: number, h: number): { scale: number; cols: number; rows: number } {
  const scale = Math.max(1, Math.floor(h / 160));
  return { scale, cols: Math.ceil(w / scale), rows: Math.ceil(h / scale) };
}

/** How far it has risen `ms` after the hold began, in GBA pixels. */
export function curtainRise(ms: number): number {
  return Math.max(0, ms - HOLD_MS) / FRAME_MS * RISE_PER_FRAME;
}

/** Hangs the curtain over the page, raises it, and takes it away. `art` is the tilemap drawn
 *  out (romart.ts contestCurtain). */
export function raiseCurtain(art: HTMLCanvasElement, parent: HTMLElement, onRise?: () => void): void {
  document.getElementById('curtain')?.remove();
  const { scale, cols, rows } = curtainSize(innerWidth, innerHeight);
  const cv = document.createElement('canvas');
  cv.id = 'curtain';
  cv.width = cols;
  cv.height = rows;
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = `position:fixed;left:0;top:0;width:${cols * scale}px;height:${rows * scale}px;z-index:9;image-rendering:pixelated;pointer-events:none`;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const fringeTop = rows - FRINGE_ROWS * TILE;
  for (let x = 0; x < cols; x += TILE) {
    for (let y = 0; y < fringeTop; y += TILE) c.drawImage(art, PLAIN_COL * TILE, 0, TILE, TILE, x, y, TILE, TILE);
    c.drawImage(art, PLAIN_COL * TILE, FRINGE_ROW * TILE, TILE, FRINGE_ROWS * TILE, x, fringeTop, TILE, FRINGE_ROWS * TILE);
  }
  const cw = CREST.cols * TILE, ch = CREST.rows * TILE;
  c.drawImage(art, CREST.col * TILE, CREST.row * TILE, cw, ch, Math.floor((cols - cw) / 2), Math.floor((fringeTop - ch) / 2), cw, ch);
  parent.append(cv);

  const t0 = performance.now();
  let rising = false;
  const step = (now: number) => {
    const up = curtainRise(now - t0);
    if (up > 0 && !rising) { rising = true; onRise?.(); }
    if (up >= rows) { cv.remove(); return; }
    cv.style.transform = `translateY(${-Math.round(up) * scale}px)`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // A hidden tab has no frames: it must not come back to a curtain still down.
  setTimeout(() => cv.remove(), HOLD_MS + (rows / RISE_PER_FRAME) * FRAME_MS + 1000);
}
