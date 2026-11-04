// A bot-vs-bot fight with no ROM (Cam, 11-02: "Bots having to wait to fight other bots bc one
// battle is running is not ideal. The games should all look and feel the same."). Two teams go in
// and what the room needs comes out, with a log (battlelog.ts) that reads like Emerald, so any
// number of pairs can fight at once on the relay, or in a solo page's own host. Every fight is
// simulated turn by turn, never settled (CLAUDE.md), and a seed always gives the same fight.
//
// The engine is Pokemon Showdown's (MIT, engine/gen3.mjs, tools/br/build-sim.mjs): its Gen 3 is the
// mechanics this game's ROM runs. No ROM data or game code is in here or in it; species, moves and
// learnsets are Showdown's public tables. What is the match's own, mirrored from src/br/:
//   - br_bot.c's BrBot_BuildMon: random IVs and nature on every build, no EVs, HP as a share of the
//     card, the card's moves only when they are a ROM's own (`romMoves`);
//   - br_levels.c's learnset walk (POK-311), ported below: the best four of what the level teaches;
//   - br_ring.c's fog, a tenth of the mon's HP at each turn's end, if a fight has it (`fog`);
//   - no EXP and no prize money in a duel; nothing to simulate.
import { Battle, Dex, LEVEL_UP, toID } from './engine/gen3.mjs';
import { speciesName } from '../../src/bots/party';
import type { PackedMon } from '../../src/net/wire';
import { logMs, START_MS, type BattleEvent, type LogMon, type LogSide, type Side } from './battlelog';
import { decide, pickNext } from './simbrain';
import { translate, STATUS_BITS } from './simlog';
import { BAG_ITEMS, heldId, type BagItem } from './simnames';
import { ITEM_MASTER_BALL, ballTakes } from './wild';
import LEARNSET_FIXES from './learnset-fixes.json';

export interface SimSide {
  /** The trainer's actor id on the room. */
  seat: number;
  name: string;
  skin: number;
  party: PackedMon[];
  /** Bag items it may spend in this fight (bag.ts battleItems), ids from the ROM's table. */
  items?: number[];
  /** The balls it carries, for a wild fight (`SimOptions.wild`). */
  balls?: { id: number; n: number }[];
}

export interface SimOptions {
  seed: number;
  /** Where it is, for the log's ground. */
  map?: string;
  /** The fog bites at each turn's end, as it does a trainer's (br_ring.c; Cam, 11-02). A function is
   *  asked at every turn's end, with how far into the log's playing that is: a ring that closes on a
   *  fight under way gets to it there (br_ring.c TurnFog; Cam, 11-03). Once in, always in. */
  fog?: boolean | ((ms: number) => boolean);
  /** The weather the fight starts in and stays in, as an overworld's does (room.ts weatherAt). */
  weather?: 'raindance' | 'sunnyday';
  /** `b` is a wild mon, as a trainer's legendary is: `a` can throw and run, and has to do one or the
   *  other to come away with anything. The ROM's own sums for both (battle_script_commands.c,
   *  br_catch.c, battle_util.c). */
  wild?: {
    catchRate: number;
    catchAt: number;
    /** On a marked spot and no legendary (room.ts botOnPatch): what a trainer does there, who is not
     *  there for it alone. A ball at once, which is when a ROYALE BALL's odds are best; the fight on
     *  with none, a KO being the only other way past it; and away once the last of the team is low,
     *  before it costs the match. What's out in the grass picks its moves at random, as Emerald's do. */
    patch?: boolean;
  };
  /** TURN_CAP, for a test. */
  turnCap?: number;
}

