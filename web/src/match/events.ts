// Events (Cam, 2026-10-13): "start every other ring from the first shrink. An event drops
// a cluster of placed NPCs, items, rares and a legendary at a location marked on the map.
// There's no completion or claim. Final ring: centres on the last event."
//
// The host deals them, with the director's clock (director.ts): one on each of the ring's
// phases 2, 4, 6 and 8, in a section inside that phase's ring, and the last one in the
// ring's own centre, the one place the final ring still holds. What drops is ordinary
// loot -- `spill`s under keys of the events' own -- so every ROM draws it, picks it up and
// hands it over the way it does a fallen trainer's, the loot table re-sends it to whoever
// walks onto the map later, and the bots go for it like any other ball inside the ring.
// The one new message is `event`: where it is, for the mark on everybody's MAP
// (src/br/br_event.c).
//
// The placed NPC is a trader, on the `event` too, so every ROM stands him on the same
// cell: any one of yours for his rare at your rung (br_event.c). He offers a rare the
// event did not drop, then whatever the last trainer gave him (#9).
import { rungForPhase } from '../bots/party';
import { MAP_OFFSET } from '../net/cells';
import { EVENT_MAX, type EventMsg, type EventTrader, type MapRef, type Msg, type PickupMsg, type SpillBag, type SpillMon, type SpillMsg } from '../net/wire';
import { pickIndex } from './clock';

/** BR_EVENT_KEY_BASE in include/br/br_event.h: `0xB000 | n << 4 | i`, past every
 *  trainer's key (they end at 0xAB56) in the nobody's space, so no ROM reads a piece as
 *  its own and skips the trade evolution. */
export const EVENT_KEY_BASE = 0xb000;
/** BR_EVENT_MAX: phases 2, 4, 6 and 8. The wire's, which validates `n` against it. */
export { EVENT_MAX };
export const eventKey = (n: number, i: number): number => EVENT_KEY_BASE | (n << 4) | i;
export const isEventKey = (key: number): boolean => (key & 0xf000) === EVENT_KEY_BASE;
/** BR_EVENT_TRADER_KEY: the last of the event's sixteen keys, past every piece. A `pickup`
 *  of it naming a species is a trade done: he holds that one now (#9). A bare one is the
 *  host's yes to an ask, which has him busy until that trade's own PICKUP. */
export const traderKey = (n: number): number => eventKey(n, 15);
export const traderOf = (key: number): number | undefined =>
  isEventKey(key) && (key & 0xf) === 15 ? (key >> 4) & 0xf : undefined;
/** BR_EVENT_CLAIM_KEY: a seat asking to trade with him (POK-392), the key below his. */
export const claimKey = (n: number): number => eventKey(n, 14);
export const claimOf = (key: number): number | undefined =>
  isEventKey(key) && (key & 0xf) === 14 ? (key >> 4) & 0xf : undefined;

/** BR_LEGEND_CLAIM_KEY in include/br/br_legend.h: a seat asking for the legendary standing
 *  under event key `key` before it fights it (POK-410). Past every event's sixteen keys. */
export const legendClaimKey = (key: number): number => key | 0x0800;
export const legendClaimOf = (key: number): number | undefined => ((key & 0xf800) === 0xb800 ? key & ~0x0800 : undefined);

/** BR_LOOT_KEY_HOME in include/br/br_loot.h: somebody at home in house i (POK-379), a
 *  Pokemon he gives or trades, or on big floor i the trader standing there, `0x80 | i`
 *  (POK-413); and BR_LOOT_KEY_HOME_CLAIM, a seat asking for him first, his key | 0x40.
 *  The page never deals them -- the ROMs do, from the seed -- and only answers the ask. */
export const homeKey = (i: number): number => 0x8c00 | i;
export const homeClaimOf = (key: number): number | undefined => ((key & 0xff40) === 0x8c40 ? key & 0xbf : undefined);
export const isHomeKey = (key: number): boolean => (key & 0xff40) === 0x8c00;
/** Either of his: the house's own key or an ask for it. */
export const isHomeOrClaim = (key: number): boolean => (key & 0xff00) === 0x8c00;

