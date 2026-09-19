// The stage every drawn screen plays on (POK-320): one canvas in Emerald's look, and
// under the finger a mirror of it in real DOM -- a <button> over every pressable thing,
// a <div> over every line of text -- so a tap, a screen reader and a Playwright
// locator all find the same things the eye does. The mirror is invisible; the canvas
// is what is seen. Nothing here knows what a room or a lobby is: a screen hands back
// what it painted, and the stage places the mirror over it.
//
// The cursor is Emerald's: a triangle beside the selected thing, moved with the
// D-pad, pressed with A, backed out of with B. A tap moves it too.
import type { GbaKey } from '../emu';
import { EmeraldCanvas, type Rect } from './emerald';

export interface Widget {
  /** Where it is, in the screen's own 240-wide pixels. */
  rect: Rect;
  /** What it says, for the mirror: the a11y name and what a test reads. */
  text: string;
  id?: string;
  cls?: string;
  /** A pressable thing gets a <button>; without this it is a <div> of text. */
  onPress?: () => void;
  disabled?: boolean;
  /** The Container it belongs in. A <ul> container wraps each child in an <li>. */
  parent?: string;
  /** Where the cursor triangle sits when this is selected. Default: left of the
   *  rect, vertically centred. `null` keeps the cursor off it (text, or a thing a
   *  tap alone reaches). */
  cursor?: { x: number; y: number } | null;
}

export interface Container {
  id: string;
  tag?: 'div' | 'ul';
  cls?: string;
  hidden?: boolean;
}

export interface Painted {
  widgets: Widget[];
  containers?: Container[];
}

export interface DrawnScreen {
  /** Draw onto `c`, which is `h` pixels tall and 240 wide (its origin is set), and
   *  say what was drawn where. */
  paint(c: EmeraldCanvas, h: number): Painted;
  /** B, or the browser's back: what leaving this screen means, if anything. */
  back?(): void;
}

/** The scale a stage shows at: whole pixels once it can afford two, the picture's own
 *  fractional fit on a phone (240 wide is the phone's width), never under one. The
 *  320 is the shortest screen anybody draws for; a desktop window gets more rows. */
export function stageScale(cssW: number, cssH: number): number {
  const s = Math.min(cssW / 240, cssH / 320);
  if (s >= 2) return Math.floor(s);
  return Math.max(1, s);
}

export const STAGE_WIDTH = 240;

