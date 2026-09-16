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
import type { PackedMon } from '../net/wire';

/** `sLadder` in src/br/br_levels.c, indexed by ring phase. The one clock. */
export const LADDER = [5, 15, 30, 50, 75, 100];

export function rungForPhase(phase: number): number {
  const i = phase === 0 ? 0 : phase - 1;
  return LADDER[Math.min(i, LADDER.length - 1)];
}

/** A curated Hoenn pool, standing in for the exported encounter tables. Chosen to be
 *  the sort of thing a trainer walking Hoenn's routes would actually have -- the real
 *  per-map tables are the rest of POK-237. */
const POOL: { species: number; name: string; moves: number[] }[] = [
  { species: 277, name: 'TREECKO', moves: [1, 43] }, // POUND, LEER
  { species: 280, name: 'TORCHIC', moves: [10, 45] }, // SCRATCH, GROWL
  { species: 283, name: 'MUDKIP', moves: [33, 45] }, // TACKLE, GROWL
  { species: 286, name: 'POOCHYENA', moves: [33, 43] },
  { species: 288, name: 'ZIGZAGOON', moves: [33, 39] }, // TACKLE, TAIL WHIP
  { species: 290, name: 'WURMPLE', moves: [33, 81] },
  { species: 296, name: 'TAILLOW', moves: [33, 45] },
  { species: 300, name: 'WINGULL', moves: [55, 39] }, // WATER GUN
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

function mon(level: number, rng: () => number): PackedMon {
  const pick = POOL[pickIndex(rng, POOL.length)];
  const max = hp(level);
  return {
    species: pick.species,
    level,
    hp: max,
    maxHp: max,
    status: 0,
    moves: pick.moves.map((id) => ({ id, pp: 25, ppUps: 0 })),
    heldItem: 0,
    otId: 0,
    personality: Math.floor(rng() * 0xffff_ffff) >>> 0,
    exp: 0,
    nickname: pick.name,
    ot: 'BR',
  };
}

/** A bot's team at a given ring phase: one at the drop, another every two rungs, up to
 *  Kanto's six. Dealt from the seed and the seat, so the same match always deals the
 *  same bot the same team -- including on a client that never ran the brain. */
export function dealParty(seed: number, seat: number, phase: number): PackedMon[] {
  const rng = mulberry32((seed ^ (seat * 0x9e37)) >>> 0);
  const level = rungForPhase(phase);
  const count = Math.min(6, 1 + Math.floor(Math.max(0, phase - 1) / 2));
  const party: PackedMon[] = [];
  for (let i = 0; i < count; i++) party.push(mon(level, rng));
  return party;
}
