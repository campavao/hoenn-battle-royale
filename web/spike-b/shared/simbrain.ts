// How a bot fights in the simulator (battlesim.ts). Written for this game and not taken from the
// game's AI: the ROM's bots get Emerald's "check the bad move, check the viable one, go for the
// knockout", and this aims at the same play -- a move that can work, the knockout when it is
// there, the hardest hit otherwise, some status while it counts, medicine when it is hurt, an X
// item on a mon just sent out, a switch out of a losing matchup now and then -- with a table of its
// own. A move is scored from 100 and the best score is played, ties at random.
import type { BagItem } from './simnames';

/* eslint-disable @typescript-eslint/no-explicit-any -- Showdown's objects, read and not typed (engine/gen3.d.mts) */
type Battle = any;
type Mon = any;
type SideObj = any;
type Move = any;

export type Rng = () => number;

export type Decision =
  | { kind: 'move'; slot: number }
  | { kind: 'switch'; to: Mon }
  | { kind: 'item'; index: number };

const STAGE = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 1, 3 / 2, 2, 5 / 2, 3, 7 / 2, 4];
const boosted = (mon: Mon, stat: string): number => mon.storedStats[stat] * STAGE[(mon.boosts[stat] ?? 0) + 6];

const ABSORB: Record<string, string> = { flashfire: 'Fire', waterabsorb: 'Water', voltabsorb: 'Electric' };
const RECHARGE = new Set(['hyperbeam', 'blastburn', 'hydrocannon', 'frenzyplant']);
const TWO_TURN = new Set(['solarbeam', 'razorwind', 'skullbash', 'skyattack', 'fly', 'dig', 'dive', 'bounce']);
const SELF_KO = new Set(['explosion', 'selfdestruct']);
const CHANGES_HANDS = new Set(['counter', 'mirrorcoat', 'bide']);
const RECOVERY = new Set(['recover', 'softboiled', 'milkdrink', 'slackoff', 'morningsun', 'synthesis', 'moonlight', 'swallow', 'wish', 'ingrain', 'rest']);
const SETUP_LATE_OK = new Set(['substitute']);
/** Moves that do nothing to speak of: the ROM's bots leave them in the bag. */
const WASTED = new Set(['foresight', 'odorsleuth', 'mudsport', 'watersport', 'camouflage', 'conversion', 'conversion2', 'teleport', 'splash']);
const FIXED: Record<string, number> = { dragonrage: 40, sonicboom: 20 };

/** The power a move has right now, as near as a bot would guess it. */
function powerOf(u: Mon, f: Mon, m: Move): number {
  switch (m.id) {
    case 'return': return 28; // friendship 70, a fresh mon's
    case 'frustration': return 72;
    case 'lowkick': { const w = f.species.weightkg; return w < 10 ? 20 : w < 25 ? 40 : w < 50 ? 60 : w < 100 ? 80 : w < 200 ? 100 : 120; }
    case 'magnitude': return 71;
    case 'present': return 40;
    case 'hiddenpower': return u.hpPower || 70;
    case 'flail': case 'reversal': {
      const r = Math.floor((u.hp * 48) / u.maxhp);
      return r < 2 ? 200 : r < 5 ? 150 : r < 10 ? 100 : r < 17 ? 80 : r < 33 ? 40 : 20;
    }
    case 'eruption': case 'waterspout': return Math.max(1, Math.floor((150 * u.hp) / u.maxhp));
    case 'facade': return u.status === 'brn' || u.status === 'psn' || u.status === 'tox' || u.status === 'par' ? 140 : 70;
    case 'smellingsalts': return f.status === 'par' ? 120 : 60;
    case 'revenge': return 60;
    case 'weatherball': return 50;
    case 'spitup': return 100 * (u.volatiles.stockpile?.layers ?? 0);
    default: return m.basePower;
  }
}

function typeOf(u: Mon, m: Move): string {
  return m.id === 'hiddenpower' ? u.hpType || m.type : m.type;
}

const PHYSICAL = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', '???']);

/** Does the type matchup, or an ability, stop this cold? */
function shutOut(b: Battle, type: string, m: Move, f: Mon): boolean {
  if (!b.dex.getImmunity(type, f)) return true;
  if (type === 'Ground' && f.ability === 'levitate') return true;
  if (ABSORB[f.ability] === type) return true;
  if (m.flags?.sound && f.ability === 'soundproof') return true;
  return false;
}