/** What came of a fight: what proxy.ts's DuelOutcome says, and the log. */
export interface SimOutcome {
  /** The seat that took it, 0 for nobody: both down, a side's team gone at once, or the cap. */
  winner: number;
  loser: number;
  /** Each card's slot, in the order it was dealt, on the card's own HP scale. */
  a: { hp: number; status: number }[];
  b: { hp: number; status: number }[];
  /** Each slot's HP as a share of the real mon: what the room's `wear` holds. */
  shareA: number[];
  shareB: number[];
  usedA: number[];
  usedB: number[];
  turns: number;
  /** The fight ran to TURN_CAP: whoever has the most of their team's HP left won (nobody, level). */
  capped: boolean;
  /** A wild fight: `a`'s ball took it, or `a` got away (`winner` 0). */
  caught?: boolean;
  ran?: boolean;
  log: BattleEvent[];
  /** Engine lines the log had no words for: empty on a clean fight, read by the tests. */
  unknown: string[];
}

/** A fight that has not ended by now will not, for a watcher: REST against REST, seven minutes of
 *  screen or more. The longest of 2324 fights from whole matches ran 68 turns, and at 60 the same
 *  fights lose one, to the side that was ahead and went on to win it anyway. */
export const TURN_CAP = 60;

const dex = Dex.forFormat('gen3customgame');
const NATURES = ['Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax', 'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash', 'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'];

/** mulberry32: the team's dice and the bots' minds, on a stream apart from the battle's. */
function dice(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const moveByNum = new Map<number, ReturnType<typeof dex.moves.get>>();
for (const m of dex.moves.all()) if (m.num > 0 && !/^hiddenpower./.test(m.id)) moveByNum.set(m.num, m);
const numOfMove = new Map<string, number>();
for (const m of dex.moves.all()) if (!/^hiddenpower./.test(m.id)) numOfMove.set(m.name, m.num);

function speciesOf(id: number) {
  const name = speciesName(id);
  if (!name || /^\d+$/.test(name)) return null;
  const s = dex.species.get(toID(name.replace('♀', 'F').replace('♂', 'M')));
  return s.exists ? s : null;
}

// ---- the best four of what the level teaches (br_levels.c, POK-311, the rule ported) -----------

const EXPLODES = new Set(['explosion', 'selfdestruct']);
const ODD_POWER: Record<string, number> = {
  seismictoss: 60, nightshade: 60, frustration: 60, superfang: 50, guillotine: 35, horndrill: 35, fissure: 35, sheercold: 35,
  return: 30, dragonrage: 25, sonicboom: 15,
};
/** Worked out at the time: Showdown has a base power for some of these and the ROM's table has 1. */
const WORKED_OUT = new Set(['guillotine', 'horndrill', 'sonicboom', 'lowkick', 'counter', 'seismictoss', 'dragonrage', 'fissure', 'nightshade', 'bide', 'psywave', 'superfang', 'flail', 'reversal', 'return', 'present', 'frustration', 'magnitude', 'hiddenpower', 'mirrorcoat', 'endeavor', 'sheercold']);
const NO_WORTH = new Set(['splash', 'teleport']);
const GOOD_STATUS = new Set(['sing', 'sleeppowder', 'hypnosis', 'lovelykiss', 'spore', 'grasswhistle', 'toxic', 'stunspore', 'thunderwave', 'glare', 'willowisp', 'supersonic', 'confuseray', 'sweetkiss', 'leechseed', 'recover', 'slackoff', 'softboiled', 'milkdrink', 'morningsun', 'synthesis', 'moonlight', 'swordsdance', 'tailglow', 'agility', 'dragondance', 'calmmind', 'bulkup']);
const HALF_WORTH = new Set(['hyperbeam', 'blastburn', 'hydrocannon', 'frenzyplant', 'razorwind', 'skyattack', 'skullbash', 'solarbeam', 'fly', 'dig', 'dive', 'bounce', 'focuspunch', 'fakeout']);
const THREE_HITS = new Set(['doubleslap', 'cometpunch', 'furyattack', 'pinmissile', 'spikecannon', 'barrage', 'furyswipes', 'bonerush', 'armthrust', 'bulletseed', 'iciclespear', 'rockblast']);
const TWO_HITS = new Set(['doublekick', 'bonemerang', 'twineedle']);
const FIFTH = new Set(['dreameater', 'snore', 'spitup']);
const POWER_SPENT = new Set(['overheat', 'psychoboost', 'superpower']);
const PHYSICAL = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);

