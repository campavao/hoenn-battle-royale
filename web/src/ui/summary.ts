// SUMMARY as a window of the page's (Cam, 11-02): "ability... type... HP, attack, defense, special
// attack, special defense and speed... don't really care about the XP... item and... moves...
// contest moves... save that for later", and "go to the right and look at the moves and click on
// them". Nothing here asks the ROM to do anything: one of the party is what its bytes say
// (carry.ts teamMembers), one off the ground is what the wire gave, its species and level, and
// the rest of what is known of the species out of the cartridge's tables, its base stats so called.
import { moveInfo, type MoveInfo, type Rom } from '../battle/movebook';
import { TEXT_BLUE, TEXT_DARK, TEXT_GRAY, TEXT_RED, fitText, measure, wrapText, type EmeraldCanvas } from './emerald';
import { CELL_W, MENU_W, drawBackArrow, drawHp, drawType, powerText, ppWithBonus, type PartyMember } from './battlemenu';
import { nextFocus, type Dir } from './focus';
import { abilityDesc, abilityName, natureName, speciesFacts, statusWord, type BaseStats } from './monfacts';
import { pageRoot, pageScale, pageWin, type PageWindow } from './pagewin';
import { Win, drawItemFitted } from './phonehud';

/** What the party's bytes add to a member (carry.ts teamMembers). */
export interface MonStats {
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
}

export type SummaryMon = PartyMember & { stats?: MonStats; nature?: number; abilityNum?: number };

/** GBA pixels. Whole windows, a phone's one over the other; a wide window's two columns. */
const W = MENU_W;
const GAP = 4;
const MOVE_H = 40;
/** As tall as the moves beside it on a wide window. */
const CARD_H = 2 * MOVE_H + GAP;
const STATS_H = 56;
const INFO_H = 72;
const ROW_H = 32;
const STEP_W = 48;
/** A move's page: the height of the two windows it stands in for on a phone. */
const DETAIL_H = STATS_H + GAP + INFO_H;
const WIDE_W = 2 * W + 2 * GAP;
const LEFT_H = CARD_H + GAP + STATS_H + GAP + INFO_H;
const WIDE_H = CARD_H + GAP + DETAIL_H + GAP + ROW_H;
const TALL_H = LEFT_H + GAP + 2 * MOVE_H + GAP + GAP + ROW_H;
/** How wide the screen must be, at the box's smallest, for its two columns. */
const WIDE_ROOM = (WIDE_W + 8) * 2;

/** The six as the page writes them, left column then right, in the order Cam said them. The
 *  party's are its real ones; off the ground, the species' base stats. */
export function statRows(m: SummaryMon, base: BaseStats | null): { base: boolean; rows: [string, string][] } {
  const s = m.stats;
  if (s) {
    return { base: false, rows: [['HP', `${m.hp}/${m.maxHp}`], ['ATTACK', String(s.attack)], ['DEFENSE', String(s.defense)], ['SP. ATK', String(s.spAttack)], ['SP. DEF', String(s.spDefense)], ['SPEED', String(s.speed)]] };
  }
  const b = base ?? { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 };
  const say = (n: number) => (base ? String(n) : '---');
  return { base: true, rows: [['HP', say(b.hp)], ['ATTACK', say(b.attack)], ['DEFENSE', say(b.defense)], ['SP. ATK', say(b.spAttack)], ['SP. DEF', say(b.spDefense)], ['SPEED', say(b.speed)]] };
}

export interface SummaryDeps {
  rom: Rom | null;
  /** The species' battle picture, 64 x 64. */
  pic(species: number): CanvasImageSource | null;
  speciesName(species: number): string;
  /** The windows' scale, and whether fingers drive them. */
  scale(): number;
  touch: boolean;
}

export class SummaryWindow implements PageWindow {
  private rows: SummaryMon[] = [];
  private at = 0;
  /** Which move's page is up: a phone's in place of the stats, a wide window's beside them. */
  private moveAt: number | null = null;
  private alive: (() => boolean) | null = null;
  private closed: (() => void) | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;
  private wide = false;
  private scale = 0;
  private focused: HTMLElement | null = null;
  private readonly box: HTMLElement;
  private readonly card: Win;
  private readonly stats: Win;
  private readonly info: Win;
  private readonly detail: Win;
  private readonly moves: { b: HTMLButtonElement; w: Win }[] = [];
  private readonly steps: { b: HTMLButtonElement; w: Win }[] = [];
  private readonly back: Win;

