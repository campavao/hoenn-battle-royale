// The phone's battle menu (Cam's mockup v3, approved 2026-10-14): under the battle
// screen, where the D-pad and the dock were, four big Emerald windows in place of the
// ROM's little 2x2 -- FIGHT, BAG, POKeMON and RUN, or the moves, each with its type, PP
// and how well it lands on the foe. Tap a move to attack; hold one and its window fills
// from the left, then its details open in the same place.
//
// Nothing here is new game logic. A tap is the choice a thumb would make, walked to and
// confirmed through the ROM's own handlers (touch.ts chooseBattle): a move the game
// refuses (no PP, DISABLE) is refused here too. BAG and POKeMON open the ROM's own
// screens, which the D-pad and A/B drive as before. RUN greys out where it cannot work:
// against a trainer, BR's rule is a POKe DOLL or no way out (src/br/br_battle.c).
// What the windows say is read every frame: gBrBattle.menu (which menu is up),
// gBattleMons (our moves and PP, the foe's types and name), gBattleTypeFlags and the
// ITEMS pocket; what a move is comes out of the ROM's tables (battle/movebook.ts).
import uiData from '../data/ui.json';
import { decodeGen3Display } from '../text/gen3';
import { MAIN_CALLBACK2 } from '../field';
import { effectWords, effectiveness, moveInfo, type MoveInfo, type Rom } from '../battle/movebook';
import { BATTLE_MENU, MAIN_IN_BATTLE_BIT, MAIN_IN_BATTLE_BYTE, MENU_ACTION, MENU_MOVE, MENU_SAFARI, localBattler } from '../touch';
import { EmeraldCanvas, TEXT_BLUE, TEXT_DARK, TEXT_GRAY, TEXT_GREEN, TEXT_RED, TEXT_WHITE, fitText, measure, wrapText, type TextColor } from './emerald';
import { ITEMS_POCKET, Win, bagHolds, drawIcon, picture } from './phonehud';
import { BAG_POCKETS, POCKET_BALLS, itemInfo, readBattleBag, type Stack } from './bag';

// ---- what the ROM says ---------------------------------------------------------------

/** `struct BattlePokemon` (include/pokemon.h). Ours is the local battler's (touch.ts
 *  localBattler: 1 on the challenged side of a link battle) and the foe the other, in a
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
/** A replay: a spectator's, whose D-pad still flips who they watch (app.ts watchStepKey). */
export const BATTLE_TYPE_RECORDED = 1 << 24;
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
  /** The BAG's battle pockets (ui/bag.ts), by pocket: what can be used in here. */
  bag: Map<number, Stack[]>;
}

export interface BattleRead {
  read(addr: number, bits: 8 | 16 | 32): number;
}

/** A Gen 3 move's PP with its PP Ups (pokemon.c CalculatePPWithBonus). */
export function ppWithBonus(base: number, ppBonuses: number, slot: number): number {
  const ups = (ppBonuses >> (2 * slot)) & 3;
  return base + Math.floor((base * 20 * ups) / 100);
}

const basePps = new WeakMap<Uint8Array, Map<number, number>>();
/** A move's PP before PP Ups, read once a ROM: this runs every frame. */
function basePp(rom: Rom, id: number): number {
  let m = basePps.get(rom.bytes);
  if (!m) basePps.set(rom.bytes, (m = new Map()));
  let pp = m.get(id);
  if (pp === undefined) m.set(id, (pp = moveInfo(rom, id)?.pp ?? 0));
  return pp;
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
  const local = localBattler(emu, sym('gBattlerPositions'));
  const ours = mons + local * MON_SIZE;
  const bonuses = emu.read(ours + MON_PP_BONUSES, 8);
  const moves: MoveSlot[] = [];
  for (let i = 0; i < MAX_MON_MOVES; i++) {
    const id = emu.read(ours + MON_MOVES + i * 2, 16);
    moves.push({ id, pp: emu.read(ours + MON_PP + i, 8), maxPp: ppWithBonus(id && rom ? basePp(rom, id) : 0, bonuses, i) });
  }
  const foe = mons + (local ^ 1) * MON_SIZE;
  const name: number[] = [];
  for (let i = 0; i < NICKNAME_SIZE; i++) {
    const b = emu.read(foe + MON_NICKNAME + i, 8);
    if (b === 0xff) break;
    name.push(b);
  }
  const dolls = bagHolds(emu, sym, ITEMS_POCKET, [ITEM_POKE_DOLL]).size > 0;
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
    bag: readBattleBag(emu, sym, rom),
  };
}