/** One trade a trader (POK-392), and one Pokemon a house (POK-379). Two players at him at
 *  once both found him standing and both traded, so a ROM asks first, with a PICKUP of
 *  his claim key, and the host answers: the first ask for one still standing with his own
 *  PICKUP naming the asker -- the trade, for the whole room -- and any later one with
 *  that PICKUP naming whoever got him, which the asker's ROM takes as no (br_event.c's
 *  Task_TradeClaim, br_loot.c's Task_HomeClaim). Everything the host hears goes through
 *  `note` first, so a trade nobody asked for (a bot's, or a ROM that heard no answer in
 *  time) is the one a later ask is told about. Somebody at home is standing until a
 *  PICKUP says otherwise: the page has no books on houses. */
export class TraderClaims {
  /** Who got each, by his own key. */
  private readonly won = new Map<number, number>();

  /** `standing(n)`: the room's books still have event n's trader. `onGround(key)`: the
   *  room's loot still has that piece. */
  constructor(
    private readonly standing: (n: number) => boolean,
    private readonly onGround: (key: number) => boolean = () => false,
  ) {}

  note(msg: Msg): void {
    if (msg.t === 'start') this.won.clear();
    if (msg.t !== 'pickup') return;
    // His key naming a Pokemon: the trade is done and he holds it now, free for the next
    // ask (Cam's 2026-10-19 play-test, #9).
    if (msg.item !== undefined && (traderOf(msg.key) !== undefined || isHomeKey(msg.key))) {
      this.won.delete(msg.key);
      return;
    }
    if (this.won.has(msg.key)) return;
    if (traderOf(msg.key) !== undefined || isHomeKey(msg.key)) this.won.set(msg.key, msg.seat);
  }

  /** The answer to an ask, and whether it is the trade itself (for the whole room) or a
   *  no (for the asker alone). Null for anything but an ask. Every ask is answered: one
   *  left to time out would trade on its own, which is the double trade again. One gone
   *  with nobody known to have got him (a host that took over after) is a no naming some
   *  other seat, which is all the asker's ROM reads. */
  answer(msg: Msg): { reply: PickupMsg; granted: boolean } | null {
    if (msg.t !== 'pickup' || msg.item !== undefined) return null;
    // A legendary (POK-410) is the one a battle took off the ground, not the one somebody
    // got for good: a lost fight puts it back, and the next ask for it is a yes again.
    const legend = legendClaimOf(msg.key);
    if (legend !== undefined) {
      const granted = this.onGround(legend);
      // A no names some other seat, which is all the asker's ROM reads.
      return { reply: { t: 'pickup', seat: granted ? msg.seat : msg.seat === 0 ? 1 : 0, key: legend }, granted };
    }
    const n = claimOf(msg.key);
    const house = homeClaimOf(msg.key);
    let key: number;
    let standing: boolean;
    if (n !== undefined) [key, standing] = [traderKey(n), this.standing(n)];
    else if (house !== undefined) [key, standing] = [homeKey(house), true];
    else return null;
    let winner = this.won.get(key);
    const granted = winner === undefined && standing;
    if (granted) this.won.set(key, (winner = msg.seat));
    winner ??= msg.seat === 0 ? 1 : 0;
    return { reply: { t: 'pickup', seat: winner, key }, granted };
  }
}

/** The events so far, by n, as a late joiner is handed them: an EVENT is booked, and its
 *  trader holds whatever he was last given (Cam's 2026-10-19 play-test, #9), which the
 *  PICKUP of his key naming it says. A bare one is the host's yes to an ask: he is busy
 *  with that trade, not gone, and its own PICKUP follows. */
export function noteEvent(events: Map<number, EventMsg>, msg: Msg): void {
  if (msg.t === 'event') events.set(msg.n, msg);
  if (msg.t !== 'pickup' || msg.item === undefined) return;
  const traded = traderOf(msg.key);
  const withTrader = traded === undefined ? undefined : events.get(traded);
  if (withTrader?.trader) events.set(withTrader.n, { ...withTrader, trader: { ...withTrader.trader, species: msg.item } });
}