export class Stage {
  readonly canvas: EmeraldCanvas;
  private screen: DrawnScreen | null = null;
  private stack: DrawnScreen[] = [];
  private widgets: Widget[] = [];
  private cursorKey: string | null = null;
  private observer: ResizeObserver | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly root: HTMLElement,
    canvasEl: HTMLCanvasElement,
    private readonly hits: HTMLElement,
  ) {
    this.canvas = new EmeraldCanvas(canvasEl);
    this.canvas.onLoad = () => this.redraw();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.redraw());
      this.observer.observe(root);
    }
  }

  get active(): boolean {
    return this.screen !== null && !this.root.hidden;
  }

  get current(): DrawnScreen | null {
    return this.screen;
  }

  /** Show `screen`, forgetting any screen it could have gone back to. */
  show(screen: DrawnScreen): void {
    this.stack = [];
    this.screen = screen;
    this.cursorKey = null;
    this.root.hidden = false;
    this.paintNow();
  }

  /** Show `screen` over the current one; `pop` comes back. */
  push(screen: DrawnScreen): void {
    if (this.screen) this.stack.push(this.screen);
    this.screen = screen;
    this.cursorKey = null;
    this.root.hidden = false;
    this.paintNow();
  }

  pop(): void {
    const prev = this.stack.pop();
    if (!prev) return;
    this.screen = prev;
    this.cursorKey = null;
    this.paintNow();
  }

  hide(): void {
    this.root.hidden = true;
    this.screen = null;
    this.stack = [];
    this.hits.replaceChildren();
  }

  /** Paint again, soon: many things change at once and one pass is enough. A timer
   *  rather than a frame callback: the core booting behind the lobby starves
   *  requestAnimationFrame for most of a minute, and the lobby has to be there first. */
  redraw(): void {
    if (this.pending !== null) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.paintNow();
    }, 0);
  }

  /** Paint now. Tests and a key press want the mirror in place before they look. */
  paintNow(): void {
    if (!this.screen || this.root.hidden) return;
    const cssW = this.root.clientWidth;
    const cssH = this.root.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    const scale = stageScale(cssW, cssH);
    const w = Math.max(STAGE_WIDTH, Math.floor(cssW / scale));
    const h = Math.floor(cssH / scale);
    const c = this.canvas;
    if (c.width !== w || c.height !== h || c.scale !== scale) c.resize(w, h, scale);
    c.origin = Math.floor((w - STAGE_WIDTH) / 2);
    c.clear();
    const painted = this.screen.paint(c, h);
    this.widgets = painted.widgets;
    this.syncMirror(painted, scale);
    const sel = this.selected();
    if (sel) {
      const at = sel.cursor ?? { x: sel.rect.x - 8, y: sel.rect.y + Math.floor((sel.rect.h - 11) / 2) };
      c.drawCursor(at.x, at.y);
    }
  }

  private keyOf(w: Widget): string {
    return w.id ?? `${w.parent ?? ''}/${w.text}`;
  }

  private selectable(): Widget[] {
    return this.widgets.filter((w) => w.onPress && !w.disabled && w.cursor !== null);
  }

  private selected(): Widget | null {
    const all = this.selectable();
    if (all.length === 0) return null;
    const found = this.cursorKey === null ? undefined : all.find((w) => this.keyOf(w) === this.cursorKey);
    const sel = found ?? all[0];
    this.cursorKey = this.keyOf(sel);
    return sel;
  }

  private syncMirror(p: Painted, scale: number): void {
    const { hits } = this;
    hits.replaceChildren();
    const ox = this.canvas.origin;
    const place = (el: HTMLElement, r: Rect) => {
      el.style.left = `${(r.x + ox) * scale}px`;
      el.style.top = `${r.y * scale}px`;
      el.style.width = `${r.w * scale}px`;
      el.style.height = `${r.h * scale}px`;
    };
    const parents = new Map<string, HTMLElement>();
    for (const def of p.containers ?? []) {
      const el = document.createElement(def.tag ?? 'div');
      el.id = def.id;
      if (def.cls) el.className = def.cls;
      el.hidden = def.hidden === true;
      hits.appendChild(el);
      parents.set(def.id, el);
    }
    for (const w of p.widgets) {
      let el: HTMLElement;
      if (w.onPress) {
        const b = document.createElement('button');
        b.type = 'button';
        b.disabled = w.disabled === true;
        b.addEventListener('click', () => {
          this.cursorKey = this.keyOf(w);
          w.onPress?.();
        });
        el = b;
      } else {
        el = document.createElement('div');
      }
      el.textContent = w.text;
      if (w.id) el.id = w.id;
      if (w.cls) el.className = w.cls;
      place(el, w.rect);
      const parent = w.parent ? parents.get(w.parent) : undefined;
      if (parent?.tagName === 'UL') {
        const li = document.createElement('li');
        li.appendChild(el);
        parent.appendChild(li);
      } else {
        (parent ?? hits).appendChild(el);
      }
    }
  }

  /** A GBA key while a screen is up. Returns whether it was for the screen (always,
   *  while one is showing: the game underneath must not hear it). */
  key(k: GbaKey): boolean {
    if (!this.active) return false;
    if (k === 'a') {
      const sel = this.selected();
      if (sel?.onPress) {
        sel.onPress();
        this.paintNow();
      }
      return true;
    }
    if (k === 'b') {
      this.screen?.back?.();
      return true;
    }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      const next = this.neighbour(k);
      if (next) {
        this.cursorKey = this.keyOf(next);
        this.paintNow();
      }
      return true;
    }
    return true;
  }

  /** The nearest selectable widget in a direction, by centres; wraps to the far end
   *  of the list when there is nothing that way. */
  private neighbour(dir: 'up' | 'down' | 'left' | 'right'): Widget | null {
    const all = this.selectable();
    const from = this.selected();
    if (!from || all.length < 2) return null;
    const centre = (w: Widget) => ({ x: w.rect.x + w.rect.w / 2, y: w.rect.y + w.rect.h / 2 });
    const a = centre(from);
    let best: Widget | null = null;
    let bestD = Infinity;
    for (const w of all) {
      if (w === from) continue;
      const b = centre(w);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 0) continue;
      const d = along + across * 2;
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    if (best) return best;
    // Nothing that way: wrap, the way Emerald's lists do.
    const i = all.indexOf(from);
    if (dir === 'up' || dir === 'left') return all[(i + all.length - 1) % all.length];
    return all[(i + 1) % all.length];
  }
}