/** About what this move would take off `f`, on an average roll and no crit. 0 for no effect. */
export function damageOf(b: Battle, u: Mon, f: Mon, m: Move): number {
  if (m.category === 'Status') return 0;
  const type = typeOf(u, m);
  if (shutOut(b, type, m, f)) return 0;
  const eff = b.dex.getEffectiveness(type, f);
  if (f.ability === 'wonderguard' && eff <= 0) return 0;
  // Fixed damage ignores the chart past the immunity.
  if (m.id === 'seismictoss' || m.id === 'nightshade') return u.level;
  if (m.id === 'psywave') return u.level;
  if (FIXED[m.id]) return FIXED[m.id];
  if (m.id === 'superfang') return Math.max(1, Math.floor(f.hp / 2));
  if (m.id === 'endeavor') return Math.max(0, f.hp - u.hp);
  if (m.ohko) return u.level >= f.level ? f.hp * ((30 + u.level - f.level) / 100) : 0;
  if (CHANGES_HANDS.has(m.id)) return 0;
  const power = powerOf(u, f, m);
  if (!power) return 0;
  const physical = PHYSICAL.has(type);
  let atk = boosted(u, physical ? 'atk' : 'spa');
  const def = boosted(f, physical ? 'def' : 'spd');
  if (physical && (u.ability === 'hugepower' || u.ability === 'purepower')) atk *= 2;
  if (physical && u.status === 'brn' && u.ability !== 'guts') atk /= 2;
  if (physical && u.ability === 'hustle') atk *= 1.5;
  let dmg = Math.floor(Math.floor(Math.floor((2 * u.level) / 5 + 2) * power * atk / def) / 50) + 2;
  if (u.hasType(type)) dmg *= 1.5;
  dmg *= 2 ** eff;
  if (f.ability === 'thickfat' && (type === 'Fire' || type === 'Ice')) dmg /= 2;
  const w = b.field.weather;
  if ((w === 'raindance' && type === 'Water') || (w === 'sunnyday' && type === 'Fire')) dmg *= 1.5;
  if ((w === 'raindance' && type === 'Fire') || (w === 'sunnyday' && type === 'Water')) dmg *= 0.5;
  // One hit of a multi-hit move: measured against the ROM's bots, they go by a move's power, and
  // leave a FURY SWIPES in the bag next to a HEADBUTT that adds up to the same.
  return dmg * 0.925;
}

