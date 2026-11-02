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
import { BATTLE_MENU, MAIN_IN_BATTLE_BIT, MAIN_IN_BATTLE_BYTE, MENU_ACTION, MENU_MOVE, MENU_PARTY, MENU_SAFARI, MENU_TARGET, localBattler } from '../touch';
import { EmeraldCanvas, TEXT_BLUE, TEXT_DARK, TEXT_GRAY, TEXT_GREEN, TEXT_RED, TEXT_WHITE, fitText, measure, wrapText, type TextColor } from './emerald';
import { ITEMS_POCKET, Win, bagHolds, drawFitted, drawIcon, drawItemFitted, drawKeycap, picture } from './phonehud';
import { nextFocus, type Dir } from './focus';
import { BAG_POCKETS, FIELD_POCKETS, POCKET_BALLS, asksMove, asksWhoInField, isMachine, itemEffect, itemInfo, learnsMachine, medicineHelps, readBattleBag, usableInField, usedOnOne, type Stack } from './bag';

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
/** `gBrBattle.runChance` (include/br/br_battle.h): the odds of the next RUN, whole percent. */
export const BATTLE_RUN_CHANCE = 12;
const MAX_MON_MOVES = 4;

export interface MoveSlot {
  id: number;
  pp: number;
  maxPp: number;
}

