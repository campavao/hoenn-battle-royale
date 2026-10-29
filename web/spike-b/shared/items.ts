// Items as the room and the page both need them (include/constants/items.h).

const ITEM_MASTER_BALL = 1, ITEM_LAST_BALL = 12, ITEM_TM01 = 289, ITEM_HM08 = 346;

/** A ball off the ground is six (br_items.c's Pickup, BR_ITEMS_BALLS); one of the rest. */
export const groundCount = (item: number): number => (item > ITEM_MASTER_BALL && item <= ITEM_LAST_BALL ? 6 : 1);

export const isTm = (item: number): boolean => item >= ITEM_TM01 && item <= ITEM_HM08;

/** The key items: MACH BIKE..DEVON SCOPE, and OAK's PARCEL onwards. */
export const isKeyItem = (item: number): boolean => (item >= 259 && item <= 288) || item >= 349;

const ITEMS_COUNT = 377, MAX_MONEY = 999999, BAG_ROWS = 30 + 16 + 46;

export interface BagRows {
  items: { id: number; n: number }[];
  money: number;
  /** The team inside (HBR-82), as the match's SPILL carries it: species and level, each
   *  made fresh for whoever takes it. */
  mons?: { species: number; level: number }[];
}

const NUM_SPECIES = 412, MAX_LEVEL = 100;
const isMon = (m: unknown): boolean => {
  const { species, level } = (m ?? {}) as { species?: unknown; level?: unknown };
  return Number.isInteger(species) && (species as number) > 0 && (species as number) < NUM_SPECIES &&
    Number.isInteger(level) && (level as number) >= 1 && (level as number) <= MAX_LEVEL;
};

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
  if (Array.isArray(mons) && mons.length) out.mons = (mons as { species: number; level: number }[]).map(({ species, level }) => ({ species, level }));
  return out;
}

/** `rest` held to what `was` had: a bag put back never grows in items or money. Its team
 *  is whatever the taker left on the BAG screen, which can be one of theirs put down. */
export function within(rest: BagRows, was: BagRows): BagRows {
  const left = new Map<number, number>();
  for (const r of was.items) left.set(r.id, (left.get(r.id) ?? 0) + r.n);
  const items: BagRows['items'] = [];
  for (const r of rest.items) {
    const n = Math.min(r.n, left.get(r.id) ?? 0);
    if (n > 0) { items.push({ id: r.id, n }); left.set(r.id, left.get(r.id)! - n); }
  }
  const out: BagRows = { items, money: Math.min(rest.money, was.money) };
  if (rest.mons?.length) out.mons = rest.mons.slice(0, 6).map(({ species, level }) => ({ species, level }));
  return out;
}
