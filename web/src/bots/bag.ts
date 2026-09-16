// What a bot is carrying that is not a Pokemon (POK-237, Kanto v0.37.0/v0.48.0).
//
// Kanto's rule is that a bot's items are real: the potions it drinks, the X ATTACKs it
// pops in a fight and the TMs a player finds on its body all come out of one inventory
// that runs down. Before that, its engine AI conjured an X ATTACK twice a fight out of
// nothing, and a player who beat it never found one -- which is the tell that the bag
// was a prop.
//
// Ours has to work across the seam, because a bot's fight does not happen here: it
// happens inside whichever player's ROM it challenged, where Emerald's own trainer AI
// picks the items (`BATTLE_HISTORY->trainerItems`, at most MAX_TRAINER_ITEMS = 4). So
// the bag lives on this page, the units it can spend in one fight ride over on the
// `trainer` card, and the ROM reports back which of them it actually used (`spent`).
// What is left is still in the bag, and what is in the bag when the bot falls is what
// hits the ground.
import { mulberry32 } from '../match/clock';
import { Grade } from './roster';
import { rungForPhase } from './party';
import type { PackedMon } from '../net/wire';

/** One kind of thing, and how many of it. The `spill` wire shape, deliberately. */
export interface Stack {
  id: number;
  n: number;
}

/** The item ids this module deals in, from include/constants/items.h. Gen 3 item ids
 *  are positions in one enum, so these are the numbers the ROM will read back. */
export const ITEM = {
  POTION: 13,
  FULL_RESTORE: 19,
  MAX_POTION: 20,
  HYPER_POTION: 21,
  SUPER_POTION: 22,
  FULL_HEAL: 23,
  GUARD_SPEC: 73,
  DIRE_HIT: 74,
  X_ATTACK: 75,
  X_DEFEND: 76,
  X_SPEED: 77,
} as const;

/** What one of these puts back, in HP. Emerald's own numbers (gItemEffectTable): a
 *  POTION is 20 and a MAX POTION is the whole bar, which is why the big two are a
 *  number nothing has. */
const HEAL: Record<number, number> = {
  [ITEM.POTION]: 20,
  [ITEM.SUPER_POTION]: 50,
  [ITEM.HYPER_POTION]: 200,
  [ITEM.MAX_POTION]: 9999,
  [ITEM.FULL_RESTORE]: 9999,
};

/** The stat boosters, in the order a trainer would reach for them. */
const BOOSTS = [ITEM.X_ATTACK, ITEM.X_SPEED, ITEM.X_DEFEND, ITEM.DIRE_HIT, ITEM.GUARD_SPEC];

/** Emerald's MAX_TRAINER_ITEMS: the AI reads four and no more. */
export const BATTLE_ITEMS = 4;

/** Is this something a quaff could drink? */
export function isMedicine(id: number): boolean {
  return HEAL[id] !== undefined;
}

/** The medicine a trainer at this rung would be carrying -- the same ladder the AI
 *  branch used to fake before there was a bag behind it. */
export function potionFor(level: number): number {
  if (level >= 75) return ITEM.FULL_RESTORE;
  if (level >= 50) return ITEM.HYPER_POTION;
  if (level >= 30) return ITEM.SUPER_POTION;
  return ITEM.POTION;
}

/** A bot's bag at the drop. Dealt from the seed and the seat like everything else it
 *  owns, so every client that cares to work it out agrees -- and by grade, because
 *  what separates an ace from a rookie is as much what it is carrying as what it is
 *  leading with (POK-265). */
export function dealBag(seed: number, seat: number, phase: number, grade: Grade = Grade.Regular): Stack[] {
  const rng = mulberry32((seed ^ (seat * 0x2f1b) ^ 0xba6) >>> 0);
  const level = rungForPhase(phase);
  const potions = grade === Grade.Ace ? 3 : grade === Grade.Rookie ? 1 : 2;
  const boosts = grade === Grade.Ace ? 2 : grade === Grade.Rookie ? 0 : 1;
  const bag: Stack[] = [{ id: potionFor(level), n: potions }];

  for (let i = 0; i < boosts; i++) add(bag, BOOSTS[Math.floor(rng() * BOOSTS.length)], 1);
  // An ace at the deep end of the ladder also carries the cure, which is the item
  // that makes a status move against it a wasted turn rather than the whole fight.
  if (grade === Grade.Ace && level >= 50) add(bag, ITEM.FULL_HEAL, 1);
  return bag;
}