export interface BattleView {
  /** gBrBattle.menu: 0 none, MENU_ACTION, MENU_MOVE, MENU_SAFARI, MENU_TARGET. */
  menu: number;
  /** A fight with somebody (a trainer, a bot, another player): RUN needs a POKe DOLL. */
  trainer: boolean;
  dolls: boolean;
  /** The odds of the next RUN, in percent: the ROM works them out (BrBattle_RunChance). */
  runChance: number;
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

const NO_BAG: Map<number, Stack[]> = new Map();

/** The battle as the menu needs it; null outside one or without the symbols. The bag's
 *  pockets only `withBag` (while the page's bag is open): a hundred slots a frame else. */
export function readBattleView(
  emu: BattleRead,
  sym: (name: string) => number | undefined,
  rom: Rom | null,
  withBag = false,
): BattleView | null {
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
    runChance: emu.read(br + BATTLE_RUN_CHANCE, 8),
    safariBalls: balls === undefined ? 0 : emu.read(balls, 8),
    moves,
    foe: { name: foeName, types: [emu.read(foe + MON_TYPES, 8), emu.read(foe + MON_TYPES + 1, 8)] },
    bag: withBag ? readBattleBag(emu, sym, rom) : NO_BAG,
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

/** In a battle (gMain.inBattle): its scene, and the BAG and party screens it opens, from
 *  CB2_InitBattleInternal until the battle hands back to the field. */
export function inBattle(emu: BattleRead, sym: (name: string) => number | undefined): boolean {
  const main = sym('gMain');
  return main !== undefined && (emu.read(main + MAIN_IN_BATTLE_BYTE, 8) & MAIN_IN_BATTLE_BIT) !== 0;
}

/** The battle itself is on screen and wants nothing the D-pad or A/B give (Cam,
 *  2026-10-15: "we shouldn't need them after all our UI changes"): the choices are the
 *  windows, and the text runs on by itself (br_battle.c BrBattle_AutoScrollFrames). The
 *  BAG and the party, which are screens of their own (callback2 is not BattleMainCB2),
 *  a battle script waiting on a press (ASKS_PAD), a double battle's target, picked with
 *  LEFT/RIGHT and backed out of with B (POK-383), and a spectator's replay, where LEFT
 *  and RIGHT pick who to watch, keep them. */
export function battleWantsNoPad(emu: BattleRead, sym: (name: string) => number | undefined, rom: Rom | null): boolean {
  const main = sym('gMain');
  const scene = sym('BattleMainCB2');
  const instr = sym('gBattlescriptCurrInstr');
  if (main === undefined || scene === undefined || instr === undefined || !rom) return false;
  if (!inBattle(emu, sym)) return false;
  if ((emu.read(main + MAIN_CALLBACK2, 32) & ~1) !== (scene & ~1)) return false;
  const flags = sym('gBattleTypeFlags');
  if (flags === undefined || emu.read(flags, 32) & BATTLE_TYPE_RECORDED) return false;
  const br = sym('gBrBattle');
  if (br !== undefined && emu.read(br + BATTLE_MENU, 8) === MENU_TARGET) return false;
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

/** The action windows: a word each (Cam, 2026-10-14: nothing under it), and RUN's odds
 *  (Cam, 2026-11-01). RUN is grey where it cannot work: a fight with somebody and no
 *  POKe DOLL (br_battle.c). The Safari's RUN always works, so it has no odds to give. */
export function actionLabels(v: BattleView): { label: string; enabled: boolean }[] {
  if (v.menu === MENU_SAFARI) return ['BALL', 'POKéBLOCK', 'GO NEAR', 'RUN'].map((label) => ({ label, enabled: true }));
  return [
    { label: 'FIGHT', enabled: true },
    { label: 'BAG', enabled: true },
    { label: 'POKéMON', enabled: true },
    { label: `RUN ${v.runChance}%`, enabled: !v.trainer || v.dolls },
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
type Mode = 'action' | 'moves' | 'info' | 'bag' | 'item' | 'party' | 'member' | 'usemove';

/** A team member as the party windows show it. */
export interface PartyMember {
  species: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  status: number;
  item: number;
  itemName: string;
  ability: string;
  moves: { id: number; pp: number; maxPp: number }[];
  /** Out in the battle now. */
  active: boolean;
}

/** The buttons under the moves (Cam's sketch, 11-01), three across MENU_W. */
const ACTION_W = 72;
const PARTY_H = 44;
const MEMBER_CARD_H = 56;
const MEMBER_HELD_H = 32;
const MEMBER_MOVE_H = 56;
const ITEM_POKE_BALL = 4, ITEM_ESCAPE_ROPE = 85, ITEM_POKEBLOCK_CASE = 273, ITEM_TM_CASE = 364;
const ICON_BOX = 15;
const SLOT_MENU_PARTY = 2, SLOT_RUN = 3;
const USE_HEAD_W = 100, USE_HEAD_H = 34;

/** A button's icon and word, side by side and centred. A long word (RUN 100%) has a smaller
 *  icon rather than be cut. */
function iconButton(c: EmeraldCanvas, w: number, h: number, icon: (cx: number, cy: number, box: number) => void, word: string, color: TextColor): void {
  c.drawFrame({ x: 0, y: 0, w, h });
  const tw = measure(word);
  const box = tw + ICON_BOX + 4 > w - 8 ? 10 : ICON_BOX;
  const left = Math.round((w - tw - box - 4) / 2);
  icon(left + box / 2, h / 2, box);
  c.drawText(fitText(word, w - box - 8), left + box + 4, Math.floor((h - 14) / 2), color);
}

/** BACK's red arrow. */
function drawBackArrow(c: EmeraldCanvas, cx: number, cy: number): void {
  for (let i = 0; i < 5; i++) c.fillRect({ x: Math.round(cx) - 2 + i, y: Math.round(cy) - i, w: 1, h: 2 * i + 1 }, ARROW_RED);
}

function hpColor(frac: number): string {
  return frac > 0.5 ? '#38d060' : frac > 0.2 ? '#f0c000' : '#e03820';
}

function drawHp(c: EmeraldCanvas, x: number, y: number, w: number, frac: number): void {
  c.fillRect({ x, y, w, h: 4 }, '#626262');
  if (frac > 0) c.fillRect({ x: x + 1, y: y + 1, w: Math.max(1, Math.round((w - 2) * frac)), h: 2 }, hpColor(frac));
}

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
  /** The bag's pockets now, for the frame BAG is tapped (readBattleView reads them after). */
  readBag?(): Map<number, Stack[]>;
  /** The moves up first, with PARTY, BAG and RUN under them and the page's own party screens
   *  (Cam's sketches, 11-01). /classic/ keeps its FIGHT/BAG/POKeMON/RUN. */
  firstMoves?: {
    readParty(): PartyMember[];
    icon(species: number): CanvasImageSource | null;
    bag(): CanvasImageSource | null;
    /** USE on one of them: `item` out of `pocket`, the ROM's BAG and party walked unseen. */
    useOn(pocket: number, item: number, slot: number, move?: number): void;
    /** One has fainted: the party's own screen, already asking, has this one go out. */
    sendOut(slot: number): void;
    /** ...or its SUMMARY, and back to the question. */
    summaryOut(slot: number): void;
    /** The same windows off a battle: PARTY and BAG on the field. */
    field?: {
      close(): void;
      readBag(): Map<number, Stack[]>;
      summary(slot: number): void;
      moves(slot: number): void;
      swap(a: number, b: number): Promise<void>;
      give(slot: number, item: number): Promise<void>;
      take(slot: number, item: number): Promise<void>;
      use(pocket: number, item: number, slot?: number, move?: number): void;
    };
    /** A keyboard's keys on PARTY and BAG. */
    keys?: { party: string; bag: string };
    /** Send out the party's `slot`; or open its SUMMARY. */
    switchTo(slot: number): void;
    summary(slot: number): void;
  };
  /** Has the focus show from the start: nothing here is touched. */
  focusFirst?: boolean;
}

/** The bag's windows, GBA pixels: the pocket bar, the list and BACK under it. A tap on
 *  a row opens that item's page -- its name, the description, BACK and USE (Cam,
 *  2026-10-18, POK-415: on a short phone USE had run off the glass under the list).
 *  The list takes what the glass has left (setRoom), in whole rows, from one up to
 *  BAG_LIST_ROWS; past that it scrolls. */
export const BAG_HEAD_H = 32;
export const BAG_ARROW_W = 56;
export const BAG_LIST_H = 104;
export const BAG_LIST_ROWS = 5;
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
  /** GBA pixels from the menu's top to the bottom of the glass; Infinity until told. */
  private room = Infinity;
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
  private readonly actions: HTMLElement;
  private readonly actionWins: Win[] = [];
  private readonly partyBox: HTMLElement;
  private readonly partyCells: { b: HTMLButtonElement; w: Win }[] = [];
  private readonly memberBox: HTMLElement;
  private readonly memberWins: { w: Win; ww: number; hh: number }[] = [];
  private team: PartyMember[] = [];
  private memberAt = 0;
  /** The item that brought the party up, until a slot or BACK. */
  private using: { pocket: number; item: number; effect: Uint8Array | null; name: string } | null = null;
  /** A dropped team on the windows, and the one of theirs picked while choosing one of ours. */
  private drop: { who: string; rows: PartyMember[]; take(at: number, give?: number): void; close(): void; pick: boolean } | null = null;
  private dropCan: ((m: PartyMember) => boolean) | null = null;
  private dropAt: number | null = null;
  private forgetting: { name: string; done(row: number | null): void } | null = null;
  private readonly forgetHead: HTMLElement;
  private readonly forgetHeadWin: Win;
  /** Off a battle, which screen BACK leaves from; null in one. */
  private fieldHome: 'party' | 'bag' | null = null;
  private fieldBag: Map<number, Stack[]> | null = null;
  /** SWITCH: the one to move, until a slot or BACK. */
  private swapFrom: number | null = null;
  /** GIVE: who is to hold what the bag picks. */
  private giving: number | null = null;
  private heldBtn!: HTMLButtonElement;
  private movesBtn!: HTMLButtonElement;
  private fitKey = '';
  /** One has fainted and the ROM is asking who goes out. */
  private forced = false;
  /** The ROM's turn on its own screen: the windows stand aside whatever the menu byte says. */
  away = false;
  private readonly useMoveBox: HTMLElement;
  private readonly useMoveWins: { b: HTMLButtonElement; w: Win }[] = [];
  private readonly useHead: HTMLElement;
  private readonly useHeadWin: Win;
  /** Which button the keys are on, among those on show. */
  private focused: HTMLElement | null = null;
  private showFocus = false;

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
      if (this.deps.firstMoves) drawBackArrow(c, MENU_W / 2 - 24, BACK_H / 2);
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
    // Over the moves' BACK, which is the list's too: goBack is the action menu from here.
    deps.root.insertBefore(this.bagHead, this.backBtn);
    this.bagHeadWin = new Win(this.bagHead, MENU_W, BAG_HEAD_H, (c) => this.paintBagHead(c));
    for (const dir of [-1, 1] as const) {
      const b = button(dir < 0 ? 'bm-bag-prev' : 'bm-bag-next', this.bagHead);
      b.setAttribute('aria-label', dir < 0 ? 'Previous pocket' : 'Next pocket');
      b.addEventListener('click', () => this.stepPocket(dir));
    }
    this.bagList = doc.createElement('div');
    this.bagList.className = 'bm-bag bm-bag-list';
    deps.root.insertBefore(this.bagList, this.backBtn);
    this.bagListWin = new Win(this.bagList, MENU_W, BAG_LIST_H, (c, redo) => this.paintBagList(c, redo));
    this.wireBagList();
    // An item's page: what it is and does, then BACK to the list and USE.
    this.bagDesc = doc.createElement('div');
    this.bagDesc.className = 'bm-bag bm-bag-item';
    this.bagDesc.setAttribute('role', 'dialog');
    deps.root.appendChild(this.bagDesc);
    this.bagDescWin = new Win(this.bagDesc, MENU_W, BAG_DESC_H, (c, redo) => this.paintBagDesc(c, redo));
    this.bagRow = doc.createElement('div');
    this.bagRow.className = 'bm-bag bm-info-row';
    deps.root.appendChild(this.bagRow);
    const bagBack = button('bm-bag-back', this.bagRow);
    bagBack.setAttribute('aria-label', 'Back');
    this.bagBackWin = new Win(bagBack, BAG_BACK_W, BACK_H, (c) => {
      c.drawFrame({ x: 0, y: 0, w: BAG_BACK_W, h: BACK_H });
      c.drawTextCentred('BACK', BAG_BACK_W / 2, 9, TEXT_DARK);
    });
    bagBack.addEventListener('click', () => this.setMode('bag'));
    this.bagUseBtn = button('bm-bag-use', this.bagRow);
    this.bagUseWin = new Win(this.bagUseBtn, MENU_W - BAG_BACK_W - GAP, BACK_H, (c) => this.paintBagUse(c));
    this.bagUseBtn.addEventListener('click', () => this.useItem());
    this.showFocus = !!deps.focusFirst;

    // PARTY, BAG and RUN under the moves.
    this.actions = doc.createElement('div');
    this.actions.className = 'bm-actions';
    deps.root.insertBefore(this.actions, this.backBtn);
    const first = deps.firstMoves;
    const WORDS = ['PARTY', 'BAG', 'RUN'];
    // With a keyboard they stand in a column beside the moves, wider, for the keys' caps.
    this.actionW = first?.keys ? 88 : ACTION_W;
    this.actionH = first?.keys ? 40 : BACK_H;
    WORDS.forEach((word, i) => {
      const b = button(`bm-act bm-act-${word.toLowerCase()}`, this.actions);
      b.setAttribute('aria-label', word);
      const w = new Win(b, this.actionW, this.actionH, (c, redo) => {
        const run = i === 2 ? this.runLabel() : null;
        const label = run?.label ?? word;
        const color = run && !run.enabled ? TEXT_GRAY : TEXT_DARK;
        iconButton(c, this.actionW, this.actionH, (cx, cy, box) => {
          if (i === 1) { const bag = first?.bag(); if (bag) drawFitted(c, 'bag', bag, 0, 0, 64, 64, cx, cy, box); }
          else drawItemFitted(c, i === 0 ? ITEM_POKE_BALL : ITEM_ESCAPE_ROPE, cx, cy, box, redo);
        }, label, color);
        const key = i === 0 ? first?.keys?.party : i === 1 ? first?.keys?.bag : undefined;
        if (key) drawKeycap(c, key, this.actionW - 3, 3);
      });
      this.actionWins.push(w);
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true') return;
        if (i === 0) this.openParty();
        else this.act(i === 1 ? 1 : SLOT_RUN);
      });
    });

    // The party: an icon, a name and HP for each, in place of the moves.
    this.partyBox = doc.createElement('div');
    this.partyBox.className = 'bm-party';
    deps.root.insertBefore(this.partyBox, this.backBtn);
    // Over them, when it is an item that brought them up: the item, and the question.
    this.useHead = doc.createElement('div');
    this.useHead.className = 'bm-use-head';
    this.useHead.hidden = true;
    this.partyBox.appendChild(this.useHead);
    this.useHeadWin = new Win(this.useHead, USE_HEAD_W, USE_HEAD_H, (c) => {
      c.fillRect({ x: 0, y: 0, w: USE_HEAD_W, h: USE_HEAD_H }, 'rgba(16,20,24,0.6)');
      const top = this.forced ? 'Send out' : this.swapFrom !== null ? 'Switch with' : this.drop ? (this.dropAt !== null ? 'Swap for' : this.drop.who) : this.using?.name ?? '';
      c.drawTextCentred(fitText(top, USE_HEAD_W - 8), USE_HEAD_W / 2, 3, TEXT_WHITE);
      c.drawTextCentred('Which POKeMON?', USE_HEAD_W / 2, 18, TEXT_WHITE);
    });
    for (let i = 0; i < 6; i++) {
      const b = button('bm-slot', this.partyBox);
      const w = new Win(b, CELL_W, PARTY_H, (c) => this.paintSlot(c, i));
      this.partyCells.push({ b, w });
      b.addEventListener('click', () => {
        if (!this.team[i] || b.getAttribute('aria-disabled') === 'true') return;
        if (this.drop) {
          const first = this.deps.firstMoves;
          if (this.drop.pick) {
            this.drop.take(i);
          } else if (this.dropAt !== null) {
            this.drop.take(this.dropAt, i);
          } else if (first && first.readParty().length >= 6) {
            // A full party trades one for one.
            this.dropAt = i;
            this.team = first.readParty();
            this.paintDrop();
            this.settleFocus(true);
          } else this.drop.take(i);
          return;
        }
        if (this.swapFrom !== null) {
          const from = this.swapFrom;
          this.swapFrom = null;
          void this.deps.firstMoves?.field?.swap(from, i).then(() => this.openParty());
          return;
        }
        const using = this.using;
        if (using?.effect && asksMove(using.effect)) {
          this.memberAt = i;
          this.setMode('usemove');
          this.useMoveWins.forEach(({ b, w }, n) => {
            const v = this.team[i]?.moves[n];
            b.hidden = !v;
            b.setAttribute('aria-disabled', String(!v || v.pp >= v.maxPp));
            w.show(`${i}|${JSON.stringify(v)}`);
          });
          this.settleFocus(true);
          return;
        }
        if (using && this.fieldHome) {
          this.deps.firstMoves?.field?.use(using.pocket, using.item, i);
          return;
        }
        if (using) {
          this.using = null;
          this.mode = 'action';
          this.send(() => this.deps.firstMoves?.useOn(using.pocket, using.item, i));
          return;
        }
        this.memberAt = i;
        this.setMode('member');
      });
    }

    // Which of their moves, for an ETHER, or to make room for a new one.
    this.useMoveBox = doc.createElement('div');
    this.useMoveBox.className = 'bm-m-moves bm-usemove';
    deps.root.insertBefore(this.useMoveBox, this.backBtn);
    this.forgetHead = doc.createElement('div');
    this.forgetHead.className = 'bm-forget-head';
    this.forgetHead.hidden = true;
    this.useMoveBox.appendChild(this.forgetHead);
    this.forgetHeadWin = new Win(this.forgetHead, MENU_W, 18, (c) => {
      c.fillRect({ x: 0, y: 0, w: MENU_W, h: 18 }, 'rgba(16,20,24,0.6)');
      c.drawTextCentred(fitText(`Forget one for ${this.forgetting?.name ?? ''}?`, MENU_W - 8), MENU_W / 2, 3, TEXT_WHITE);
    });
    for (let n = 0; n < 4; n++) {
      const b = button('bm-pick-move', this.useMoveBox);
      const w = new Win(b, CELL_W, PARTY_H, (c) => this.paintUseMove(c, n));
      this.useMoveWins.push({ b, w });
      b.addEventListener('click', () => {
        if (this.forgetting && b.getAttribute('aria-disabled') !== 'true') { this.forgetting.done(n); return; }
        const using = this.using;
        if (!using || b.getAttribute('aria-disabled') === 'true') return;
        const slot = this.memberAt;
        if (this.fieldHome) {
          this.deps.firstMoves?.field?.use(using.pocket, using.item, slot, n);
          return;
        }
        this.using = null;
        this.mode = 'action';
        this.send(() => this.deps.firstMoves?.useOn(using.pocket, using.item, slot, n));
      });
    }

    // One of them: who, what they hold, their moves against this foe, and what to do.
    this.memberBox = doc.createElement('div');
    this.memberBox.className = 'bm-member';
    deps.root.appendChild(this.memberBox);
    const part = (cls: string, ww: number, hh: number, paint: (c: EmeraldCanvas, redo: () => void) => void) => {
      const el = doc.createElement('div');
      el.className = cls;
      this.memberBox.appendChild(el);
      this.memberWins.push({ w: new Win(el, ww, hh, paint), ww, hh });
    };
    part('bm-m-card', MENU_W, MEMBER_CARD_H, (c) => this.paintCard(c));
    part('bm-m-held', MENU_W - 16, MEMBER_HELD_H, (c, redo) => this.paintHeld(c, redo));
    const moves = doc.createElement('div');
    moves.className = 'bm-m-moves';
    this.memberBox.appendChild(moves);
    for (let i = 0; i < 4; i++) {
      const el = doc.createElement('div');
      moves.appendChild(el);
      this.memberWins.push({ w: new Win(el, CELL_W, MEMBER_MOVE_H, (c) => this.paintMemberMove(c, i)), ww: CELL_W, hh: MEMBER_MOVE_H });
    }
    const mrow = doc.createElement('div');
    mrow.className = 'bm-m-row';
    this.memberBox.appendChild(mrow);
    const rowButton = (word: string | (() => string), color: () => TextColor, icon: (c: EmeraldCanvas, cx: number, cy: number, redo: () => void) => void, press: () => void) => {
      const b = button('bm-m-btn', mrow);
      const says = typeof word === 'string' ? () => word : word;
      b.setAttribute('aria-label', says());
      this.memberWins.push({ w: new Win(b, ACTION_W, BACK_H, (c, redo) => iconButton(c, ACTION_W, BACK_H, (cx, cy) => icon(c, cx, cy, redo), says(), color())), ww: ACTION_W, hh: BACK_H });
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') press(); });
      return b;
    };
    rowButton('BACK', () => TEXT_DARK, (c, cx, cy) => drawBackArrow(c, cx, cy), () => this.setMode('party'));
    rowButton('SUMMARY', () => TEXT_DARK, (c, cx, cy, redo) => drawItemFitted(c, ITEM_TM_CASE, cx, cy, ICON_BOX, redo), () => {
      if (this.fieldHome) first?.field?.summary(this.memberAt);
      else this.send(() => (this.forced ? first?.summaryOut(this.memberAt) : first?.summary(this.memberAt)));
    });
    this.selectBtn = rowButton(() => (this.fieldHome ? 'SWITCH' : 'SELECT'), () => (this.canSelect() ? TEXT_BLUE : TEXT_GRAY), (c, cx, cy, redo) => drawItemFitted(c, ITEM_POKE_BALL, cx, cy, ICON_BOX, redo), () => {
      if (this.fieldHome) { this.swapFrom = this.memberAt; this.openParty(); return; }
      this.send(() => (this.forced ? first?.sendOut(this.memberAt) : first?.switchTo(this.memberAt)));
    });
    // Off a battle: what they hold, and the rung's free moves.
    this.heldBtn = rowButton(() => (this.team[this.memberAt]?.item ? 'TAKE' : 'GIVE'), () => TEXT_DARK, (c, cx, cy, redo) => drawItemFitted(c, this.team[this.memberAt]?.item || ITEM_POKE_BALL, cx, cy, ICON_BOX, redo), () => {
      const m = this.team[this.memberAt];
      if (!m) return;
      if (m.item) { void first?.field?.take(this.memberAt, m.item).then(() => this.refreshTeam()); return; }
      this.giving = this.memberAt;
      this.fieldBag = first?.field?.readBag() ?? null;
      this.pocketAt = 0;
      this.picked = 0;
      this.setMode('bag');
    });
    this.movesBtn = rowButton('MOVES', () => TEXT_DARK, (c, cx, cy, redo) => drawItemFitted(c, ITEM_TM_CASE, cx, cy, ICON_BOX, redo), () => first?.field?.moves(this.memberAt));
    this.setPartyHidden();
    if (first?.keys) {
      // The keys, by the windows they drive: the keyboard's and a pad's.
      const el = doc.createElement('div');
      el.className = 'bm-keys';
      deps.root.appendChild(el);
      const rows: [string, string][] = [['ARROWS', 'move'], ['Z  A', 'choose'], ['X  B', 'back'], ['Q  L', 'PARTY'], ['E  R', 'BAG'], ['SHIFT', 'details']];
      const h = rows.length * 17 + 8;
      this.keysWin = new Win(el, 118, h, (c) => {
        c.fillRect({ x: 0, y: 0, w: 118, h }, 'rgba(16,20,24,0.6)');
        rows.forEach(([k, what], i) => {
          drawKeycap(c, k, 6 + measure(k) + 5, 5 + i * 17);
          c.drawText(what, 62, 4 + i * 17, TEXT_WHITE);
        });
      });
      this.keysH = h;
    }
    deps.root.addEventListener('pointerdown', () => {
      if (deps.focusFirst) return;
      this.showFocus = false;
      this.paintFocus();
    });
    deps.root.hidden = true;
  }

