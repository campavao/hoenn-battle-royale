// What a move is, read out of the ROM itself: its name, type, power, accuracy, PP and
// description, and how well it lands on a foe's types. The phone's battle menu shows
// these on each move's window (ui/battlemenu.ts). Read from the ROM's own tables
// (gBattleMoves, gMoveNames, gMoveDescriptionPointers, gTypeNames, gTypeEffectiveness)
// rather than an exported copy, so a move the match changes is shown as it plays.
import { decodeGen3 } from '../text/gen3';

const ROM_BASE = 0x08000000;
/** charmap.txt: ' ' and '-'. */
const SPACE = 0x00;
const HYPHEN = 0xae;

/** `struct BattleMove` (include/pokemon.h): nine u8s, padded to 12 (agbcc and modern
 *  both lay structs out on a 4-byte boundary here; src/br/br_pins.c holds them to it). */
export const MOVE_SIZE = 12;
export const MOVE_POWER = 1;
export const MOVE_TYPE = 2;
export const MOVE_ACCURACY = 3;
export const MOVE_PP = 4;
/** MOVE_NAME_LENGTH + 1 and TYPE_NAME_LENGTH + 1 (include/constants/global.h). */
export const MOVE_NAME_SIZE = 13;
export const TYPE_NAME_SIZE = 7;
/** include/constants/pokemon.h: the types below it hit physically, above it specially. */
export const TYPE_MYSTERY = 9;
/** include/battle_main.h. */
export const TYPE_FORESIGHT = 0xfe;
export const TYPE_ENDTABLE = 0xff;
export const TYPE_MUL_NORMAL = 10;
/** gTypeEffectiveness[336]: 112 triplets at most. */
const TYPE_TABLE_MAX = 336;

export type MoveKind = 'PHYSICAL' | 'SPECIAL' | 'STATUS';

export interface MoveInfo {
  id: number;
  name: string;
  type: number;
  typeName: string;
  power: number;
  accuracy: number;
  pp: number;
  kind: MoveKind;
  desc: string;
}

export interface Rom {
  bytes: Uint8Array;
  sym(name: string): number | undefined;
}

function u8(rom: Rom, addr: number): number {
  return rom.bytes[addr - ROM_BASE] ?? 0;
}

function u32(rom: Rom, addr: number): number {
  const o = addr - ROM_BASE;
  const b = rom.bytes;
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}

/** EOS-ended text at `addr`, at most `max` bytes. The summary screen's line breaks
 *  (0xFE) are spaces, but for a word it hyphenated across them ("full-|body"). */
function text(rom: Rom, addr: number, max: number): string {
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const c = u8(rom, addr + i);
    if (c === 0xff) break;
    if (c === 0xfe) {
      if (out[out.length - 1] !== HYPHEN) out.push(SPACE);
      continue;
    }
    out.push(c);
  }
  try {
    return decodeGen3(Uint8Array.from(out));
  } catch {
    return '';
  }
}

/** Physical or special is the type's in Gen 3; no power is a status move. */
export function kindOf(type: number, power: number): MoveKind {
  if (power === 0) return 'STATUS';
  return type < TYPE_MYSTERY ? 'PHYSICAL' : 'SPECIAL';
}

/** A move, or null without the tables or for no move. */
export function moveInfo(rom: Rom, id: number): MoveInfo | null {
  const moves = rom.sym('gBattleMoves');
  const names = rom.sym('gMoveNames');
  const descs = rom.sym('gMoveDescriptionPointers');
  const types = rom.sym('gTypeNames');
  if (id <= 0 || moves === undefined || names === undefined) return null;
  const m = moves + id * MOVE_SIZE;
  const type = u8(rom, m + MOVE_TYPE);
  const power = u8(rom, m + MOVE_POWER);
  // The descriptions skip MOVE_NONE: entry 0 is move 1's.
  const descAt = descs === undefined ? 0 : u32(rom, descs + (id - 1) * 4);
  return {
    id,
    name: text(rom, names + id * MOVE_NAME_SIZE, MOVE_NAME_SIZE),
    type,
    typeName: types === undefined ? '' : text(rom, types + type * TYPE_NAME_SIZE, TYPE_NAME_SIZE),
    power,
    accuracy: u8(rom, m + MOVE_ACCURACY),
    pp: u8(rom, m + MOVE_PP),
    kind: kindOf(type, power),
    desc: descAt >= ROM_BASE ? text(rom, descAt, 120) : '',
  };
}

/** How a move of `type` lands on `defTypes`, as Emerald multiplies it: 0, 0.25, 0.5, 1,
 *  2 or 4. Foresight's entries count: a NORMAL move does not touch a GHOST. A
 *  pure-type foe lists its type twice, and is counted once. Null without the table. */
export function effectiveness(rom: Rom, type: number, defTypes: [number, number]): number | null {
  const table = rom.sym('gTypeEffectiveness');
  if (table === undefined) return null;
  const defs = defTypes[0] === defTypes[1] ? [defTypes[0]] : defTypes;
  let mul = 1;
  for (let i = 0; i + 2 < TYPE_TABLE_MAX; i += 3) {
    const atk = u8(rom, table + i);
    if (atk === TYPE_ENDTABLE) break;
    if (atk === TYPE_FORESIGHT) continue;
    if (atk !== type) continue;
    const def = u8(rom, table + i + 1);
    if (defs.includes(def)) mul *= u8(rom, table + i + 2) / TYPE_MUL_NORMAL;
  }
  return mul;
}

/** The words for a multiplier, the way the battle says them after a hit. */
export function effectWords(mul: number | null, power: number): { text: string; tone: 'super' | 'weak' | 'none' | 'normal' | 'status' } {
  if (power === 0) return { text: 'NO DAMAGE', tone: 'status' };
  if (mul === null) return { text: '', tone: 'normal' };
  if (mul === 0) return { text: 'NO EFFECT', tone: 'none' };
  if (mul > 1) return { text: mul >= 4 ? 'SUPER EFF. ×4' : 'SUPER EFFECTIVE', tone: 'super' };
  if (mul < 1) return { text: 'NOT VERY EFF.', tone: 'weak' };
  return { text: 'EFFECTIVE', tone: 'normal' };
}