interface Learner { atk: number; spa: number; types: string[] }

function moveWorth(who: Learner, num: number): number {
  if (!num) return 0;
  const m = moveByNum.get(num);
  if (!m) return 0;
  const accuracy = m.accuracy === true ? 100 : m.accuracy;
  if (m.category === 'Status') {
    const worth = NO_WORTH.has(m.id) ? 0 : GOOD_STATUS.has(m.id) ? 50 : 20;
    return Math.floor((worth * accuracy) / 100);
  }
  if (WORKED_OUT.has(m.id)) return ODD_POWER[m.id] ?? 40;
  if (EXPLODES.has(m.id)) return 15;
  let worth = m.basePower;
  if (THREE_HITS.has(m.id)) worth *= 3;
  else if (TWO_HITS.has(m.id)) worth *= 2;
  else if (m.id === 'triplekick') worth *= 4;
  else if (HALF_WORTH.has(m.id)) worth = Math.floor(worth / 2);
  else if (m.id === 'falseswipe') worth = Math.floor(worth / 3);
  else if (FIFTH.has(m.id)) worth = Math.floor(worth / 5);
  else if (POWER_SPENT.has(m.id)) worth = Math.floor((worth * 4) / 5);
  worth = Math.floor((worth * accuracy) / 100);
  if (who.types.includes(m.type)) worth = Math.floor((worth * 3) / 2);
  const mine = PHYSICAL.has(m.type) ? who.atk : who.spa;
  const best = Math.max(who.atk, who.spa);
  if (best) worth = Math.floor((worth * mine) / best);
  return worth;
}

/** A move's effect, as far as "two of one thing" asks: status moves that do the same. */
function effectKey(m: ReturnType<typeof dex.moves.get>): string {
  if (m.boosts) return JSON.stringify(m.boosts) + m.target;
  if (m.status) return m.status;
  if (m.volatileStatus) return m.volatileStatus;
  return m.id;
}

function echoes(a: ReturnType<typeof dex.moves.get>, b: ReturnType<typeof dex.moves.get>): boolean {
  if (a.category === 'Status' || EXPLODES.has(a.id)) return EXPLODES.has(a.id) ? EXPLODES.has(b.id) : b.category === 'Status' && effectKey(a) === effectKey(b);
  return b.category !== 'Status' && !WORKED_OUT.has(b.id) && !EXPLODES.has(b.id) && a.type === b.type;
}

function setWorth(who: Learner, moves: number[]): number {
  const worth = moves.map((n) => moveWorth(who, n));
  const outranks = (j: number, i: number) => worth[j] > worth[i] || (worth[j] === worth[i] && j < i);
  let total = 0, hitters = 0;
  for (let i = 0; i < 4; i++) {
    const a = moveByNum.get(moves[i]);
    if (!a) continue;
    let w = worth[i], statusAbove = 0, echoed = 0;
    if (a.category !== 'Status' && !EXPLODES.has(a.id)) hitters++;
    for (let j = 0; j < 4; j++) {
      const b = moveByNum.get(moves[j]);
      if (j === i || !b || !outranks(j, i)) continue;
      if (a.category === 'Status' && b.category === 'Status') statusAbove++;
      if (echoes(a, b)) echoed++;
    }
    if (echoed === 1) w = Math.floor((w * 2) / 5);
    else if (echoed >= 2) w = Math.floor(w / 5);
    if (statusAbove >= 2) w = Math.floor((w * 3) / 10);
    total += w;
  }
  return hitters === 0 ? Math.floor(total / 4) : total;
}

function teach(who: Learner, moves: number[], num: number): void {
  for (let i = 0; i < 4; i++) {
    if (moves[i] === num) return;
    if (!moves[i]) { moves[i] = num; return; }
  }
  let bestWorth = setWorth(who, moves), best = 4;
  for (let i = 0; i < 4; i++) {
    const trial = moves.slice();
    trial[i] = num;
    const w = setWorth(who, trial);
    if (w > bestWorth) { bestWorth = w; best = i; }
  }
  if (best !== 4) moves[best] = num;
}

