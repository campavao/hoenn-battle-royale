// What a bot is carrying (POK-237, the first slice).
//
// Dealt from the match seed like everything else about a bot, and levelled by the same
// ladder the player is: the ring phase IS the rung (POK-225), so a bot is never above
// or below the fight it is walking into.
//
// The rows are `PackedMon` -- the wire's own unencrypted 100 bytes, which is what the
// ROM already reads for a party. Nothing here builds a real `struct Pokemon`: the ROM
// does that when it needs one, and a page that knew how to encrypt a Gen 3 mon would be
// a second implementation of something the ROM already owns.
import { mulberry32, pickIndex } from '../match/clock';
import { Grade } from './roster';
import type { PackedMon } from '../net/wire';
import encounterData from '../data/encounters.json';

/** `tools/br/export-encounters.py`: every map's land table, species ids, the commonest
 *  first, plus the level-up evolutions. A bot on Route 119 should be carrying Route
 *  119's mons and they should grow up with the rung -- the ROM has had both tables all
 *  along, the page just could not see them. */
const EXPORTED = encounterData as unknown as {
  maps: Record<string, number[]>;
  evolve: Record<string, [number, number]>;
};
const ENCOUNTERS = EXPORTED.maps;

/** What this species turns into, and at what level. Undefined for something that does
 *  not grow up on levels alone. */
export function evolutionOf(species: number): { level: number; into: number } | undefined {
  const row = EXPORTED.evolve[String(species)];
  return row ? { level: row[0], into: row[1] } : undefined;
}

/** The species this one is at `level`, following the chain as far as it goes -- a
 *  Wurmple dealt at rung 30 is a Beautifly, not a Wurmple that has been alive a long
 *  time. */
export function grownUp(species: number, level: number): number {
  let at = species;
  for (let step = 0; step < 4; step++) {
    const evo = evolutionOf(at);
    if (!evo || level < evo.level) return at;
    at = evo.into;
  }
  return at;
}

/** `sLadder` in src/br/br_levels.c, indexed by ring phase. The one clock. */
export const LADDER = [5, 15, 30, 50, 75, 100];

export function rungForPhase(phase: number): number {
  const i = phase === 0 ? 0 : phase - 1;
  return LADDER[Math.min(i, LADDER.length - 1)];
}

/** The fallback pool, for a map with no land table of its own -- a town, a cave mouth,
 *  the inside of a Centre. Every one of these is somewhere in Hoenn's early routes, so
 *  a bot dealt from it still looks like it came from around here. */
export const MOVE_SURF = 57;
/** The rung a water mon has learned SURF by. Hoenn is half ocean and the drop is
 *  happy to put a trainer on Route 125 or Southern Island, which nothing without it
 *  ever leaves -- so this is a way off an island, not a convenience. */
const SURF_RUNG = 30;

const POOL: { species: number; name: string; moves: number[]; water?: true }[] = [
  { species: 277, name: 'TREECKO', moves: [1, 43] }, // POUND, LEER
  { species: 280, name: 'TORCHIC', moves: [10, 45] }, // SCRATCH, GROWL
  { species: 283, name: 'MUDKIP', moves: [33, 45], water: true }, // TACKLE, GROWL
  { species: 286, name: 'POOCHYENA', moves: [33, 43] },
  { species: 288, name: 'ZIGZAGOON', moves: [33, 39] }, // TACKLE, TAIL WHIP
  { species: 290, name: 'WURMPLE', moves: [33, 81] },
  { species: 296, name: 'TAILLOW', moves: [33, 45] },
  { species: 300, name: 'WINGULL', moves: [55, 39], water: true }, // WATER GUN
  { species: 304, name: 'RALTS', moves: [93, 45] }, // CONFUSION
  { species: 309, name: 'ARON', moves: [33, 106] },
  { species: 313, name: 'ELECTRIKE', moves: [33, 84] }, // THUNDER SHOCK
  { species: 325, name: 'MAKUHITA', moves: [4, 43] },
];

function hp(level: number): number {
  // Not the Gen 3 formula -- the ROM computes the real one when it builds the mon.
  // This is what a peek box and a wound bar show, and it wants to look like a mon.
  return Math.max(10, Math.floor(level * 2.2) + 10);
}

/** The names the wire carries are the page's; the ROM builds the real mon from the
 *  species id and nicknames it itself. A species we have no name for is shown by its
 *  number, which is honest rather than wrong. */
function nameOf(species: number): string {
  return POOL.find((p) => p.species === species)?.name ?? String(species);
}

/** What a trainer standing here would have caught. Empty for a map with no land table,
 *  which is the caller's cue to fall back to the pool. */
export function speciesAt(mapId: string): number[] {
  return ENCOUNTERS[mapId] ?? [];
}

function mon(level: number, rng: () => number, mapId?: string): PackedMon {
  const local = mapId ? speciesAt(mapId) : [];
  if (local.length > 0) {
    const species = grownUp(local[pickIndex(rng, local.length)], level);
    const max = hp(level);
    return {
      species,
      level,
      hp: max,
      maxHp: max,
      status: 0,
      // TACKLE. A real move set per species is the ROM's own learnset table, and
      // building one here would be a second implementation of what the ROM already
      // does when it makes the mon.
      moves: [{ id: 33, pp: 25, ppUps: 0 }],
      heldItem: 0,
      otId: 0,
      personality: Math.floor(rng() * 0xffff_ffff) >>> 0,
      exp: 0,
      nickname: nameOf(species),
      ot: 'BR',
    };
  }
  const pick = POOL[pickIndex(rng, POOL.length)];
  const species = grownUp(pick.species, level);
  const max = hp(level);
  const moves = [...pick.moves];
  if (pick.water && level >= SURF_RUNG && !moves.includes(MOVE_SURF)) moves.push(MOVE_SURF);
  return {
    species,
    level,
    hp: max,
    maxHp: max,
    status: 0,
    moves: moves.map((id) => ({ id, pp: 25, ppUps: 0 })),
    heldItem: 0,
    otId: 0,
    personality: Math.floor(rng() * 0xffff_ffff) >>> 0,
    exp: 0,
    nickname: species === pick.species ? pick.name : nameOf(species),
    ot: 'BR',
  };
}

/** A bot's team at a given ring phase: one at the drop, another every two rungs, up to
 *  Kanto's six. Dealt from the seed and the seat, so the same match always deals the
 *  same bot the same team -- including on a client that never ran the brain. */
export function dealParty(
  seed: number,
  seat: number,
  phase: number,
  mapId?: string,
  grade: Grade = Grade.Regular,
): PackedMon[] {
  const rng = mulberry32((seed ^ (seat * 0x9e37)) >>> 0);
  const level = rungForPhase(phase);
  // A grade is worth a Pokemon either way (POK-265). The rung is shared, so what
  // separates a rookie from an ace is how much of a team is standing behind the one in
  // front -- which is also what a player finds out by fighting it.
  const bring = grade === Grade.Ace ? 1 : grade === Grade.Rookie ? -1 : 0;
  const count = Math.max(1, Math.min(6, 1 + Math.floor(Math.max(0, phase - 1) / 2) + bring));
  const party: PackedMon[] = [];
  for (let i = 0; i < count; i++) party.push(mon(level, rng, mapId));
  return party;
}
