// Items as the room and the page both need them (include/constants/items.h).

const ITEM_MASTER_BALL = 1, ITEM_LAST_BALL = 12, ITEM_TM01 = 289, ITEM_HM08 = 346;

/** A ball off the ground is six (br_items.c's Pickup, BR_ITEMS_BALLS); one of the rest. */
export const groundCount = (item: number): number => (item > ITEM_MASTER_BALL && item <= ITEM_LAST_BALL ? 6 : 1);

export const isTm = (item: number): boolean => item >= ITEM_TM01 && item <= ITEM_HM08;

/** br_loot.c's TradedInto: the four classic trade evolutions go off when a home's
 *  POKeMON reaches you (SPECIES_KADABRA, MACHOKE, GRAVELER, HAUNTER). */
const TRADED_INTO: Record<number, number> = { 64: 65, 67: 68, 75: 76, 93: 94 };
export const tradedInto = (species: number): number => TRADED_INTO[species] ?? species;

/** br_balls.c's BrBalls_Deal: past the machines (one in BR_BALLS_TM_IN), one ball in
 *  BR_BALLS_CABLE_IN is a LINK CABLE and one a POKe DOLL. */
export const ITEM_POKE_DOLL = 80, ITEM_LINK_CABLE = 52;
const CABLE_IN = 12;
export function cableOrDoll(item: number, roll: number): number {
  if (isTm(item)) return item;
  const k = Math.floor(roll * CABLE_IN);
  return k === 0 ? ITEM_LINK_CABLE : k === 1 ? ITEM_POKE_DOLL : item;
}

/** The key items: MACH BIKE..DEVON SCOPE, and OAK's PARCEL onwards. */
export const isKeyItem = (item: number): boolean => (item >= 259 && item <= 288) || item >= 349;

const ITEMS_COUNT = 377, MAX_MONEY = 999999, BAG_ROWS = 30 + 16 + 46;

/** A mon in a ball on the ground: species and level, made fresh for whoever takes it
 *  (br_loot.c MakeTaken). One of a trainer's own let go -- a full party's catch, a swap on a
 *  bag's team -- says the HP it left the party with, and is taken with that (Cam, 11-11: "the
 *  Mon you released should have the same health it was at"). None said, it is made full:
 *  a beaten trainer's team, a gift, an old page's. */
export interface GroundMon { species: number; level: number; hp?: number; maxHp?: number }

export interface BagRows {
  items: { id: number; n: number }[];
  money: number;
  /** The team inside (HBR-82), as the match's SPILL carries it (GroundMon). */
  mons?: GroundMon[];
}

const NUM_SPECIES = 412, MAX_LEVEL = 100;
/** Gen 3's most is 714 (a level-100 BLISSEY); past 999 is nonsense. */
const MAX_HP = 999;
const isMon = (m: unknown): boolean => {
  const { species, level } = (m ?? {}) as { species?: unknown; level?: unknown };
  return Number.isInteger(species) && (species as number) > 0 && (species as number) < NUM_SPECIES &&
    Number.isInteger(level) && (level as number) >= 1 && (level as number) <= MAX_LEVEL;
};

/** A ground mon as a phone said it, held to the mon: an HP over its most is its most, under 0
 *  is 0, and one that is not a whole number with a most of 1..999 beside it is not said at
 *  all (made full, as before). */
export function groundMon(m: { species: number; level: number; hp?: unknown; maxHp?: unknown }): GroundMon {
  const { species, level, hp, maxHp } = m;
  if (!Number.isInteger(hp) || !Number.isInteger(maxHp) || (maxHp as number) < 1 || (maxHp as number) > MAX_HP) return { species, level };
  return { species, level, hp: Math.min(Math.max(hp as number, 0), maxHp as number), maxHp: maxHp as number };
}

/** The wire's released rows ({ sp, lv, hp?, mhp? }, wire.ts `released`), made safe: up to six,
 *  each a real species at a real level, its HP held as groundMon holds it. */
export function cleanReleased(raw: unknown): GroundMon[] {
  if (!Array.isArray(raw)) return [];
  const out: GroundMon[] = [];
  for (const r of raw.slice(0, 6) as { sp?: unknown; lv?: unknown; hp?: unknown; mhp?: unknown }[]) {
    const m = { species: r?.sp, level: r?.lv };
    if (isMon(m)) out.push(groundMon({ ...(m as { species: number; level: number }), hp: r.hp, maxHp: r.mhp }));
  }
  return out;
}

/** A bag as a phone sent it, made safe: real item ids from the pockets a bag spills (not
 *  key items or machines), counts up to a berry stack's 999, no more rows than those three
 *  pockets (items, balls, berries) hold, and money as the game caps it. Null for anything
 *  that is not a bag. */
export function cleanBag(raw: unknown): BagRows | null {
  if (!raw || typeof raw !== 'object') return null;
  const { items, money, mons } = raw as { items?: unknown; money?: unknown; mons?: unknown };
  if (!Array.isArray(items) || items.length > BAG_ROWS) return null;
  if (mons !== undefined && (!Array.isArray(mons) || mons.length > 6 || !mons.every(isMon))) return null;
  const out: BagRows = { items: [], money: Number.isInteger(money) ? Math.min(Math.max(money as number, 0), MAX_MONEY) : 0 };
  for (const r of items) {
    const id = Number((r as { id?: unknown })?.id), n = Number((r as { n?: unknown })?.n);
    if (Number.isInteger(id) && id > 0 && id < ITEMS_COUNT && Number.isInteger(n) && n > 0 && !isTm(id) && !isKeyItem(id)) out.items.push({ id, n: Math.min(n, 999) });
  }
  if (Array.isArray(mons) && mons.length) out.mons = (mons as GroundMon[]).map(groundMon);
  return out;
}

/** `rest` held to what `was` had: a bag put back never grows in items or money. Its team
 *  is whatever the taker left on the BAG screen, which can be one of theirs put down, with
 *  the HP it left them with. */
export function within(rest: BagRows, was: BagRows): BagRows {
  const left = new Map<number, number>();
  for (const r of was.items) left.set(r.id, (left.get(r.id) ?? 0) + r.n);
  const items: BagRows['items'] = [];
  for (const r of rest.items) {
    const n = Math.min(r.n, left.get(r.id) ?? 0);
    if (n > 0) { items.push({ id: r.id, n }); left.set(r.id, left.get(r.id)! - n); }
  }
  const out: BagRows = { items, money: Math.min(rest.money, was.money) };
  if (rest.mons?.length) out.mons = rest.mons.slice(0, 6).map(groundMon);
  return out;
}
