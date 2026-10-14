// The phone's battle menu (Cam's mockup v3, approved 2026-10-14): under the battle
// screen, where the stick and the dock were, four big Emerald windows in place of the
// ROM's little 2x2 -- FIGHT, BAG, POKeMON and RUN, or the moves, each with its type, PP
// and how well it lands on the foe. Tap a move to attack; hold one and its window fills
// from the left, then its details open in the same place.
//
// Nothing here is new game logic. A tap is the choice a thumb would make, walked to and
// confirmed through the ROM's own handlers (touch.ts chooseBattle): a move the game
// refuses (no PP, DISABLE) is refused here too. BAG and POKeMON open the ROM's own
// screens, which the stick and A/B drive as before. RUN greys out where it cannot work:
// against a trainer, BR's rule is a POKe DOLL or no way out (src/br/br_battle.c).
// What the windows say is read every frame: gBrBattle.menu (which menu is up),
// gBattleMons (our moves and PP, the foe's types and name), gBattleTypeFlags and the
// ITEMS pocket; what a move is comes out of the ROM's tables (battle/movebook.ts).
import uiData from '../data/ui.json';
import { decodeGen3Display } from '../text/gen3';
import { effectWords, effectiveness, moveInfo, type MoveInfo, type Rom } from '../battle/movebook';
import { BATTLE_MENU, MAIN_IN_BATTLE_BIT, MAIN_IN_BATTLE_BYTE, MENU_ACTION, MENU_MOVE, MENU_SAFARI } from '../touch';
import { EmeraldCanvas, TEXT_BLUE, TEXT_DARK, TEXT_GRAY, TEXT_GREEN, TEXT_RED, TEXT_WHITE, fitText, measure, wrapText, type TextColor } from './emerald';
import { Win, picture } from './phonehud';

// ---- what the ROM says ---------------------------------------------------------------

/** `struct BattlePokemon` (include/pokemon.h). Battler 0 is ours, 1 the foe, in a
 *  single battle -- which is every BR battle. */
export const MON_SIZE = 0x58;
export const MON_MOVES = 0x0c;
export const MON_TYPES = 0x21;
export const MON_PP = 0x24;
export const MON_NICKNAME = 0x30;
export const MON_PP_BONUSES = 0x3b;
export const NICKNAME_SIZE = 11;
/** include/constants/battle.h. */
export const BATTLE_TYPE_LINK = 1 << 1;
export const BATTLE_TYPE_TRAINER = 1 << 3;
export const BATTLE_TYPE_SAFARI = 1 << 7;
/** `struct BagPocket` (include/item.h): the slots' pointer, then the capacity. */
export const POCKET_SIZE = 8;
export const POCKET_CAPACITY = 4;
export const ITEMS_POCKET = 0;
/** `struct ItemSlot` (include/global.h): the id, then the (encrypted) count. */
export const SLOT_SIZE = 4;
export const ITEM_POKE_DOLL = 80;
const MAX_MON_MOVES = 4;

export interface MoveSlot {
  id: number;
  pp: number;
  maxPp: number;
}

export interface BattleView {
  /** gBrBattle.menu: 0 none, MENU_ACTION, MENU_MOVE, MENU_SAFARI. */
  menu: number;
  /** A fight with somebody (a trainer, a bot, another player): RUN needs a POKe DOLL. */
  trainer: boolean;
  dolls: boolean;
  safariBalls: number;
  moves: MoveSlot[];
  foe: { name: string; types: [number, number] };
}

export interface BattleRead {
  read(addr: number, bits: 8 | 16 | 32): number;
}

/** A Gen 3 move's PP with its PP Ups (pokemon.c CalculatePPWithBonus). */
export function ppWithBonus(base: number, ppBonuses: number, slot: number): number {
  const ups = (ppBonuses >> (2 * slot)) & 3;
  return base + Math.floor((base * 20 * ups) / 100);
}