  private selectBtn: HTMLButtonElement | null = null;
  private keysWin: Win | null = null;
  private keysH = 0;
  private actionW = ACTION_W;
  private actionH = BACK_H;

  private setPartyHidden(): void {
    this.actions.hidden = this.partyBox.hidden = this.memberBox.hidden = this.useMoveBox.hidden = true;
  }

  private runLabel(): { label: string; enabled: boolean } | null {
    const v = this.view;
    return v ? actionLabels(v)[SLOT_RUN] ?? null : null;
  }

  // ---- the same windows off a battle -----------------------------------------------------

  /** PARTY or BAG on the field. No battle runs under them: the page's own reads and writes,
   *  and a walk of the ROM's screens only for what has to be the ROM's. */
  openField(home: 'party' | 'bag', keep = false): void {
    this.fieldHome = home;
    this.view = null;
    this.lastMenu = 0;
    this.sent = 0;
    if (!keep) { this.pocketAt = 0; this.picked = 0; this.using = null; this.swapFrom = null; this.giving = null; }
    this.setShown(true);
    if (home === 'party') this.openParty();
    else {
      this.fieldBag = this.deps.firstMoves?.field?.readBag() ?? null;
      this.setMode('bag');
      this.layout();
    }
    this.settleFocus(true);
  }

