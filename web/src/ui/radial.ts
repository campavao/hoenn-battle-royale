// The key items on a dial (Cam, 11-02: "if I hold down the right trigger, I get a radial menu where
// I can select some key items"), for what the BAG took four presses to do. Hold it, lean a stick,
// the D-pad or the arrows one way, and let go. Each item has its own side of the dial and keeps it,
// so the thumb learns it, and one that can't go here says why in the middle rather than vanish.
import { TEXT_DARK, TEXT_GRAY, TEXT_RED, fitText, wrapText, type EmeraldCanvas } from './emerald';
import { pageRoot, pageWin, type PageWindow } from './pagewin';
import { Win, drawItemFitted } from './phonehud';

export type Side = 'up' | 'right' | 'down' | 'left';
const SIDES: readonly Side[] = ['up', 'right', 'down', 'left'];
const WAYS: Record<Side, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

export interface DialItem {
  side: Side;
  item: number;
  label: string;
  enabled: boolean;
  /** Why not, for one greyed. */
  why?: string;
  go(): void;
}

/** The side a lean of (dx, dy) points at, among those there are; null for none. Screen axes:
 *  down is positive. Nearest by the angle, so a lean between two takes the closer. */
export function aimed(sides: readonly Side[], dx: number, dy: number): Side | null {
  if (!dx && !dy) return null;
  let best: Side | null = null, most = -Infinity;
  for (const s of sides) {
    const [x, y] = WAYS[s];
    const along = (dx * x + dy * y) / Math.hypot(dx, dy);
    if (along > most) { most = along; best = s; }
  }
  // Square across from anything there is: no pick, rather than the nearest of two behind it.
  return most > 0 ? best : null;
}

/** GBA pixels. */
const CELL_W = 80;
const CELL_H = 48;
const MID_W = 80;

export class Radial implements PageWindow {
  private items: DialItem[] = [];
  private on: Side | null = null;
  private readonly box: HTMLElement;
  private readonly cells = new Map<Side, { b: HTMLButtonElement; w: Win }>();
  private readonly mid: Win;
  private scale = 0;

  constructor(private readonly deps: { scale(): number; sound?(): void }) {
    const doc = document;
    this.box = doc.createElement('div');
    this.box.id = 'radial';
    this.box.setAttribute('role', 'menu');
    this.box.setAttribute('aria-label', 'Key items');
    this.box.hidden = true;
    pageRoot().appendChild(this.box);
    for (const side of SIDES) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `bm-btn rad-cell rad-${side}`;
      b.setAttribute('role', 'menuitem');
      b.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') this.aimAt(side); });
      b.addEventListener('click', () => {
        this.aimAt(side);
        this.release();
      });
      this.box.appendChild(b);
      this.cells.set(side, { b, w: new Win(b, CELL_W, CELL_H, (c, redo) => this.paintCell(c, side, redo)) });
    }
    const mid = doc.createElement('div');
    mid.className = 'rad-mid';
    this.box.appendChild(mid);
    this.mid = new Win(mid, MID_W, CELL_H, (c) => this.paintMid(c));
    // A tap off the dial shuts it.
    pageRoot().addEventListener('click', (ev) => { if (this.isOpen && ev.target === pageRoot()) this.close(); });
    addEventListener('pointermove', (ev) => this.lean(ev));
    addEventListener('pointerup', (ev) => this.lift(ev));
  }

  get isOpen(): boolean {
    return !this.box.hidden;
  }

  /** What is highlighted, for the page's words and tests. */
  get picked(): Side | null {
    return this.on;
  }

  open(items: DialItem[]): void {
    if (this.isOpen) return;
    this.items = items;
    this.on = null;
    this.box.hidden = false;
    pageWin.open(this);
    this.fit();
    this.paint();
  }

  close(): void {
    if (!this.isOpen) return;
    this.box.hidden = true;
    this.fromFinger = null;
    pageWin.close(this);
  }

  /** The trigger or the key came up: what it was leaning on goes, if it can. */
  release(): void {
    if (!this.isOpen) return;
    const it = this.items.find((x) => x.side === this.on);
    this.close();
    if (it?.enabled) it.go();
  }

  /** A stick's lean, from wherever. */
  aim(dx: number, dy: number): void {
    const s = aimed(this.items.map((x) => x.side), dx, dy);
    if (s) this.aimAt(s);
  }

  key(k: string): void {
    if (k === 'a') this.release();
    else if (k === 'b') this.close();
    else if (k === 'up' || k === 'down' || k === 'left' || k === 'right') this.aim(WAYS[k][0], WAYS[k][1]);
  }

  /** Opened by a finger still down at (x, y): sliding away leans, and lifting it picks. Lifted
   *  where it was, the dial stays up to be tapped. */
  private fromFinger: { x: number; y: number; leaned: boolean } | null = null;
  fingerFrom(x: number, y: number): void {
    this.fromFinger = { x, y, leaned: false };
  }
  private lean(ev: PointerEvent): void {
    const f = this.fromFinger;
    if (!f || !this.isOpen) return;
    const dx = ev.clientX - f.x, dy = ev.clientY - f.y;
    if (Math.hypot(dx, dy) < 24) return;
    f.leaned = true;
    this.aim(dx, dy);
  }
  private lift(ev: PointerEvent): void {
    const f = this.fromFinger;
    if (!f || !this.isOpen) return;
    this.fromFinger = null;
    if (f.leaned) { ev.preventDefault(); this.release(); }
  }

  private aimAt(side: Side): void {
    if (side === this.on || !this.items.some((x) => x.side === side)) return;
    this.on = side;
    this.deps.sound?.();
    this.paint();
  }

  private fit(): void {
    const s = this.deps.scale();
    if (s === this.scale) return;
    this.scale = s;
    pageRoot().style.setProperty('--s', String(s));
    for (const { w } of this.cells.values()) w.size(CELL_W, CELL_H, s);
    this.mid.size(MID_W, CELL_H, s);
  }

  private paint(): void {
    for (const side of SIDES) {
      const it = this.items.find((x) => x.side === side);
      const { b, w } = this.cells.get(side)!;
      b.hidden = !it;
      b.setAttribute('aria-label', it ? `${it.label}${it.enabled ? '' : `: ${it.why ?? 'not here'}`}` : '');
      b.setAttribute('aria-disabled', String(!it?.enabled));
      b.classList.toggle('bm-focus', side === this.on);
      w.show(`${it?.item}|${it?.label}|${it?.enabled}`);
    }
    this.box.dataset.on = this.on ?? '';
    this.mid.redraw();
  }

  private paintCell(c: EmeraldCanvas, side: Side, redo: () => void): void {
    const it = this.items.find((x) => x.side === side);
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: CELL_H });
    if (!it) return;
    drawItemFitted(c, it.item, CELL_W / 2, 18, 22, redo);
    c.drawTextCentred(fitText(it.label, CELL_W - 12), CELL_W / 2, 29, it.enabled ? TEXT_DARK : TEXT_GRAY);
  }

  /** The middle: why not, for what it leans on; else nothing, so the map shows through. */
  private paintMid(c: EmeraldCanvas): void {
    const it = this.items.find((x) => x.side === this.on);
    if (!it || it.enabled) return;
    c.drawFrame({ x: 0, y: 0, w: MID_W, h: CELL_H });
    wrapText(it.why ?? 'Not here.', MID_W - 14).slice(0, 2).forEach((line, i) => c.drawTextCentred(line, MID_W / 2, 9 + i * 14, TEXT_RED));
  }
}