/** What a mon of this species and level knows: the last four its level had taught it (a mon made
 *  fresh), then the walk from the bottom that swaps for a better four; or, for a ROM's own set,
 *  that set walked the same way. */
export function movesFor(speciesId: string, level: number, who: Learner, known: number[] = []): number[] {
  // Emerald's list where the engine's is another game's (tools/br/learnset-fixes.mjs).
  const row = (LEARNSET_FIXES as Record<string, number[]>)[speciesId] ?? LEVEL_UP[speciesId] ?? [];
  const moves = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) moves[i] = known[i] ?? 0;
  if (!known.length) {
    for (let i = 0; i < row.length; i += 2) {
      if (row[i] > level) break;
      const n = row[i + 1];
      if (moves.includes(n)) continue;
      const empty = moves.indexOf(0);
      if (empty >= 0) moves[empty] = n;
      else { moves.shift(); moves.push(n); }
    }
  }
  for (let i = 0; i < row.length; i += 2) if (row[i] <= level) teach(who, moves, row[i + 1]);
  return moves.filter(Boolean);
}

// ---- the fight -----------------------------------------------------------------------------

interface Built {
  /** Card slot of each mon that could be built, in order. */
  slots: number[];
  sets: unknown[];
  /** Real-HP rule per set (BrBot_HpFromCard). */
  cards: { hp: number; max: number; pps?: (number | undefined)[] }[];
  species: Map<number, number>;
}

/** A card's HP as a share of the real mon: none stays none, a sliver is at least 1. */
function realHp(cardHp: number, cardMax: number, realMax: number): number {
  if (cardHp <= 0) return 0;
  if (cardMax <= 0 || cardHp >= cardMax) return realMax;
  return Math.max(1, Math.min(realMax, Math.floor((realMax * cardHp + Math.floor(cardMax / 2)) / cardMax)));
}

function buildTeam(party: readonly PackedMon[], rng: () => number): Built {
  const out: Built = { slots: [], sets: [], cards: [], species: new Map() };
  party.forEach((card, slot) => {
    const species = speciesOf(card.species);
    if (!species) return; // a row with no real species is left out, the rest close up (br_duel.c)
    const level = Math.min(100, card.level || 5);
    const ivs = { hp: rand32(rng), atk: rand32(rng), def: rand32(rng), spa: rand32(rng), spd: rand32(rng), spe: rand32(rng) };
    const nature = NATURES[Math.floor(rng() * 25)];
    const n = dex.natures.get(nature);
    const stat = (k: 'atk' | 'spa') => Math.floor((Math.floor(((2 * species.baseStats[k] + ivs[k]) * level) / 100) + 5) * (n.plus === k ? 1.1 : n.minus === k ? 0.9 : 1));
    const known = card.romMoves ? card.moves.map((m) => m.id).filter(Boolean) : [];
    const moves = movesFor(species.id, level, { atk: stat('atk'), spa: stat('spa'), types: species.types }, known);
    if (!moves.length) moves.push(moveByNum.get(33)!.num); // nothing teachable at this level: TACKLE
    const slot1 = species.abilities['1'];
    const ability = (rng() < 0.5 && slot1 && dex.abilities.get(slot1).exists) ? slot1 : species.abilities['0'];
    out.slots.push(slot);
    out.species.set(slot, card.species);
    out.sets.push({
      name: `M${slot}`,
      species: species.name,
      item: heldId(card.heldItem),
      ability,
      moves: moves.map((num) => moveByNum.get(num)!.id),
      nature,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs,
      level,
      happiness: 70,
      gender: '',
      shiny: !!card.shiny,
    });
    out.cards.push({
      hp: card.hp,
      max: card.maxHp,
      pps: card.romMoves ? moves.map((num) => card.moves.find((m) => m.id === num)?.pp) : undefined,
    });
  });
  return out;
}

const rand32 = (rng: () => number) => Math.floor(rng() * 32);

/** Showdown's battle, with the two things a match's needs from it: wounds going in, and a turn a
 *  trainer spends on a bag item instead of a move. */