  /** A dropped team on the party's windows: who to take, and when the party is full, for whom.
   *  The rows stand in as members: an icon, a name and a whole HP bar. */
  openDrop(who: string, rows: PartyMember[], take: (at: number, give?: number) => void, close: () => void, can?: (m: PartyMember) => boolean): void {
    this.fieldHome = 'party';
    this.view = null;
    this.lastMenu = 0;
    this.sent = 0;
    this.using = null;
    this.swapFrom = null;
    this.giving = null;
    this.drop = { who, rows, take, close, pick: false };
    this.dropCan = can ?? null;
    this.dropAt = null;
    this.team = rows;
    this.setShown(true);
    this.mode = 'party';
    this.paintDrop();
    this.layout();
    this.settleFocus(true);
  }

  /** Which of the party: the windows ask for the page, for what the ROM will then be told. */
  openPick(title: string, take: (at: number) => void, close: () => void, can?: (m: PartyMember, rom: Rom | null) => boolean): void {
    const rows = this.deps.firstMoves?.readParty() ?? [];
    this.openDrop(title, rows, take, close, can ? (m) => can(m, this.deps.rom) : undefined);
    if (this.drop) this.drop.pick = true;
    this.paintDrop();
    this.settleFocus(true);
  }

  /** A new move and four known: which goes. BACK keeps the four. */
  openForget(slot: number, name: string, done: (row: number | null) => void): void {
    this.fieldHome = 'party';
    this.view = null;
    this.lastMenu = 0;
    this.sent = 0;
    this.using = null;
    this.swapFrom = null;
    this.giving = null;
    this.drop = null;
    this.forgetting = { name, done };
    this.team = this.deps.firstMoves?.readParty() ?? [];
    this.memberAt = slot;
    this.forgetHead.hidden = false;
    this.forgetHeadWin.show(name);
    this.setShown(true);
    this.mode = 'usemove';
    this.layout();
    this.useMoveWins.forEach(({ b, w }, n) => {
      const v = this.team[slot]?.moves[n];
      b.hidden = !v;
      b.setAttribute('aria-disabled', String(!v));
      w.show(`f${slot}|${JSON.stringify(v)}|${name}`);
    });
    this.settleFocus(true);
  }

