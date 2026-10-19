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
import { LEGENDS, RARES, draw, isEventKey, layEvent, type EventDrop } from './events';
import type { EventMsg, MapRef, Msg } from '../net/wire';

// include/constants/species.h
const LILEEP = 388;
const ANORITH = 390;
const BELDUM = 398;
const WYNAUT = 360;
const REGIROCK = 401;
const REGICE = 402;
const REGISTEEL = 403;
const KYOGRE = 404;
// A gate boss's team, trainer_parties.h's (parity.test.ts).
const ZUBAT = 41;
const GOLBAT = 42;
const CROBAT = 169;
const MIGHTYENA = 287;
const CARVANHA = 330;
const SHARPEDO = 331;
const CAMERUPT = 340;
const GROUDON = 405;
const RAYQUAZA = 406;
const CASTFORM = 385;
const LATIAS = 407;
const LATIOS = 408;
const DEOXYS = 410;
const MEW = 151;
const LUGIA = 249;
const HO_OH = 250;
/** The legendaries no cluster drops and a story can (Cam: "all legendaries and pokemon in
 *  the game are valid"): the ticker calls them legendaries too. */
const OTHER_LEGENDS: readonly number[] = [DEOXYS, MEW, LUGIA, HO_OH];

/** The islands the Lilycove ferry sails to (br_story.c, sIslands): include/constants/
 *  region_map_sections.h's numbers. Three are not on Hoenn's MAP, so the event carries
 *  the island's and the ROM marks it, and rings it, as the dock. */
const MAPSEC_SOUTHERN_ISLAND = 73;
const MAPSEC_BIRTH_ISLAND = 200;
const MAPSEC_FARAWAY_ISLAND = 201;
const MAPSEC_NAVEL_ROCK = 211;

// include/constants/items.h
const ITEM_FOCUS_BAND = 196;
const ITEM_SHELL_BELL = 219;
const ITEM_TM24 = 312; // THUNDERBOLT
const ITEM_TM47 = 335; // STEEL WING
const ITEM_DEEP_SEA_TOOTH = 192;
const ITEM_DEEP_SEA_SCALE = 193;
const ITEM_SCANNER = 278;
const ITEM_MASTER_BALL = 1;
const ITEM_METEORITE = 280;
const ITEM_SUN_STONE = 93;

/** How a REGI's chamber opens (br_story.c, sDoors): A at the wall, as Rock Smash would;
 *  A at the wall with a Flying-type in the party; or by itself once the ring has moved on
 *  a phase from the one its event dropped on. Not "knows FLY": the HMs are out of the
 *  match, so FLY is a move almost no player has (PR #30 review). */
export type StoryDoor = 'smash' | 'fly' | 'wait';
/** The three chambers are one layout, and its wall is on this row: a cell above it is
 *  behind the door. */
export const DOOR_Y = 20;

/** Every species with Flying as one of its types (gSpeciesInfo, ROM ids): who opens
 *  ANCIENT TOMB (br_story.c, HasFlier). parity.test.ts pins it to species_info.h. */
export const FLYING: ReadonlySet<number> = new Set([6, 12, 16, 17, 18, 21, 22, 41, 42, 83, 84, 85, 123, 130, 142, 144, 145, 146, 149, 163, 164, 165, 166, 169, 176, 177, 178, 187, 188, 189, 193, 198, 207, 225, 226, 227, 249, 250, 292, 302, 304, 305, 309, 310, 312, 358, 359, 369, 397, 406]);

/** How often an event that has a story in reach tells it rather than dropping the
 *  cluster, with its legendary (director.ts). */
export const STORY_CHANCE = 0.5;

/** How often a match centres its ring on a final story's section, which then holds that
 *  story for the last event (director.ts). SKY PILLAR's final ring takes in Route 131 and
 *  SOOTOPOLIS's Route 126, sea a bot can reach to fight in; the story itself it cannot. */
export const FINAL_CHANCE = 0.25;

