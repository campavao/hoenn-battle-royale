// Items lying about (Cam's 2026-10-14 play-test, POK-354: "I almost want just more items
// all over the place and you just kind of pick up items"). The map's own item balls are
// few -- one in a Lilycove house and none on the beach -- so at the buzzer the host deals
// a few more to every outdoor section, on cells nobody has been dealt. On the wire each
// is a `spill` of a one-item bag under a scatter key, which the ROM draws as an item ball
// (br_loot.c's OneThing) and picks up like any other: its PICKUP takes it off every map,
// a late joiner is handed the ones still lying there, and a bot walks over to one.
import { MAP_OFFSET } from '../net/cells';
import type { MapRef, Msg } from '../net/wire';
import { GOLD } from './events';
import { pickIndex } from './clock';

/** `0xD000 | i`: nobody's space, past the trainers' (to 0xAB56), the events' (0xB000) and
 *  the gift-givers' (0xC000), so no ROM reads one as its own or as a person
 *  (include/br/br_loot.h). */
export const SCATTER_KEY_BASE = 0xd000;
export const SCATTER_MAX = 0x1000;
export const scatterKey = (i: number): number => SCATTER_KEY_BASE | i;
export const isScatterKey = (key: number): boolean => (key & 0xf000) === SCATTER_KEY_BASE;

/** How many a section gets. Two, so a map with an event's seven on it is still mostly
 *  under the eight a ROM keeps (br_loot.c's Evict takes the farthest, and the page hands
 *  them back on the next visit). */
export const SCATTER_PER_SECTION = 2;

// include/constants/items.h
const ITEM_ULTRA_BALL = 2;
const ITEM_GREAT_BALL = 3;
const ITEM_HYPER_POTION = 21;
const ITEM_SUPER_POTION = 22;
const ITEM_FULL_HEAL = 23;
const ITEM_REVIVE = 24;
const ITEM_ETHER = 34;
const ITEM_X_ATTACK = 75;
const ITEM_X_DEFEND = 76;
const ITEM_X_SPEED = 77;
const ITEM_LUM_BERRY = 141;
const ITEM_SITRUS_BERRY = 142;
const ITEM_TM01 = 289;
const ITEM_HM01 = 339;

/** The battle royale's loot table, weights out of their sum: mostly what keeps a team
 *  standing, some balls (a ball off the ground is six, br_items.h), the odd machine.
 *  No RARE CANDY (Cam, 2026-10-13: it lifts a mon past the ring's rung). A status heal
 *  is a FULL RESTORE when it is picked up (br_items.h). */
export const SCATTER_TABLE: readonly { id: number | 'tm'; w: number }[] = [
  { id: ITEM_SUPER_POTION, w: 6 },
  { id: ITEM_HYPER_POTION, w: 4 },
  { id: ITEM_REVIVE, w: 3 },
  { id: ITEM_FULL_HEAL, w: 2 },
  { id: ITEM_GREAT_BALL, w: 3 },
  { id: ITEM_ULTRA_BALL, w: 2 },
  { id: ITEM_ETHER, w: 2 },
  { id: ITEM_SITRUS_BERRY, w: 2 },
  { id: ITEM_LUM_BERRY, w: 1 },
  { id: ITEM_X_ATTACK, w: 1 },
  { id: ITEM_X_DEFEND, w: 1 },
  { id: ITEM_X_SPEED, w: 1 },
  { id: 'tm', w: 3 },
];

/** A machine for the ground: any but the gold ones, which are for houses and events
 *  (br_balls.c's BlueTm). */
function blueTm(rng: () => number): number {
  let tm = ITEM_TM01 + pickIndex(rng, ITEM_HM01 - ITEM_TM01);
  while (GOLD.includes(tm)) tm = tm + 1 < ITEM_HM01 ? tm + 1 : ITEM_TM01;
  return tm;
}

export function scatterItem(rng: () => number): number {
  const total = SCATTER_TABLE.reduce((n, row) => n + row.w, 0);
  let roll = pickIndex(rng, total);
  for (const row of SCATTER_TABLE) {
    if (roll < row.w) return row.id === 'tm' ? blueTm(rng) : row.id;
    roll -= row.w;
  }
  return ITEM_SUPER_POTION;
}

/** One ball: which map, and where, in the page's space (landing.json's). */
export interface ScatterSpot {
  map: MapRef;
  x: number;
  y: number;
}

/** The balls, as the messages that put them on the ground: one `spill` each, a bag of
 *  one item, under the host's seat; `spots[i]` gets scatterKey(i). */
export function scatterDrop(rng: () => number, seat: number, spots: ScatterSpot[]): Msg[] {
  return spots.slice(0, SCATTER_MAX).map((s, i) => ({
    t: 'spill',
    seat,
    map: s.map,
    mons: [],
    bag: {
      key: scatterKey(i),
      x: s.x + MAP_OFFSET,
      y: s.y + MAP_OFFSET,
      items: [{ id: scatterItem(rng), n: 1 }],
      money: 0,
    },
  }));
}
