// What lives on a marked spot, for a bot that steps on one (Cam, 11-04: "an actual player when they
// stepped over a tile would initiate a battle and then leaving that tile would leave it no longer
// with a wild Pokemon, that's how a bot should do it too"). A trainer's page asks its ROM (br_wild.c);
// a bot has no ROM of its own, so this is the same roll off the same tables: the map's land or water
// table at Emerald's odds, this match's national stand-in (br_zone.c BrZone_NationalOn), at the rung;
// in the Zone, any first stage, and the Zone's battle. No engine in here: the room rolls it on every
// mirror, and a Zone battle wants none.
import encounterData from '../../src/data/encounters.json';
import { speciesName, tradedMon } from '../../src/bots/party';
import { mulberry32 } from '../../src/match/clock';
import type { PackedMon } from '../../src/net/wire';
import type { BattleEvent, LogMon } from './battlelog';
import type { SimOutcome, SimSide } from './battlesim';

const DATA = encounterData as unknown as {
  slots: Record<string, { land?: number[]; water?: number[] }>;
  catch: Record<string, number>;
  stats: Record<string, [number, number, number]>;
  zone: number[];
};

/** wild_encounter.h's ENCOUNTER_CHANCE_*: a table's slots, by how often each comes up. */
const LAND_ODDS = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1];
const WATER_ODDS = [60, 30, 5, 4, 1];
/** br_zone.c's BR_NATIONAL_BAND. */
const NATIONAL_BAND = 30;
/** rom.ts's: what a trainer has to throw in the Zone. */
export const SAFARI_BALLS = 30;
export const ITEM_MASTER_BALL = 1;
export const ITEM_SAFARI_BALL = 5;
/** battle_ai_script_commands.c: safariEscapeFactor (3, nothing here moves it) * 5, in a hundred, a turn. */
const SAFARI_FLEE = 15;

/** species_info.h. */
export const catchRateOf = (species: number): number => DATA.catch[species] ?? 3;

/** br_zone.c's Mix. */
function mix(x: number): number {
  x = Math.imul(x, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca77);
  x ^= x >>> 13;
  return x >>> 0;
}

/** br_zone.c's StandIns, as a list; the same order: by species id. */
const STAND_INS = new Map<number, number[]>();
function standIns(native: number, band: number): number[] {
  const key = native * 8 + band / NATIONAL_BAND;
  let hit = STAND_INS.get(key);
  if (hit) return hit;
  const [total, t0, t1] = DATA.stats[native];
  hit = [];
  for (const id of Object.keys(DATA.stats).map(Number).sort((p, q) => p - q)) {
    const [st, a, b] = DATA.stats[id];
    if (id === native || (a !== t0 && b !== t0 && a !== t1 && b !== t1)) continue;
    if (st + band < total || st > total + band) continue;
    hit.push(id);
  }
  STAND_INS.set(key, hit);
  return hit;
}

/** br_zone.c's BrZone_NationalOn: half of a map's table stays Hoenn's, and the rest is, this match,
 *  something of its weight and one of its types from anywhere in the dex. */
export function nationalOn(seed: number, group: number, num: number, native: number): number {
  if (seed === 0 || !DATA.stats[native]) return native;
  let h = mix((seed ^ (group << 24) ^ (num << 16) ^ native) >>> 0);
  if (h & 1) return native;
  h = mix(h);
  for (let band = NATIONAL_BAND; band <= 2 * NATIONAL_BAND; band += NATIONAL_BAND) {
    const n = standIns(native, band);
    if (n.length) return n[h % n.length];
  }
  return native;
}

/** The dice for a spot's roll: off the match, the spot and the frame, the same on every mirror. */
export function wildDice(seed: number, key: number, tick: number): () => number {
  return mulberry32((Math.imul(seed ^ key, 0x9e3779b1) ^ Math.imul(tick + 1, 0x85ebca6b)) >>> 0);
}

function slotOf(odds: readonly number[], roll: number): number {
  let r = Math.floor(roll * odds.reduce((t, n) => t + n, 0));
  for (let i = 0; i < odds.length; i++) if ((r -= odds[i]) < 0) return i;
  return odds.length - 1;
}

/** What comes out of `map`'s table: 0, a map with none for that kind of ground (br_wild.c's
 *  SPECIES_NONE: no battle), as for a trainer. */
export function rollWild(seed: number, map: { id: string; group: number; num: number }, water: boolean, rng: () => number): number {
  const table = water ? DATA.slots[map.id]?.water : DATA.slots[map.id]?.land;
  if (!table?.length) return 0;
  const native = table[slotOf(water ? WATER_ODDS : LAND_ODDS, rng())] ?? 0;
  return native ? nationalOn(seed, map.group, map.num, native) : 0;
}

/** br_zone.c's BrZone_PickAny: any wild first stage. */
export function rollZone(rng: () => number): number {
  return DATA.zone[Math.floor(rng() * DATA.zone.length)];
}

/** A wild mon as a bot meets it: what the table said at the rung's level, whole. CreateScriptedWildMon
 *  grows nothing (br_wild.c): a level 50 ZIGZAGOON is a ZIGZAGOON until somebody catches it. */