  private paintDrop(): void {
    this.useHead.hidden = false;
    this.useHeadWin.show(`${this.drop?.who}|${this.dropAt}`);
    this.partyCells.forEach(({ b, w }, i) => {
      const m = this.team[i];
      b.setAttribute('aria-disabled', String(!m || (this.dropCan ? !this.dropCan(m) : false)));
      w.show(`d${JSON.stringify([m ?? null, this.dropAt, this.dropCan ? !!m && this.dropCan(m) : true])}`);
    });
    this.layout();
  }

  /** Stood aside for a screen that is the ROM's; openField or reshow brings them back. */
  hideField(): void {
    this.setShown(false);
  }

  /** Back where they were, with what the ROM's screen changed. */
  reshowField(): void {
    this.using = null;
    this.setShown(true);
    this.fieldBag = this.deps.firstMoves?.field?.readBag() ?? null;
    if (this.fieldHome === 'bag') { this.mode = 'bag'; this.layout(); }
    else if (this.mode === 'member') this.refreshTeam();
    else this.openParty();
    this.settleFocus(true);
  }

  closeField(): void {
    this.forgetting = null;
    this.forgetHead.hidden = true;
    this.dropCan = null;
    this.drop = null;
    this.dropAt = null;
    this.fieldHome = null;
    this.using = null;
    this.swapFrom = null;
    this.giving = null;
    this.useHead.hidden = true;
    this.mode = 'action';
    this.setShown(false);
  }

  private refreshTeam(): void {
    const first = this.deps.firstMoves;
    if (first) this.team = first.readParty();
    this.layout();
  }

  private pockets(): { pocket: number; label: string }[] {
    return this.fieldHome ? FIELD_POCKETS : BAG_POCKETS;
  }

  /** Whether `mode` shows the moves first, here, for this battle (the Safari has no moves). */
  private home(): Mode {
    if (this.fieldHome) return this.fieldHome;
    return this.deps.firstMoves && this.view?.menu !== MENU_SAFARI && this.lastShown !== MENU_SAFARI ? 'moves' : 'action';
  }

  private openParty(using: BattleMenu['using'] = null): void {
    const first = this.deps.firstMoves;
    if (!first) return;
    this.using = using;
    this.team = first.readParty();
    this.useHead.hidden = !using && !this.forced && this.swapFrom === null;
    this.useHeadWin.show(this.forced ? 'send' : this.swapFrom !== null ? 'swap' : using?.name ?? '');
    this.partyCells.forEach(({ b }, i) => b.setAttribute('aria-disabled', String(!this.slotHelps(i))));
    this.setMode('party');
    this.partyCells.forEach(({ w }, i) => w.show(JSON.stringify([this.team[i] ?? null, using?.item, this.swapFrom])));
  }

  /** Whether this slot can be pressed: with an item in hand, only who it would help. */
  private slotHelps(i: number): boolean {
    const m = this.team[i];
    if (!m) return false;
    if (this.using && isMachine(this.using.item) && this.deps.rom) return learnsMachine(this.deps.rom, m.species, this.using.item);
    return !this.using?.effect || !usedOnOne(this.using.effect) || medicineHelps(this.using.effect, m);
  }

  private canSelect(): boolean {
    const m = this.team[this.memberAt];
    if (this.fieldHome) return this.team.length > 1;
    return !!m && !m.active && m.hp > 0;
  }

