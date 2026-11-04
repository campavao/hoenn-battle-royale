// MOVES as a small box on the page (Cam, 11-02, of the ROM's screen: "This is actually pretty
// good, but we just need to make it so it's not full screen"): what this one could learn, level-up
// moves then the machines in the bag, each one's numbers and words under the list, as br_moves.c
// has the list. It stays up through a teach, and LEFT and RIGHT walk the party, as that screen did.
import { moveInfo, type MoveInfo, type Rom } from '../battle/movebook';
import { TEXT_BLUE, TEXT_DARK, TEXT_GRAY, fitText, measure, wrapText, type EmeraldCanvas } from './emerald';
import { drawType, powerText, type PartyMember } from './battlemenu';
import { isMachine } from './bag';
import { relearnable } from './monfacts';
import { pageRoot, pageScale, pageWin, type PageWindow } from './pagewin';
import { Win } from './phonehud';
import { TMHM_MOVES } from './tmhm';

export const ITEM_TM01 = 289;
export const ITEM_HM01 = 339;

/** A move it could learn, and the machine that would teach it; 0 for its own learnset's. */
export interface LearnRow {
  move: number;
  machine: number;
}

/** The list: GetMoveRelearnerMoves, then BrMoves_AppendMachines over the TMHM pocket in its order,
 *  which any mon may take (CanMonLearnTMHM, Cam 2026-10-17) unless it knows the move or it is
 *  on the list already. */
export function learnList(rom: Rom, m: { species: number; level: number; moves: readonly { id: number }[] }, machines: readonly number[]): LearnRow[] {
  const known = m.moves.map((x) => x.id);
  const rows: LearnRow[] = relearnable(rom, m.species, m.level, known).map((move) => ({ move, machine: 0 }));
  for (const item of machines) {
    if (!isMachine(item)) continue;
    const move = TMHM_MOVES[item - ITEM_TM01];
    if (!move || known.includes(move) || rows.some((r) => r.move === move)) continue;
    rows.push({ move, machine: item });
  }
  return rows;
}

/** A machine's word on its row: TM12, HM03. */
export function machineTag(item: number): string {
  if (!item) return '';
  const hm = item >= ITEM_HM01;
  const n = hm ? item - ITEM_HM01 + 1 : item - ITEM_TM01 + 1;
  return `${hm ? 'HM' : 'TM'}${String(n).padStart(2, '0')}`;
}

/** GBA pixels. */
const W = 232;
const GAP = 4;
const ARROW_W = 32;
const HEAD_H = 40;
const ROW = 20;
const ROWS = 5;
const LIST_H = 8 + ROWS * ROW + 8;
const DETAIL_H = 80;
const BACK_W = 72;
const BTN_H = 32;
const BOX_H = HEAD_H + GAP + LIST_H + GAP + DETAIL_H + GAP + BTN_H;

export interface MovesBoxDeps {
  rom: Rom | null;
  icon(species: number): CanvasImageSource | null;
  /** The party, and the list for one of them, now. */
  team(): PartyMember[];
  list(m: PartyMember): LearnRow[];
  /** It goes on `slot`; the box stands aside for as long as this takes to ask and do. */
  teach(slot: number, row: LearnRow): Promise<void>;
  /** The windows' scale, and whether fingers drive them. */
  scale(): number;
  touch: boolean;
}

export class MovesBox implements PageWindow {
  private slot = 0;
  private rows: LearnRow[] = [];
  private at = 0;
  private busy = false;
  private scale = 0;
  private alive: (() => boolean) | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;
  private closed: ((slot: number) => void) | null = null;
  private readonly box: HTMLElement;
  private readonly head: Win;
  private readonly list: Win;
  private readonly listEl: HTMLElement;
  private readonly detail: Win;
  private readonly back: Win;
  private readonly learn: Win;
  private readonly learnBtn: HTMLButtonElement;
  private readonly arrows: { b: HTMLButtonElement; w: Win }[] = [];

