// Both trainers, parked beside a trainer battle (Cam's 2026-10-19 play-test, #18): "We
// have the real estate to show the opposing trainer top right and yours bottom left, and
// how many Poke Balls are left. When the trainer slides out, instead of disappearing off
// the right, have them persist there and show their name underneath."
//
// The ROM says who is fighting (gBrSides, include/br/br_battle.h): each side's front
// picture and name, filled as the intro draws the opponent. The pictures are
// web/public/trainer-pics/<pic>.png (tools/br/export-trainer-pics.py). The balls are
// each party's, read every frame: one per mon, grey once it faints.
//
// They come up with the first choice of the fight -- by then the opponent has slid out of
// the picture -- and stay until the battle hands back to the field. Beside the picture
// when the field has the room (a desktop, a phone on its side); above it when only that
// has it; not at all on a screen with neither.
import type { FieldLayout } from '../field';
import { decodeGen3 } from '../text/gen3';
import { BATTLE_MENU, MAIN_IN_BATTLE_BIT, MAIN_IN_BATTLE_BYTE } from '../touch';
import { BATTLE_TYPE_RECORDED } from './battlemenu';
import { TEXT_WHITE, fitText, textImage } from './emerald';

export const BATTLE_TYPE_TRAINER = 1 << 3;

/** struct BrSides (include/br/br_battle.h). */
export const SIDES_FOE_PIC = 0;
export const SIDES_MINE_PIC = 1;
export const SIDES_FOE_NAME = 2;
export const SIDES_MINE_NAME = 18;
export const SIDES_SERIAL = 26;
export const SIDES_SIZE = 28;

/** struct Pokemon: 100 bytes, status u32 at 80, hp u16 at 86, maxHP at 88. */
const MON_SIZE = 100;
const MON_STATUS = 80;
const MON_HP = 86;
const MON_MAX_HP = 88;
const PARTY_SIZE = 6;

const PIC = 64;
const NAME_H = 14;
const BALL = 7;
const BALL_GAP = 2;
const BALLS_W = PARTY_SIZE * BALL + (PARTY_SIZE - 1) * BALL_GAP;
/** A card: the picture, the name under it, the balls under that. GBA pixels. */
export const CARD_W = PIC;
export const CARD_H = PIC + NAME_H + BALL + 3;
const GAP = 4;

export type Ball = 'ok' | 'status' | 'fainted' | 'empty';

export interface Side {
  pic: number;
  name: string;
  balls: Ball[];
}

export interface Sides {
  foe: Side;
  mine: Side;
}

/** Where the two cards go on the field canvas, in GBA pixels, or null when neither beside
 *  nor above the picture has the room. Cam's corners: theirs top right, ours bottom left. */
export function sidesLayout(lay: FieldLayout): { foe: { x: number; y: number }; mine: { x: number; y: number } } | null {
  if (!lay.scale) return null;
  const right = lay.cols - (lay.lcdCol + 240);
  const left = lay.lcdCol;
  if (right >= CARD_W + GAP && left >= CARD_W + GAP) {
    return {
      foe: { x: lay.lcdCol + 240 + GAP, y: lay.lcdRow },
      mine: { x: lay.lcdCol - GAP - CARD_W, y: lay.lcdRow + 160 - CARD_H },
    };
  }
  if (lay.lcdRow >= CARD_H + GAP) {
    const y = lay.lcdRow - GAP - CARD_H;
    // In from the picture's edges, which on a phone held upright are the glass's.
    return { foe: { x: lay.lcdCol + 240 - GAP - CARD_W, y }, mine: { x: lay.lcdCol + GAP, y } };
  }
  return null;
}

/** One party's balls, as the ROM's own indicator draws them: a mon each, its slot empty
 *  past the party's end. */
