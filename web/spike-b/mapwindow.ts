// The MAP as the page's own window (Cam, 11-02: "Map can be it's own window"), and the drop's
// "Drop where?" with it: the MAP's picture from the player's ROM (romart.ts regionMap), this
// world's fog a pixel at a time (ringmap.ts), the marks, and a cursor by the keys, a pad, a mouse
// or a thumb. Nothing of it goes through the hidden ROM.
import { Win, drawItemFitted } from '../src/ui/phonehud';
import { TEXT_BLUE, TEXT_DARK, TEXT_GRAY, fitText, wrapText, type EmeraldCanvas, type TextColor } from '../src/ui/emerald';
import { CELL, GRID_H, GRID_W, GRID_X, GRID_Y, type MapPlots, type MapPlace } from './ringmap';

const W = 240, H = 160, FOOT_H = 36, BTN_H = 32, GAP = 4, BTN_W = (W - GAP) / 2;
/** A phone on its side: the words and the buttons in a column by the picture, this narrow at least,
 *  the second line wrapped, the footer that much taller. */
const COL_MIN = 104, COL_MAX = 200, SIDE_FOOT_H = 52;
/** The most a phone's MAP grows: a tablet's isn't a wall. */
const TOUCH_MAX = 3;

export interface MapFit {
  /** CSS pixels to a GBA pixel. */
  s: number;
  /** The column's width, GBA pixels, for a phone on its side; 0 for the footer under the picture. */
  col: number;
}

/** The MAP's size on this screen. A phone's is all the glass there is, to a fraction of a pixel (Cam,
 *  11-04: "The map tends to be pretty small on mobile"); a window with a mouse keeps whole pixels. */
export function mapFit(touch: boolean, room: { w: number; h: number }, base: number): MapFit {
  const tall = H + FOOT_H + BTN_H + 16;
  if (!touch) return { s: Math.min(base, Math.max(1, Math.min(Math.floor(room.w / W), Math.floor((room.h - 16) / tall)))), col: 0 };
  if (room.w > room.h) {
    const s = Math.min(TOUCH_MAX, (room.h - 8) / H, (room.w - 8 - GAP) / (W + COL_MIN));
    return { s, col: Math.min(COL_MAX, Math.floor(((room.w - 8 - GAP) / s - W) / 8) * 8) };
  }
  return { s: Math.min(TOUCH_MAX, (room.w - 8) / W, (room.h - 16) / tall), col: 0 };
}
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
  /** A person's standing sprite, with its frame's size. */
  head(gfx: number): { img: HTMLCanvasElement; w: number; h: number } | null;
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
  /** Its size on the screen now. */
  fit(): MapFit;
  start: { x: number; y: number };
}

const greys = new Map<HTMLCanvasElement, HTMLCanvasElement>();
/** A sprite sheet in grey, for a leader beaten (br_gym.c BrGym_Gray), by hand: Safari's canvas has no filter. */
function greyOf(img: HTMLCanvasElement): HTMLCanvasElement {
  let out = greys.get(img);
  if (out) return out;
  out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const c = out.getContext('2d')!;
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (d.data[i] * 3 + d.data[i + 1] * 6 + d.data[i + 2]) / 10;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  c.putImageData(d, 0, 0);
  greys.set(img, out);
  return out;
}

/** A person's head, the 16 rows that have it: they stand at the bottom of a frame, the head some way
 *  down it (as the minimap's, main.ts miniFrame). */
function head(c: EmeraldCanvas, deps: MapWindowDeps, gfx: number, x: number, y: number, grey = false): void {
  const s = deps.head(gfx);
  if (s) c.drawImageTo(grey ? greyOf(s.img) : s.img, 0, Math.max(0, s.h - 26), s.w, 16, Math.round(x - s.w / 2), Math.round(y - 8), s.w, 16);
}

/** How near, in the picture's pixels, a mark has to be to take the cursor; and in cells, a place. */
const SNAP_MARK = 8, SNAP_PLACE = 3;

/** The cell a pointer at (x, y) of the picture means: a mark it is on (a legendary's ball, a leader),
 *  or the place under it, or the nearest place when it is over open sea. Null off the grid, or with
 *  nothing near. */
export function snapCell(x: number, y: number, plots: Pick<MapPlots, 'events' | 'gyms'>, placeAt: (cx: number, cy: number) => unknown): { x: number; y: number } | null {
  const cx = Math.floor((x - GRID_X) / CELL), cy = Math.floor((y - GRID_Y) / CELL);
  if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return null;
  let best: { x: number; y: number } | null = null, bestD = SNAP_MARK;
  for (const m of [...plots.events, ...plots.gyms]) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= bestD) { best = { x: Math.floor((m.x - GRID_X) / CELL), y: Math.floor((m.y - GRID_Y) / CELL) }; bestD = d; }
  }
  if (best) return best;
  if (placeAt(cx, cy)) return { x: cx, y: cy };
  let far = SNAP_PLACE + 1;
  for (let dy = -SNAP_PLACE; dy <= SNAP_PLACE; dy++) {
    for (let dx = -SNAP_PLACE; dx <= SNAP_PLACE; dx++) {
      const d = Math.hypot(dx, dy), nx = cx + dx, ny = cy + dy;
      if (d < far && nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && placeAt(nx, ny)) { best = { x: nx, y: ny }; far = d; }
    }
  }
  return best;
}