/** The event a ring phase drops, by the director's 0-based ring index, or undefined:
 *  every other ring from the first shrink, which is index 1. */
export function eventForRing(ringIndex: number): number | undefined {
  if (ringIndex < 1 || ringIndex % 2 === 0) return undefined;
  const n = (ringIndex - 1) / 2;
  return n < EVENT_MAX ? n : undefined;
}

// include/constants/species.h
const REGIROCK = 401;
const REGICE = 402;
const REGISTEEL = 403;
const KYOGRE = 404;
const GROUDON = 405;
const RAYQUAZA = 406;
const LATIAS = 407;
const LATIOS = 408;

/** Each event's legendary, one of these: the golems first, the weather trio's last word
 *  at the end. Jirachi and Deoxys are event Pokemon in Emerald and stay that way. */
export const LEGENDS: readonly (readonly number[])[] = [
  [REGIROCK, REGICE, REGISTEEL],
  [LATIAS, LATIOS],
  [KYOGRE, GROUDON],
  [RAYQUAZA],
];

/** The rares, two an event: the strong ones Hoenn hides or never has in the wild. */
export const RARES: readonly number[] = [
  147, // DRATINI
  246, // LARVITAR
  131, // LAPRAS
  123, // SCYTHER
  142, // AERODACTYL
  133, // EEVEE
  392, // RALTS
  395, // BAGON
  398, // BELDUM
  376, // ABSOL
  328, // FEEBAS
];
export const EVENT_RARES = 2;

// include/constants/items.h
const ITEM_MASTER_BALL = 1;
const ITEM_FULL_RESTORE = 19;
const ITEM_MAX_POTION = 20;
const ITEM_MAX_REVIVE = 25;
const ITEM_CHOICE_BAND = 186;
const ITEM_LEFTOVERS = 200;

/** `sGold` in src/br/br_balls.c: what a gold ball holds, and so what the ROM draws gold. */
export const GOLD: readonly number[] = [
  301, 302, 303, 310, 312, 313, 314, 317, 318, 323, 326, // TM13 14 15 22 24 25 26 29 30 35 38
  ITEM_MASTER_BALL,
  ITEM_LEFTOVERS,
  ITEM_CHOICE_BAND,
];
export const EVENT_GOLD = 3;

/** The one bag of supplies beside them: healing only (Cam, 2026-10-13: no RARE CANDY,
 *  which would lift a mon past the ring's rung). */
export const SUPPLIES: readonly { id: number; n: number }[] = [
  { id: ITEM_FULL_RESTORE, n: 2 },
  { id: ITEM_MAX_REVIVE, n: 2 },
  { id: ITEM_MAX_POTION, n: 3 },
];

/** The legendary, the rares, the gold balls and the bag: seven, under the eight the ROM
 *  keeps on a map, so one fallen trainer's bag can still lie beside them. */
export const EVENT_PIECES = 1 + EVENT_RARES + EVENT_GOLD + 1;
/** The pieces and the trader: the cells an event wants. */
export const EVENT_CELLS = EVENT_PIECES + 1;

/** Some of `pool`, `n` of them, none twice. */
export function draw<T>(rng: () => number, pool: readonly T[], n: number): T[] {
  const left = [...pool];
  const out: T[] = [];
  while (out.length < n && left.length > 0) out.push(left.splice(pickIndex(rng, left.length), 1)[0]);
  return out;
}

export interface EventDrop {
  /** Event `n` (0-based), as the director counts them. */
  n: number;
  /** The ring phase it drops on (1-based, the wire's), which is its level. */
  phase: number;
  seat: number;
  mapsec: number;
  place?: string;
  map: MapRef;
  /** Where the pieces lie, best first, in the page's space (landing.json's): the first is
   *  the legendary's, and the one past the pieces (EVENT_CELLS) the trader's. Fewer drops
   *  fewer, the trader first to go and then the supplies. */
  cells: { x: number; y: number; map?: MapRef }[];
}

/** An event, as the messages that put it on the ground: the `event` first, then the
 *  `spill`s -- six mons and one bag a spill, so the gold balls and the supplies, each a
 *  bag, take one each. A bag of one item is drawn as a ball (br_loot.c), gold by its
 *  item (br_balls.c). */
