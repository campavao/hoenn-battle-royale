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
// had yet is inside the next ring (or, when none is, this one), half the time, and today's
// cluster otherwise. The last event is the final ring's: a story takes it only in the
// ring's own section.
import { pickIndex } from './clock';
import { MAP_OFFSET } from '../net/cells';
import { RARES, draw, isEventKey, layEvent, type EventDrop } from './events';
import type { EventMsg, MapRef, Msg } from '../net/wire';

// include/constants/species.h
const LILEEP = 388;
const ANORITH = 390;
const BELDUM = 398;
const WYNAUT = 360;
const REGIROCK = 401;
const REGICE = 402;
const REGISTEEL = 403;

// include/constants/items.h
const ITEM_FOCUS_BAND = 196;
const ITEM_SHELL_BELL = 219;
const ITEM_TM24 = 312; // THUNDERBOLT
const ITEM_TM47 = 335; // STEEL WING
const ITEM_DEEP_SEA_TOOTH = 192;
const ITEM_DEEP_SEA_SCALE = 193;
const ITEM_SCANNER = 278;

/** How a REGI's chamber opens (br_story.c, sDoors): A at the wall, as Rock Smash would;
 *  A at the wall with a mon that knows FLY; or by itself once the ring has moved on a
 *  phase from the one its event dropped on. */
export type StoryDoor = 'smash' | 'fly' | 'wait';
/** The three chambers are one layout, and its wall is on this row: a cell above it is
 *  behind the door. */
export const DOOR_Y = 20;

/** How often an event that has a story in reach tells it rather than dropping the
 *  cluster, with its legendary (director.ts). */
export const STORY_CHANCE = 0.5;

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
  /** The items it gives, one ball each: one item out of each list. */
  items?: readonly (readonly number[])[];
  /** Rares from events.ts's pool beside its own reward. */
  rares?: number;
  /** Where the pieces lie, map coords: the mons, the rares, the items, then the supplies
   *  and the trader. A cell with a `map` of its own is on that map rather than the
   *  story's (STERN's harbour, a sea away from his ship). story.test.ts walks to every one. */
  cells: readonly { x: number; y: number; map?: string }[];
  /** The REGI chamber's door, which every cell behind it waits on. */
  door?: StoryDoor;
  /** The pieces a person hands over rather than a ball (br_story.c, sPeople): the cell's
   *  index, the object the ROM draws there, and what he wants for it first. */
  people?: readonly { at: number; gfx: string; wants?: number }[];
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
    items: [[ITEM_TM24]],
    cells: [{ x: 32, y: 35 }, { x: 31, y: 35 }, { x: 33, y: 35 }],
  },
  {
    id: 'shoal-cave',
    name: 'SHOAL CAVE',
    section: 'MAPSEC_SHOAL_CAVE',
    map: 'MAP_SHOAL_CAVE_LOW_TIDE_LOWER_ROOM',
    // The BLACK BELT's FOCUS BAND where he stands, and the bell the shells and salt make.
    items: [[ITEM_FOCUS_BAND], [ITEM_SHELL_BELL]],
    cells: [{ x: 11, y: 4 }, { x: 12, y: 4 }, { x: 10, y: 4 }, { x: 11, y: 5 }],
  },
  // The three golems in their chambers, where their own sat, the supplies and the trader
  // outside the wall for whoever cannot open it.
  {
    id: 'desert-ruins',
    name: 'DESERT RUINS',
    section: 'MAPSEC_DESERT_RUINS',
    map: 'MAP_DESERT_RUINS',
    mons: [[REGIROCK]],
    cells: [{ x: 8, y: 7 }, { x: 7, y: 22 }, { x: 9, y: 22 }],
    door: 'smash',
  },
  {
    id: 'island-cave',
    name: 'ISLAND CAVE',
    section: 'MAPSEC_ISLAND_CAVE',
    map: 'MAP_ISLAND_CAVE',
    mons: [[REGICE]],
    cells: [{ x: 8, y: 7 }, { x: 7, y: 22 }, { x: 9, y: 22 }],
    door: 'wait',
  },
  {
    id: 'ancient-tomb',
    name: 'ANCIENT TOMB',
    section: 'MAPSEC_ANCIENT_TOMB',
    map: 'MAP_ANCIENT_TOMB',
    mons: [[REGISTEEL]],
    cells: [{ x: 8, y: 7 }, { x: 7, y: 22 }, { x: 9, y: 22 }],
    door: 'fly',
  },
  {
    id: 'granite-cave',
    name: 'GRANITE CAVE',
    section: 'MAPSEC_GRANITE_CAVE',
    map: 'MAP_GRANITE_CAVE_STEVENS_ROOM',
    // Steven and the TM he gives for the letter, where he stands.
    items: [[ITEM_TM47]],
    cells: [{ x: 7, y: 8 }, { x: 5, y: 7 }, { x: 9, y: 7 }],
    people: [{ at: 0, gfx: 'OBJ_EVENT_GFX_STEVEN' }],
  },
  {
    id: 'lavaridge-egg',
    name: 'LAVARIDGE TOWN',
    section: 'MAPSEC_LAVARIDGE_TOWN',
    map: 'MAP_LAVARIDGE_TOWN',
    // The egg woman's WYNAUT, hatched, at her feet: she has no flag to stand her down,
    // so she is her own self above it.
    mons: [[WYNAUT]],
    cells: [{ x: 4, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 9 }],
  },
  {
    id: 'abandoned-ship',
    name: 'ABANDONED SHIP',
    section: 'MAPSEC_ABANDONED_SHIP',
    map: 'MAP_ABANDONED_SHIP_CAPTAINS_OFFICE',
    // The SCANNER in the captain's office, and CAPTAIN STERN at his harbour, who gives a
    // DEEP SEA TOOTH or SCALE for it.
    items: [[ITEM_DEEP_SEA_TOOTH, ITEM_DEEP_SEA_SCALE], [ITEM_SCANNER]],
    cells: [{ x: 6, y: 13, map: 'MAP_SLATEPORT_CITY_HARBOR' }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }],
    people: [{ at: 0, gfx: 'OBJ_EVENT_GFX_SCIENTIST_1', wants: ITEM_SCANNER }],
  },
];