/** The battle as the menu needs it; null outside one or without the symbols. */
export function readBattleView(emu: BattleRead, sym: (name: string) => number | undefined, rom: Rom | null): BattleView | null {
  const main = sym('gMain');
  const br = sym('gBrBattle');
  const mons = sym('gBattleMons');
  if (main === undefined || br === undefined || mons === undefined) return null;
  if (!(emu.read(main + MAIN_IN_BATTLE_BYTE, 8) & MAIN_IN_BATTLE_BIT)) return null;
  const flagsAt = sym('gBattleTypeFlags');
  const flags = flagsAt === undefined ? 0 : emu.read(flagsAt, 32);
  const bonuses = emu.read(mons + MON_PP_BONUSES, 8);
  const moves: MoveSlot[] = [];
  for (let i = 0; i < MAX_MON_MOVES; i++) {
    const id = emu.read(mons + MON_MOVES + i * 2, 16);
    const base = id && rom ? (moveInfo(rom, id)?.pp ?? 0) : 0;
    moves.push({ id, pp: emu.read(mons + MON_PP + i, 8), maxPp: ppWithBonus(base, bonuses, i) });
  }
  const foe = mons + MON_SIZE;
  const name: number[] = [];
  for (let i = 0; i < NICKNAME_SIZE; i++) {
    const b = emu.read(foe + MON_NICKNAME + i, 8);
    if (b === 0xff) break;
    name.push(b);
  }
  let dolls = false;
  const pockets = sym('gBagPockets');
  if (pockets !== undefined) {
    const p = pockets + ITEMS_POCKET * POCKET_SIZE;
    const slots = emu.read(p, 32);
    const cap = emu.read(p + POCKET_CAPACITY, 8);
    // An empty slot is id 0; the bag keeps no slot for a count of nothing.
    for (let i = 0; i < cap && !dolls; i++) dolls = emu.read(slots + i * SLOT_SIZE, 16) === ITEM_POKE_DOLL;
  }
  const balls = sym('gNumSafariBalls');
  let foeName = '';
  try {
    foeName = decodeGen3Display(Uint8Array.from(name));
  } catch {
    /* a name the charmap cannot say is no name */
  }
  return {
    menu: emu.read(br + BATTLE_MENU, 8),
    trainer: (flags & (BATTLE_TYPE_TRAINER | BATTLE_TYPE_LINK)) !== 0 && !(flags & BATTLE_TYPE_SAFARI),
    dolls,
    safariBalls: balls === undefined ? 0 : emu.read(balls, 8),
    moves,
    foe: { name: foeName, types: [emu.read(foe + MON_TYPES, 8), emu.read(foe + MON_TYPES + 1, 8)] },
  };
}

// ---- what the windows say --------------------------------------------------------------

export type Tone = 'super' | 'weak' | 'none' | 'normal' | 'status';
const TONE: Record<Tone, TextColor> = { super: TEXT_GREEN, weak: TEXT_RED, none: TEXT_GRAY, normal: TEXT_GRAY, status: TEXT_GRAY };

/** The action windows' words: a label, and under it what it does here. */
export function actionLabels(v: BattleView): { label: string; sub: string; color: TextColor; enabled: boolean }[] {
  if (v.menu === MENU_SAFARI) {
    return [
      { label: 'BALL', sub: `×${v.safariBalls} LEFT`, color: TEXT_GRAY, enabled: true },
      { label: 'POKéBLOCK', sub: 'THROW ONE', color: TEXT_GRAY, enabled: true },
      { label: 'GO NEAR', sub: 'STEP CLOSER', color: TEXT_GRAY, enabled: true },
      { label: 'RUN', sub: 'GET AWAY', color: TEXT_GRAY, enabled: true },
    ];
  }
  const known = v.moves.filter((m) => m.id !== 0).length;
  const run = !v.trainer
    ? { sub: 'GET AWAY', color: TEXT_GRAY, enabled: true }
    : v.dolls
      ? { sub: 'USES A POKé DOLL', color: TEXT_GRAY, enabled: true }
      : { sub: 'NO POKé DOLL', color: TEXT_RED, enabled: false };
  return [
    { label: 'FIGHT', sub: known === 1 ? '1 MOVE' : `${known} MOVES`, color: TEXT_GRAY, enabled: true },
    { label: 'BAG', sub: 'ITEMS', color: TEXT_GRAY, enabled: true },
    { label: 'POKéMON', sub: 'SWITCH', color: TEXT_GRAY, enabled: true },
    { label: 'RUN', ...run },
  ];
}

/** How a move lands on the foe, in words and the colour the menu says them in. */
export function moveEffect(rom: Rom | null, info: MoveInfo | null, foe: [number, number]): { text: string; tone: Tone; color: TextColor } {
  if (!info) return { text: '', tone: 'normal', color: TEXT_GRAY };
  const w = effectWords(rom ? effectiveness(rom, info.type, foe) : null, info.power);
  return { ...w, color: TONE[w.tone] };
}

// ---- drawing ---------------------------------------------------------------------------

/** A window of the grid, GBA pixels: two across in 240. Whole tiles, as Emerald's
 *  windows are (frameTiles draws the frame in eights). */