// ---- the D-pad and A/B -------------------------------------------------------------------

const ROM_BASE = 0x08000000;
/** The battle script commands that wait on a press the windows do not offer
 *  (include/constants/battle_script_commands.h): a YES/NO (USE NEXT POKeMON? in a wild
 *  battle) and a caught mon's POKeDEX page. The D-pad and A/B come back for these. */
export const ASKS_PAD: ReadonlySet<number> = new Set([
  0x5a, // B_SCR_OP_YESNOBOXLEARNMOVE
  0x5b, // B_SCR_OP_YESNOBOXSTOPLEARNINGMOVE
  0x67, // B_SCR_OP_YESNOBOX
  0xf2, // B_SCR_OP_DISPLAYDEXINFO
  0xf3, // B_SCR_OP_TRYGIVECAUGHTMONNICK
]);

/** The battle itself is on screen and wants nothing the D-pad or A/B give (Cam,
 *  2026-10-15: "we shouldn't need them after all our UI changes"): the choices are the
 *  windows, and the text runs on by itself (br_battle.c BrBattle_AutoScrollFrames). The
 *  BAG and the party, which are screens of their own (callback2 is not BattleMainCB2),
 *  a battle script waiting on a press (ASKS_PAD), and a spectator's replay, where LEFT
 *  and RIGHT pick who to watch, keep them. */
export function battleWantsNoPad(emu: BattleRead, sym: (name: string) => number | undefined, rom: Rom | null): boolean {
  const main = sym('gMain');
  const scene = sym('BattleMainCB2');
  const instr = sym('gBattlescriptCurrInstr');
  if (main === undefined || scene === undefined || instr === undefined || !rom) return false;
  if (!(emu.read(main + MAIN_IN_BATTLE_BYTE, 8) & MAIN_IN_BATTLE_BIT)) return false;
  if ((emu.read(main + MAIN_CALLBACK2, 32) & ~1) !== (scene & ~1)) return false;
  const flags = sym('gBattleTypeFlags');
  if (flags === undefined || emu.read(flags, 32) & BATTLE_TYPE_RECORDED) return false;
  const at = emu.read(instr, 32) - ROM_BASE;
  return !(at >= 0 && at < rom.bytes.length && ASKS_PAD.has(rom.bytes[at]));
}

// ---- what the windows say --------------------------------------------------------------

export type Tone = 'extreme' | 'super' | 'weak' | 'none' | 'normal' | 'status';
const TONE: Record<Tone, TextColor> = { extreme: TEXT_GREEN, super: TEXT_GREEN, weak: TEXT_RED, none: TEXT_GRAY, normal: TEXT_GRAY, status: TEXT_GRAY };

/** Cam's reference (2026-10-15): how a move lands, as a band under its name with a mark
 *  ahead of the words -- a star for x4, a double circle for x2, a triangle for less, a
 *  cross for nothing. The band is the tone's colour, the words and mark white on it.
 *  Plain EFFECTIVE, and a move that does no damage, get words alone. */
export const BAND: Partial<Record<Tone, string>> = { extreme: '#d08800', super: '#209c08', weak: '#c83030', none: '#626262' };
const MARK_ROWS: Partial<Record<Tone, string[]>> = {
  extreme: ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  super: ['...###...', '.##...##.', '.#.....#.', '#..###..#', '#..#.#..#', '#..###..#', '.#.....#.', '.##...##.', '...###...'],
  weak: ['....#....', '....#....', '...#.#...', '...#.#...', '..#...#..', '..#...#..', '.#.....#.', '.#.....#.', '#########'],
  none: ['#.......#', '.#.....#.', '..#...#..', '...#.#...', '....#....', '...#.#...', '..#...#..', '.#.....#.', '#.......#'],
};
export const MARK = 9;

/** The tone's mark, MARK pixels square, its top-left at (x, y). No shadow: at this
 *  size a shadow fills the double circle in. */