/** The story an `event` told, or undefined for a cluster: its place and section, and its
 *  trader on its own cell. A host that takes over learns from these what was told. A
 *  cluster in a section whose name is a story's would need its trader on that cell too. */
export function storyOf(
  e: EventMsg,
  sections: Record<string, { num?: number }>,
  refOf: (mapId: string) => MapRef | undefined,
): Story | undefined {
  return STORIES.find((s) => {
    if (s.name !== e.place || sections[s.section]?.num !== e.mapsec) return false;
    if (!e.trader) return true;
    const at = s.cells[s.cells.length - 1];
    const map = refOf(at.map ?? s.map);
    return !!map && e.trader.map.group === map.group && e.trader.map.num === map.num && e.trader.x - MAP_OFFSET === at.x && e.trader.y - MAP_OFFSET === at.y;
  });
}

/** The phase event `n` dropped on, from one of its keys: event n drops on 2n + 2. */
const phaseOf = (key: number) => ((key >> 4) & 0xf) * 2 + 2;

/** Is this piece out of a bot's reach for now? A story's cells are walkable in the
 *  bots' grid, which knows nothing of a door or a person's terms, so the gate is asked
 *  here: behind a REGI's wall until the bot could open it, and a person's until it has
 *  what he wants. `phase` is the ring's (the wire's, 1-based). */
export function storySealed(
  piece: { key: number; mapId: string; x: number; y: number },
  bot: { flies: boolean; has: (item: number) => boolean; phase: number },
): boolean {
  if (!isEventKey(piece.key)) return false;
  for (const story of STORIES) {
    const cells = story.cells.map((c) => ({ ...c, map: c.map ?? story.map }));
    const i = cells.findIndex((c) => c.map === piece.mapId && c.x === piece.x && c.y === piece.y);
    if (i < 0) continue;
    const wants = story.people?.find((p) => p.at === i)?.wants;
    if (wants !== undefined && !bot.has(wants)) return true;
    if (story.door && piece.y < DOOR_Y) {
      if (story.door === 'fly' && !bot.flies) return true;
      if (story.door === 'wait' && bot.phase <= phaseOf(piece.key)) return true;
    }
    return false;
  }
  return false;
}

/** The story's cells as an event's: a cell's own map named by its ref. */
export function storyCells(story: Story, ref: (mapId: string) => MapRef): EventDrop['cells'] {
  return story.cells.map((c) => (c.map ? { x: c.x, y: c.y, map: ref(c.map) } : { x: c.x, y: c.y }));
}

/** The story, as the messages that put it down: `e.cells` are the story's own. */
export function storyDrop(rng: () => number, story: Story, e: EventDrop): Msg[] {
  const species = (story.mons ?? []).map((pick) => pick[pickIndex(rng, pick.length)]);
  species.push(...draw(rng, RARES, story.rares ?? 0));
  const bags = (story.items ?? []).map((pick) => [{ id: pick[pickIndex(rng, pick.length)], n: 1 }]);
  return layEvent(rng, e, species, bags);
}
