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
//
// And what is in it is only what the bot picked up (POK-322): nothing is dealt at the
// drop and nothing appears when the ring moves. Kanto deals BOT_LOOT and a graded kit;
// Cam's play-test met bots opening fights with "two potions off the start" and the rule
// here is his -- a bag that holds something the bot never went and got is a prop again.
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

/** Emerald's MAX_TRAINER_ITEMS: the AI reads four and no more. */
export const BATTLE_ITEMS = 2;

/** Is this something a quaff could drink? */
export function isMedicine(id: number): boolean {
  return HEAL[id] !== undefined;
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

/** What the bot hands its opponent's ROM for one fight: two units at most. Units, not
 *  stacks -- two POTIONs go over as two entries, which is how Emerald's trainerItems
 *  array is shaped.
 *
 *  One medicine at most, then a booster. It was four and two, and Emerald's AI spends
 *  what it is given the moment it is behind: the play-test met bots drinking "three to
 *  five potions per battle, usually all at once", which is not a fight, it is a wall.
 *  A bot that has looted somebody's bag can be carrying nothing but potions, so
 *  medicine goes first but only once -- the second slot is where its X ATTACK gets to
 *  exist.
 *
 *  Never more units than the bag holds: the last pour is the medicine the first one
 *  left, and it used to pour the first one's again, so a bot with one POTION went in
 *  with two and the second was spent out of nothing (POK-322).
 *
 *  Nothing is taken out of the bag here. The ROM says what it used when the fight is
 *  over (`spent`), and a fight that ended on the first turn leaves the bag full. */
export function battleItems(bag: Stack[]): number[] {
  const out: number[] = [];
  const left = bag.map((stack) => stack.n);
  const pour = (want: (id: number) => boolean, cap = BATTLE_ITEMS) => {
    bag.forEach((stack, i) => {
      if (!want(stack.id)) return;
      for (; left[i] > 0 && out.length < cap; left[i]--) out.push(stack.id);
    });
  };

  pour((id) => isMedicine(id), MEDICINE_FIRST);
  pour((id) => !isMedicine(id));
  pour((id) => isMedicine(id));
  return out;
}

/** How many of the two go to medicine before the boosters get a look in. */
const MEDICINE_FIRST = 1;

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
