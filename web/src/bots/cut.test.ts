import { describe, expect, it } from 'vitest';
import { World, type WorldMap } from './world';
import { findPath } from './path';
import { canCut, canSurf } from './brain';
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
    // canCut() answers TRUE for any contestant -- they all boot with the HMs (POK-256)
    // -- so what is worth checking is the move actually being on the team, which is
    // what a bot uses in a fight.
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
    // Either way a contestant can open a tree, because the bag says so.
    expect(canCut(dealParty(99, 31, 1))).toBe(true);
  });
});
