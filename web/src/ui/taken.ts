// What a mon off the ground will be once it is taken, for a SUMMARY before it is (Cam, 11-04: "moves
// are dealt when it joins a team. That's kind of silly. It should show the moves here."). The ROM
// deals them from nothing it keeps anywhere: br_loot.c's MakeTaken makes the mon from a seed of the
// match's and the ball's, then BrLevels_Settle grows it up and teaches it (br_levels.c, POK-311). So
// this is that, line for line, over the player's own cartridge's tables, and a spec holds the two
// together (spikeb-summary.spec.ts): anything changed there has to change here.
//
// One thing can't be foretold: VBlankIntr rolls Random() too, so a VBlank landing inside CreateMon
// shifts the IVs (seed 11: the first mon of a pile's second roll one later, the third's not), and a
// trader's mon is rolled freely. A set can turn on those IVs, so the page has the last word: what
// SUMMARY said is written on it when it joins (main.ts sayWhatItSaid), the species being the same.
import { MOVE_ACCURACY, MOVE_POWER, MOVE_PP, MOVE_SIZE, MOVE_TYPE, type Rom } from '../battle/movebook';

const ROM_BASE = 0x08000000;
const MAX_MOVES = 4;
const MOVE_EFFECT = 0;
/** struct SpeciesInfo (include/pokemon.h). */
const SPECIES_INFO = 0x1c;
const INFO_ATTACK = 1, INFO_DEFENSE = 2, INFO_SPATK = 4, INFO_TYPES = 6, INFO_GROWTH = 0x13;
/** struct Evolution, EVOS_PER_MON of them a species: three u16s, which agbcc pads to 8 bytes (a
 *  release's) and a modern compiler does not. BULBASAUR's first row says which. */
const EVOS_PER_MON = 5;
const EVO_FRIENDSHIP = 1, EVO_DAY = 2, EVO_NIGHT = 3, EVO_LEVEL = 4, EVO_ATK_GT = 8, EVO_ATK_EQ = 9, EVO_ATK_LT = 10, EVO_SILCOON = 11, EVO_CASCOON = 12, EVO_NINJASK = 13;
/** rtc.h's DAY_EVO_HOUR_BEGIN and END: the day is the afternoon, in Emerald. */
const DAY_FROM = 12, DAY_TO = 24;
const LEARN_END = 0xffff, LEARN_MOVE = 0x1ff, LEARN_LEVEL_SHIFT = 9;
const MAX_LEVEL = 100;
/** gNatureStatTable's columns; a row is a nature, -1, 0 or +1 for each. */
const NATURE_ATK = 0, NATURE_DEF = 1, NATURE_SPATK = 3;
/** Gen 3: a type's moves read ATTACK below this one, SP. ATK from it (IS_TYPE_PHYSICAL). */
const TYPE_MYSTERY = 9;
/** Key of a mon on the team screen the page opens (rom.ts team()): DROP_SEAT in the high byte. */
const DROP_SEAT = 30;

// include/constants/battle_move_effects.h, the ones the worth of a move asks about.
const EFFECT_SLEEP = 1, EFFECT_EXPLOSION = 7, EFFECT_DREAM_EATER = 8, EFFECT_MULTI_HIT = 29, EFFECT_RESTORE_HP = 32, EFFECT_TOXIC = 33, EFFECT_OHKO = 38, EFFECT_RAZOR_WIND = 39, EFFECT_SUPER_FANG = 40, EFFECT_DRAGON_RAGE = 41, EFFECT_DOUBLE_HIT = 44, EFFECT_CONFUSE = 49, EFFECT_ATTACK_UP_2 = 50, EFFECT_SPEED_UP_2 = 52, EFFECT_SPECIAL_ATTACK_UP_2 = 53, EFFECT_PARALYZE = 67, EFFECT_SKY_ATTACK = 75, EFFECT_TWINEEDLE = 77, EFFECT_RECHARGE = 80, EFFECT_LEECH_SEED = 84, EFFECT_SPLASH = 85, EFFECT_LEVEL_DAMAGE = 87, EFFECT_SNORE = 92, EFFECT_FALSE_SWIPE = 101, EFFECT_TRIPLE_KICK = 104, EFFECT_RETURN = 121, EFFECT_FRUSTRATION = 123, EFFECT_SONICBOOM = 130, EFFECT_MORNING_SUN = 132, EFFECT_SYNTHESIS = 133, EFFECT_MOONLIGHT = 134, EFFECT_SKULL_BASH = 145, EFFECT_SOLAR_BEAM = 151, EFFECT_TELEPORT = 153, EFFECT_SEMI_INVULNERABLE = 155, EFFECT_SOFTBOILED = 157, EFFECT_FAKE_OUT = 158, EFFECT_SPIT_UP = 161, EFFECT_WILL_O_WISP = 167, EFFECT_FOCUS_PUNCH = 170, EFFECT_SUPERPOWER = 182, EFFECT_OVERHEAT = 204, EFFECT_BULK_UP = 208, EFFECT_CALM_MIND = 211, EFFECT_DRAGON_DANCE = 212;