export class MapWindow {
  private map: Win;
  private foot: Win;
  private layout: MapFit;
  private buttons: { win: Win }[] = [];
  private readonly refit = (): void => this.fit();
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
  private outside: (e: PointerEvent) => void;
  /** The cell last pressed on, for the second press. */
  private armed: { x: number; y: number } | null = null;

  constructor(private readonly el: HTMLElement, private readonly deps: MapWindowDeps) {
    this.cx = deps.start.x;
    this.cy = deps.start.y;
    this.fogged.width = W;
    this.fogged.height = H;
    el.replaceChildren();
    el.hidden = false;
    this.layout = deps.fit();
    this.map = new Win(el, W, H, (c, redo) => this.paintMap(c, redo));
    this.map.canvas.classList.add('map-picture');
    this.map.canvas.addEventListener('pointerdown', (e) => this.pointed(e));
    // A mouse's cursor follows it, onto what's near (Cam, 11-02: "Can we make it like snap?").
    this.map.canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.hovered(e); });
    // Off the window, onto the dim round it, is out, as B is, and goes no further (no walk to where
    // it landed). Cam, 11-02: "Took me forever to get out of the map there".
    this.outside = (e: PointerEvent) => {
      if (!deps.back || el.contains(e.target as Node)) return;
      e.stopPropagation();
      deps.back();
    };
    addEventListener('pointerdown', this.outside, true);
    const col = document.createElement('div');
    col.className = 'map-col';
    el.appendChild(col);
    this.foot = new Win(col, W, FOOT_H, (c) => this.paintFoot(c));
    const row = document.createElement('div');
    row.className = 'map-row';
    col.appendChild(row);
    if (deps.back) this.button(row, 'BACK', deps.back);
    if (deps.verb) {
      this.verbBtn = this.button(row, deps.verb, () => this.press());
      this.verbWin = this.verbBtn.firstElementChild ? null : null;
    }
    this.fit();
    addEventListener('resize', this.refit);
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
      const w = c.width;
      c.drawFrame({ x: 0, y: 0, w, h: BTN_H });
      const off = b.getAttribute('aria-disabled') === 'true';
      c.drawTextCentred(label, w / 2, 8, off ? TEXT_GRAY : TEXT_DARK);
    });
    this.buttons.push({ win });
    if (label === this.deps.verb) this.verbWin = win;
    b.addEventListener('click', press);
    return b;
  }

  /** Everything at the size it has now, a phone turned included. */
  private fit(): void {
    const f = (this.layout = this.deps.fit());
    this.el.classList.toggle('side', f.col > 0);
    this.map.size(W, H, f.s);
    this.foot.size(f.col || W, f.col ? SIDE_FOOT_H : FOOT_H, f.s);
    for (const { win } of this.buttons) win.size(f.col || BTN_W, BTN_H, f.s);
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
    const at = snapCell(x, y, this.deps.plots(), this.deps.placeAt);
    if (!at) return;
    // Pressed on already: a second press is the verb, for a mouse. A thumb has the button too. Not
    // the first, though the mouse brought the cursor there: a FLY is not undone by a stray click.
    if (this.armed && at.x === this.armed.x && at.y === this.armed.y) { this.press(); return; }
    this.armed = at;
    if (at.x !== this.cx || at.y !== this.cy) this.moveTo(at);
  }

  private hovered(e: PointerEvent): void {
    const { x, y } = this.map.c.toPixel(e.clientX, e.clientY);
    const at = snapCell(x, y, this.deps.plots(), this.deps.placeAt);
    if (at && (at.x !== this.cx || at.y !== this.cy)) { this.armed = null; this.moveTo(at); }
  }

  private moveTo(at: { x: number; y: number }): void {
    this.cx = at.x;
    this.cy = at.y;
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
    for (const g of plots.gyms) head(c, this.deps, g.gfx, g.x, g.y, g.beaten);
    if (plots.me) head(c, this.deps, plots.me.gfx, plots.me.x, plots.me.y);
    // The cursor over all of it, region_map.c's red box, breathing.
    const x = GRID_X + this.cx * CELL, y = GRID_Y + this.cy * CELL, n = CELL;
    const colour = Math.floor(performance.now() / 400) % 2 ? '#f83010' : '#f8d020';
    for (const r of [{ x: x - 1, y: y - 1, w: n + 2, h: 1 }, { x: x - 1, y: y + n, w: n + 2, h: 1 }, { x: x - 1, y, w: 1, h: n }, { x: x + n, y, w: 1, h: n }]) c.fillRect(r, colour);
  }

  private paintFoot(c: EmeraldCanvas): void {
    const w = c.width;
    c.drawFrame({ x: 0, y: 0, w, h: c.height });
    const line = (t: string, y: number, colour: TextColor) => c.drawText(fitText(t, w - 16), 8, y, colour);
    line(this.place()?.name || '', 3, TEXT_DARK);
    // Narrow, the second line takes two.
    wrapText(this.deps.prompt(), w - 16).slice(0, c.height > FOOT_H ? 2 : 1).forEach((t, i) => line(t, 18 + i * 14, TEXT_BLUE));
  }

  close(): void {
    removeEventListener('pointerdown', this.outside, true);
    removeEventListener('resize', this.refit);
    cancelAnimationFrame(this.raf);
    this.el.replaceChildren();
    this.el.hidden = true;
  }
}
