import { describe, expect, it } from 'vitest';
import { FIELD_CUT, FIELD_STRENGTH, World, type WorldMap } from './world';
import { findPath } from './path';
import { canCut, canSurf, fieldMoves } from './brain';
import { dealParty } from './party';

// A one-map world with a tree across the only corridor: the top row is open, the middle
// row is wall except for the tree at (2,1), so (2,0) -> (2,2) is only possible by
// cutting. Written as an RLE grid the way world.json stores one.
const maps: WorldMap[] = [
  {
    id: 'TEST', group: 0, num: 0, w: 5, h: 3, section: 'TEST', outdoor: true,
    grid: '5x0;2x1;1x9;2x1;5x0', seams: [], warps: [], centre: null,
  } as unknown as WorldMap,
];

describe('a tree is a tree until somebody can cut it (POK-267)', () => {
  const world = new World(maps);

  it('is not standable without CUT, and is with it', () => {
    expect(world.standable('TEST', 2, 1)).toBe(false);
    expect(world.standable('TEST', 2, 1, false, true)).toBe(true);
  });

  it('blocks the only route through, until it does not', () => {
    const from = { map: 'TEST', x: 2, y: 0 };
    const to = { map: 'TEST', x: 2, y: 2 };
    expect(findPath(world, from, to, 500, false, false).found).toBe(false);
    expect(findPath(world, from, to, 500, false, true).found).toBe(true);
  });

  it('deals CUT to land mons at the rung, and SURF to the water ones', () => {
    // The move on the team is what a bot uses in a fight; canCut() asks more (below).
    const carries = (party: ReturnType<typeof dealParty>, id: number) =>
      party.some((mon) => mon.moves.some((mv) => mv.id === id));
    let cutters = 0;
    let surfers = 0;
    for (let seat = 16; seat < 32; seat++) {
      const late = dealParty(99, seat, 9);
      if (carries(late, 15)) cutters++;
      if (carries(late, 57)) surfers++;
    }
    expect(cutters).toBeGreaterThan(0);
    expect(surfers).toBeGreaterThan(0);
    // And nobody has it at the bottom rung, where the ladder starts.
    expect(carries(dealParty(99, 31, 1), 15)).toBe(false);
  });

  it('lets a team past a tree or onto the water with somebody who could learn the HM (#7)', () => {
    const mon = (species: number, moves: number[] = [33]) => ({
      species, level: 5, hp: 20, maxHp: 20, status: 0, moves: moves.map((id) => ({ id, pp: 10, ppUps: 0 })),
      heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: '', ot: 'BR',
    });
    const TREECKO = 277;
    const MUDKIP = 283;
    const PIDGEY = 16;
    expect(canCut([mon(TREECKO)])).toBe(true);
    expect(canSurf([mon(TREECKO)])).toBe(false);
    expect(canSurf([mon(TREECKO), mon(MUDKIP)])).toBe(true);
    expect(canCut([mon(PIDGEY)])).toBe(false);
    expect(canSurf([mon(PIDGEY, [57])])).toBe(true); // knows it: a TM'd move counts too
  });
});

// #7: Strength boulders are back. The exporter marks the cell one starts on class 10, and
// a bot crosses it only with somebody who could push it. CUT alone is not enough.
describe('a boulder is in the way until somebody could push it (#7)', () => {
  const world = new World([
    { ...maps[0], id: 'ROCK', grid: '5x0;2x1;1x10;2x1;5x0' } as unknown as WorldMap,
  ]);
  const from = { map: 'ROCK', x: 2, y: 0 };
  const to = { map: 'ROCK', x: 2, y: 2 };

  it('blocks a team with CUT only, and lets one with STRENGTH by', () => {
    expect(world.standable('ROCK', 2, 1, false, FIELD_CUT)).toBe(false);
    expect(findPath(world, from, to, 500, false, FIELD_CUT).found).toBe(false);
    expect(findPath(world, from, to, 500, false, FIELD_STRENGTH).found).toBe(true);
    expect(findPath(world, from, to, 500, false, true).found).toBe(true);
  });

  it('asks the party whether anyone could learn STRENGTH', () => {
    const mon = (species: number) => ({
      species, level: 5, hp: 20, maxHp: 20, status: 0, moves: [{ id: 33, pp: 10, ppUps: 0 }],
      heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: '', ot: 'BR',
    });
    const MAKUHITA = 296;
    const MAGIKARP = 129;
    expect(fieldMoves([mon(MAGIKARP)])).toBe(0);
    expect(fieldMoves([mon(MAKUHITA)]) & FIELD_STRENGTH).toBe(FIELD_STRENGTH);
  });
});
