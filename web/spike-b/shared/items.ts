// Items as the room and the page both need them (include/constants/items.h).

const ITEM_MASTER_BALL = 1, ITEM_LAST_BALL = 12, ITEM_TM01 = 289, ITEM_HM08 = 346;

/** A ball off the ground is six (br_items.c's Pickup, BR_ITEMS_BALLS); one of the rest. */
export const groundCount = (item: number): number => (item > ITEM_MASTER_BALL && item <= ITEM_LAST_BALL ? 6 : 1);

export const isTm = (item: number): boolean => item >= ITEM_TM01 && item <= ITEM_HM08;
