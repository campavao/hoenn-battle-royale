// Who the bots are (POK-236).
//
// Dealt from the match seed, never sent over the wire as bots: everyone in the room
// sees them as ordinary seats walking around, because that is all a ghost is. Kanto's
// rule, and it is the reason a bot needs no special case anywhere downstream -- the
// ROM, the roster, the engage and the spectator all treat a bot's seat like a player's.
//
// Seats count DOWN from the top. The relay hands human members ids counting up from 0,
// so the two can never meet until a room is full of both, which BR_MAX_SEATS already
// forbids.
import { mulberry32, pickIndex } from '../match/clock';
import type { MapRef } from '../net/wire';

/** include/br/br_config.h's BR_MAX_SEATS. */
export const MAX_SEATS = 32;

export interface Bot {
  seat: number;
  name: string;
  /** Index into the ROM's skin table (br_ghosts.c's sSkinGraphics). */
  skin: number;
  map: MapRef;
  /** world.json map id, which is what the pathfinder speaks. */
  mapId: string;
  x: number;
  y: number;
}

/** Ten characters is the ROM's name field, and these are read off a HUD at a glance. */
const NAMES = [
  'BRENDAN', 'MAY', 'WALLY', 'ROXANNE', 'BRAWLY', 'WATTSON', 'FLANNERY', 'NORMAN',
  'WINONA', 'TATE', 'LIZA', 'JUAN', 'SIDNEY', 'PHOEBE', 'GLACIA', 'DRAKE',
  'STEVEN', 'WALLACE', 'ARCHIE', 'MAXIE', 'COURTNEY', 'TABITHA', 'SHELLY', 'MATT',
  'RILEY', 'CAMERON', 'DEVON', 'BIRCH', 'LANETTE', 'BILL', 'SCOTT', 'GABBY',
];

export interface BotSpawn {
  mapId: string;
  map: MapRef;
  x: number;
  y: number;
}

/** Deals `count` bots onto the given cells. The same seed and the same taken seats
 *  always deal the same bots, which is what lets a rejoining client draw the same
 *  lobby without anybody sending it one. */
export function dealBots(seed: number, count: number, takenSeats: number[], spawns: BotSpawn[]): Bot[] {
  const rng = mulberry32(seed ^ 0x8b07);
  const taken = new Set(takenSeats);
  const names = [...NAMES];
  const bots: Bot[] = [];
  let seat = MAX_SEATS - 1;

  for (let i = 0; i < count && spawns.length > 0; i++) {
    while (seat >= 0 && taken.has(seat)) seat--;
    if (seat < 0) break; // the room is full of people, which is a good problem
    taken.add(seat);
    const name = names.length > 0 ? names.splice(pickIndex(rng, names.length), 1)[0] : `BOT${seat}`;
    const spawn = spawns[pickIndex(rng, spawns.length)];
    bots.push({
      seat,
      name,
      skin: pickIndex(rng, 4),
      map: spawn.map,
      mapId: spawn.mapId,
      x: spawn.x,
      y: spawn.y,
    });
    seat--;
  }
  return bots;
}
