// Story events (Cam, 2026-10-13: "Let's explore all possible story events. They should all
// result in a legendary Pokemon I think, or at least a rare item"; and of the menu that came
// back, "I'm fine with what's in that doc and all legendaries and pokemon in the game are
// valid").
//
// A story event is an event (events.ts) set where Emerald set that beat: the fossils at the
// top of MIRAGE TOWER, Steven's BELDUM on his table. It drops the way every event does, as
// `spill`s under the event's keys, so the ROM draws it, picks it up and hands it over, a
// late joiner is caught up on it and the bots go for it. What it gives is its own reward,
// with the supplies bag and the trader beside it; it has no rares and no gold balls unless
// its row says so (Cam: "Maybe too much gold").
//
// The director drops one when a ring phase drops an event and a story the match has not
// had yet is inside the next ring, and today's cluster when none is.
import { pickIndex } from './clock';
import { RARES, layEvent, type EventDrop } from './events';
import type { Msg } from '../net/wire';

// include/constants/species.h
const LILEEP = 388;
const ANORITH = 390;
const BELDUM = 398;

// include/constants/items.h
const ITEM_FOCUS_BAND = 196;
const ITEM_SHELL_BELL = 219;
const ITEM_TM24 = 312; // THUNDERBOLT

export interface Story {
  id: string;
  /** What the ticker and the record say it is. */
  name: string;
  /** Its regionmap.json section: the ring has to reach it, and the MAP marks it. */
  section: string;
  /** Its world.json map: where every piece lies. */
  map: string;
  /** The mons it gives, one ball each: one species out of each list. */
  mons?: readonly (readonly number[])[];
  /** The items it gives, one ball each. */
  items?: readonly number[];
  /** Rares from events.ts's pool beside its own reward. */
  rares?: number;
  /** Where the pieces lie, map coords: the mons, the rares, the items, then the supplies
   *  and the trader. world.test.ts walks to every one. */
  cells: readonly { x: number; y: number }[];
}

export const STORIES: readonly Story[] = [
  {
    id: 'mirage-tower',
    name: 'MIRAGE TOWER',
    section: 'MAPSEC_MIRAGE_TOWER',
    map: 'MAP_MIRAGE_TOWER_4F',
    // The two fossils where the tower's own lie, each already the mon it would revive as.
    mons: [[LILEEP], [ANORITH]],
    cells: [{ x: 5, y: 4 }, { x: 7, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 5 }],
  },
  {
    id: 'stevens-house',
    name: "STEVEN'S HOUSE",
    section: 'MAPSEC_MOSSDEEP_CITY',
    map: 'MAP_MOSSDEEP_CITY_STEVENS_HOUSE',
    // The BELDUM he leaves, at the rung: METANG or METAGROSS late on.
    mons: [[BELDUM]],
    cells: [{ x: 4, y: 2 }, { x: 3, y: 3 }, { x: 5, y: 2 }],
  },
  {
    id: 'new-mauville',
    name: 'NEW MAUVILLE',
    section: 'MAPSEC_NEW_MAUVILLE',
    map: 'MAP_NEW_MAUVILLE_INSIDE',
    // Wattson's thanks for the generator. In the hall inside the door: the generator room
    // is behind the barriers, and a bot walks the layout's, which never open.
    items: [ITEM_TM24],
    cells: [{ x: 32, y: 35 }, { x: 31, y: 35 }, { x: 33, y: 35 }],
  },
  {
    id: 'shoal-cave',
    name: 'SHOAL CAVE',
    section: 'MAPSEC_SHOAL_CAVE',
    map: 'MAP_SHOAL_CAVE_LOW_TIDE_LOWER_ROOM',
    // The BLACK BELT's FOCUS BAND where he stands, and the bell the shells and salt make.
    items: [ITEM_FOCUS_BAND, ITEM_SHELL_BELL],
    cells: [{ x: 11, y: 4 }, { x: 12, y: 4 }, { x: 10, y: 4 }, { x: 11, y: 5 }],
  },
];

/** Some of `pool`, `n` of them, none twice. */
function draw(rng: () => number, pool: readonly number[], n: number): number[] {
  const left = [...pool];
  const out: number[] = [];
  while (out.length < n && left.length > 0) out.push(left.splice(pickIndex(rng, left.length), 1)[0]);
  return out;
}

/** The story, as the messages that put it down: `e.cells` are the story's own. */
export function storyDrop(rng: () => number, story: Story, e: EventDrop): Msg[] {
  const species = (story.mons ?? []).map((pick) => pick[pickIndex(rng, pick.length)]);
  species.push(...draw(rng, RARES, story.rares ?? 0));
  const bags = (story.items ?? []).map((id) => [{ id, n: 1 }]);
  return layEvent(rng, e, species, bags);
}