export function partyBalls(mons: Uint8Array, count: number): Ball[] {
  const out: Ball[] = [];
  for (let i = 0; i < PARTY_SIZE; i++) {
    const at = i * MON_SIZE;
    const maxHp = i < count ? mons[at + MON_MAX_HP] | (mons[at + MON_MAX_HP + 1] << 8) : 0;
    if (!maxHp) {
      out.push('empty');
      continue;
    }
    const hp = mons[at + MON_HP] | (mons[at + MON_HP + 1] << 8);
    const status = mons[at + MON_STATUS] | mons[at + MON_STATUS + 1] | mons[at + MON_STATUS + 2] | mons[at + MON_STATUS + 3];
    out.push(hp === 0 ? 'fainted' : status ? 'status' : 'ok');
  }
  return out;
}

/** A ROM name, EOS-terminated, as text; '' for bytes the charmap does not have. */
export function romName(bytes: Uint8Array): string {
  const end = bytes.indexOf(0xff);
  try {
    return decodeGen3(end < 0 ? bytes : bytes.subarray(0, end));
  } catch {
    return '';
  }
}

export interface SidesRead {
  read(addr: number, bits: 8 | 16 | 32): number;
  bytes(addr: number, len: number): Uint8Array;
}

/** What to show this frame, or null. `shown` is the serial of the fight the first choice
 *  has come up in: until then the opponent is still in the picture. */
export function readSides(emu: SidesRead, sym: (name: string) => number | undefined, shown: { serial: number }): Sides | null {
  const main = sym('gMain');
  const flags = sym('gBattleTypeFlags');
  const sides = sym('gBrSides');
  const br = sym('gBrBattle');
  const party = sym('gPlayerParty');
  const partyCount = sym('gPlayerPartyCount');
  const enemy = sym('gEnemyParty');
  const enemyCount = sym('gEnemyPartyCount');
  if ([main, flags, sides, br, party, partyCount, enemy, enemyCount].some((a) => a === undefined)) return null;
  if (!(emu.read(main! + MAIN_IN_BATTLE_BYTE, 8) & MAIN_IN_BATTLE_BIT)) return null;
  const type = emu.read(flags!, 32);
  if (!(type & BATTLE_TYPE_TRAINER) || type & BATTLE_TYPE_RECORDED) return null;
  const raw = emu.bytes(sides!, SIDES_SIZE);
  const serial = raw[SIDES_SERIAL] | (raw[SIDES_SERIAL + 1] << 8);
  if (serial === 0) return null;
  if (emu.read(br! + BATTLE_MENU, 8) !== 0) shown.serial = serial;
  if (shown.serial !== serial) return null;
  return {
    foe: {
      pic: raw[SIDES_FOE_PIC],
      name: romName(raw.subarray(SIDES_FOE_NAME, SIDES_MINE_NAME)),
      balls: partyBalls(emu.bytes(enemy!, PARTY_SIZE * MON_SIZE), emu.read(enemyCount!, 8)),
    },
    mine: {
      pic: raw[SIDES_MINE_PIC],
      name: romName(raw.subarray(SIDES_MINE_NAME, SIDES_SERIAL)),
      balls: partyBalls(emu.bytes(party!, PARTY_SIZE * MON_SIZE), emu.read(partyCount!, 8)),
    },
  };
}

const BALL_ROWS = ['..###..', '.#TTT#.', '#TTTTT#', '#######', '#BBBBB#', '.#BBB#.', '..###..'];
const BALL_INK: Record<Ball, { line: string; top: string; bottom: string } | null> = {
  ok: { line: '#202020', top: '#f04030', bottom: '#f8f8f8' },
  status: { line: '#202020', top: '#f0a830', bottom: '#f8f8f8' },
  fainted: { line: '#383838', top: '#787878', bottom: '#a8a8a8' },
  empty: null,
};