const GOOD_STATUS: ReadonlySet<number> = new Set([EFFECT_SLEEP, EFFECT_TOXIC, EFFECT_PARALYZE, EFFECT_WILL_O_WISP, EFFECT_CONFUSE, EFFECT_LEECH_SEED, EFFECT_RESTORE_HP, EFFECT_SOFTBOILED, EFFECT_MORNING_SUN, EFFECT_SYNTHESIS, EFFECT_MOONLIGHT, EFFECT_ATTACK_UP_2, EFFECT_SPECIAL_ATTACK_UP_2, EFFECT_SPEED_UP_2, EFFECT_DRAGON_DANCE, EFFECT_CALM_MIND, EFFECT_BULK_UP]);
const ODD_WORTH: Readonly<Record<number, number>> = { [EFFECT_LEVEL_DAMAGE]: 60, [EFFECT_FRUSTRATION]: 60, [EFFECT_SUPER_FANG]: 50, [EFFECT_OHKO]: 35, [EFFECT_RETURN]: 30, [EFFECT_DRAGON_RAGE]: 25, [EFFECT_SONICBOOM]: 15 };
const HALVED: ReadonlySet<number> = new Set([EFFECT_RECHARGE, EFFECT_RAZOR_WIND, EFFECT_SKY_ATTACK, EFFECT_SKULL_BASH, EFFECT_SOLAR_BEAM, EFFECT_SEMI_INVULNERABLE, EFFECT_FOCUS_PUNCH, EFFECT_FAKE_OUT]);
const FIFTHED: ReadonlySet<number> = new Set([EFFECT_DREAM_EATER, EFFECT_SNORE, EFFECT_SPIT_UP]);

const u8 = (rom: Rom, at: number) => rom.bytes[at - ROM_BASE];
const u16 = (rom: Rom, at: number) => rom.bytes[at - ROM_BASE] | (rom.bytes[at - ROM_BASE + 1] << 8);
const u32 = (rom: Rom, at: number) => (u16(rom, at) | (u16(rom, at + 2) << 16)) >>> 0;
const s8 = (rom: Rom, at: number) => (u8(rom, at) << 24) >> 24;

/** The game's own Random(), from a state. */
class Rng {
  constructor(private state: number) {}
  next(): number {
    this.state = (Math.imul(this.state, 1103515245) + 24691) >>> 0;
    return this.state >>> 16;
  }
}

interface Learner {
  atk: number;
  spAtk: number;
  types: [number, number];
}

interface MoveRow {
  effect: number;
  power: number;
  type: number;
  accuracy: number;
}

function moveRow(rom: Rom, table: number, id: number): MoveRow {
  const at = table + id * MOVE_SIZE;
  return { effect: u8(rom, at + MOVE_EFFECT), power: u8(rom, at + MOVE_POWER), type: u8(rom, at + MOVE_TYPE), accuracy: u8(rom, at + MOVE_ACCURACY) };
}

/** br_levels.c MoveWorth. */
function moveWorth(who: Learner, id: number, m: MoveRow): number {
  if (id === 0) return 0;
  const acc = m.accuracy === 0 ? 100 : m.accuracy;
  if (m.power === 0) {
    const status = m.effect === EFFECT_SPLASH || m.effect === EFFECT_TELEPORT ? 0 : GOOD_STATUS.has(m.effect) ? 50 : 20;
    return Math.floor((status * acc) / 100);
  }
  if (m.power === 1) return ODD_WORTH[m.effect] ?? 40;
  if (m.effect === EFFECT_EXPLOSION) return 15;
  let worth = m.power;
  if (m.effect === EFFECT_MULTI_HIT) worth *= 3;
  else if (m.effect === EFFECT_DOUBLE_HIT || m.effect === EFFECT_TWINEEDLE) worth *= 2;
  else if (m.effect === EFFECT_TRIPLE_KICK) worth *= 4;
  else if (HALVED.has(m.effect)) worth = Math.floor(worth / 2);
  else if (m.effect === EFFECT_FALSE_SWIPE) worth = Math.floor(worth / 3);
  else if (FIFTHED.has(m.effect)) worth = Math.floor(worth / 5);
  else if (m.effect === EFFECT_OVERHEAT || m.effect === EFFECT_SUPERPOWER) worth = Math.floor((worth * 4) / 5);
  worth = Math.floor((worth * acc) / 100);
  if (m.type === who.types[0] || m.type === who.types[1]) worth = Math.floor((worth * 3) / 2);
  const mine = m.type < TYPE_MYSTERY ? who.atk : who.spAtk;
  const best = who.atk > who.spAtk ? who.atk : who.spAtk;
  if (best !== 0) worth = Math.floor((worth * mine) / best);
  return worth & 0xffff;
}

