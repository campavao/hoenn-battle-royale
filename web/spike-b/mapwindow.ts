// The MAP as the page's own window (Cam, 11-02: "Map can be it's own window"), and the drop's
// "Drop where?" with it: the MAP's picture from the player's ROM (romart.ts regionMap), this
// world's fog a pixel at a time (ringmap.ts), the marks, and a cursor by the keys, a pad, a mouse
// or a thumb. Nothing of it goes through the hidden ROM.
import { Win, drawItemFitted } from '../src/ui/phonehud';
import { TEXT_BLUE, TEXT_DARK, TEXT_GRAY, fitText, type EmeraldCanvas, type TextColor } from '../src/ui/emerald';
import { CELL, GRID_H, GRID_W, GRID_X, GRID_Y, type MapPlots, type MapPlace } from './ringmap';

const W = 240, H = 160, FOOT_H = 36, BTN_H = 32, GAP = 4, BTN_W = (W - GAP) / 2;
const FOG_TINT = [152, 96, 200], FOG_MIX = 0.62;
/** The next ring's edge: a border round what's still safe, rather than the next fog blinking on
 *  and off (Cam, 11-02: "make this a line like a border so it just kind of looks like an area
 *  that's being filled in"). */
const FOG_LINE = [72, 24, 136];
const ITEM_POKE_BALL = 4;

export interface MapWindowDeps {
  /** The MAP's picture, 240 x 160. */
  picture: ImageData;
  /** Whether the picture's pixel is in the fog; `next` asks of the ring after this one. */
  fogAt(x: number, y: number, next: boolean): boolean;
  /** What the fog looks like now, and the next ring's, as keys ('' for no next ring). */
  fogKey(): { key: string; next: string };
  /** The place on a cell of the grid. */
  placeAt(cx: number, cy: number): MapPlace | null;
  plots(): MapPlots;
  /** A person's standing sprite, with its width. */
  head(gfx: number): { img: CanvasImageSource; w: number } | null;
  /** The buttons' word, null for none: a MAP with nobody to FLY only looks. */
  verb: string | null;
  /** Whether the verb can be pressed on this place. */
  can(place: MapPlace): boolean;
  /** The second line of the footer. */
  prompt(): string;
  /** Null, so there is no way back: the drop. */
  back: (() => void) | null;
  choose(place: MapPlace): void;
  moved(): void;
  scale: number;
  start: { x: number; y: number };
}

function head(c: EmeraldCanvas, deps: MapWindowDeps, gfx: number, x: number, y: number): void {
  const s = deps.head(gfx);
  if (s) c.drawImageTo(s.img, 0, 0, s.w, 16, Math.round(x - s.w / 2), Math.round(y - 8), s.w, 16);
}

export class MapWindow {
  private map: Win;
  private foot: Win;
  private verbBtn: HTMLButtonElement | null = null;
  private verbWin: Win | null = null;
  private cx: number;
  private cy: number;
  private fogged = document.createElement('canvas');
  private fogMade = '';
  /** The next ring's edge on the picture's pixels, and which ring that is. */
  private edge: Uint8Array | null = null;
  private edgeOf = '';
  private raf = 0;

  constructor(private readonly el: HTMLElement, private readonly deps: MapWindowDeps) {
    this.cx = deps.start.x;
    this.cy = deps.start.y;
    this.fogged.width = W;
    this.fogged.height = H;
    el.replaceChildren();
    el.hidden = false;
    const s = deps.scale;
    this.map = new Win(el, W, H, (c, redo) => this.paintMap(c, redo));
    this.map.size(W, H, s);
    this.map.canvas.classList.add('map-picture');
    this.map.canvas.addEventListener('pointerdown', (e) => this.pointed(e));
    this.foot = new Win(el, W, FOOT_H, (c) => this.paintFoot(c));
    this.foot.size(W, FOOT_H, s);
    const row = document.createElement('div');
    row.className = 'map-row';
    el.appendChild(row);
    if (deps.back) this.button(row, 'BACK', deps.back);
    if (deps.verb) {
      this.verbBtn = this.button(row, deps.verb, () => this.press());
      this.verbWin = this.verbBtn.firstElementChild ? null : null;
    }
    const tick = () => {
      this.paint();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.paint();
  }

  private button(parent: HTMLElement, label: string, press: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bm-btn map-btn';
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    const win = new Win(b, BTN_W, BTN_H, (c) => {
      c.drawFrame({ x: 0, y: 0, w: BTN_W, h: BTN_H });
      const off = b.getAttribute('aria-disabled') === 'true';
      c.drawTextCentred(label, BTN_W / 2, 8, off ? TEXT_GRAY : TEXT_DARK);
    });
    win.size(BTN_W, BTN_H, this.deps.scale);
    win.show(label);
    if (label === this.deps.verb) this.verbWin = win;
    b.addEventListener('click', press);
    return b;
  }

  private place(): MapPlace | null {
    return this.deps.placeAt(this.cx, this.cy);
  }

  /** The cursor's cell (grid cells), for a spec to read. */
  get cursor(): { x: number; y: number } {
    return { x: this.cx, y: this.cy };
  }

  private press(): void {
    const p = this.place();
    if (this.deps.verb && p && this.deps.can(p)) this.deps.choose(p);
  }

  private pointed(e: PointerEvent): void {
    const { x, y } = this.map.c.toPixel(e.clientX, e.clientY);
    const cx = Math.floor((x - GRID_X) / CELL), cy = Math.floor((y - GRID_Y) / CELL);
    if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return;
    // On it already: a second press is the verb, for a mouse. A thumb has the button too.
    if (cx === this.cx && cy === this.cy) { this.press(); return; }
    this.cx = cx;
    this.cy = cy;
    this.deps.moved();
    this.paint();
  }

  key(k: string): void {
    const d = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as Record<string, number[]>)[k];
    if (d) {
      const cx = Math.max(0, Math.min(GRID_W - 1, this.cx + d[0])), cy = Math.max(0, Math.min(GRID_H - 1, this.cy + d[1]));
      if (cx !== this.cx || cy !== this.cy) this.deps.moved();
      this.cx = cx;
      this.cy = cy;
      this.paint();
    } else if (k === 'a') this.press();
    else if (k === 'b' || k === 'start') this.deps.back?.();
  }