  private paintSlot(c: EmeraldCanvas, i: number): void {
    const m = this.team[i];
    if (!m) return;
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: PARTY_H });
    const icon = this.deps.firstMoves?.icon(m.species);
    if (icon) c.drawImageTo(icon, 0, 0, 32, 32, 5, 6, 32, 32);
    const dim = this.dropCan ? !this.dropCan(m) : this.using ? !this.slotHelps(i) : m.hp === 0;
    c.drawText(fitText(m.name, CELL_W - 48), 40, 9, dim ? TEXT_GRAY : m.active ? TEXT_BLUE : TEXT_DARK);
    drawHp(c, 40, 28, CELL_W - 50, m.maxHp ? m.hp / m.maxHp : 0);
  }

  private paintCard(c: EmeraldCanvas): void {
    const m = this.team[this.memberAt];
    c.drawFrame({ x: 0, y: 0, w: MENU_W, h: MEMBER_CARD_H });
    if (!m) return;
    const icon = this.deps.firstMoves?.icon(m.species);
    if (icon) c.drawImageTo(icon, 0, 0, 32, 32, 10, 12, 32, 32);
    c.drawText(fitText(m.name, 120), 50, 8, TEXT_DARK);
    const lv = `Lv${m.level}`;
    c.drawText(lv, MENU_W - 10 - measure(lv), 8, TEXT_GRAY);
    c.drawText(fitText(m.ability, MENU_W - 60), 50, 22, TEXT_BLUE);
    drawHp(c, 50, 40, 110, m.maxHp ? m.hp / m.maxHp : 0);
    const hp = `${m.hp}/${m.maxHp}`;
    c.drawText(hp, MENU_W - 10 - measure(hp), 36, TEXT_DARK);
  }

  private paintHeld(c: EmeraldCanvas, redo: () => void): void {
    const m = this.team[this.memberAt];
    c.drawFrame({ x: 0, y: 0, w: MENU_W - 16, h: MEMBER_HELD_H });
    if (!m) return;
    if (m.item) drawIcon(c, m.item, 8, 4, redo);
    c.drawText(m.item ? m.itemName : 'Holds nothing', m.item ? 36 : 12, 9, m.item ? TEXT_DARK : TEXT_GRAY);
  }

  private paintUseMove(c: EmeraldCanvas, i: number): void {
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: PARTY_H });
    const slot = this.team[this.memberAt]?.moves[i];
    const info = slot && this.deps.rom ? moveInfo(this.deps.rom, slot.id) : null;
    if (!slot || !info) return;
    const full = !this.forgetting && slot.pp >= slot.maxPp;
    c.drawText(fitText(info.name, CELL_W - 16), 8, 6, full ? TEXT_GRAY : TEXT_DARK);
    c.drawText(`PP ${slot.pp}/${slot.maxPp}`, 8, 22, slot.pp === 0 ? TEXT_RED : TEXT_GRAY);
  }

  private paintMemberMove(c: EmeraldCanvas, i: number): void {
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: MEMBER_MOVE_H });
    const slot = this.team[this.memberAt]?.moves[i];
    const info = slot && this.deps.rom ? moveInfo(this.deps.rom, slot.id) : null;
    if (!slot || !info) { c.drawTextCentred('-', CELL_W / 2, 20, TEXT_GRAY); return; }
    c.drawText(fitText(info.name, CELL_W - 16), 8, 7, TEXT_DARK);
    c.drawText(`PP ${slot.pp}/${slot.maxPp}`, 8, 21, slot.pp === 0 ? TEXT_RED : TEXT_GRAY);
    if (this.view) drawEffect(c, moveEffect(this.deps.rom, info, this.view.foe.types), '', 6, 37, CELL_W - 12);
  }

  // ---- the keys and a pad --------------------------------------------------------------

  get isShown(): boolean {
    return this.shown;
  }

  private targets(): HTMLElement[] {
    return [...this.deps.root.querySelectorAll<HTMLElement>('button.bm-btn')].filter((b) => b.offsetParent !== null && b.getAttribute('aria-disabled') !== 'true' && !b.className.includes('bm-bag-prev') && !b.className.includes('bm-bag-next'));
  }

  private paintFocus(): void {
    for (const b of this.deps.root.querySelectorAll('.bm-focus')) b.classList.remove('bm-focus');
    if (this.showFocus && this.focused?.isConnected) this.focused.classList.add('bm-focus');
  }

  /** Back on the first button of whatever is on show, or kept where it was. */
  private settleFocus(reset = false): void {
    if (!this.shown) return;
    const list = this.targets();
    if (reset || !this.focused || !list.includes(this.focused)) this.focused = list[0] ?? null;
    this.paintFocus();
  }

  /** A key of the keyboard or a pad, while the windows are up: up, down, left, right, a, b, l,
   *  r, select. False when it is nobody's here, for the ROM. */
  key(k: string): boolean {
    if (!this.shown) return false;
    if (!this.showFocus) { this.showFocus = true; this.settleFocus(true); if (k !== 'a' && k !== 'b') return true; }
    if (this.mode === 'bag') return this.bagKey(k);
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      const list = this.targets();
      const at = this.focused ? list.indexOf(this.focused) : -1;
      const boxes = list.map((b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      this.focused = list[nextFocus(boxes, at, k as Dir)] ?? null;
      this.paintFocus();
      return true;
    }
    if (k === 'a') { this.focused?.click(); return true; }
    if (k === 'b' && this.fieldHome) { this.goBack(); return true; }
    if (k === 'b') {
      if (this.mode === 'info') this.setMode('moves');
      else if (this.mode === 'item') this.setMode('bag');
      else if (this.mode === 'member') this.setMode('party');
      else if (this.mode === 'usemove') this.setMode('party');
      else if (this.mode === 'party' && this.using) this.dropItem();
      else if (this.mode === 'party' && this.forced) return true;
      else if (this.mode !== this.home()) this.goBack();
      return true;
    }
    if (this.deps.firstMoves && this.mode === 'moves') {
      if (k === 'l') { this.openParty(); return true; }
      if (k === 'r') { this.act(1); return true; }
      if (k === 'select' && this.focused) {
        const i = this.cells.findIndex((x) => x.b === this.focused);
        if (i >= 0 && this.view?.moves[i]?.id) { this.info = i; this.setMode('info'); }
        return true;
      }
    }
    return true;
  }

  private bagKey(k: string): boolean {
    const list = this.stacks();
    const at = Math.max(0, list.findIndex((s) => s.item === this.pickedStack()?.item));
    if (k === 'left' || k === 'right') this.stepPocket(k === 'left' ? -1 : 1);
    else if (k === 'up' || k === 'down') {
      const to = list[at + (k === 'up' ? -1 : 1)];
      if (to) {
        this.picked = to.item;
        const y = (at + (k === 'up' ? -1 : 1)) * BAG_ROW_H * this.scale;
        const h = this.bagList.clientHeight;
        if (y < this.bagList.scrollTop) this.bagList.scrollTop = y;
        else if (y + BAG_ROW_H * this.scale + 8 * this.scale > this.bagList.scrollTop + h) this.bagList.scrollTop = y + (BAG_ROW_H + 16) * this.scale - h;
        this.layout();
      }
    } else if (k === 'a' && list.length) {
      this.picked = list[at].item;
      this.setMode('item');
    } else if (k === 'b') this.goBack();
    return true;
  }

  // ---- the bag -------------------------------------------------------------------------

  private stacks(): Stack[] {
    const bag = this.fieldHome ? this.fieldBag : this.view?.bag;
    return bag?.get(this.pockets()[this.pocketAt].pocket) ?? [];
  }

  /** The stack the cursor is on: the picked item, or the pocket's first. */
  private pickedStack(): Stack | undefined {
    const list = this.stacks();
    return list.find((s) => s.item === this.picked) ?? list[0];
  }

  /** Why USE cannot go: a ball against a trainer. Null when it can. */
  private refusal(stack: Stack | undefined): string | null {
    if (!stack) return null;
    if (this.fieldHome) return this.giving === null && this.deps.rom && !usableInField(this.deps.rom, stack.item) ? "That can't be used here." : null;
    return BAG_POCKETS[this.pocketAt].pocket === POCKET_BALLS && this.view?.trainer ? "You can't catch a TRAINER's POKéMON." : null;
  }

  private stepPocket(dir: 1 | -1): void {
    const n = this.pockets().length;
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
      this.setMode('item');
    });
  }

  private useItem(): void {
    const stack = this.pickedStack();
    if (!stack || this.refusal(stack)) return;
    const pocket = this.pockets()[this.pocketAt].pocket;
    const effect = this.deps.rom ? itemEffect(this.deps.rom, stack.item) : null;
    const field = this.fieldHome ? this.deps.firstMoves?.field : undefined;
    if (field && this.giving !== null) {
      const slot = this.giving;
      this.giving = null;
      void field.give(slot, stack.item).then(() => { this.refreshTeam(); this.setMode('member'); });
      return;
    }
    if (field) {
      if (this.deps.rom && asksWhoInField(this.deps.rom, stack.item, effect)) {
        this.openParty({ pocket, item: stack.item, effect, name: itemInfo(this.deps.rom, stack.item)?.name || '' });
      } else field.use(pocket, stack.item);
      return;
    }
    if (!this.deps.useItem) return;
    if (this.deps.firstMoves && effect && usedOnOne(effect)) {
      this.openParty({ pocket, item: stack.item, effect, name: (this.deps.rom && itemInfo(this.deps.rom, stack.item)?.name) || '' });
      return;
    }
    this.mode = 'action';
    this.send(() => this.deps.useItem!(pocket, stack.item));
  }

  /** The list's box, GBA pixels: the whole rows the room leaves past the pocket bar
   *  and BACK, one to BAG_LIST_ROWS. The list scrolls inside it. */
  private bagListBox(): number {
    const rest = BAG_HEAD_H + BACK_H + 2 * GAP;
    const rows = Math.floor((this.room - rest - 16) / BAG_ROW_H);
    return 16 + Math.max(1, Math.min(BAG_LIST_ROWS, rows)) * BAG_ROW_H;
  }

  private bagListHeight(): number {
    return Math.max(this.bagListBox(), 16 + Math.max(1, this.stacks().length) * BAG_ROW_H);
  }

  /** The item page's lines: the description, and why not under it when it can't go. */
  private itemLines(): { desc: string[]; no: string | null } {
    const stack = this.pickedStack();
    if (!stack) return { desc: [], no: null };
    const desc = wrapText((this.deps.rom && itemInfo(this.deps.rom, stack.item)?.desc) || '', MENU_W - 16);
    return { desc, no: this.refusal(stack) };
  }

  private itemHeight(): number {
    const { desc, no } = this.itemLines();
    // the name row, a rule, the lines, the frame's edges
    return Math.ceil((40 + (desc.length + (no ? 1 : 0)) * 14 + 8) / 8) * 8;
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
    c.drawTextCentred(this.pockets()[this.pocketAt].label, MENU_W / 2, 5, TEXT_DARK);
    const n = this.pockets().length;
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
      if (s.item === on) c.drawCursor(8, y + 6);
      this.paintRow(c, s, y, redo);
    });
  }

  /** A stack's row: its icon, name and count, from `y`. The list's, and its page's head. */
  private paintRow(c: EmeraldCanvas, s: Stack, y: number, redo: () => void): void {
    const info = this.deps.rom ? itemInfo(this.deps.rom, s.item) : null;
    drawIcon(c, s.item, 16, y, redo);
    const count = `×${s.n}`;
    const right = MENU_W - 10;
    c.drawText(count, right - measure(count), y + 5, TEXT_DARK);
    c.drawText(fitText(info?.name ?? '', right - measure(count) - 50), 44, y + 5, TEXT_DARK);
  }

  private paintBagDesc(c: EmeraldCanvas, redo: () => void): void {
    c.drawFrame({ x: 0, y: 0, w: MENU_W, h: c.height });
    const stack = this.pickedStack();
    if (!stack) return;
    // Its row from the list, a rule, then the words.
    this.paintRow(c, stack, 6, redo);
    c.fillRect({ x: 8, y: 33, w: MENU_W - 16, h: 1 }, DOT_OFF);
    const { desc, no } = this.itemLines();
    desc.forEach((line, i) => c.drawText(line, 8, 40 + i * 14, TEXT_DARK));
    if (no) c.drawText(fitText(no, MENU_W - 16), 8, 40 + desc.length * 14, TEXT_RED);
  }

  private paintBagUse(c: EmeraldCanvas): void {
    const w = MENU_W - BAG_BACK_W - GAP;
    c.drawFrame({ x: 0, y: 0, w, h: BACK_H });
    const stack = this.pickedStack();
    const label = !stack ? 'NOTHING HERE' : this.refusal(stack) ? "CAN'T USE" : this.giving !== null ? 'GIVE' : 'USE';
    c.drawTextCentred(label, w / 2, 9, label === 'USE' || label === 'GIVE' ? TEXT_BLUE : TEXT_GRAY);
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
      if (this.deps.readBag) this.view = { ...v, bag: this.deps.readBag() };
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

  /** BACK from "which POKeMON?": the item again, and nothing has reached the ROM. */
  private dropItem(): void {
    this.using = null;
    this.setMode('item');
  }

  private goBack(): void {
    if (this.forgetting) { this.forgetting.done(null); return; }
    if (this.drop) {
      if (this.dropAt !== null) {
        this.dropAt = null;
        this.team = this.drop.rows;
        this.paintDrop();
        this.settleFocus(true);
      } else this.drop.close();
      return;
    }
    if (this.fieldHome) {
      if (this.mode === 'usemove') this.setMode('party');
      else if (this.mode === 'item') this.setMode('bag');
      else if (this.mode === 'party' && this.using) this.dropItem();
      else if (this.mode === 'party' && this.swapFrom !== null) { this.swapFrom = null; this.openParty(); this.setMode('member'); }
      else if (this.mode === 'bag' && this.giving !== null) { this.giving = null; this.refreshTeam(); this.setMode('member'); }
      else if (this.mode === 'member') this.setMode('party');
      else this.deps.firstMoves?.field?.close();
      return;
    }
    if (this.mode === 'usemove') { this.setMode('party'); return; }
    if (this.mode === 'party' && this.using) { this.dropItem(); return; }
    if (this.home() === 'moves') {
      this.setMode(this.mode === 'member' ? 'party' : 'moves');
      return;
    }
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

  /** Whether the page's bag is open, so the frame's read wants the pockets. */
  get wantsBag(): boolean {
    return !this.fieldHome && (this.mode === 'bag' || this.mode === 'item' || !!this.using);
  }

  private setMode(mode: Mode): void {
    const changed = mode !== this.mode;
    this.mode = mode;
    this.layout();
    if (changed) this.settleFocus(true);
  }

  private setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.deps.root.hidden = !shown;
    this.deps.onShown(shown);
    if (shown) { this.layout(); this.settleFocus(true); }
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
    this.bagDescWin.size(MENU_W, this.itemHeight(), scale);
    this.bagBackWin.size(BAG_BACK_W, BACK_H, scale);
    this.bagUseWin.size(MENU_W - BAG_BACK_W - GAP, BACK_H, scale);
    for (const w of this.actionWins) w.size(this.actionW, this.actionH, scale);
    if (this.keysWin) { this.keysWin.size(118, this.keysH, scale); this.keysWin.show('keys'); }
    this.useHeadWin.size(USE_HEAD_W, USE_HEAD_H, scale);
    this.forgetHeadWin.size(MENU_W, 18, scale);
    for (const { w } of this.useMoveWins) w.size(CELL_W, PARTY_H, scale);
    for (const { w } of this.partyCells) w.size(CELL_W, PARTY_H, scale);
    for (const { w, ww, hh } of this.memberWins) w.size(ww, hh, scale);
    if (this.mode === 'bag' || this.mode === 'item') this.layout();
  }

  /** The glass under the menu's top, GBA pixels: the bag fits itself to it. */
  setRoom(gbaPx: number): void {
    if (!(gbaPx > 0) || gbaPx === this.room) return;
    this.room = gbaPx;
    if (this.mode === 'bag' || this.mode === 'item') this.layout();
  }

  /** Each frame, from the ROM. */
  update(v: BattleView | null): void {
    if (this.fieldHome) return;
    // /classic/ has only the ROM's party screen for it.
    const menu = v?.menu === MENU_PARTY && !this.deps.firstMoves ? 0 : v?.menu ?? 0;
    this.view = v;
    if (!v) {
      this.forced = false;
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
    // One has fainted: who goes out, on the page's party, with the ROM's own unseen behind it.
    if (menu === MENU_PARTY) {
      if (!this.forced) {
        this.forced = true;
        this.sent = 0;
        this.openParty();
      }
      this.lastMenu = menu;
      this.setShown(!this.away);
      if (!this.away) this.layout();
      return;
    }
    if (this.forced) {
      this.forced = false;
      this.useHead.hidden = true;
      this.setShown(false);
    }
    // A double battle's target (POK-383): the pad picks it and B backs out, so the page
    // steps aside with the moves kept. B lands back in the move menu, which follows below.
    if (menu === MENU_TARGET) {
      this.sent = 0;
      this.lastMenu = menu;
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
        else if ((this.lastMenu === 0 || this.lastMenu === MENU_MOVE) && this.opening === 0) { this.lastShown = menu; this.mode = this.home(); }
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
    // An item page whose stack went (used up, the bag changed under it): the list.
    if (this.mode === 'item' && !this.stacks().some((s) => s.item === this.picked)) this.mode = 'bag';
    const bag = this.mode === 'bag';
    const item = this.mode === 'item';
    const moves = this.mode === 'moves' || this.mode === 'info';
    const info = this.mode === 'info';
    const party = this.mode === 'party';
    const member = this.mode === 'member';
    const first = this.home() === 'moves' || !!this.fieldHome;
    const v = this.view;
    const labels = v ? actionLabels(v) : [];
    this.actions.hidden = !(first && moves && !info);
    this.partyBox.hidden = !party;
    this.memberBox.hidden = !member;
    const usemove = this.mode === 'usemove';
    this.useMoveBox.hidden = !usemove;
    if (first && moves && !info) {
      const run = labels[SLOT_RUN];
      const runB = this.actions.children[2] as HTMLElement;
      runB.setAttribute('aria-disabled', String(!(run?.enabled ?? true)));
      this.actionWins[2].show(JSON.stringify(run ?? null));
      this.actionWins[0].show('p');
      this.actionWins[1].show('b');
    }
    if (party) this.partyCells.forEach(({ b }, i) => { b.hidden = !this.team[i]; b.setAttribute('aria-label', this.team[i]?.name ?? ''); });
    if (member) {
      const key = `${this.memberAt}|${JSON.stringify(this.team[this.memberAt])}|${v?.foe.types}|${!!this.fieldHome}`;
      for (const { w } of this.memberWins) w.show(key);
      this.selectBtn?.setAttribute('aria-disabled', String(!this.canSelect()));
    }
    this.cells.forEach(({ b, w }, i) => {
      b.hidden = info || bag || item || party || member || usemove;
      const slot = v?.moves[i];
      const enabled = moves ? !!slot?.id : (labels[i]?.enabled ?? false);
      b.setAttribute('aria-disabled', String(!enabled));
      const m = moves ? this.moveInfoAt(i) : null;
      b.setAttribute('aria-label', moves ? (m ? `${m.name}, ${m.typeName}, PP ${slot!.pp}/${slot!.maxPp}` : 'No move') : (labels[i]?.label ?? ''));
      w.show(moves ? `m|${slot?.id}|${slot?.pp}|${slot?.maxPp}|${v?.foe.types}` : `a|${JSON.stringify(labels[i] ?? null)}`);
    });
    this.backBtn.hidden = this.forced ? true : first ? !(bag || party || usemove) : (!moves || info) && !bag;
    this.heldBtn.hidden = this.movesBtn.hidden = !this.fieldHome;
    (this.hint.el as HTMLElement).hidden = first || !moves || info;
    this.sheet.hidden = !info;
    for (const el of [this.bagHead, this.bagList]) el.hidden = !bag;
    for (const el of [this.bagDesc, this.bagRow]) el.hidden = !item;
    if (bag) {
      const h = this.bagListHeight();
      if (this.bagListWin.c.height !== h) this.bagListWin.size(MENU_W, h, this.scale);
      const box = `${this.bagListBox() * this.scale}px`;
      if (this.bagList.style.height !== box) this.bagList.style.height = box;
      this.bagHeadWin.show(String(this.pocketAt));
      this.bagHead.setAttribute('aria-label', this.pockets()[this.pocketAt].label);
      this.bagListWin.show(`${this.pocketAt}|${this.picked}|${JSON.stringify(this.stacks())}`);
    }
    if (item) {
      const stack = this.pickedStack();
      const key = `${this.pocketAt}|${stack?.item}|${stack?.n}|${this.view?.trainer}`;
      const h = this.itemHeight();
      if (this.bagDescWin.c.height !== h) this.bagDescWin.size(MENU_W, h, this.scale);
      this.bagDescWin.show(key);
      this.bagUseWin.show(key);
      this.bagUseBtn.setAttribute('aria-disabled', String(!stack || !!this.refusal(stack)));
      this.bagUseBtn.setAttribute('aria-label', stack ? `Use ${(this.deps.rom && itemInfo(this.deps.rom, stack.item)?.name) ?? ''}` : 'Nothing to use');
    }
    if (info) {
      const h = this.infoHeight();
      if (this.sheetWin.c.height !== h) this.sheetWin.size(INFO_W, h, this.scale);
      this.sheetWin.show(`${this.info}|${v?.moves[this.info]?.id}|${v?.moves[this.info]?.pp}|${v?.foe.name}`);
      this.useWin.show(String(v?.moves[this.info]?.id));
    }
    // Only on a change: a write each frame dirties style for app.ts's read of the HUD.
    if (this.deps.root.dataset.mode !== this.mode) this.deps.root.dataset.mode = this.mode;
    this.fitGlass();
  }

  /** Windows taller than the glass leaves under the picture (a small phone, a trainer's cards
   *  above it: Cam, 11-02, iPhone 13 mini) stand on the bottom of the glass instead, over the
   *  picture, so SELECT and BACK can always be reached. Measured only when something changed. */
  private fitGlass(): void {
    const key = `${this.mode}|${this.room}|${this.scale}|${this.useHead.hidden}|${this.shown}|${innerHeight}`;
    if (key === this.fitKey || !this.shown) return;
    this.fitKey = key;
    const root = this.deps.root;
    root.classList.remove('bm-lift');
    if (root.getBoundingClientRect().bottom > innerHeight) root.classList.add('bm-lift');
  }

  private paintCell(c: EmeraldCanvas, i: number, redo: () => void): void {
    const v = this.view;
    c.drawFrame({ x: 0, y: 0, w: CELL_W, h: CELL_H });
    if (!v) return;
    if (this.mode === 'action') {
      const l = actionLabels(v)[i];
      if (!l) return;
      if (!this.deps.firstMoves) {
        c.drawTextCentred(l.label, CELL_W / 2, 24, l.enabled ? TEXT_DARK : TEXT_GRAY);
        return;
      }
      // The Safari's four, in the windows' own look: BALL, POKeBLOCK, GO NEAR, RUN.
      iconButton(c, CELL_W, CELL_H, (cx, cy, box) => {
        if (i === 2) { c.fillRect({ x: cx - 6, y: cy - 1, w: 8, h: 3 }, ARROW_RED); for (let n = 0; n < 5; n++) c.fillRect({ x: cx + 6 - n, y: cy - n, w: 1, h: 2 * n + 1 }, ARROW_RED); }
        else drawItemFitted(c, i === 0 ? ITEM_POKE_BALL : i === 1 ? ITEM_POKEBLOCK_CASE : ITEM_ESCAPE_ROPE, cx, cy, box, redo);
      }, l.label, l.enabled ? TEXT_DARK : TEXT_GRAY);
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