function echoes(a: MoveRow, b: MoveRow): boolean {
  if (a.power === 0 || a.effect === EFFECT_EXPLOSION) return a.effect === b.effect;
  return b.power > 1 && b.effect !== EFFECT_EXPLOSION && a.type === b.type;
}

/** br_levels.c SetWorth. */
function setWorth(who: Learner, moves: readonly number[], row: (id: number) => MoveRow): number {
  const rows = moves.map(row);
  const worth = moves.map((id, i) => moveWorth(who, id, rows[i]));
  const outranks = (j: number, i: number) => worth[j] > worth[i] || (worth[j] === worth[i] && j < i);
  let total = 0, hitters = 0;
  for (let i = 0; i < MAX_MOVES; i++) {
    if (moves[i] === 0) continue;
    const a = rows[i];
    let w = worth[i], statusAbove = 0, said = 0;
    if (a.power !== 0 && a.effect !== EFFECT_EXPLOSION) hitters++;
    for (let j = 0; j < MAX_MOVES; j++) {
      if (j === i || moves[j] === 0 || !outranks(j, i)) continue;
      if (a.power === 0 && rows[j].power === 0) statusAbove++;
      if (echoes(a, rows[j])) said++;
    }
    if (said === 1) w = Math.floor((w * 2) / 5);
    else if (said >= 2) w = Math.floor(w / 5);
    if (statusAbove >= 2) w = Math.floor((w * 3) / 10);
    total = (total + w) & 0xffff;
  }
  return hitters === 0 ? Math.floor(total / 4) : total;
}

/** br_levels.c Teach, with no slot kept: nobody chose this one's moves. */
function teach(who: Learner, moves: number[], move: number, row: (id: number) => MoveRow): void {
  for (let i = 0; i < MAX_MOVES; i++) {
    if (moves[i] === move) return;
    if (moves[i] === 0) { moves[i] = move; return; }
  }
  let bestWorth = setWorth(who, moves, row), best = MAX_MOVES;
  for (let i = 0; i < MAX_MOVES; i++) {
    const w = setWorth(who, moves.map((m, j) => (j === i ? move : m)), row);
    if (w > bestWorth) { bestWorth = w; best = i; }
  }
  if (best !== MAX_MOVES) moves[best] = move;
}

export interface Taken {
  species: number;
  level: number;
  /** Its moves, slot by slot, none empty. */
  moves: number[];
  personality: number;
}

/** The mon `species` at `level` would be, from `seed` and its ball's `key`: MakeTaken and then
 *  BrLevels_Settle. `rng` is that mon's seed, or null where the ROM rolls freely (a trader's,
 *  br_event.c Offered): mid-range IVs and a plain nature stand in. Null without the tables. */