  /** The pixels just inside the next ring: safe, with fog-to-be beside them. */
  private nextEdge(next: string): Uint8Array | null {
    if (!next) return null;
    if (next === this.edgeOf) return this.edge;
    const out = new Uint8Array(W * H), fog = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fog[y * W + x] = this.deps.fogAt(x, y, true) ? 1 : 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        // Not off the grid: no fog says nothing out there, and it would box the grid in.
        const onGrid = x >= GRID_X && y >= GRID_Y && x < GRID_X + GRID_W * CELL && y < GRID_Y + GRID_H * CELL;
        if (onGrid && !fog[i] && (fog[i - 1] || fog[i + 1] || fog[i - W] || fog[i + W])) out[i] = 1;
      }
    }
    this.edgeOf = next;
    this.edge = out;
    return out;
  }

  private paint(): void {
    const { key, next } = this.deps.fogKey();
    const p = this.place();
    this.map.show(`${this.cx}|${this.cy}|${key}|${next}|${Math.floor(performance.now() / 400) % 2}|${JSON.stringify(this.deps.plots())}`);
    this.foot.show(`${p?.name ?? ''}|${this.deps.prompt()}`);
    if (this.verbBtn) {
      const off = !p || !this.deps.can(p);
      if ((this.verbBtn.getAttribute('aria-disabled') === 'true') !== off) {
        this.verbBtn.setAttribute('aria-disabled', String(off));
        this.verbWin?.redraw();
      }
    }
  }

  /** The picture with the fog on it, made again only when the fog moved. */
  private fogPicture(): HTMLCanvasElement {
    const { key, next } = this.deps.fogKey();
    const made = `${key}|${next}`;
    if (made !== this.fogMade) {
      this.fogMade = made;
      const c = this.fogged.getContext('2d')!;
      const from = this.deps.picture.data;
      const img = c.createImageData(W, H);
      const edge = this.nextEdge(next);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const fog = this.deps.fogAt(x, y, false);
          const line = !fog && edge?.[y * W + x];
          for (let j = 0; j < 3; j++) img.data[i + j] = line ? FOG_LINE[j] : fog ? from[i + j] * (1 - FOG_MIX) + FOG_TINT[j] * FOG_MIX : from[i + j];
          img.data[i + 3] = 255;
        }
      }
      c.putImageData(img, 0, 0);
    }
    return this.fogged;
  }

  private paintMap(c: EmeraldCanvas, redo: () => void): void {
    c.drawImageTo(this.fogPicture(), 0, 0, W, H, 0, 0, W, H);
    const plots = this.deps.plots();
    for (const e of plots.events) {
      if (e.taken) c.setFilter('grayscale(1)');
      drawItemFitted(c, ITEM_POKE_BALL, e.x, e.y, 10, redo);
      c.setFilter('none');
    }
    for (const g of plots.gyms) head(c, this.deps, g.gfx, g.x, g.y);
    if (plots.me) head(c, this.deps, plots.me.gfx, plots.me.x, plots.me.y);
    // The cursor over all of it, region_map.c's red box, breathing.
    const x = GRID_X + this.cx * CELL, y = GRID_Y + this.cy * CELL, n = CELL;
    const colour = Math.floor(performance.now() / 400) % 2 ? '#f83010' : '#f8d020';
    for (const r of [{ x: x - 1, y: y - 1, w: n + 2, h: 1 }, { x: x - 1, y: y + n, w: n + 2, h: 1 }, { x: x - 1, y, w: 1, h: n }, { x: x + n, y, w: 1, h: n }]) c.fillRect(r, colour);
  }

  private paintFoot(c: EmeraldCanvas): void {
    c.drawFrame({ x: 0, y: 0, w: W, h: FOOT_H });
    const line = (t: string, y: number, colour: TextColor) => c.drawText(fitText(t, W - 16), 8, y, colour);
    line(this.place()?.name || '', 3, TEXT_DARK);
    line(this.deps.prompt(), 18, TEXT_BLUE);
  }

  close(): void {
    cancelAnimationFrame(this.raf);
    this.el.replaceChildren();
    this.el.hidden = true;
  }
}