  constructor(private readonly deps: SummaryDeps) {
    const doc = document;
    this.box = doc.createElement('div');
    this.box.id = 'summary';
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', 'Summary');
    this.box.hidden = true;
    pageRoot().appendChild(this.box);
    const part = (cls: string, parent: HTMLElement = this.box) => {
      const el = doc.createElement('div');
      el.className = cls;
      parent.appendChild(el);
      return el;
    };
    const button = (cls: string, parent: HTMLElement) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `bm-btn ${cls}`;
      parent.appendChild(b);
      return b;
    };
    this.card = new Win(part('sum-card'), W, CARD_H, (c) => this.paintCard(c));
    this.stats = new Win(part('sum-stats'), W, STATS_H, (c) => this.paintStats(c));
    this.info = new Win(part('sum-info'), W, INFO_H, (c, redo) => this.paintInfo(c, redo));
    const list = part('sum-moves');
    for (let i = 0; i < 4; i++) {
      const b = button('sum-move', list);
      const w = new Win(b, CELL_W, MOVE_H, (c, redo) => this.paintMove(c, i, redo));
      this.moves.push({ b, w });
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') this.pickMove(i); });
      // With a mouse, what it rests on.
      b.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse' && this.wide && this.mon()?.moves[i]) this.setMove(i); });
    }
    this.detail = new Win(part('sum-detail'), W, DETAIL_H, (c, redo) => this.paintDetail(c, redo));
    const row = part('sum-row');
    const word = (w: number, say: string, arrow: number) => (c: EmeraldCanvas) => {
      c.drawFrame({ x: 0, y: 0, w, h: ROW_H });
      if (arrow < 0) drawBackArrow(c, w / 2 - 2, ROW_H / 2);
      else if (arrow > 0) for (let n = 0; n < 5; n++) c.fillRect({ x: w / 2 + 2 - n, y: ROW_H / 2 - n, w: 1, h: 2 * n + 1 }, '#e60808');
      else c.drawTextCentred(say, w / 2, 9, TEXT_DARK);
    };
    const prev = button('sum-prev', row);
    prev.setAttribute('aria-label', 'Previous POKeMON');
    this.steps.push({ b: prev, w: new Win(prev, STEP_W, ROW_H, word(STEP_W, '', -1)) });
    prev.addEventListener('click', () => this.step(-1));
    const back = button('sum-back', row);
    back.setAttribute('aria-label', 'Back');
    this.back = new Win(back, W - 2 * STEP_W - 2 * GAP, ROW_H, word(W - 2 * STEP_W - 2 * GAP, 'BACK', 0));
    back.addEventListener('click', () => this.close());
    const next = button('sum-next', row);
    next.setAttribute('aria-label', 'Next POKeMON');
    this.steps.push({ b: next, w: new Win(next, STEP_W, ROW_H, word(STEP_W, '', 1)) });
    next.addEventListener('click', () => this.step(1));
    addEventListener('resize', () => { if (this.isOpen) this.fit(); });
  }

  get isOpen(): boolean {
    return !this.box.hidden;
  }

  /** `rows[at]`'s page, and L and R through the rest. It shuts itself when `alive` says what it
   *  stands over has gone (a shot clock ran out, the fog took the panel). */
  open(rows: SummaryMon[], at: number, alive: () => boolean, closed?: () => void): void {
    this.closed = closed ?? null;
    this.rows = rows;
    this.at = at;
    this.box.dataset.at = String(at);
    this.alive = alive;
    this.box.hidden = false;
    pageWin.open(this);
    if (this.watch) clearInterval(this.watch);
    this.watch = setInterval(() => { if (!this.alive?.()) this.close(); }, 250);
    this.fit();
    this.paint(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.box.hidden = true;
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.alive = null;
    pageWin.close(this);
    const done = this.closed;
    this.closed = null;
    done?.();
  }

  key(k: string): void {
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      const list = this.targets();
      const at = this.focused ? list.indexOf(this.focused) : -1;
      const boxes = list.map((b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      this.setFocus(list[nextFocus(boxes, at, k as Dir)] ?? null);
    } else if (k === 'a') this.focused?.click();
    else if (k === 'b') {
      if (!this.wide && this.moveAt !== null) this.setMove(null);
      else this.close();
    } else if (k === 'l') this.step(-1);
    else if (k === 'r') this.step(1);
  }

  private mon(): SummaryMon | undefined {
    return this.rows[this.at];
  }

  private targets(): HTMLElement[] {
    return [...this.box.querySelectorAll<HTMLElement>('button.bm-btn')].filter((b) => b.offsetParent !== null && b.getAttribute('aria-disabled') !== 'true');
  }

  private setFocus(b: HTMLElement | null): void {
    this.focused?.classList.remove('bm-focus');
    this.focused = b;
    b?.classList.add('bm-focus');
    const i = this.moves.findIndex((x) => x.b === b);
    // A wide window has the page beside the moves, so walking down them reads them.
    if (this.wide && i >= 0) this.setMove(i);
  }

  private step(dir: 1 | -1): void {
    const n = this.rows.length;
    if (n < 2) return;
    this.at = (this.at + dir + n) % n;
    this.box.dataset.at = String(this.at);
    this.paint(true);
  }

  private pickMove(i: number): void {
    this.setMove(!this.wide && this.moveAt === i ? null : i);
  }

  private setMove(i: number | null): void {
    if (i === this.moveAt) return;
    this.moveAt = i;
    this.paintMoveState();
  }

  /** The box's shape for this screen: two columns where there is room for them. */
  private fit(): void {
    const room = { w: innerWidth, h: innerHeight };
    const wide = !this.deps.touch && innerWidth >= WIDE_ROOM;
    const s = pageScale(wide ? WIDE_W : W, wide ? WIDE_H : TALL_H, this.deps.scale(), this.deps.touch, room);
    this.box.classList.toggle('wide', wide);
    const changed = wide !== this.wide || s !== this.scale;
    this.wide = wide;
    if (!changed) return;
    this.scale = s;
    pageRoot().style.setProperty('--s', String(s));
    this.card.size(W, CARD_H, s);
    this.stats.size(W, STATS_H, s);
    this.info.size(W, INFO_H, s);
    this.detail.size(W, DETAIL_H, s);
    for (const { w } of this.moves) w.size(CELL_W, MOVE_H, s);
    for (const { w } of this.steps) w.size(STEP_W, ROW_H, s);
    this.back.size(W - 2 * STEP_W - 2 * GAP, ROW_H, s);
  }

  /** All of it, for a new mon: `fresh` puts the keys on its first move. */
  private paint(fresh: boolean): void {
    const m = this.mon();
    const key = JSON.stringify(m ?? null);
    this.card.show(key);
    this.stats.show(key);
    this.info.show(key);
    this.moves.forEach(({ b, w }, i) => {
      const slot = m?.moves[i];
      const info = slot && this.deps.rom ? moveInfo(this.deps.rom, slot.id) : null;
      b.setAttribute('aria-disabled', String(!info));
      b.setAttribute('aria-label', info && slot ? `${info.name}, ${info.typeName}, PP ${slot.pp}/${this.maxPp(m!, i, info)}` : 'No move');
      w.show(`${key}|${i}`);
    });
    for (const { b } of this.steps) b.hidden = this.rows.length < 2;
    this.box.setAttribute('aria-label', m ? `Summary of ${m.name}` : 'Summary');
    if (fresh) {
      this.moveAt = this.wide && m?.moves.length ? 0 : null;
      this.paintMoveState();
      this.setFocus(this.moves[0].b.getAttribute('aria-disabled') === 'true' ? this.box.querySelector<HTMLElement>('.sum-back') : this.moves[0].b);
    }
  }

  private paintMoveState(): void {
    this.box.classList.toggle('on-move', this.moveAt !== null);
    this.detail.redraw();
    const id = this.moveAt === null ? null : this.mon()?.moves[this.moveAt]?.id;
    const info = id && this.deps.rom ? moveInfo(this.deps.rom, id) : null;
    this.detail.el.setAttribute('aria-label', info ? `${info.name}: ${info.desc}` : '');
    this.detail.el.setAttribute('role', 'note');
  }

  private maxPp(m: SummaryMon, i: number, info: MoveInfo): number {
    return m.moves[i].maxPp || ppWithBonus(info.pp, 0, i);
  }

  private paintCard(c: EmeraldCanvas): void {
    c.drawFrame({ x: 0, y: 0, w: W, h: CARD_H });
    const m = this.mon();
    if (!m) return;
    const pic = this.deps.pic(m.species);
    if (pic) c.drawImageTo(pic, 0, 0, 64, 64, 4, 10, 64, 64);
    const x = 72, right = W - 8;
    const lv = `Lv${m.level}`;
    c.drawText(lv, right - measure(lv), 6, TEXT_DARK);
    c.drawText(fitText(m.name, right - x - measure(lv) - 4), x, 6, TEXT_DARK);
    const rom = this.deps.rom;
    const facts = rom ? speciesFacts(rom, m.species) : null;
    if (facts) {
      drawType(c, facts.types[0], x, 21, () => this.card.redraw());
      if (facts.types[1] !== facts.types[0]) drawType(c, facts.types[1], x + 36, 21, () => this.card.redraw());
    }
    const species = this.deps.speciesName(m.species);
    if (species !== m.name) c.drawText(fitText(species, right - x - 72), x + 72, 21, TEXT_DARK);
    const nature = rom && m.nature !== undefined ? natureName(rom, m.nature) : '';
    if (nature) c.drawText(`${nature} nature`, x, 38, TEXT_DARK);
    if (!m.stats) { c.drawText('Not on a team yet.', x, 38, TEXT_DARK); return; }
    drawHp(c, x, 62, 76, m.maxHp ? m.hp / m.maxHp : 0);
    const status = statusWord(m.hp, m.status);
    const hp = `${m.hp}/${m.maxHp}`;
    c.drawText(hp, right - measure(hp), 57, m.hp === 0 ? TEXT_RED : TEXT_DARK);
    if (status) c.drawText(status, right - measure(status), 38, TEXT_RED);
  }

  private paintStats(c: EmeraldCanvas): void {
    c.drawFrame({ x: 0, y: 0, w: W, h: STATS_H });
    const m = this.mon();
    if (!m) return;
    const facts = this.deps.rom ? speciesFacts(this.deps.rom, m.species) : null;
    const { base, rows } = statRows(m, facts?.base ?? null);
    rows.forEach(([k, v], i) => {
      const col = i < 3 ? 0 : 1, y = 7 + (i % 3) * 14;
      const x = col ? W / 2 + 4 : 8, end = col ? W - 8 : W / 2 - 4;
      c.drawText(base && i === 0 ? 'BASE HP' : k, x, y, TEXT_BLUE);
      c.drawText(v, end - measure(v), y, TEXT_DARK);
    });
  }

  private paintInfo(c: EmeraldCanvas, redo: () => void): void {
    c.drawFrame({ x: 0, y: 0, w: W, h: INFO_H });
    const m = this.mon();
    const rom = this.deps.rom;
    if (!m || !rom) return;
    const facts = speciesFacts(rom, m.species);
    const ids = facts?.abilities ?? [0, 0];
    // One of the party has the one; off the ground either, until it is somebody's.
    const one = m.abilityNum === undefined ? 0 : (m.abilityNum && ids[1]) || ids[0];
    const name = m.abilityNum === undefined ? ids.filter((a) => a).map((a) => abilityName(rom, a)).join(' or ') : abilityName(rom, one);
    c.drawText(fitText(name || m.ability, W - 16), 8, 5, TEXT_BLUE);
    const words = m.abilityNum === undefined && ids[1] ? '' : abilityDesc(rom, one || ids[0]);
    wrapText(words, W - 16).slice(0, 2).forEach((line, i) => c.drawText(line, 8, 19 + i * 13, TEXT_DARK));
    // Holding nothing goes unsaid (Cam, 11-04).
    if (!m.item) return;
    c.fillRect({ x: 8, y: 46, w: W - 16, h: 1 }, '#d0d0c8');
    drawItemFitted(c, m.item, 18, 58, 15, redo);
    c.drawText(fitText(m.itemName, W - 40), 32, 51, TEXT_DARK);
  }

  private paintMove(c: EmeraldCanvas, i: number, redo: () => void): void {
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: MOVE_H });
    const m = this.mon();
    const slot = m?.moves[i];
    const info = slot && this.deps.rom ? moveInfo(this.deps.rom, slot.id) : null;
    if (!m || !slot || !info) {
      c.drawTextCentred('-', CELL_W / 2, 13, TEXT_GRAY);
      return;
    }
    drawType(c, info.type, 7, 6, redo);
    const pp = `${slot.pp}/${this.maxPp(m, i, info)}`;
    c.drawText(pp, CELL_W - 8 - measure(pp), 6, slot.pp === 0 ? TEXT_RED : TEXT_DARK);
    c.drawText(fitText(info.name, CELL_W - 16), 8, 20, TEXT_DARK);
  }

  private paintDetail(c: EmeraldCanvas, redo: () => void): void {
    c.drawFrame({ x: 0, y: 0, w: W, h: DETAIL_H });
    const m = this.mon();
    const slot = this.moveAt === null ? undefined : m?.moves[this.moveAt];
    const info = slot && this.deps.rom ? moveInfo(this.deps.rom, slot.id) : null;
    if (!m || !slot || !info) {
      if (!m?.moves.length) wrapText(m?.stats ? 'No moves.' : 'Its moves are dealt when it joins a team.', W - 16).forEach((line, i) => c.drawText(line, 8, 8 + i * 14, TEXT_GRAY));
      return;
    }
    const w = c.drawText(info.name, 8, 7, TEXT_DARK);
    drawType(c, info.type, 8 + w + 6, 7, redo);
    const pair = (k: string, val: string, x: number, y: number) => {
      c.drawText(k, x, y, TEXT_BLUE);
      c.drawText(val, x + measure(k) + 6, y, TEXT_DARK);
    };
    pair('POWER', powerText(info), 8, 24);
    pair('ACCURACY', info.accuracy ? String(info.accuracy) : '---', 116, 24);
    pair('PP', `${slot.pp}/${this.maxPp(m, this.moveAt!, info)}`, 8, 38);
    pair('KIND', info.kind, 116, 38);
    c.fillRect({ x: 8, y: 55, w: W - 16, h: 1 }, '#d0d0c8');
    wrapText(info.desc, W - 16).forEach((line, i) => c.drawText(line, 8, 60 + i * 14, TEXT_DARK));
  }
}