function drawMark(c: EmeraldCanvas, tone: Tone, x: number, y: number, color: string): void {
  MARK_ROWS[tone]?.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '#') c.fillRect({ x: x + i, y: y + j, w: 1, h: 1 }, color);
  });
}

/** The action windows: a word each (Cam, 2026-10-14: nothing under it). RUN is grey
 *  where it cannot work: a fight with somebody and no POKe DOLL (br_battle.c). */
export function actionLabels(v: BattleView): { label: string; enabled: boolean }[] {
  if (v.menu === MENU_SAFARI) return ['BALL', 'POKéBLOCK', 'GO NEAR', 'RUN'].map((label) => ({ label, enabled: true }));
  return [
    { label: 'FIGHT', enabled: true },
    { label: 'BAG', enabled: true },
    { label: 'POKéMON', enabled: true },
    { label: 'RUN', enabled: !v.trainer || v.dolls },
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
/** Frames FIGHT, pressed, may take to bring the ROM's move menu up. */
const OPEN_FRAMES = 90;
/** Frames a choice the ROM did not take (no PP left) may keep the menu down. */
const REFUSED_FRAMES = 150;
const TYPES = uiData.typeIcons as { w: number; h: number };
const RULE = '#d0d0c8';

/** The page's view of the menu: the actions, the moves, or a move's details over them.
 *  FIGHT is pressed in the ROM too, so its shot clock picks a move, as a thumb's would,
 *  rather than RUN (a forfeit, in a link battle). */
type Mode = 'action' | 'moves' | 'info' | 'bag';

export interface BattleMenuDeps {
  /** Where the windows go: under the picture, over the pad. */
  root: HTMLElement;
  rom: Rom | null;
  /** FIGHT/BAG/POKeMON/RUN (or the Safari's) slot, and the move after FIGHT. */
  choose(which: number, slot: number, move?: number): void;
  /** B: out of the ROM's move menu. */
  back(): void;
  /** Up, or down: the D-pad and the dock make way. */
  onShown(shown: boolean): void;
  /** USE in the page's bag: `item` out of `pocket`, through the ROM's BAG (ui/bag.ts).
   *  Without it BAG opens the ROM's own screen, as it used to. */
  useItem?(pocket: number, item: number): void;
}

/** The bag's windows, GBA pixels: the mockup's pocket bar, list, description, and BACK
 *  and USE under them, pressed to fit under the picture on a phone -- 236 in all with
 *  the gaps, where a 390 x 844 screen has about 250. */
export const BAG_HEAD_H = 32;
export const BAG_ARROW_W = 56;
export const BAG_LIST_H = 104;
export const BAG_ROW_H = 24;
export const BAG_DESC_H = 44;
export const BAG_BACK_W = 72;
/** How far a finger goes across the list, CSS pixels, before it is a swipe. */
const SWIPE_PX = 40;
const ARROW_RED = '#e60808';
const DOT_ON = '#626262';
const DOT_OFF = '#d5d5cd';

function drawType(c: EmeraldCanvas, type: number, x: number, y: number, redo: () => void): void {
  c.drawPicture(picture('/ui/types.png', redo), 0, type * TYPES.h, TYPES.w, TYPES.h, x, y);
}

/** How a move lands, `w` wide from (x, y): its band and mark (BAND), or its words alone.
 *  `tail` follows the words (the details' "VS foe"). */
function drawEffect(c: EmeraldCanvas, e: { text: string; tone: Tone; color: TextColor }, tail: string, x: number, y: number, w: number): void {
  const band = BAND[e.tone];
  if (!e.text) return;
  if (!band) {
    c.drawText(fitText(e.text + tail, w - 4), x + 2, y + 1, e.color);
    return;
  }
  // A band of BAND_H with its corners clipped a pixel, the way a pill reads at this size.
  c.fillRect({ x: x + 1, y, w: w - 2, h: BAND_H }, band);
  c.fillRect({ x, y: y + 1, w, h: BAND_H - 2 }, band);
  drawMark(c, e.tone, x + 2, y + 3, TEXT_WHITE.fg);
  c.drawText(fitText(e.text + tail, w - MARK - 7), x + MARK + 5, y + 1, TEXT_WHITE);
}

const BAND_H = 15;

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
  /** FIGHT was pressed: frames left for the ROM's move menu to come up. */
  private opening = 0;
  /** BACK before it did: B, the moment it does. */
  private backOnOpen = false;
  /** The last menu the ROM had up. */
  private lastShown = 0;
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
  /** Which of BAG_POCKETS the bag is open on, and the item its cursor is on. */
  private pocketAt = 0;
  private picked = 0;
  private readonly bagHead: HTMLElement;
  private readonly bagHeadWin: Win;
  private readonly bagList: HTMLElement;
  private readonly bagListWin: Win;
  private readonly bagDesc: HTMLElement;
  private readonly bagDescWin: Win;
  private readonly bagRow: HTMLElement;
  private readonly bagBackWin: Win;
  private readonly bagUseBtn: HTMLButtonElement;
  private readonly bagUseWin: Win;

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

    // The bag. Its pocket bar is one window with its arrows in it, and the whole left
    // and right of it are the arrows (Cam, 2026-10-14: the bag's own were too small).
    this.bagHead = doc.createElement('div');
    this.bagHead.className = 'bm-bag bm-bag-head';
    deps.root.appendChild(this.bagHead);
    this.bagHeadWin = new Win(this.bagHead, MENU_W, BAG_HEAD_H, (c) => this.paintBagHead(c));
    for (const dir of [-1, 1] as const) {
      const b = button(dir < 0 ? 'bm-bag-prev' : 'bm-bag-next', this.bagHead);
      b.setAttribute('aria-label', dir < 0 ? 'Previous pocket' : 'Next pocket');
      b.addEventListener('click', () => this.stepPocket(dir));
    }
    this.bagList = doc.createElement('div');
    this.bagList.className = 'bm-bag bm-bag-list';
    deps.root.appendChild(this.bagList);
    this.bagListWin = new Win(this.bagList, MENU_W, BAG_LIST_H, (c, redo) => this.paintBagList(c, redo));
    this.wireBagList();
    this.bagDesc = doc.createElement('div');
    this.bagDesc.className = 'bm-bag';
    deps.root.appendChild(this.bagDesc);
    this.bagDescWin = new Win(this.bagDesc, MENU_W, BAG_DESC_H, (c) => this.paintBagDesc(c));
    this.bagRow = doc.createElement('div');
    this.bagRow.className = 'bm-bag bm-info-row';
    deps.root.appendChild(this.bagRow);
    const bagBack = button('bm-bag-back', this.bagRow);
    bagBack.setAttribute('aria-label', 'Back');
    this.bagBackWin = new Win(bagBack, BAG_BACK_W, BACK_H, (c) => {
      c.drawFrame({ x: 0, y: 0, w: BAG_BACK_W, h: BACK_H });
      c.drawTextCentred('BACK', BAG_BACK_W / 2, 9, TEXT_DARK);
    });
    bagBack.addEventListener('click', () => this.setMode('action'));
    this.bagUseBtn = button('bm-bag-use', this.bagRow);
    this.bagUseWin = new Win(this.bagUseBtn, MENU_W - BAG_BACK_W - GAP, BACK_H, (c) => this.paintBagUse(c));
    this.bagUseBtn.addEventListener('click', () => this.useItem());
    deps.root.hidden = true;
  }

  // ---- the bag -------------------------------------------------------------------------

  private stacks(): Stack[] {
    return this.view?.bag.get(BAG_POCKETS[this.pocketAt].pocket) ?? [];
  }

  /** The stack the cursor is on: the picked item, or the pocket's first. */
  private pickedStack(): Stack | undefined {
    const list = this.stacks();
    return list.find((s) => s.item === this.picked) ?? list[0];
  }

  /** Why USE cannot go: a ball against a trainer. Null when it can. */
  private refusal(stack: Stack | undefined): string | null {
    if (!stack) return null;
    return BAG_POCKETS[this.pocketAt].pocket === POCKET_BALLS && this.view?.trainer ? "You can't catch a TRAINER's POKéMON." : null;
  }

  private stepPocket(dir: 1 | -1): void {
    const n = BAG_POCKETS.length;
    this.pocketAt = (this.pocketAt + dir + n) % n;
    this.picked = 0;
    this.bagList.scrollTop = 0;
    this.layout();
  }

  private wireBagList(): void {
    let from: { x: number; y: number } | null = null;
    let swiped = false;
    this.bagList.addEventListener('pointerdown', (ev) => {
      from = { x: ev.clientX, y: ev.clientY };
      swiped = false;
    });
    this.bagList.addEventListener('pointerup', (ev) => {
      if (!from) return;
      const dx = ev.clientX - from.x;
      // Across, and more across than down: a swipe turns the pocket. Down is a scroll.
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(ev.clientY - from.y)) {
        swiped = true;
        this.stepPocket(dx < 0 ? 1 : -1);
      }
      from = null;
    });
    this.bagList.addEventListener('pointercancel', () => (from = null));
    this.bagList.addEventListener('click', (ev) => {
      if (swiped) return;
      const at = this.bagListWin.c.toPixel(ev.clientX, ev.clientY);
      const row = Math.floor((at.y - 8) / BAG_ROW_H);
      const stack = this.stacks()[row];
      if (!stack || at.y < 8) return;
      this.picked = stack.item;
      this.layout();
    });
  }

  private useItem(): void {
    const stack = this.pickedStack();
    if (!stack || this.refusal(stack) || !this.deps.useItem) return;
    const pocket = BAG_POCKETS[this.pocketAt].pocket;
    this.mode = 'action';
    this.send(() => this.deps.useItem!(pocket, stack.item));
  }

  private bagListHeight(): number {
    return Math.max(BAG_LIST_H, 16 + Math.max(1, this.stacks().length) * BAG_ROW_H);
  }

  private paintBagHead(c: EmeraldCanvas): void {
    c.drawFrame({ x: 0, y: 0, w: MENU_W, h: BAG_HEAD_H });
    // Emerald's pocket arrows, a red triangle each side, drawn big enough for a thumb.
    const arrow = (x: number, dir: 1 | -1) => {
      for (let i = 0; i < 9; i++) {
        const col = dir > 0 ? i : 8 - i;
        c.fillRect({ x: x + col, y: 7 + i, w: 1, h: 17 - 2 * i }, ARROW_RED);
      }
    };
    arrow(BAG_ARROW_W / 2 - 4, -1);
    arrow(MENU_W - BAG_ARROW_W / 2 - 4, 1);
    c.drawTextCentred(BAG_POCKETS[this.pocketAt].label, MENU_W / 2, 5, TEXT_DARK);
    const n = BAG_POCKETS.length;
    const x0 = MENU_W / 2 - (n * 8 - 2) / 2;
    for (let k = 0; k < n; k++) c.fillRect({ x: x0 + k * 8, y: 21, w: 6, h: 4 }, k === this.pocketAt ? DOT_ON : DOT_OFF);
  }

  private paintBagList(c: EmeraldCanvas, redo: () => void): void {
    const list = this.stacks();
    c.drawFrame({ x: 0, y: 0, w: MENU_W, h: c.height });
    if (list.length === 0) {
      c.drawTextCentred('NOTHING IN THIS POCKET', MENU_W / 2, 13, TEXT_GRAY);
      return;
    }
    const on = this.pickedStack()?.item;
    list.forEach((s, i) => {
      const y = 8 + i * BAG_ROW_H;
      const info = this.deps.rom ? itemInfo(this.deps.rom, s.item) : null;
      if (s.item === on) c.drawCursor(8, y + 6);
      drawIcon(c, s.item, 16, y, redo);
      const count = `×${s.n}`;
      const right = MENU_W - 10;
      c.drawText(count, right - measure(count), y + 5, TEXT_DARK);
      c.drawText(fitText(info?.name ?? '', right - measure(count) - 50), 44, y + 5, TEXT_DARK);
    });
  }

  private paintBagDesc(c: EmeraldCanvas): void {
    c.drawFrame({ x: 0, y: 0, w: MENU_W, h: BAG_DESC_H });
    const stack = this.pickedStack();
    if (!stack) return;
    const no = this.refusal(stack);
    const lines = no ? [no] : wrapText((this.deps.rom && itemInfo(this.deps.rom, stack.item)?.desc) || '', MENU_W - 16).slice(0, 3);
    // Two lines as a message box spaces them; a third closes them up to fit.
    const step = lines.length > 2 ? 10 : 13;
    const top = Math.round((BAG_DESC_H - (lines.length - 1) * step - 14) / 2);
    lines.forEach((line, i) => c.drawText(line, 8, top + i * step, no ? TEXT_RED : TEXT_DARK));
  }

  private paintBagUse(c: EmeraldCanvas): void {
    const w = MENU_W - BAG_BACK_W - GAP;
    c.drawFrame({ x: 0, y: 0, w, h: BACK_H });
    const stack = this.pickedStack();
    const label = !stack ? 'NOTHING HERE' : this.refusal(stack) ? "CAN'T USE" : 'USE';
    c.drawTextCentred(label, w / 2, 9, label === 'USE' ? TEXT_BLUE : TEXT_GRAY);
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
    // The windows say which menu this is, not the ROM's byte: just after BACK it still
    // reads the move menu, and between two menus nothing. A choice made then waits for
    // the action menu to come (touch.ts chooseBattle).
    if (!v || this.lastShown === 0) return;
    const which = v.menu === MENU_SAFARI || this.lastShown === MENU_SAFARI ? MENU_SAFARI : MENU_ACTION;
    if (which === MENU_ACTION && slot === 0) {
      this.deps.choose(MENU_ACTION, 0);
      this.opening = OPEN_FRAMES;
      this.setMode('moves');
      return;
    }
    // BAG is the page's own (ui/bag.ts), until USE: then it is the ROM's that uses it.
    if (which === MENU_ACTION && slot === 1 && this.deps.useItem) {
      this.pocketAt = 0;
      this.picked = 0;
      this.bagList.scrollTop = 0;
      this.setMode('bag');
      return;
    }
    this.send(() => this.deps.choose(which, slot));
  }

  private attack(slot: number): void {
    const v = this.view;
    if (!v || !v.moves[slot]?.id) return;
    // A choice the ROM refuses (no PP) brings the move list back, not the details.
    this.mode = 'moves';
    // FIGHT went in and the move menu is on its way: the choice waits for it. First,
    // since just after BACK the ROM's byte can still read the move menu it left.
    if (this.opening > 0) this.sendChained(() => this.deps.choose(MENU_MOVE, slot));
    else if (v.menu === MENU_MOVE) this.send(() => this.deps.choose(MENU_MOVE, slot));
    else if (v.menu === MENU_ACTION) this.sendChained(() => this.deps.choose(MENU_ACTION, 0, slot));
  }

  private goBack(): void {
    if (this.view?.menu === MENU_MOVE) {
      this.deps.back();
      // ...and the action menu is the one coming back.
      this.lastShown = MENU_ACTION;
    } else if (this.opening > 0) this.backOnOpen = true;
    this.setMode('action');
  }

  private send(go: () => void): void {
    go();
    this.chained = false;
    this.opening = 0;
    this.sent = REFUSED_FRAMES;
    this.setShown(false);
  }

  /** A move whose move menu is still to come: that menu opening is not a new choice. */
  private sendChained(go: () => void): void {
    this.send(go);
    this.chained = true;
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
    this.bagHeadWin.size(MENU_W, BAG_HEAD_H, scale);
    this.bagListWin.size(MENU_W, this.bagListHeight(), scale);
    this.bagDescWin.size(MENU_W, BAG_DESC_H, scale);
    this.bagBackWin.size(BAG_BACK_W, BACK_H, scale);
    this.bagUseWin.size(MENU_W - BAG_BACK_W - GAP, BACK_H, scale);
  }

  /** Each frame, from the ROM. */
  update(v: BattleView | null): void {
    const menu = v?.menu ?? 0;
    this.view = v;
    if (!v) {
      this.sent = 0;
      this.chained = false;
      this.opening = 0;
      this.backOnOpen = false;
      this.lastShown = 0;
      this.mode = 'action';
      this.lastMenu = 0;
      this.setShown(false);
      return;
    }
    // A new menu opening (a new turn, or FIGHT pressed by a thumb): the page follows it.
    if (menu !== this.lastMenu && menu !== 0) {
      if (menu === MENU_MOVE) this.opening = 0;
      if (menu === MENU_MOVE && this.backOnOpen) {
        this.backOnOpen = false;
        this.deps.back();
      } else if (menu === MENU_MOVE && this.chained) this.chained = false;
      else {
        this.sent = 0;
        if (menu === MENU_MOVE) this.mode = this.mode === 'info' ? 'info' : 'moves';
        // A new turn's actions; but not over the moves FIGHT was just tapped for.
        else if ((this.lastMenu === 0 || this.lastMenu === MENU_MOVE) && this.opening === 0) this.mode = 'action';
      }
    }
    this.lastMenu = menu;
    if (menu) this.lastShown = menu;
    this.idle = menu ? 0 : this.idle + 1;
    if (this.sent > 0) this.sent--;
    if (this.opening > 0) this.opening--;
    const shown = this.sent === 0 && (menu !== 0 || (this.shown && (this.idle < GRACE_FRAMES || this.opening > 0)));
    this.setShown(shown);
    if (shown) this.layout();
  }

  private layout(): void {
    const bag = this.mode === 'bag';
    const moves = this.mode === 'moves' || this.mode === 'info';
    const info = this.mode === 'info';
    const v = this.view;
    const labels = v ? actionLabels(v) : [];
    this.cells.forEach(({ b, w }, i) => {
      b.hidden = info || bag;
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
    for (const el of [this.bagHead, this.bagList, this.bagDesc, this.bagRow]) el.hidden = !bag;
    if (bag) {
      const stack = this.pickedStack();
      const h = this.bagListHeight();
      if (this.bagListWin.c.height !== h) this.bagListWin.size(MENU_W, h, this.scale);
      const key = `${this.pocketAt}|${stack?.item}|${this.view?.trainer}|${JSON.stringify(this.stacks())}`;
      this.bagHeadWin.show(String(this.pocketAt));
      this.bagListWin.show(key);
      this.bagDescWin.show(key);
      this.bagUseWin.show(key);
      this.bagUseBtn.setAttribute('aria-disabled', String(!stack || !!this.refusal(stack)));
      this.bagUseBtn.setAttribute('aria-label', stack ? `Use ${itemInfo(this.deps.rom!, stack.item)?.name ?? ''}` : 'Nothing to use');
    }
    if (info) {
      const h = this.infoHeight();
      if (this.sheetWin.c.height !== h) this.sheetWin.size(INFO_W, h, this.scale);
      this.sheetWin.show(`${this.info}|${v?.moves[this.info]?.id}|${v?.moves[this.info]?.pp}|${v?.foe.name}`);
      this.useWin.show(String(v?.moves[this.info]?.id));
    }
    // Only on a change: a write each frame dirties style for app.ts's read of the HUD.
    if (this.deps.root.dataset.mode !== this.mode) this.deps.root.dataset.mode = this.mode;
  }

  private paintCell(c: EmeraldCanvas, i: number, redo: () => void): void {
    const v = this.view;
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: CELL_H });
    if (!v) return;
    if (this.mode === 'action') {
      const l = actionLabels(v)[i];
      if (!l) return;
      c.drawTextCentred(l.label, CELL_W / 2, 24, l.enabled ? TEXT_DARK : TEXT_GRAY);
      return;
    }
    const slot = v.moves[i];
    const m = this.moveInfoAt(i);
    if (!slot?.id || !m) {
      c.drawTextCentred('-', CELL_W / 2, 24, TEXT_GRAY);
      return;
    }
    // The reference's row: the type, and the PP over on the right; the name; and how it
    // lands, on its band.
    drawType(c, m.type, 8, 6, redo);
    const pp = `PP ${slot.pp}/${slot.maxPp}`;
    c.drawText(pp, CELL_W - 8 - measure(pp), 7, slot.pp === 0 ? TEXT_RED : TEXT_DARK);
    c.drawText(fitText(m.name, CELL_W - 16), 8, 23, TEXT_DARK);
    drawEffect(c, moveEffect(this.deps.rom, m, v.foe.types), '', 6, 40, CELL_W - 12);
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
    drawEffect(c, e, m.power === 0 ? '' : ` VS ${v.foe.name}`, 6, 22, INFO_W - 12);
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