/** The ring moved: a trainer who is still standing has been back to a Mart. One
 *  potion of the new rung's tier, and nothing else -- a top-up, not a re-deal, so a
 *  bag that has been spent stays spent. */
export function restock(bag: Stack[], phase: number): void {
  add(bag, potionFor(rungForPhase(phase)), 1);
}

/** Take one of `id`. TRUE when there was one to take. */
export function take(bag: Stack[], id: number): boolean {
  const i = bag.findIndex((s) => s.id === id && s.n > 0);

  if (i < 0) return false;
  bag[i].n--;
  if (bag[i].n <= 0) bag.splice(i, 1);
  return true;
}

/** Put one (or more) in. Stacks merge by id; the wire carries at most 32 of them. */
export function add(bag: Stack[], id: number, n = 1): void {
  const mine = bag.find((s) => s.id === id);

  if (mine) mine.n = Math.min(99, mine.n + n);
  else if (bag.length < 32) bag.push({ id, n: Math.min(99, n) });
}

/** A bag found on the ground folds into this one. */
export function merge(bag: Stack[], loot: Stack[]): void {
  for (const stack of loot) add(bag, stack.id, stack.n);
}

/** How many units are in here at all -- for a test, and for the ticker. */
export function units(bag: Stack[]): number {
  return bag.reduce((n, s) => n + s.n, 0);
}

/** Under this and a trainer drinks. 0.6 is Kanto's number (Bots.quaff). */
const QUAFF_AT = 0.6;

/** A drink between fights, the moment a player would reach for the bag rather than
 *  walk to a Centre: the weakest medicine that helps, onto the worst-hurt mon still
 *  standing, whenever anybody is under 60%. Mutates both the party and the bag, and
 *  answers with the item drunk -- or null when nobody needed it or nothing was left.
 *
 *  The weakest that helps, rather than the best, is the whole character of the rule:
 *  a bot that opens with its FULL RESTORE on a scratch has nothing at the buzzer. */
export function quaff(party: PackedMon[], bag: Stack[]): number | null {
  let worst = -1;
  let share = QUAFF_AT;

  for (let i = 0; i < party.length; i++) {
    const mon = party[i];
    if (mon.hp <= 0 || mon.maxHp <= 0) continue;
    const frac = mon.hp / mon.maxHp;
    if (frac < share) {
      share = frac;
      worst = i;
    }
  }
  if (worst < 0) return null;
  let best: number | null = null;
  for (const stack of bag) {
    if (stack.n <= 0 || !isMedicine(stack.id)) continue;
    if (best === null || HEAL[stack.id] < HEAL[best]) best = stack.id;
  }
  if (best === null) return null;
  take(bag, best);
  const mon = party[worst];
  party[worst] = { ...mon, hp: Math.min(mon.maxHp, mon.hp + HEAL[best]) };
  return best;
}

/** What the bot hands its opponent's ROM for one fight: up to four units, medicine
 *  first because that is the item the AI will actually reach for, then the boosters.
 *  Units, not stacks -- two POTIONs go over as two entries, which is how Emerald's
 *  trainerItems array is shaped.
 *
 *  Nothing is taken out of the bag here. The ROM says what it used when the fight is
 *  over (`spent`), and a fight that ended on the first turn leaves the bag full. */
export function battleItems(bag: Stack[]): number[] {
  const out: number[] = [];
  const pour = (want: (id: number) => boolean) => {
    for (const stack of bag) {
      if (!want(stack.id)) continue;
      for (let i = 0; i < stack.n && out.length < BATTLE_ITEMS; i++) out.push(stack.id);
    }
  };

  pour((id) => isMedicine(id));
  pour((id) => !isMedicine(id));
  return out.slice(0, BATTLE_ITEMS);
}

/** The fight is over and the ROM says these were used. */
export function spend(bag: Stack[], used: number[]): void {
  for (const id of used) take(bag, id);
}

/** What a trainer at this rung is carrying in cash -- the part of a spill that is not
 *  an item. A rookie's purse at the drop is pocket money; an ace at the buzzer is
 *  worth walking across the fog for. */
export function purse(phase: number, grade: Grade = Grade.Regular): number {
  const level = rungForPhase(phase);
  const mult = grade === Grade.Ace ? 3 : grade === Grade.Rookie ? 1 : 2;

  return level * 20 * mult;
}