class SimBattle extends Battle {
  /** Run once both teams are in, before the first send. */
  beforeStart: (() => void) | null = null;
  /** Who spends this turn on an item. */
  skip: unknown[] = [];
  start(): void {
    this.beforeStart?.();
    super.start();
  }
  go(): void {
    for (const p of this.skip) this.queue.cancelAction(p);
    this.skip = [];
    super.go();
  }
}

/** Wounds, PP as the ROM has it (no PP UPs), and whoever can stand first in line. */
function setUp(side: any, built: Built): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  side.pokemon.forEach((mon: any, i: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const card = built.cards[i];
    mon.hp = realHp(card.hp, card.max, mon.maxhp);
    if (mon.hp <= 0) { mon.fainted = true; mon.status = 'fnt'; side.pokemonLeft--; }
    mon.moveSlots.forEach((slot: any, j: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const pp = dex.moves.get(slot.id).pp;
      slot.maxpp = pp;
      slot.pp = Math.min(pp, card.pps?.[j] ?? pp);
    });
    mon.baseMoveSlots = mon.moveSlots.map((s: unknown) => s);
  });
  side.pokemon.sort((p: any, q: any) => Number(p.fainted) - Number(q.fainted)); // eslint-disable-line @typescript-eslint/no-explicit-any
  side.pokemon.forEach((mon: any, i: number) => { mon.position = i; }); // eslint-disable-line @typescript-eslint/no-explicit-any
}

function logMon(card: PackedMon, mon: any, hp: number): LogMon { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    species: card.species,
    level: mon.level,
    hp,
    maxHp: mon.maxhp,
    status: 0, // the ROM builds a card with none (br_bot.c)
    shiny: !!card.shiny,
    gender: mon.gender === 'M' ? 0 : mon.gender === 'F' ? 1 : 2,
    // No `nickname`: a bot's mon is called what its species is called. The ROM never applies the
    // card's (br_bot.c, POK-237's "a Lovedisc named Makuhita"), and the lines here go the same way.
  };
}

/** A card on the log's side when nothing was fought: what the card says of it. */
const plainMon = (card: PackedMon): LogMon => ({ species: card.species, level: card.level, hp: card.hp, maxHp: card.maxHp, status: 0, shiny: !!card.shiny, gender: card.personality & 1 });

/** A side that cannot fight loses, with nothing to play out. */
function unfought(a: SimSide, b: SimSide, map: string, winner: number): SimOutcome {
  const report = (s: SimSide) => s.party.map((m) => ({ hp: m.hp, status: m.status }));
  const share = (s: SimSide) => s.party.map((m) => (m.maxHp > 0 ? Math.min(1, m.hp / m.maxHp) : 0));
  const side = (s: SimSide): LogSide => ({ seat: s.seat, name: s.name, skin: s.skin, team: s.party.map(plainMon) });
  return {
    winner,
    loser: winner === a.seat ? b.seat : winner === b.seat ? a.seat : 0,
    a: report(a),
    b: report(b),
    shareA: share(a),
    shareB: share(b),
    usedA: [],
    usedB: [],
    turns: 0,
    capped: false,
    log: [{ e: 'start', a: side(a), b: side(b), map }, { e: 'end', winner }],
    unknown: [],
  };
}

const bagOf = (items: number[] | undefined): { id: number; item: BagItem | null; used: boolean }[] =>
  (items ?? []).map((id) => ({ id, item: BAG_ITEMS[id] ?? null, used: false }));

/** One turn's bag item on the mon that is out (Emerald's item effects). */
function useItem(battle: any, side: any, row: { item: BagItem | null; used: boolean }): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  const it = row.item!;
  const mon = side.active[0];
  row.used = true;
  battle.add('bag', side.id, it.name);
  if (it.cures) {
    if (mon.status && it.cures.includes(mon.status)) mon.cureStatus();
    if (it.cures.includes('confusion') && mon.volatiles.confusion) mon.removeVolatile('confusion');
  }
  if (it.heal !== undefined && mon.hp < mon.maxhp) {
    mon.sethp(Math.min(mon.maxhp, mon.hp + it.heal));
    battle.add('-heal', mon, mon.getHealth, '[silent]');
  }
  if (it.boost) battle.boost({ [it.boost]: 1 }, mon, mon, null, true);
  if (it.special === 'direhit') mon.addVolatile('focusenergy');
  if (it.special === 'guardspec') side.addSideCondition('mist', mon);
}