/** Would this move do nothing? (A bot does not waste the turn knowingly.) */
function useless(b: Battle, u: Mon, f: Mon, m: Move): boolean {
  const id: string = m.id;
  const foeSide: SideObj = f.side;
  const targetsFoe = m.target !== 'self' && m.target !== 'allySide' && m.target !== 'allyTeam' && m.target !== 'all' && m.target !== 'foeSide' && m.target !== 'adjacentAllyOrSelf';
  if (m.category === 'Status' && targetsFoe && f.volatiles.substitute && !m.flags?.bypasssub && id !== 'whirlwind' && id !== 'roar') return true;
  if (m.category === 'Status' && targetsFoe && !b.dex.getImmunity(typeOf(u, m), f) && m.ignoreImmunity !== true && (m.status === 'par' || id === 'toxic' || m.status === 'psn' || id === 'thunderwave')) return true;
  if (m.flags?.sound && f.ability === 'soundproof') return true;
  if (m.status) {
    if (f.status) return true;
    if (foeSide.sideConditions.safeguard) return true;
    const a = f.ability;
    if (m.status === 'slp' && (a === 'insomnia' || a === 'vitalspirit')) return true;
    if (m.status === 'par' && a === 'limber') return true;
    if ((m.status === 'psn' || m.status === 'tox') && (a === 'immunity' || f.hasType('Poison') || f.hasType('Steel'))) return true;
    if (m.status === 'brn' && (a === 'waterveil' || f.hasType('Fire'))) return true;
  }
  if (m.volatileStatus === 'confusion' && (f.volatiles.confusion || f.ability === 'owntempo' || foeSide.sideConditions.safeguard)) return true;
  if (id === 'leechseed' && (f.volatiles.leechseed || f.hasType('Grass'))) return true;
  if (id === 'attract' && (f.volatiles.attract || f.ability === 'oblivious' || u.gender === 'N' || f.gender === 'N' || u.gender === f.gender)) return true;
  if (id === 'dreameater' || id === 'nightmare') return f.status !== 'slp' && f.ability !== 'comatose';
  if (id === 'snore' || id === 'sleeptalk') return u.status !== 'slp';
  if (id === 'fakeout') return u.activeTurns > 1; // the engine counts the turn it came out on as 1
  if (id === 'spitup' || id === 'swallow') return !u.volatiles.stockpile;
  if (id === 'stockpile') return (u.volatiles.stockpile?.layers ?? 0) >= 3;
  if (id === 'bellydrum') return u.hp <= u.maxhp / 2 || u.boosts.atk >= 6;
  if (id === 'rest') return u.hp === u.maxhp || u.status === 'slp' || u.ability === 'insomnia' || u.ability === 'vitalspirit';
  if (RECOVERY.has(id)) return u.hp === u.maxhp;
  if (id === 'substitute') return !!u.volatiles.substitute || u.hp <= u.maxhp / 4;
  if (id === 'splash' || id === 'teleport' || id === 'helpinghand' || id === 'followme') return true;
  if (m.weather) return b.field.weather === m.weather;
  if (m.sideCondition) {
    const side = m.target === 'foeSide' ? foeSide : u.side;
    const c = side.sideConditions[m.id];
    if (m.id === 'spikes') return (c?.layers ?? 0) >= 3;
    return !!c;
  }
  if (id === 'focusenergy') return !!u.volatiles.focusenergy;
  if (id === 'encore') return !f.lastMove || !!f.volatiles.encore;
  if (id === 'disable') return !f.lastMove || !!f.volatiles.disable;
  if (id === 'taunt') return !!f.volatiles.taunt;
  if (id === 'torment') return !!f.volatiles.torment;
  if (id === 'destinybond') return !!u.volatiles.destinybond;
  if (id === 'ingrain') return !!u.volatiles.ingrain;
  if (id === 'curse' && !u.hasType('Ghost')) return u.boosts.atk >= 6 && u.boosts.def >= 6;
  if (id === 'curse') return !!f.volatiles.curse || u.hp <= u.maxhp / 2;
  if (id === 'yawn') return !!f.volatiles.yawn || !!f.status;
  if (id === 'perishsong') return !!f.volatiles.perishsong;
  if (id === 'whirlwind' || id === 'roar') return !f.side.pokemon.some((p: Mon) => p !== f && p.hp > 0) || f.volatiles.ingrain || f.ability === 'suctioncups';
  if (m.boosts && m.category === 'Status') {
    const on = m.target === 'self' || m.target === 'adjacentAllyOrSelf' ? u : f;
    const stats = Object.entries(m.boosts as Record<string, number>);
    if (on === u) return stats.every(([s, n]) => (n > 0 ? u.boosts[s] >= 6 : false));
    if (f.ability === 'clearbody' || f.ability === 'whitesmoke') return true;
    if (f.ability === 'hypercutter' && m.boosts.atk) return true;
    if (f.ability === 'keeneye' && m.boosts.accuracy) return true;
    if (foeSide.sideConditions.mist) return true;
    return stats.every(([s, n]) => (n < 0 ? f.boosts[s] <= -6 : false));
  }
  return false;
}