export function takenMon(rom: Rom, species: number, level: number, rng: number | null, hour = DAY_FROM): Taken | null {
  const info = rom.sym('gSpeciesInfo'), sets = rom.sym('gLevelUpLearnsets'), moves = rom.sym('gBattleMoves');
  const evos = rom.sym('gEvolutionTable'), natures = rom.sym('gNatureStatTable'), exp = rom.sym('gExperienceTables');
  if (info === undefined || sets === undefined || moves === undefined || evos === undefined || natures === undefined || exp === undefined || species <= 0) return null;
  const learnset = (sp: number) => {
    const out: number[] = [];
    const at = u32(rom, sets + sp * 4);
    if (at < ROM_BASE) return out;
    for (let i = 0; ; i++) {
      const w = u16(rom, at + i * 2);
      if (w === LEARN_END) return out;
      out.push(w);
    }
  };
  const base = (sp: number, off: number) => u8(rom, info + sp * SPECIES_INFO + off);
  const expAt = (sp: number, lv: number) => u32(rom, exp + base(sp, INFO_GROWTH) * (MAX_LEVEL + 1) * 4 + lv * 4);

  // CreateBoxMon: its personality (Random32, the low half first), then the IVs, two rolls.
  let personality = 0, ivAtk = 15, ivDef = 15, ivSpAtk = 15, nature = 0;
  let neutral = true;
  if (rng !== null) {
    const r = new Rng(rng >>> 0);
    const low = r.next(), high = r.next();
    personality = (low | (high << 16)) >>> 0;
    const one = r.next(), two = r.next();
    ivAtk = (one >> 5) & 31;
    ivDef = (one >> 10) & 31;
    ivSpAtk = (two >> 5) & 31;
    nature = personality % 25;
    neutral = false;
  }
  const row = (id: number) => moveRow(rom, moves, id);
  const evoSize = u16(rom, evos + EVOS_PER_MON * 8) === EVO_LEVEL ? 8 : 6;
  const exps = expAt(species, level);
  let lv = level;

  // GiveBoxMonInitialMoveset: the last four written at or under its level, of what it starts as.
  const known = [0, 0, 0, 0];
  for (const w of learnset(species)) {
    if ((w >> LEARN_LEVEL_SHIFT) > lv) break;
    const move = w & LEARN_MOVE;
    if (known.includes(move)) continue;
    const empty = known.indexOf(0);
    if (empty >= 0) known[empty] = move;
    else { known.shift(); known.push(move); }
  }

  const stat = (sp: number, off: number, iv: number, column: number): number => {
    const n = Math.floor(((2 * base(sp, off) + iv) * lv) / 100) + 5;
    if (neutral) return n;
    const k = s8(rom, natures + nature * 5 + column);
    return k > 0 ? Math.floor((n * 110) / 100) : k < 0 ? Math.floor((n * 90) / 100) : n;
  };

  // GrowUp: as fond as it can be, as far as levelling takes it; a big jump is two evolutions.
  let sp = species;
  for (let step = 0; step < 3; step++) {
    let target = 0;
    const atk = stat(sp, INFO_ATTACK, ivAtk, NATURE_ATK), def = stat(sp, INFO_DEFENSE, ivDef, NATURE_DEF);
    for (let i = 0; i < EVOS_PER_MON; i++) {
      const e = evos + sp * EVOS_PER_MON * evoSize + i * evoSize;
      const method = u16(rom, e), param = u16(rom, e + 2), to = u16(rom, e + 4);
      const up = param <= lv;
      const day = hour >= DAY_FROM && hour < DAY_TO;
      if (method === EVO_FRIENDSHIP) target = to;
      else if (method === EVO_DAY) { if (day) target = to; }
      else if (method === EVO_NIGHT) { if (!day) target = to; }
      else if (method === EVO_LEVEL || method === EVO_NINJASK) { if (up) target = to; }
      else if (method === EVO_ATK_GT) { if (up && atk > def) target = to; }
      else if (method === EVO_ATK_EQ) { if (up && atk === def) target = to; }
      else if (method === EVO_ATK_LT) { if (up && atk < def) target = to; }
      else if (method === EVO_SILCOON) { if (up && (personality >>> 16) % 10 <= 4) target = to; }
      else if (method === EVO_CASCOON) { if (up && (personality >>> 16) % 10 > 4) target = to; }
    }
    if (target === 0 || target === sp) break;
    sp = target;
    // CalculateMonStats: the level is what its EXP comes to on the new species' table.
    let l = 1;
    while (l <= MAX_LEVEL && expAt(sp, l) <= exps) l++;
    lv = l - 1;
  }

  // LearnThrough: every move the levels would have taught it, each only if it betters the four.
  const who: Learner = { atk: stat(sp, INFO_ATTACK, ivAtk, NATURE_ATK), spAtk: stat(sp, INFO_SPATK, ivSpAtk, NATURE_SPATK), types: [base(sp, INFO_TYPES), base(sp, INFO_TYPES + 1)] };
  for (const w of learnset(sp)) {
    if ((w >> LEARN_LEVEL_SHIFT) <= lv) teach(who, known, w & LEARN_MOVE, row);
  }
  return { species: sp, level: lv, moves: known.filter((m) => m !== 0), personality };
}

/** The seed of the `at`th mon on the team screen the page opens (rom.ts team()): its key's, and the
 *  match's (br_loot.c MakeTaken). */
export function teamSeed(matchSeed: number, at: number): number {
  const key = ((DROP_SEAT << 8) | at) & 0xffff;
  return (matchSeed ^ ((key << 16) | key)) >>> 0;
}

/** A move's full PP, as a mon just made has it. */
export function fullPp(rom: Rom, id: number): number {
  const moves = rom.sym('gBattleMoves');
  return moves === undefined ? 0 : u8(rom, moves + id * MOVE_SIZE + MOVE_PP);
}