export interface Story {
  id: string;
  /** What the ticker and the record say it is. */
  name: string;
  /** Its regionmap.json section: the ring has to reach it, and the MAP marks it. An
   *  island's is the dock, Lilycove, and `mapsec` is the island's own. */
  section: string;
  /** The EVENT's mapsec when it is not `section`'s: an island's, which is where the ferry
   *  sails (br_story.c). */
  mapsec?: number;
  /** Reached by the Lilycove ferry, which a bot never takes. */
  boat?: boolean;
  /** A final ring's story (the director's FINAL_CHANCE): a match may centre its ring on
   *  this story's section and hold it for the last event. */
  final?: boolean;
  /** Somewhere the bots' world does not go (a dive, a floor it has no way up to): a bot
   *  leaves it alone, as it does an island. */
  noBots?: boolean;
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
   *  index, the object the ROM draws there, and what he wants for it first: an item, or
   *  a fight (a gate: `trainer` is his opponents.h id). A gate's boss guards the rest of
   *  his story too, which waits until his piece is gone. */
  people?: readonly { at: number; gfx: string; wants?: number; trainer?: string; party?: readonly number[] }[];
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
  // The gates: the team's boss where Emerald stood him, holding what the team was after,
  // and handing it over when he falls (one fight, his own, on each ROM; whoever wins
  // first takes it from the room).
  {
    id: 'magma-hideout',
    name: 'MAGMA HIDEOUT',
    section: 'MAPSEC_MAGMA_HIDEOUT',
    map: 'MAP_MAGMA_HIDEOUT_4F',
    // GROUDON awake, and the MASTER BALL MAXIE would have caught it with.
    mons: [[GROUDON]],
    items: [[ITEM_MASTER_BALL]],
    cells: [{ x: 16, y: 21 }, { x: 15, y: 22 }, { x: 14, y: 22 }, { x: 13, y: 22 }],
    people: [{ at: 0, gfx: 'OBJ_EVENT_GFX_MAXIE', trainer: 'TRAINER_MAXIE_MAGMA_HIDEOUT', party: [MIGHTYENA, CROBAT, CAMERUPT] }],
  },
  {
    id: 'route128-kyogre',
    name: 'ROUTE 128 SHOAL',
    section: 'MAPSEC_ROUTE_128',
    map: 'MAP_ROUTE128',
    // KYOGRE, risen, with ARCHIE on the shoal where he watched it.
    mons: [[KYOGRE]],
    cells: [{ x: 37, y: 22 }, { x: 38, y: 22 }, { x: 36, y: 22 }],
    people: [{ at: 0, gfx: 'OBJ_EVENT_GFX_ARCHIE', trainer: 'TRAINER_ARCHIE', party: [MIGHTYENA, CROBAT, SHARPEDO] }],
  },
  {
    id: 'weather-institute',
    name: 'WEATHER INSTITUTE',
    section: 'MAPSEC_ROUTE_119',
    map: 'MAP_ROUTE119_WEATHER_INSTITUTE_2F',
    // The CASTFORM the scientists give for clearing TEAM AQUA out, in SHELLY's hands.
    mons: [[CASTFORM]],
    cells: [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 3, y: 6 }],
    people: [{ at: 0, gfx: 'OBJ_EVENT_GFX_AQUA_MEMBER_F', trainer: 'TRAINER_SHELLY_WEATHER_INSTITUTE', party: [CARVANHA, MIGHTYENA] }],
  },
  {
    id: 'aqua-hideout',
    name: 'AQUA HIDEOUT',
    section: 'MAPSEC_AQUA_HIDEOUT',
    map: 'MAP_AQUA_HIDEOUT_B2F',
    // The MASTER BALL from the hideout's last room, with MATT at the submarine's dock.
    items: [[ITEM_MASTER_BALL]],
    cells: [{ x: 23, y: 19 }, { x: 22, y: 19 }, { x: 24, y: 19 }],
    people: [{ at: 0, gfx: 'OBJ_EVENT_GFX_AQUA_MEMBER_M', trainer: 'TRAINER_MATT', party: [MIGHTYENA, GOLBAT] }],
  },
  {
    id: 'mt-chimney',
    name: 'MT. CHIMNEY',
    section: 'MAPSEC_MT_CHIMNEY',
    map: 'MAP_MT_CHIMNEY',
    // The METEORITE at the machine, plus two rares (the doc's row), MAXIE beside it.
    // He holds the stone (at: 2); the rares are his story's other pieces and open when he falls.
    rares: 2,
    items: [[ITEM_METEORITE]],
    cells: [{ x: 12, y: 6 }, { x: 11, y: 6 }, { x: 13, y: 6 }, { x: 13, y: 7 }, { x: 12, y: 7 }],
    people: [{ at: 2, gfx: 'OBJ_EVENT_GFX_MAXIE', trainer: 'TRAINER_MAXIE_MT_CHIMNEY', party: [MIGHTYENA, ZUBAT, CAMERUPT] }],
  },
  {
    id: 'space-center',
    name: 'SPACE CENTER',
    section: 'MAPSEC_MOSSDEEP_CITY',
    map: 'MAP_MOSSDEEP_CITY_SPACE_CENTER_2F',
    // The SUN STONE the center gives, plus two rares (the doc's row), MAXIE at the stairs.
    // He holds the stone (at: 2); the rares are his story's other pieces and open when he falls.
    rares: 2,
    items: [[ITEM_SUN_STONE]],
    cells: [{ x: 2, y: 9 }, { x: 3, y: 9 }, { x: 1, y: 9 }, { x: 1, y: 8 }, { x: 0, y: 8 }],
    people: [{ at: 2, gfx: 'OBJ_EVENT_GFX_MAXIE', trainer: 'TRAINER_MAXIE_MOSSDEEP', party: [MIGHTYENA, CROBAT, CAMERUPT] }],
  },
  // The islands. Lilycove's ferry sails to the one a live story is on (br_story.c), and
  // its own legendary is gone for the match: this is the only one there.
  {
    id: 'southern-island',
    name: 'SOUTHERN ISLAND',
    section: 'MAPSEC_LILYCOVE_CITY',
    mapsec: MAPSEC_SOUTHERN_ISLAND,
    map: 'MAP_SOUTHERN_ISLAND_INTERIOR',
    // The EON pair, one of them, before the stone.
    mons: [[LATIAS, LATIOS]],
    cells: [{ x: 13, y: 10 }, { x: 12, y: 10 }, { x: 14, y: 10 }],
    boat: true,
  },
  {
    id: 'birth-island',
    name: 'BIRTH ISLAND',
    section: 'MAPSEC_LILYCOVE_CITY',
    mapsec: MAPSEC_BIRTH_ISLAND,
    map: 'MAP_BIRTH_ISLAND_EXTERIOR',
    // DEOXYS where the triangle's last step would have put it.
    mons: [[DEOXYS]],
    cells: [{ x: 15, y: 10 }, { x: 14, y: 11 }, { x: 16, y: 11 }],
    boat: true,
  },
  {
    id: 'faraway-island',
    name: 'FARAWAY ISLAND',
    section: 'MAPSEC_LILYCOVE_CITY',
    mapsec: MAPSEC_FARAWAY_ISLAND,
    map: 'MAP_FARAWAY_ISLAND_INTERIOR',
    // MEW in the island's long grass.
    mons: [[MEW]],
    cells: [{ x: 13, y: 12 }, { x: 12, y: 13 }, { x: 14, y: 13 }],
    boat: true,
  },
  {
    id: 'navel-rock-top',
    name: 'NAVEL ROCK PEAK',
    section: 'MAPSEC_LILYCOVE_CITY',
    mapsec: MAPSEC_NAVEL_ROCK,
    map: 'MAP_NAVEL_ROCK_TOP',
    // HO-OH at the summit, at the top of the last climb.
    mons: [[HO_OH]],
    cells: [{ x: 12, y: 9 }, { x: 11, y: 16 }, { x: 13, y: 16 }],
    boat: true,
  },
  {
    id: 'navel-rock-bottom',
    name: 'NAVEL ROCK',
    section: 'MAPSEC_LILYCOVE_CITY',
    mapsec: MAPSEC_NAVEL_ROCK,
    map: 'MAP_NAVEL_ROCK_BOTTOM',
    // LUGIA in the hollow at the foot of the rock.
    mons: [[LUGIA]],
    cells: [{ x: 11, y: 13 }, { x: 10, y: 12 }, { x: 12, y: 12 }],
    boat: true,
  },
  // The final rings. RAYQUAZA at the top of SKY PILLAR, where it sleeps, its own gone for
  // the match and the door already open (br_boot.c), and the clean pillar the match plays
  // is the one the bots' world has, so they climb it; SOOTOPOLIS's clash, KYOGRE or
  // GROUDON at the CAVE OF ORIGIN's mouth, and the city in KYOGRE's rain or GROUDON's
  // drought while it is there, the seed's pick (br_story.c), so a fight in it starts in it.
  {
    id: 'sky-pillar',
    name: 'SKY PILLAR',
    section: 'MAPSEC_SKY_PILLAR',
    map: 'MAP_SKY_PILLAR_TOP',
    mons: [[RAYQUAZA]],
    cells: [{ x: 14, y: 5 }, { x: 13, y: 6 }, { x: 15, y: 6 }],
    final: true,
  },
  {
    id: 'sootopolis',
    name: 'SOOTOPOLIS CITY',
    section: 'MAPSEC_SOOTOPOLIS_CITY',
    map: 'MAP_SOOTOPOLIS_CITY',
    mons: [[KYOGRE, GROUDON]],
    cells: [{ x: 31, y: 34 }, { x: 30, y: 35 }, { x: 32, y: 35 }],
    final: true,
    noBots: true,
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
    if (s.name !== e.place || (s.mapsec ?? sections[s.section]?.num) !== e.mapsec) return false;
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
 *  here: behind a REGI's wall until the bot could open it, a person's until it has what
 *  he wants, and a gate's until its boss's piece is gone. `phase` is the ring's (the wire's, 1-based). */