const FOG = { id: 'fog', name: 'fog', fullname: 'fog', effectType: 'Condition' };

/** Every ball but the MASTER BALL is a ROYALE BALL in a match (br_items.c). */
const BALL_NAME = (id: number) => (id === ITEM_MASTER_BALL ? 'MASTER BALL' : 'ROYALE BALL');
/** RUN from a wild mon, with the ROM's sums (battle_util.c TryRunFromBattle): a faster one always
 *  gets away, a slower one on a byte's odds that grow with each try. */
function runTakes(mine: number, theirs: number, tries: number, rng: () => number): boolean {
  if (mine >= theirs) return true;
  return ((Math.floor((mine * 128) / theirs) + tries * 30) & 0xff) > Math.floor(rng() * 256);
}

/** A fight, start to end, there and then, the same every time for the same seed and sides. */
export function simulate(a: SimSide, b: SimSide, opts: SimOptions): SimOutcome {
  const run = simulation(a, b, opts);
  for (;;) {
    const step = run.next();
    if (step.done) return step.value;
  }
}

/** The same fight a turn at a time. The engine takes 3-5 ms a turn, so a fight is 10 to 150 ms:
 *  more than a frame on a relay that steps its rooms sixty times a second. The host runs it a
 *  turn or so a frame, and the fight's bots are busy either way. */