function scoreMove(b: Battle, u: Mon, f: Mon, m: Move, rolled: number, best: number, anyKo: boolean, rng: Rng): number {
  let s = 100;
  const hp = u.hp / u.maxhp;
  const foeHp = f.hp / f.maxhp;
  const id: string = m.id;
  if (useless(b, u, f, m)) return s - 10;
  if (m.category !== 'Status' && !CHANGES_HANDS.has(id)) {
    if (rolled <= 0) return s - 10;
    if (rolled >= f.hp) {
      s += 4;
      // A knockout that also lands first needs nothing more said about it.
      if (m.priority > 0 && u.getStat('spe') < f.getStat('spe')) s += 1;
      if ((m.accuracy !== true && m.accuracy < 80) || RECHARGE.has(id)) s -= 1;
    } else if (rolled < best) s -= 1;
    if (b.dex.getEffectiveness(typeOf(u, m), f) >= 2 && rng() < 0.31) s += 2;
    if (SELF_KO.has(id)) s += hp < 0.33 ? (rolled >= f.hp ? 0 : 1) : -3;
    if (!anyKo && RECHARGE.has(id)) s -= 1;
    if (!anyKo && TWO_TURN.has(id)) s -= 1;
    if (m.ohko && u.level < f.level) s -= 10;
    return s;
  }
  // Moves that do not hit: what they are worth now.
  if (anyKo) return s - 1;
  if (CHANGES_HANDS.has(id)) return s + (hp > 0.5 && rng() < 0.25 ? 0 : -1);
  if (RECOVERY.has(id)) return s + (hp < 0.25 ? 2 : hp < 0.5 ? (rng() < 0.5 ? 0 : -1) : -3);
  if (WASTED.has(id)) return s - 3;
  if (id === 'substitute') return s + (hp > 0.5 && rng() < 0.3 ? 0 : -2);
  if (id === 'endure') return s + (hp < 0.25 && !u.volatiles.stall ? 1 : -2);
  if (id === 'protect' || id === 'detect') {
    // Measured against the ROM's bots: one that has PROTECT opens with it, and may try it once more.
    const stalls = u.volatiles.stall ? (u.volatiles.stall.counter >= 9 ? 2 : 1) : 0;
    if (stalls > 1 || u.status === 'tox' || u.volatiles.leechseed || u.volatiles.curse || u.volatiles.attract) return s - 2;
    s += rng() < 0.5 ? 1 : 0;
    if (stalls) s -= rng() < 0.5 ? 1 : 2;
    return s;
  }
  if (m.status || m.volatileStatus === 'confusion' || id === 'leechseed' || id === 'attract' || id === 'yawn') {
    if (foeHp < 0.3) return s - 2;
    return s + (u.activeTurns < 3 && rng() < 0.5 ? 1 : rng() < 0.5 ? 0 : -1);
  }
  if (m.boosts && (m.target === 'self' || m.target === 'adjacentAllyOrSelf')) {
    const already = Math.max(...Object.keys(m.boosts).map((st) => u.boosts[st] ?? 0));
    if (hp < 0.4) return s - 3;
    if (already >= 2) return s - 2;
    if (m.boosts.spe && u.getStat('spe') > f.getStat('spe')) return s - 3; // already first
    // Measured against the ROM's bots: they sharpen an attack while they are well, and rarely wall up.
    if (m.boosts.atk || m.boosts.spa) return s + (hp > 0.7 ? 1 : 0);
    return s + (hp > 0.7 && rng() < 0.5 ? 0 : -1);
  }
  if (m.boosts) return s + (foeHp < 0.3 ? -2 : rng() < 0.75 ? -1 : 0);
  if (m.weather || m.sideCondition) return s + (rng() < 0.5 ? 0 : -1);
  if (id === 'destinybond') return s + (hp < 0.25 ? 2 : -2);
  if (id === 'perishsong' || id === 'painsplit') return s + (hp < 0.5 ? 1 : -1);
  if (SETUP_LATE_OK.has(id)) return s;
  return s + (rng() < 0.5 ? 0 : -1);
}

/** Which slot of the mon's moves to play. */
function pickMove(b: Battle, u: Mon, f: Mon, slots: { id: string; disabled?: boolean; pp?: number; move?: string }[], rng: Rng): number {
  const rows: { slot: number; m: Move; rolled: number }[] = [];
  slots.forEach((slot, i) => {
    if (slot.disabled) return;
    if (slot.pp !== undefined && slot.pp <= 0) return;
    const m = b.dex.moves.get(slot.id);
    rows.push({ slot: i, m, rolled: damageOf(b, u, f, m) * (0.92 + rng() * 0.16) });
  });
  if (!rows.length) return 0;
  const best = Math.max(...rows.map((r) => r.rolled));
  const anyKo = rows.some((r) => r.rolled >= f.hp);
  let top = -Infinity;
  let pool: number[] = [];
  for (const r of rows) {
    const s = scoreMove(b, u, f, r.m, r.rolled, best, anyKo, rng);
    if (s > top) { top = s; pool = [r.slot]; } else if (s === top) pool.push(r.slot);
  }
  return pool[Math.floor(rng() * pool.length)];
}

const hasSuperEffective = (b: Battle, mon: Mon, foe: Mon): boolean =>
  mon.moveSlots.some((s: any) => {
    const m = b.dex.moves.get(s.id);
    return m.category !== 'Status' && !shutOut(b, typeOf(mon, m), m, foe) && b.dex.getEffectiveness(typeOf(mon, m), foe) > 0;
  });

/** The best damage a mon could do to `foe`. */
const bestDamage = (b: Battle, mon: Mon, foe: Mon): number => Math.max(0, ...mon.moveSlots.map((s: any) => damageOf(b, mon, foe, b.dex.moves.get(s.id))));

