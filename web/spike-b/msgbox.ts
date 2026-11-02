// The message box over the field: the live match's ticker and the ROM's own messages are
// Emerald's dialogue window there (br_hud.c's ticker inside the message box), in its font,
// so spike B's are too. Drawn with the page's Emerald look (src/ui/emerald.ts), at the
// phone HUD's scale, just above the dock.
import { EmeraldCanvas, TEXT_DARK, TEXT_RED, TILE, wrapText } from '../src/ui/emerald';

/** The live window's width (29 tiles, the ROM's screen less a tile and a half each side). */
export const BOX_W = 29 * TILE;
const TEXT_X = 12;
const LINE = 16;

/** The lines `text` takes in the box (two at most: a longer message is cut, never shrunk).
 *  A line break starts the second line, as the fishing rod's bite does under its dots. */
export function boxLines(text: string): string[] {
  return text.split('\n').flatMap((l) => wrapText(l, BOX_W - 2 * TEXT_X)).slice(0, 2);
}

/** `lines` with only their first `n` characters, as the window prints them. */
export function revealed(lines: string[], n: number): string[] {
  let left = n;
  return lines.map((l) => {
    const part = l.slice(0, Math.max(0, left));
    left -= l.length;
    return part;
  });
}

/** Emerald's FAST text, a character a frame. */
const CHARS_PER_S = 60;

export class MessageBox {
  private readonly c: EmeraldCanvas;
  private shown = '';
  private scale = 1;
  private wanted: { text: string; alert: boolean; lines: number } | null = null;
  private draw: ((n: number) => void) | null = null;
  private raf = 0;
  private atOnce = false;

  constructor(private readonly el: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(canvas);
    this.c = new EmeraldCanvas(canvas);
    this.c.onLoad = () => this.paint();
  }

  setScale(s: number): void {
    if (s === this.scale) return;
    this.scale = s;
    this.shown = '';
    this.atOnce = true; // the same words at a new size: no reason to print them again
    this.paint();
    this.atOnce = false;
  }

  /** `lines`: as tall as this many lines even with fewer (the rod's box, before its dots). */
  show(text: string, alert = false, lines = 0): void {
    this.wanted = { text, alert, lines };
    this.paint();
  }

  hide(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.wanted = null;
    this.shown = '';
    this.el.classList.remove('on');
    this.el.removeAttribute('data-text');
  }

  private paint(): void {
    const w = this.wanted;
    if (!w) return;
    const key = `${w.alert}:${w.lines}:${w.text}`;
    // Above the dock when it is up; the stylesheet's place otherwise.
    const dock = document.getElementById('pdock');
    const top = dock && !dock.hidden ? dock.getBoundingClientRect().top : 0;
    this.el.style.bottom = top > 0 ? `${Math.round(innerHeight - top + 4 * this.scale)}px` : '';
    if (key === this.shown) return;
    this.shown = key;
    const lines = boxLines(w.text);
    const h = TILE + LINE * Math.max(lines.length, w.lines);
    this.c.resize(BOX_W, h, this.scale);
    const draw = (n: number) => {
      this.c.clearAll();
      this.c.drawMessageBox({ x: 0, y: 0, w: BOX_W, h });
      revealed(lines, n).forEach((l, i) => this.c.drawText(l, TEXT_X, 4 + i * LINE, w.alert ? TEXT_RED : TEXT_DARK));
    };
    this.el.dataset.text = w.text;
    this.el.classList.add('on');
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const total = lines.join('').length;
    // A ticker's alert stays whole, it is there to be seen. The rest scroll in (Cam, 11-01:
    // "it would be nice if it has kind of like the scrolling text").
    if (w.alert || this.atOnce) {
      draw(total);
      return;
    }
    const t0 = performance.now();
    const step = () => {
      const n = Math.min(total, Math.ceil(((performance.now() - t0) / 1000) * CHARS_PER_S));
      draw(n);
      this.raf = n < total ? requestAnimationFrame(step) : 0;
    };
    step();
  }
}