export function storySealed(
  piece: { key: number; mapId: string; x: number; y: number },
  bot: { flies: boolean; has: (item: number) => boolean; phase: number; onGround: (key: number) => boolean },
): boolean {
  if (!isEventKey(piece.key)) return false;
  for (const story of STORIES) {
    const cells = story.cells.map((c) => ({ ...c, map: c.map ?? story.map }));
    const i = cells.findIndex((c) => c.map === piece.mapId && c.x === piece.x && c.y === piece.y);
    if (i < 0) continue;
    if (story.boat || story.noBots) return true; // a bot never takes the ferry, or dives
    const wants = story.people?.find((p) => p.at === i)?.wants;
    if (wants !== undefined && !bot.has(wants)) return true;
    // A gate's boss's own piece is open: the bot fights him for it (storyGuard). The rest
    // of his story waits on his piece, as it does in the ROM (GuardOf).
    const boss = story.people?.find((p) => p.trainer !== undefined);
    if (boss && boss.at !== i && bot.onGround((piece.key & 0xfff0) | boss.at)) return true;
    if (story.door && piece.y < DOOR_Y) {
      if (story.door === 'fly' && !bot.flies) return true;
      if (story.door === 'wait' && bot.phase <= phaseOf(piece.key)) return true;
    }
    return false;
  }
  return false;
}