export const CELL_W = 112;
export const CELL_H = 64;
export const GAP = 8;
export const CLOSE_W = 72;
export const MENU_W = 2 * CELL_W + GAP;
export const BACK_H = 32;
export const INFO_W = MENU_W;
/** How long a hold takes to open a move's details, ms. */
export const HOLD_MS = 450;
/** Frames the menu stays up across the ROM's gap between two of its menus. */
const GRACE_FRAMES = 20;
/** Frames a choice the ROM did not take (no PP left) may keep the menu down. */
const REFUSED_FRAMES = 150;
const TYPES = uiData.typeIcons as { w: number; h: number };
const RULE = '#d0d0c8';

/** The page's view of the menu: the ROM's action menu can show the moves before FIGHT
 *  is pressed, and a move's details over them. */
type Mode = 'action' | 'moves' | 'info';

export interface BattleMenuDeps {
  /** Where the windows go: under the picture, over the pad. */
  root: HTMLElement;
  rom: Rom | null;
  /** FIGHT/BAG/POKeMON/RUN (or the Safari's) slot, and the move after FIGHT. */
  choose(which: number, slot: number, move?: number): void;
  /** B: out of the ROM's move menu. */
  back(): void;
  /** Up, or down: the stick and the dock make way. */
  onShown(shown: boolean): void;
}

function drawType(c: EmeraldCanvas, type: number, x: number, y: number, redo: () => void): void {
  c.drawPicture(picture('/ui/types.png', redo), 0, type * TYPES.h, TYPES.w, TYPES.h, x, y);
}

export class BattleMenu {
  private view: BattleView | null = null;
  private mode: Mode = 'action';
  private info = 0;
  private scale = 1;
  private shown = false;
  private lastMenu = 0;
  private idle = 0;
  /** A choice was sent: the menu stays down until the ROM's next one opens. */
  private sent = 0;
  /** ...and it was FIGHT then a move: the move menu that opens on the way is not a new
   *  choice to show. */
  private chained = false;
  private readonly infoCache = new Map<number, MoveInfo | null>();
  private readonly cells: { b: HTMLButtonElement; w: Win; hold: HTMLElement }[] = [];
  private readonly backBtn: HTMLButtonElement;
  private readonly backWin: Win;
  private readonly hint: Win;
  private readonly sheet: HTMLElement;
  private readonly sheetWin: Win;
  private readonly closeBtn: HTMLButtonElement;
  private readonly closeWin: Win;
  private readonly useBtn: HTMLButtonElement;
  private readonly useWin: Win;