/** The balls, left to right, on a canvas BALLS_W x BALL. An empty slot is a grey ring. */
export function paintBalls(ctx: CanvasRenderingContext2D, balls: readonly Ball[]): void {
  ctx.clearRect(0, 0, BALLS_W, BALL);
  balls.forEach((b, i) => {
    const x0 = i * (BALL + BALL_GAP);
    const ink = BALL_INK[b];
    BALL_ROWS.forEach((row, y) => {
      for (let x = 0; x < BALL; x++) {
        const c = row[x];
        if (c === '.') continue;
        if (!ink) {
          // An empty slot: the ball's outline in grey on a dark fill, legible over grass.
          if (y === 3 && c === '#' && x > 0 && x < BALL - 1) continue;
          ctx.fillStyle = c === '#' ? '#c8c8c8' : 'rgba(16,20,24,0.55)';
        } else ctx.fillStyle = c === '#' ? ink.line : c === 'T' ? ink.top : ink.bottom;
        ctx.fillRect(x0 + x, y, 1, 1);
      }
    });
  });
}

/** The two cards, as DOM in the play screen's box, placed off the field's layout. */
export class SidesView {
  private readonly cards: { el: HTMLElement; pic: HTMLImageElement; name: HTMLElement; balls: HTMLCanvasElement; drawn: string }[];
  private shown = { serial: 0 };
  private placed = '';
  private off: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly emu: SidesRead & { onFrame(fn: () => void): () => void },
    private readonly sym: (name: string) => number | undefined,
    private readonly layout: () => FieldLayout,
  ) {
    this.cards = ['foe', 'mine'].map((who) => {
      const el = document.createElement('div');
      el.className = `side side-${who}`;
      el.dataset.side = who;
      const pic = document.createElement('img');
      pic.alt = '';
      pic.className = 'side-pic';
      const name = document.createElement('div');
      name.className = 'side-name';
      const balls = document.createElement('canvas');
      balls.className = 'side-balls';
      balls.width = BALLS_W;
      balls.height = BALL;
      el.append(pic, name, balls);
      root.appendChild(el);
      return { el, pic, name, balls, drawn: '' };
    });
    root.hidden = true;
  }

  attach(): void {
    this.off = this.emu.onFrame(() => this.frame());
  }

  detach(): void {
    this.off?.();
    this.off = null;
    this.root.hidden = true;
  }

  private frame(): void {
    const sides = readSides(this.emu, this.sym, this.shown);
    const lay = this.layout();
    const at = sides ? sidesLayout(lay) : null;
    if (!sides || !at) {
      this.root.hidden = true;
      return;
    }
    const s = lay.scale;
    const place = `${s}:${at.foe.x}:${at.foe.y}:${at.mine.x}:${at.mine.y}`;
    if (place !== this.placed) {
      this.placed = place;
      [at.foe, at.mine].forEach((p, i) => {
        const { el } = this.cards[i];
        el.style.left = `${p.x * s}px`;
        el.style.top = `${p.y * s}px`;
        el.style.width = `${CARD_W * s}px`;
        el.style.height = `${CARD_H * s}px`;
        this.cards[i].drawn = '';
      });
    }
    [sides.foe, sides.mine].forEach((side, i) => this.paint(this.cards[i], side, s));
    this.root.hidden = false;
  }

  private paint(card: SidesView['cards'][number], side: Side, s: number): void {
    const key = `${side.pic}:${side.name}:${side.balls.join(',')}:${s}`;
    if (key === card.drawn) return;
    card.drawn = key;
    const src = `/trainer-pics/${side.pic}.png`;
    if (!card.pic.src.endsWith(src)) card.pic.src = src;
    card.pic.style.width = card.pic.style.height = `${PIC * s}px`;
    card.name.replaceChildren(textImage(fitText(side.name, CARD_W), TEXT_WHITE, s));
    card.name.setAttribute('aria-label', side.name);
    card.balls.style.width = `${BALLS_W * s}px`;
    card.balls.style.height = `${BALL * s}px`;
    const ctx = card.balls.getContext('2d');
    if (ctx) paintBalls(ctx, side.balls);
  }
}