/** The team a gate's boss fights with when a bot steps up to his piece, as species, or
 *  undefined for any other piece. A player fights him in the ROM and a loss puts them out
 *  (src/overworld.c); a bot has no ROM, so bots/brain.ts settles it with duel(). */
export function storyGuard(piece: { key: number; mapId: string; x: number; y: number }): readonly number[] | undefined {
  if (!isEventKey(piece.key)) return undefined;
  for (const story of STORIES) {
    const boss = story.people?.find((p) => p.party !== undefined);
    if (!boss) continue;
    const cell = story.cells[boss.at];
    if ((cell.map ?? story.map) === piece.mapId && cell.x === piece.x && cell.y === piece.y) return boss.party;
  }
  return undefined;
}

/** Does this piece stand as one of a story's people (STEVEN, STERN, a gate's boss)? The
 *  ROM's BrStory_Person: a person is solid, whatever he would say. */
export function storyPerson(piece: { key: number; mapId: string; x: number; y: number }): boolean {
  if (!isEventKey(piece.key)) return false;
  return STORIES.some((story) =>
    (story.people ?? []).some((p) => {
      const cell = story.cells[p.at];
      return (cell.map ?? story.map) === piece.mapId && cell.x === piece.x && cell.y === piece.y;
    }),
  );
}

/** Does the story give a legendary? What the ticker calls it. */
export function storyLegend(story: Story): boolean {
  const legends = new Set([...LEGENDS.flat(), ...OTHER_LEGENDS]);
  return (story.mons ?? []).some((pick) => pick.some((sp) => legends.has(sp)));
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