/** Who comes out next when the last one is down: somebody with a super-effective move, the
 *  hardest-hitting of those; nobody like that, the hardest hitter. */
export function pickNext(b: Battle, side: SideObj, foe: Mon | undefined): Mon | undefined {
  const bench: Mon[] = side.pokemon.filter((p: Mon) => p.hp > 0 && !p.isActive);
  if (!bench.length) return undefined;
  if (!foe || foe.hp <= 0) return bench[0];
  const rank = (p: Mon) => (hasSuperEffective(b, p, foe) ? 1e6 : 0) + bestDamage(b, p, foe);
  return bench.reduce((a, p) => (rank(p) > rank(a) ? p : a));
}

/** Time to go? A mon that cannot touch what it faces goes for one that can; one just hit by what
 *  a bench mate shrugs off, with nothing to hit back with itself, sometimes does too. */
function pickSwitch(b: Battle, side: SideObj, u: Mon, f: Mon, lastHit: Move | undefined, rng: Rng): Mon | undefined {
  const bench: Mon[] = side.pokemon.filter((p: Mon) => p.hp > 0 && !p.isActive);
  if (!bench.length) return undefined;
  if (u.boosts.atk + u.boosts.spa + u.boosts.def + u.boosts.spd + u.boosts.spe > 3) return undefined;
  if (u.volatiles.perishsong?.duration === 1) return pickNext(b, side, f);
  if (hasSuperEffective(b, u, f)) return undefined;
  if (f.ability === 'wonderguard' && rng() < 0.66) {
    const can = bench.find((p) => hasSuperEffective(b, p, f));
    if (can) return can;
  }
  if (!lastHit || lastHit.category === 'Status') return undefined;
  const type = lastHit.type;
  for (const p of bench) {
    const immune = shutOut(b, type, lastHit, p);
    const resists = !immune && b.dex.getEffectiveness(type, p) < 0;
    if (!immune && !resists) continue;
    if (!hasSuperEffective(b, p, f)) continue;
    if (rng() < (immune ? 0.5 : 0.33)) return p;
  }
  return undefined;
}

/** A bag item worth its turn now, if there is one. The first in the bag is always in reach; the
 *  rest are saved until about as few mons stand as items remain. */
function pickItem(u: Mon, side: SideObj, bag: { item: BagItem | null; used: boolean }[]): number {
  const standing = side.pokemon.filter((p: Mon) => p.hp > 0).length;
  const left = bag.filter((b) => !b.used).length;
  let seen = 0;
  for (let i = 0; i < bag.length; i++) {
    const row = bag[i];
    if (row.used) continue;
    const at = seen++;
    if (at > 0 && standing > left - at + 1) continue;
    const it = row.item;
    if (!it) continue;
    const lost = u.maxhp - u.hp;
    // Under a quarter, or down by more than it gives back. A whole bar waits for the quarter.
    if (it.heal !== undefined && u.hp > 0 && (u.hp < u.maxhp / 4 || lost > it.heal)) return i;
    if (it.cures && !it.heal) {
      if (u.status && it.cures.includes(u.status)) return i;
      if (u.volatiles.confusion && it.cures.includes('confusion')) return i;
    }
    if (it.boost && u.activeTurns <= 1) return i;
    if (it.special === 'direhit' && u.activeTurns <= 1) return i;
    if (it.special === 'guardspec' && u.activeTurns <= 1 && !side.sideConditions.mist) return i;
  }
  return -1;
}

/** A trainer's turn: the mon's own request is the moves it may play (Showdown already knows what
 *  is disabled, locked or out of PP). */
export function decide(b: Battle, side: SideObj, request: any, bag: { item: BagItem | null; used: boolean }[], lastHit: Move | undefined, rng: Rng): Decision {
  const u: Mon = side.active[0];
  const f: Mon = side.foe.active[0];
  const row = request.active[0];
  const locked = row.moves.length === 1 && (!!u.getLockedMove?.() || row.moves[0].id === 'recharge' || row.moves[0].id === 'struggle');
  if (!u || !f || u.hp <= 0 || locked) return { kind: 'move', slot: 0 };
  if (!row.trapped && !row.maybeTrapped) {
    const to = pickSwitch(b, side, u, f, lastHit, rng);
    if (to) return { kind: 'switch', to };
  }
  const item = pickItem(u, side, bag);
  if (item >= 0) return { kind: 'item', index: item };
  return { kind: 'move', slot: pickMove(b, u, f, row.moves, rng) };
}