  constructor(private readonly deps: MovesBoxDeps) {
    const doc = document;
    this.box = doc.createElement('div');
    this.box.id = 'moves-box';
    this.box.setAttribute('role', 'dialog');
    this.box.hidden = true;
    pageRoot().appendChild(this.box);
    const part = (cls: string, parent: HTMLElement = this.box) => {
      const el = doc.createElement('div');
      el.className = cls;
      parent.appendChild(el);
      return el;
    };
    const button = (cls: string, parent: HTMLElement, label: string, press: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `bm-btn ${cls}`;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') press(); });
      parent.appendChild(b);
      return b;
    };
    const top = part('mv-top');
    const arrow = (dir: 1 | -1) => {
      const b = button(dir < 0 ? 'mv-prev' : 'mv-next', top, dir < 0 ? 'Previous POKeMON' : 'Next POKeMON', () => this.step(dir));
      const w = new Win(b, ARROW_W, HEAD_H, (c) => {
        c.drawFrame({ x: 0, y: 0, w: ARROW_W, h: HEAD_H });
        for (let i = 0; i < 6; i++) {
          const col = dir > 0 ? i : 5 - i;
          c.fillRect({ x: ARROW_W / 2 - 3 + col, y: HEAD_H / 2 - 5 + i, w: 1, h: 11 - 2 * i }, '#e60808');
        }
      });
      this.arrows.push({ b, w });
    };
    arrow(-1);
    this.head = new Win(part('mv-head', top), W - 2 * ARROW_W - 2 * GAP, HEAD_H, (c) => this.paintHead(c));
    arrow(1);
    this.listEl = part('mv-list');
    this.list = new Win(this.listEl, W, LIST_H, (c, redo) => this.paintList(c, redo));
    this.listEl.addEventListener('click', (ev) => {
      const at = this.list.c.toPixel(ev.clientX, ev.clientY);
      const row = Math.floor((at.y - 8) / ROW);
      if (at.y >= 8 && row >= 0 && row < this.rows.length) this.setAt(row);
    });
    this.detail = new Win(part('mv-detail'), W, DETAIL_H, (c) => this.paintDetail(c));
    const row = part('mv-row');
    const backBtn = button('mv-back', row, 'Back', () => this.close());
    this.back = new Win(backBtn, BACK_W, BTN_H, (c) => {
      c.drawFrame({ x: 0, y: 0, w: BACK_W, h: BTN_H });
      c.drawTextCentred('BACK', BACK_W / 2, 9, TEXT_DARK);
    });
    this.learnBtn = button('mv-learn', row, 'Learn', () => void this.teach());
    const learnW = W - BACK_W - GAP;
    this.learn = new Win(this.learnBtn, learnW, BTN_H, (c) => {
      c.drawFrame({ x: 0, y: 0, w: learnW, h: BTN_H });
      c.drawTextCentred(fitText(`LEARN ${this.info()?.name ?? ''}`, learnW - 16), learnW / 2, 9, TEXT_BLUE);
    });
    addEventListener('resize', () => { if (this.isOpen) this.fit(); });
  }

  get isOpen(): boolean {
    return !this.box.hidden;
  }

  /** This one's list. It shuts when `alive` says the windows it stands over have gone. */
  open(slot: number, alive: () => boolean, closed: (slot: number) => void): void {
    this.slot = slot;
    this.alive = alive;
    this.closed = closed;
    this.at = 0;
    this.show();
    this.reload();
  }

  private show(): void {
    this.box.hidden = false;
    pageWin.open(this);
    if (this.watch) clearInterval(this.watch);
    this.watch = setInterval(() => { if (!this.alive?.()) this.close(); }, 250);
    this.fit();
  }

  private stand(): void {
    this.box.hidden = true;
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    pageWin.close(this);
  }

  close(): void {
    if (!this.isOpen) return;
    this.stand();
    const done = this.closed;
    this.closed = null;
    done?.(this.slot);
  }

  key(k: string): void {
    if (this.busy) return;
    if (k === 'up') this.setAt(Math.max(0, this.at - 1));
    else if (k === 'down') this.setAt(Math.min(this.rows.length - 1, this.at + 1));
    else if (k === 'left' || k === 'l') this.step(-1);
    else if (k === 'right' || k === 'r') this.step(1);
    else if (k === 'a') void this.teach();
    else if (k === 'b') this.close();
  }

  private mon(): PartyMember | undefined {
    // Its windows paint as they're made, before there's a ROM to read a party off.
    if (this.box.hidden) return undefined;
    return this.deps.team()[this.slot];
  }

  private info(): MoveInfo | null {
    const r = this.rows[this.at];
    return r && this.deps.rom ? moveInfo(this.deps.rom, r.move) : null;
  }

  /** The list again, for what is true now; the cursor where it was, or as near as there is. */
  private reload(): void {
    const m = this.mon();
    this.rows = m ? this.deps.list(m) : [];
    this.at = Math.max(0, Math.min(this.at, this.rows.length - 1));
    const others = this.deps.team().filter((t, i) => i !== this.slot && this.deps.list(t).length > 0).length;
    for (const { b } of this.arrows) b.setAttribute('aria-disabled', String(!others));
    this.box.setAttribute('aria-label', m ? `Moves for ${m.name}` : 'Moves');
    this.head.show(JSON.stringify([m?.species, m?.name, m?.level]));
    const h = Math.max(LIST_H, 8 + this.rows.length * ROW + 8);
    if (this.list.c.height !== h) this.list.size(W, h, this.scale);
    this.listEl.style.height = `${LIST_H * this.scale}px`;
    this.paintChoice();
    this.listEl.scrollTop = 0;
    this.scrollToCursor();
  }

  private setAt(i: number): void {
    if (i === this.at) return;
    this.at = i;
    this.paintChoice();
    this.scrollToCursor();
  }