  constructor(private readonly deps: BattleMenuDeps) {
    const doc = deps.root.ownerDocument;
    const button = (cls: string, parent: HTMLElement) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `bm-btn ${cls}`;
      parent.appendChild(b);
      return b;
    };
    for (let i = 0; i < 4; i++) {
      const b = button('bm-cell', deps.root);
      b.dataset.slot = String(i);
      const hold = doc.createElement('span');
      hold.className = 'bm-hold';
      const w = new Win(b, CELL_W, CELL_H, (c, redo) => this.paintCell(c, i, redo));
      b.appendChild(hold);
      this.cells.push({ b, w, hold });
      this.wireCell(b, hold, i);
    }
    this.backBtn = button('bm-back', deps.root);
    this.backBtn.setAttribute('aria-label', 'Back');
    this.backWin = new Win(this.backBtn, MENU_W, BACK_H, (c) => {
      c.drawFrame({ x: 0, y: 0, w: MENU_W, h: BACK_H });
      c.drawTextCentred('BACK', MENU_W / 2, 9, TEXT_DARK);
    });
    this.backBtn.addEventListener('click', () => this.goBack());
    const hint = doc.createElement('div');
    hint.className = 'bm-hint';
    deps.root.appendChild(hint);
    this.hint = new Win(hint, MENU_W, 16, (c) => c.drawTextCentred('TAP TO ATTACK.  HOLD FOR DETAILS.', MENU_W / 2, 0, TEXT_WHITE));
    this.sheet = doc.createElement('div');
    this.sheet.className = 'bm-info';
    this.sheet.setAttribute('role', 'dialog');
    deps.root.appendChild(this.sheet);
    this.sheetWin = new Win(this.sheet, INFO_W, this.infoHeight(), (c, redo) => this.paintInfo(c, redo));
    const row = doc.createElement('div');
    row.className = 'bm-info-row';
    this.sheet.appendChild(row);
    this.closeBtn = button('bm-close', row);
    this.closeBtn.setAttribute('aria-label', 'Close');
    this.closeWin = new Win(this.closeBtn, CLOSE_W, BACK_H, (c) => {
      c.drawFrame({ x: 0, y: 0, w: CLOSE_W, h: BACK_H });
      c.drawTextCentred('CLOSE', CLOSE_W / 2, 9, TEXT_DARK);
    });
    this.useBtn = button('bm-use', row);
    this.useWin = new Win(this.useBtn, MENU_W - CLOSE_W - GAP, BACK_H, (c) => {
      const w = MENU_W - CLOSE_W - GAP;
      c.drawFrame({ x: 0, y: 0, w, h: BACK_H });
      const m = this.moveInfoAt(this.info);
      c.drawTextCentred(fitText(`USE ${m?.name ?? ''}`, w - 16), w / 2, 9, TEXT_BLUE);
    });
    this.closeBtn.addEventListener('click', () => this.setMode('moves'));
    this.useBtn.addEventListener('click', () => this.attack(this.info));
    deps.root.hidden = true;
  }

  private moveInfoAt(slot: number): MoveInfo | null {
    const id = this.view?.moves[slot]?.id ?? 0;
    if (!id) return null;
    if (!this.infoCache.has(id)) this.infoCache.set(id, this.deps.rom ? moveInfo(this.deps.rom, id) : null);
    return this.infoCache.get(id) ?? null;
  }

  private wireCell(b: HTMLButtonElement, hold: HTMLElement, i: number): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let long = false;
    const end = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      hold.style.transition = 'transform 120ms ease-out';
      hold.style.transform = 'scaleX(0)';
    };
    b.addEventListener('pointerdown', () => {
      long = false;
      if (this.mode !== 'moves' || !this.view?.moves[i]?.id) return;
      hold.style.transition = `transform ${HOLD_MS}ms linear`;
      hold.style.transform = 'scaleX(1)';
      timer = setTimeout(() => {
        long = true;
        end();
        this.info = i;
        this.setMode('info');
      }, HOLD_MS);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, end);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (long || b.getAttribute('aria-disabled') === 'true') return;
      if (this.mode === 'moves') this.attack(i);
      else this.act(i);
    });
  }

  private act(slot: number): void {
    const v = this.view;
    if (!v) return;
    if (v.menu === MENU_ACTION && slot === 0) {
      this.setMode('moves');
      return;
    }
    this.send(() => this.deps.choose(v.menu, slot));
  }

  private attack(slot: number): void {
    const v = this.view;
    if (!v || !v.moves[slot]?.id) return;
    // From the page's own move list the ROM is still on its action menu: FIGHT first.
    if (v.menu === MENU_MOVE) this.send(() => this.deps.choose(MENU_MOVE, slot));
    else {
      this.send(() => this.deps.choose(MENU_ACTION, 0, slot));
      this.chained = true;
    }
  }

  private goBack(): void {
    if (this.view?.menu === MENU_MOVE) this.deps.back();
    this.setMode('action');
  }

  private send(go: () => void): void {
    go();
    this.chained = false;
    this.sent = REFUSED_FRAMES;
    this.setShown(false);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.layout();
  }

  private setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.deps.root.hidden = !shown;
    this.deps.onShown(shown);
  }

  /** CSS pixels per GBA pixel: the field's. */
  setScale(scale: number): void {
    if (!(scale > 0) || scale === this.scale) return;
    this.scale = scale;
    for (const c of this.cells) c.w.size(CELL_W, CELL_H, scale);
    this.backWin.size(MENU_W, BACK_H, scale);
    this.hint.size(MENU_W, 16, scale);
    this.sheetWin.size(INFO_W, this.infoHeight(), scale);
    this.closeWin.size(CLOSE_W, BACK_H, scale);
    this.useWin.size(MENU_W - CLOSE_W - GAP, BACK_H, scale);
  }

  /** Each frame, from the ROM. */
  update(v: BattleView | null): void {
    const menu = v?.menu ?? 0;
    this.view = v;
    if (!v) {
      this.sent = 0;
      this.chained = false;
      this.mode = 'action';
      this.lastMenu = 0;
      this.setShown(false);
      return;
    }
    // A new menu opening (a new turn, or FIGHT pressed by a thumb): the page follows it.
    if (menu !== this.lastMenu && menu !== 0) {
      if (menu === MENU_MOVE && this.chained) this.chained = false;
      else this.sent = 0;
      if (menu === MENU_MOVE) this.mode = this.mode === 'info' ? 'info' : 'moves';
      else if (this.lastMenu === 0 || this.lastMenu === MENU_MOVE) this.mode = 'action';
    }
    this.lastMenu = menu;
    this.idle = menu ? 0 : this.idle + 1;
    if (this.sent > 0) this.sent--;
    const shown = this.sent === 0 && (menu !== 0 || (this.shown && this.idle < GRACE_FRAMES));
    this.setShown(shown);
    if (shown) this.layout();
  }

  private layout(): void {
    const moves = this.mode !== 'action';
    const info = this.mode === 'info';
    const v = this.view;
    const labels = v ? actionLabels(v) : [];
    this.cells.forEach(({ b, w }, i) => {
      b.hidden = info;
      const slot = v?.moves[i];
      const enabled = moves ? !!slot?.id : (labels[i]?.enabled ?? false);
      b.setAttribute('aria-disabled', String(!enabled));
      const m = moves ? this.moveInfoAt(i) : null;
      b.setAttribute('aria-label', moves ? (m ? `${m.name}, ${m.typeName}, PP ${slot!.pp}/${slot!.maxPp}` : 'No move') : (labels[i]?.label ?? ''));
      w.show(moves ? `m|${slot?.id}|${slot?.pp}|${slot?.maxPp}|${v?.foe.types}` : `a|${JSON.stringify(labels[i] ?? null)}`);
    });
    this.backBtn.hidden = !moves || info;
    (this.hint.el as HTMLElement).hidden = !moves || info;
    this.sheet.hidden = !info;
    if (info) {
      const h = this.infoHeight();
      if (this.sheetWin.c.height !== h) this.sheetWin.size(INFO_W, h, this.scale);
      this.sheetWin.show(`${this.info}|${v?.moves[this.info]?.id}|${v?.moves[this.info]?.pp}|${v?.foe.name}`);
      this.useWin.show(String(v?.moves[this.info]?.id));
    }
    this.deps.root.dataset.mode = this.mode;
  }

  private paintCell(c: EmeraldCanvas, i: number, redo: () => void): void {
    const v = this.view;
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: CELL_H });
    if (!v) return;
    if (this.mode === 'action') {
      const l = actionLabels(v)[i];
      if (!l) return;
      c.drawTextCentred(l.label, CELL_W / 2, 15, l.enabled ? TEXT_DARK : TEXT_GRAY);
      c.drawTextCentred(fitText(l.sub, CELL_W - 16), CELL_W / 2, 33, l.color);
      return;
    }
    const slot = v.moves[i];
    const m = this.moveInfoAt(i);
    if (!slot?.id || !m) {
      c.drawTextCentred('-', CELL_W / 2, 24, TEXT_GRAY);
      return;
    }
    c.drawText(fitText(m.name, CELL_W - 16), 8, 7, TEXT_DARK);
    drawType(c, m.type, 8, 23, redo);
    c.drawText(`PP ${slot.pp}/${slot.maxPp}`, 44, 24, slot.pp === 0 ? TEXT_RED : TEXT_DARK);
    const e = moveEffect(this.deps.rom, m, v.foe.types);
    c.drawText(fitText(e.text, CELL_W - 16), 8, 41, e.color);
  }

  private descLines(): string[] {
    return wrapText(this.moveInfoAt(this.info)?.desc ?? '', INFO_W - 16);
  }

  private infoHeight(): number {
    // name, effect, two rows of numbers, the rule, the description, the frame's edges
    return Math.ceil((72 + this.descLines().length * 14 + 8) / 8) * 8;
  }

  private paintInfo(c: EmeraldCanvas, redo: () => void): void {
    const v = this.view;
    const slot = v?.moves[this.info];
    const m = this.moveInfoAt(this.info);
    c.drawFrame({ x: 0, y: 0, w: INFO_W, h: c.height });
    if (!v || !slot || !m) return;
    const w = c.drawText(m.name, 8, 7, TEXT_DARK);
    drawType(c, m.type, 8 + w + 6, 7, redo);
    const e = moveEffect(this.deps.rom, m, v.foe.types);
    const vs = m.power === 0 ? e.text : `${e.text} VS ${v.foe.name}`;
    c.drawText(fitText(vs, INFO_W - 16), 8, 23, e.color);
    const pair = (k: string, val: string, x: number, y: number) => {
      c.drawText(k, x, y, TEXT_BLUE);
      c.drawText(val, x + measure(k) + 6, y, TEXT_DARK);
    };
    pair('POWER', m.power ? String(m.power) : '---', 8, 39);
    pair('ACCURACY', m.accuracy ? String(m.accuracy) : '---', 116, 39);
    pair('PP', `${slot.pp}/${slot.maxPp}`, 8, 53);
    pair('KIND', m.kind, 116, 53);
    c.fillRect({ x: 8, y: 70, w: INFO_W - 16, h: 1 }, RULE);
    this.descLines().forEach((line, i) => c.drawText(line, 8, 74 + i * 14, TEXT_DARK));
  }
}