export function wildMon(species: number, phase: number): PackedMon {
  return { ...tradedMon(species, phase), species, nickname: speciesName(species) };
}

/** A ball thrown at `mon`, with the ROM's sums: atkcatch's odds and shakes, a ROYALE BALL's ULTRA odds
 *  doubled on the first turn (br_catch.c BrCatch_BallMultiplier, a SAFARI BALL's too). */
export function ballTakes(ball: number, mon: { hp: number; maxhp: number; status: string }, catchRate: number, firstTurn: boolean, rng: () => number): boolean {
  if (ball === ITEM_MASTER_BALL) return true;
  const multiplier = firstTurn ? 40 : 20;
  let odds = Math.floor((Math.floor((catchRate * multiplier) / 10) * (mon.maxhp * 3 - mon.hp * 2)) / (3 * mon.maxhp));
  if (mon.status === 'slp' || mon.status === 'frz') odds *= 2;
  else if (mon.status === 'psn' || mon.status === 'tox' || mon.status === 'brn' || mon.status === 'par') odds = Math.floor((odds * 15) / 10);
  if (odds > 254) return true;
  if (odds <= 0) return false;
  const shakes = Math.floor(1048560 / Math.floor(Math.sqrt(Math.floor(Math.sqrt(Math.floor(16711680 / odds))))));
  for (let i = 0; i < 4; i++) if (rng() * 65536 >= shakes) return false;
  return true;
}

/** What a bot has to throw on a marked spot: nothing with no room for what it catches, and never its
 *  MASTER BALL, which is for a legendary. */
export function patchBalls<T extends { id: number }>(partySize: number, balls: readonly T[]): T[] {
  return partySize < 6 ? balls.filter((b) => b.id !== ITEM_MASTER_BALL) : [];
}

/** ...and in the Zone: a trainer's thirty SAFARI BALLs, less those it has thrown. */
export function zoneBalls(partySize: number, thrown = 0): { id: number; n: number }[] {
  return partySize < 6 ? [{ id: ITEM_SAFARI_BALL, n: Math.max(0, SAFARI_BALLS - thrown) }] : [];
}

/** The Zone's catch rate (battle_main.c's safariCatchFactor, handleballthrow's way back): it goes
 *  through a share of 1275 and comes back a little less. */
export const zoneRate = (species: number): number => Math.floor((Math.floor((catchRateOf(species) * 100) / 1275) * 1275) / 100) & 0xff;

/** A battle in the Zone, every throw of it, on the ROM's sums (battle_main.c, battle_script_commands.c,
 *  AI_Safari): no POKeMON of yours in it and none hurt. A ball a turn while there are any, and after
 *  each the wild mon stays or runs. Nothing to catch it with, or no room for it: away. The ROM's
 *  POKeBLOCK and GO NEAR it leaves alone. */
export function zoneFight(a: SimSide, species: number, opts: { seed: number; map?: string }): SimOutcome {
  const rng = mulberry32(opts.seed);
  const name = speciesName(species);
  const card = wildMon(species, 1);
  const rate = zoneRate(species);
  const mon: LogMon = { species, level: card.level, hp: card.hp, maxHp: card.maxHp, status: 0, gender: 2 };
  const log: BattleEvent[] = [
    { e: 'start', a: { seat: a.seat, name: a.name, skin: a.skin, team: [] }, b: { seat: -2, name, skin: 0, team: [mon], wild: true }, map: opts.map ?? '' },
    { e: 'text', text: `Wild ${name} appeared!` },
    { e: 'send', side: 1, slot: 0 },
  ];
  const left = (a.balls ?? []).find((b) => b.id === ITEM_SAFARI_BALL)?.n ?? 0;
  const thrown: number[] = [];
  let caught = false, ran = false, turn = 0;
  while (!caught && !ran) {
    if (thrown.length >= left) {
      log.push({ e: 'text', text: 'Got away safely!' });
      ran = true;
      break;
    }
    thrown.push(ITEM_SAFARI_BALL);
    log.push({ e: 'text', text: `${a.name} used SAFARI BALL!` });
    if (ballTakes(ITEM_SAFARI_BALL, { hp: 1, maxhp: 1, status: '' }, rate, turn === 0, rng)) {
      caught = true;
      log.push({ e: 'text', text: `Gotcha! ${name} was caught!` });
      break;
    }
    log.push({ e: 'text', text: 'Oh, no! The POKeMON broke free!' });
    if (rng() * 100 < SAFARI_FLEE) {
      log.push({ e: 'text', text: `Wild ${name} fled!` });
      ran = true;
    }
    turn += 1;
  }
  const winner = caught ? a.seat : 0;
  log.push({ e: 'end', winner });
  const shareA = a.party.map((m) => (m.maxHp > 0 ? Math.min(1, m.hp / m.maxHp) : 0));
  return {
    winner,
    loser: 0,
    a: a.party.map((m) => ({ hp: m.hp, status: m.status })),
    b: [{ hp: card.hp, status: 0 }],
    shareA,
    shareB: [1],
    usedA: thrown,
    usedB: [],
    turns: turn + 1,
    capped: false,
    ...(caught ? { caught } : {}),
    ...(ran ? { ran } : {}),
    log,
    unknown: [],
  };
}