export function eventDrop(rng: () => number, e: EventDrop): Msg[] {
  const legends = LEGENDS[Math.min(e.n, LEGENDS.length - 1)];
  const rares = draw(rng, RARES, EVENT_RARES);
  const species = [legends[pickIndex(rng, legends.length)], ...rares];
  const bags = draw(rng, GOLD, EVENT_GOLD).map((id) => [{ id, n: 1 }]);
  return layEvent(rng, e, species, bags);
}

/** What an event puts down, in `e.cells` order: the mons, then the bags, then the
 *  supplies, then the trader with a rare none of the mons is. The first piece's key is
 *  the one the MAP mark goes gray on. */
export function layEvent(
  rng: () => number,
  e: EventDrop,
  species: readonly number[],
  bags: readonly { id: number; n: number }[][],
): Msg[] {
  const level = rungForPhase(e.phase);
  const at = (i: number) => ({ x: e.cells[i].x + MAP_OFFSET, y: e.cells[i].y + MAP_OFFSET });
  // A story can lie on more than one map (STERN's harbour and the ship); a cell with no
  // map of its own is on the event's.
  const mapOf = (i: number) => e.cells[i].map ?? e.map;
  const same = (a: MapRef, b: MapRef) => a.group === b.group && a.num === b.num;
  const all = [...bags, SUPPLIES.map((s) => ({ ...s }))];
  const pieces = species.length + all.length;

  let i = 0;
  const mons: { map: MapRef; mon: SpillMon }[] = [];
  for (const s of species) {
    if (i >= e.cells.length) break;
    mons.push({ map: mapOf(i), mon: { key: eventKey(e.n, i), ...at(i), species: s, level } });
    i++;
  }
  const event: EventMsg = { t: 'event', seat: e.seat, n: e.n, mapsec: e.mapsec, key: eventKey(e.n, 0) };
  if (e.place !== undefined) event.place = e.place;
  const offers = RARES.filter((r) => !species.includes(r));
  if (e.cells.length > pieces && offers.length > 0) {
    const trader: EventTrader = { map: mapOf(pieces), ...at(pieces), species: offers[pickIndex(rng, offers.length)] };
    event.trader = trader;
  }
  const spills: SpillMsg[] = [];
  for (const items of all) {
    if (i >= e.cells.length) break;
    const bag: SpillBag = { key: eventKey(e.n, i), ...at(i), items, money: 0 };
    spills.push({ t: 'spill', seat: e.seat, map: mapOf(i), mons: [], bag });
    i++;
  }
  // The mons ride the first bag's spill on their map, or one of their own.
  for (const { map, mon } of mons) {
    let spill = spills.find((s) => same(s.map, map));
    if (!spill) {
      spill = { t: 'spill', seat: e.seat, map, mons: [] };
      spills.push(spill);
    }
    spill.mons.push(mon);
  }
  return [event, ...spills];
}

/** The cells of `pool` on `from`'s map nearest it, `n` of them, none `taken`, `from`
 *  first; within eight tiles, so an event is one cluster and not a trail across a route
 *  -- on open ground the seven are all within three. None on `from`'s four sides: the
 *  legendary stands there, and its own pieces round it boxed it in as the trees had
 *  (HBR-41, PR #127 review). */
export function clusterCells(
  pool: readonly { map: MapRef; x: number; y: number }[],
  from: { map: MapRef; x: number; y: number },
  n: number,
  taken: (c: { map: MapRef; x: number; y: number }) => boolean,
): { x: number; y: number }[] {
  const d = (c: { x: number; y: number }) => Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
  const near = pool
    .filter((c) => c.map.group === from.map.group && c.map.num === from.map.num)
    .filter((c) => d(c) <= 8 && d(c) !== 1 && (d(c) === 0 || !taken(c)))
    .sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x)
    .filter((c, i, all) => i === 0 || c.x !== all[i - 1].x || c.y !== all[i - 1].y);
  return near.slice(0, n).map((c) => ({ x: c.x, y: c.y }));
}
