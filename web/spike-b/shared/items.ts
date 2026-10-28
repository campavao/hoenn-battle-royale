// Items as the room and the page both need them (include/constants/items.h).

const ITEM_MASTER_BALL = 1, ITEM_LAST_BALL = 12, ITEM_TM01 = 289, ITEM_HM08 = 346;

/** A ball off the ground is six (br_items.c's Pickup, BR_ITEMS_BALLS); one of the rest. */
export const groundCount = (item: number): number => (item > ITEM_MASTER_BALL && item <= ITEM_LAST_BALL ? 6 : 1);

export const isTm = (item: number): boolean => item >= ITEM_TM01 && item <= ITEM_HM08;

/** The key items: MACH BIKE..DEVON SCOPE, and OAK's PARCEL onwards. */
export const isKeyItem = (item: number): boolean => (item >= 259 && item <= 288) || item >= 349;

const ITEMS_COUNT = 377, MAX_MONEY = 999999, BAG_ROWS = 30 + 16 + 46;

export interface BagRows { items: { id: number; n: number }[]; money: number }

/** A bag as a phone sent it, made safe: real item ids from the pockets a bag spills (not
 *  key items or machines), counts up to a berry stack's 999, no more rows than those three
 *  pockets (items, balls, berries) hold, and money as the game caps it. Null for anything
 *  that is not a bag. */
export function cleanBag(raw: unknown): BagRows | null {
  if (!raw || typeof raw !== 'object') return null;
  const { items, money } = raw as { items?: unknown; money?: unknown };
  if (!Array.isArray(items) || items.length > BAG_ROWS) return null;
  const out: BagRows = { items: [], money: Number.isInteger(money) ? Math.min(Math.max(money as number, 0), MAX_MONEY) : 0 };
  for (const r of items) {
    const id = Number((r as { id?: unknown })?.id), n = Number((r as { n?: unknown })?.n);
    if (Number.isInteger(id) && id > 0 && id < ITEMS_COUNT && Number.isInteger(n) && n > 0 && !isTm(id) && !isKeyItem(id)) out.items.push({ id, n: Math.min(n, 999) });
  }
  return out;
}

/** `rest` held to what `was` had: a bag put back never grows. */
export function within(rest: BagRows, was: BagRows): BagRows {
  const left = new Map<number, number>();
  for (const r of was.items) left.set(r.id, (left.get(r.id) ?? 0) + r.n);
  const items: BagRows['items'] = [];
  for (const r of rest.items) {
    const n = Math.min(r.n, left.get(r.id) ?? 0);
    if (n > 0) { items.push({ id: r.id, n }); left.set(r.id, left.get(r.id)! - n); }
  }
  return { items, money: Math.min(rest.money, was.money) };
}