  private paintChoice(): void {
    const key = `${this.slot}|${this.at}|${JSON.stringify(this.rows)}`;
    this.list.show(key);
    this.detail.show(key);
    this.learn.show(key);
    const info = this.info();
    this.detail.el.setAttribute('role', 'note');
    this.detail.el.setAttribute('aria-label', info ? `${info.name}, ${info.typeName}, POWER ${powerText(info)}: ${info.desc}` : '');
    this.learnBtn.setAttribute('aria-label', info ? `Learn ${info.name}` : 'Learn');
    this.learnBtn.setAttribute('aria-disabled', String(!info));
  }

  private scrollToCursor(): void {
    const y = (8 + this.at * ROW) * this.scale;
    const h = this.listEl.clientHeight, row = ROW * this.scale;
    if (y - row < this.listEl.scrollTop) this.listEl.scrollTop = Math.max(0, y - row);
    else if (y + 2 * row > this.listEl.scrollTop + h) this.listEl.scrollTop = y + 2 * row - h;
  }

  /** The next of the party with anything to learn. */
  private step(dir: 1 | -1): void {
    const team = this.deps.team();
    for (let n = 1; n < team.length; n++) {
      const i = (this.slot + dir * n + team.length * n) % team.length;
      if (this.deps.list(team[i]).length) {
        this.slot = i;
        this.at = 0;
        this.reload();
        return;
      }
    }
  }

  private async teach(): Promise<void> {
    const r = this.rows[this.at];
    if (!r || this.busy) return;
    this.busy = true;
    const alive = this.alive, closed = this.closed;
    // A move to forget is the windows' to ask, under this.
    this.stand();
    try {
      await this.deps.teach(this.slot, r);
    } finally {
      this.busy = false;
    }
    if (!alive?.()) { closed?.(this.slot); this.closed = null; return; }
    this.show();
    this.reload();
    // Nothing more to learn: back where it was asked from.
    if (!this.rows.length) this.close();
  }

  private fit(): void {
    const s = pageScale(W, BOX_H, this.deps.scale(), this.deps.touch, { w: innerWidth, h: innerHeight });
    if (s === this.scale) return;
    this.scale = s;
    pageRoot().style.setProperty('--s', String(s));
    for (const { w } of this.arrows) w.size(ARROW_W, HEAD_H, s);
    this.head.size(W - 2 * ARROW_W - 2 * GAP, HEAD_H, s);
    this.list.size(W, Math.max(LIST_H, 8 + this.rows.length * ROW + 8), s);
    this.listEl.style.height = `${LIST_H * s}px`;
    this.detail.size(W, DETAIL_H, s);
    this.back.size(BACK_W, BTN_H, s);
    this.learn.size(W - BACK_W - GAP, BTN_H, s);
  }

  private paintHead(c: EmeraldCanvas): void {
    const w = W - 2 * ARROW_W - 2 * GAP;
    c.drawFrame({ x: 0, y: 0, w, h: HEAD_H });
    const m = this.mon();
    if (!m) return;
    const icon = this.deps.icon(m.species);
    if (icon) c.drawImageTo(icon, 0, 0, 32, 32, 6, 4, 32, 32);
    const lv = `Lv${m.level}`;
    c.drawText(lv, w - 8 - measure(lv), 5, TEXT_DARK);
    c.drawText(fitText(m.name, w - 46 - measure(lv) - 10), 42, 5, TEXT_DARK);
    c.drawText('Learn which?', 42, 20, TEXT_BLUE);
  }

  private paintList(c: EmeraldCanvas, redo: () => void): void {
    c.drawFrame({ x: 0, y: 0, w: W, h: c.height });
    this.rows.forEach((r, i) => {
      const info = this.deps.rom ? moveInfo(this.deps.rom, r.move) : null;
      if (!info) return;
      const y = 8 + i * ROW;
      if (i === this.at) c.drawCursor(8, y + 3);
      c.drawText(fitText(info.name, 118), 18, y + 2, TEXT_DARK);
      if (r.machine) c.drawText(machineTag(r.machine), W - 46 - 34, y + 2, TEXT_BLUE);
      drawType(c, info.type, W - 8 - 34, y + 2, redo);
    });
  }

  private paintDetail(c: EmeraldCanvas): void {
    c.drawFrame({ x: 0, y: 0, w: W, h: DETAIL_H });
    const info = this.info();
    if (!info) { c.drawText('Nothing more to learn.', 8, 8, TEXT_GRAY); return; }
    const pair = (k: string, val: string, x: number, y: number) => {
      c.drawText(k, x, y, TEXT_BLUE);
      c.drawText(val, x + measure(k) + 6, y, TEXT_DARK);
    };
    pair('POWER', powerText(info), 8, 5);
    pair('ACCURACY', info.accuracy ? String(info.accuracy) : '---', 116, 5);
    pair('PP', String(info.pp), 8, 19);
    pair('KIND', info.kind, 116, 19);
    c.fillRect({ x: 8, y: 35, w: W - 16, h: 1 }, '#d0d0c8');
    wrapText(info.desc, W - 16).slice(0, 3).forEach((line, i) => c.drawText(line, 8, 38 + i * 13, TEXT_DARK));
  }
}