export function* simulation(a: SimSide, b: SimSide, opts: SimOptions): Generator<void, SimOutcome, void> {
  const map = opts.map ?? '';
  const standing = (s: SimSide) => s.party.some((m) => m.hp > 0 && speciesOf(m.species));
  if (!standing(a) || !standing(b)) return unfought(a, b, map, standing(a) ? a.seat : standing(b) ? b.seat : 0);

  const rng = dice(opts.seed);
  const teamA = buildTeam(a.party, rng);
  const teamB = buildTeam(b.party, rng);
  const hex = (rng() * 2 ** 32).toString(16).padStart(8, '0').slice(0, 8) + (rng() * 2 ** 32).toString(16).padStart(8, '0').slice(0, 8);
  const battle = new SimBattle({ formatid: 'gen3customgame', seed: `gen5,${hex}` });
  battle.beforeStart = () => {
    setUp(battle.sides[0], teamA);
    setUp(battle.sides[1], teamB);
  };
  battle.setPlayer('p1', { name: 'A', team: teamA.sets });
  battle.setPlayer('p2', { name: 'B', team: teamB.sets });
  // The engine's 'start' counts each team whole, so a mon already down (setUp) would leave it one
  // short of over when its last one faints: nobody out, no switch to make, and the other side's every
  // move "But it failed!" until TURN_CAP. Started by the second player's coming in, so counted here.
  for (const s of battle.sides) s.pokemonLeft = s.pokemon.filter((m: any) => !m.fainted).length; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sides = battle.sides;
  const bags = [bagOf(a.items), bagOf(b.items)];
  const inputs: SimSide[] = [a, b];
  const cardOf = (mon: any) => Number(mon.name.slice(1)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const names = {
    trainers: [a.name, b.name] as [string, string],
    mon: (side: Side, slot: number) => speciesName(inputs[side].party[slot]?.species ?? 0),
    moveNum: (name: string) => numOfMove.get(name) ?? 0,
    ...(opts.wild ? { wild: true } : {}),
  };

  if (opts.fog) {
    let fogged = opts.fog === true;
    let askedOn = -1;
    battle.onEvent('Residual', battle.format, (mon: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!fogged && typeof opts.fog === 'function' && askedOn !== battle.turn) {
        askedOn = battle.turn;
        fogged = opts.fog(START_MS + logMs(translate(battle.log, names, 0, [a.seat, b.seat]).log));
      }
      if (!fogged) return;
      // A tenth, down to nothing: it knocks out, as a trainer's does (br_ring.c BrRing_FogEndTurn).
      battle.damage(Math.max(1, Math.floor(mon.maxhp / 10)), mon, mon, FOG);
    });
  }

  // An overworld's weather: it lasts (B_WEATHER_RAIN_PERMANENT), and the fight opens in it.
  if (opts.weather) {
    battle.field.setWeather(opts.weather, 'debug');
    battle.field.weatherState.duration = 0;
  }

  let capped = false, caught = false, ran = false, runs = 0;
  const cap = opts.turnCap ?? TURN_CAP;
  let guard = 0;
  const left = (a.balls ?? []).map((row) => ({ ...row }));
  const thrown: number[] = [];
  yield; // the teams and the opening are a turn's work
  while (!battle.ended && !caught && !ran) {
    if (battle.turn > cap || ++guard > cap * 20) { capped = true; break; }
    let acted = false;
    for (let n = 0; n < 2 && !battle.ended && !caught && !ran; n++) {
      const side = sides[n];
      const request = side.activeRequest;
      if (!request || request.wait || side.isChoiceDone()) continue;
      acted = true;
      if (request.forceSwitch) {
        const next = pickNext(battle, side, side.foe.active[0]);
        if (!next || !battle.choose(side.id, `switch ${side.pokemon.indexOf(next) + 1}`)) battle.choose(side.id, 'default');
        continue;
      }
      // Emerald's wild mons have no AI flags: every move scores the same (battle_ai_script_commands.c).
      if (n === 1 && opts.wild?.patch) {
        const moves: { pp?: number; disabled?: boolean }[] = request.active[0].moves;
        const can = moves.map((_, i) => i).filter((i) => !moves[i].disabled && moves[i].pp !== 0);
        if (!can.length || !battle.choose(side.id, `move ${can[Math.floor(rng() * can.length)] + 1}`)) battle.choose(side.id, 'default');
        continue;
      }
      // At a wild mon, what a trainer goes there for: a ball, once it is low enough to be worth one
      // (a MASTER BALL at once); with none left, away, before it costs the match.
      if (n === 0 && opts.wild) {
        const me = side.active[0], wild = side.foe.active[0];
        const ball = left[0];
        const patch = opts.wild.patch;
        if (ball && (ball.id === ITEM_MASTER_BALL || wild.hp / wild.maxhp <= opts.wild.catchAt || (patch && battle.turn <= 1))) {
          if (--ball.n <= 0) left.shift();
          thrown.push(ball.id);
          battle.add('bag', side.id, BALL_NAME(ball.id));
          if (ballTakes(ball.id, wild, opts.wild.catchRate, battle.turn <= 1, rng)) {
            caught = true;
            battle.add('say', `Gotcha! ${speciesName(b.party[0]?.species ?? 0)} was caught!`);
            break;
          }
          battle.add('say', 'Oh, no! The POKeMON broke free!');
          battle.skip.push(me);
          battle.choose(side.id, 'default');
          continue;
        }
        const lastLow = patch && me.hp / me.maxhp <= opts.wild.catchAt && !side.pokemon.some((p: { hp: number; isActive: boolean }) => p.hp > 0 && !p.isActive);
        if (patch ? lastLow : !ball) {
          if (runTakes(me.storedStats.spe, wild.storedStats.spe, runs++, rng)) {
            ran = true;
            battle.add('say', 'Got away safely!');
            break;
          }
          battle.add('say', "Can't escape!");
          battle.skip.push(me);
          battle.choose(side.id, 'default');
          continue;
        }
      }
      const lastHit = side.active[0]?.attackedBy?.at(-1)?.move;
      const d = decide(battle, side, request, bags[n], lastHit ? dex.moves.get(lastHit) : undefined, rng);
      if (d.kind === 'switch') {
        if (!battle.choose(side.id, `switch ${side.pokemon.indexOf(d.to) + 1}`)) battle.choose(side.id, 'default');
      } else if (d.kind === 'item') {
        useItem(battle, side, bags[n][d.index]);
        battle.skip.push(side.active[0]);
        battle.choose(side.id, 'default');
      } else if (d.kind === 'struggle') {
        // The engine's way to STRUGGLE is no PP, for the choosing: what it has left is still there
        // if the foe sends out something it can work on.
        const slots: { pp: number }[] = side.active[0].moveSlots;
        const left = slots.map((slot) => slot.pp);
        for (const slot of slots) slot.pp = 0;
        const ok = battle.choose(side.id, 'move 1');
        slots.forEach((slot, i) => { slot.pp = left[i]; });
        if (!ok) battle.choose(side.id, 'default');
      } else if (!battle.choose(side.id, `move ${d.slot + 1}`)) battle.choose(side.id, 'default');
    }
    if (!acted && !battle.ended && !caught && !ran) { capped = true; break; }
    if (!battle.ended) yield;
  }

  // Report, card by card, on each card's scale.
  const report = (n: 0 | 1) => {
    const party = inputs[n].party;
    const row = party.map((m) => ({ hp: m.hp, status: m.status }));
    const share = party.map((m) => (m.maxHp > 0 ? Math.min(1, m.hp / m.maxHp) : 0));
    for (const mon of sides[n].pokemon) {
      const slot = cardOf(mon);
      row[slot] = { hp: toCard(mon.hp, mon.maxhp, party[slot].maxHp), status: STATUS_BITS[mon.status] ?? 0 };
      share[slot] = mon.maxhp > 0 ? mon.hp / mon.maxhp : 0;
    }
    return { row, share };
  };
  const ra = report(0), rb = report(1);
  // Out of turns: judged on what's left, as a share of each team (Cam's rule is no coin flip, and
  // this is what the fight showed). Level, nobody won, and both walk on.
  const teamLeft = (share: number[]) => share.reduce((t, x) => t + x, 0) / Math.max(1, share.length);
  const byHp = teamLeft(ra.share) > teamLeft(rb.share) ? a.seat : teamLeft(rb.share) > teamLeft(ra.share) ? b.seat : 0;
  const winner = caught ? a.seat : ran ? 0 : capped ? byHp : battle.winner === 'A' ? a.seat : battle.winner === 'B' ? b.seat : 0;

  const logSide = (n: 0 | 1): LogSide => {
    const s = inputs[n];
    const team: LogMon[] = s.party.map(plainMon);
    for (const mon of sides[n].pokemon) {
      const slot = cardOf(mon);
      team[slot] = logMon(s.party[slot], mon, realHp(s.party[slot].hp, s.party[slot].maxHp, mon.maxhp));
    }
    return { seat: s.seat, name: s.name, skin: s.skin, team };
  };
  const said = translate(battle.log, names, winner, [a.seat, b.seat]);
  const log: BattleEvent[] = [{ e: 'start', a: logSide(0), b: logSide(1), map }, ...said.log];

  return {
    winner,
    loser: winner === a.seat ? b.seat : winner === b.seat ? a.seat : 0,
    a: ra.row,
    b: rb.row,
    shareA: ra.share,
    shareB: rb.share,
    usedA: [...bags[0].filter((r) => r.used).map((r) => r.id), ...thrown],
    usedB: bags[1].filter((r) => r.used).map((r) => r.id),
    turns: battle.turn,
    capped,
    ...(caught ? { caught } : {}),
    ...(ran ? { ran } : {}),
    log,
    unknown: said.unknown,
  };
}

/** Real HP on the card's own scale, as br_bot.c's BrBot_HpToCard. */
function toCard(hp: number, realMax: number, cardMax: number): number {
  if (hp <= 0 || realMax <= 0 || cardMax <= 0) return Math.max(0, hp);
  if (hp >= realMax) return cardMax;
  return Math.max(1, Math.min(cardMax, Math.floor((cardMax * hp + Math.floor(realMax / 2)) / realMax)));
}
