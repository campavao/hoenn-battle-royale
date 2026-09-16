import { describe, expect, it } from 'vitest';
import { Bots, canFly } from './brain';
import { World, type WorldMap } from './world';
import { dealParty, MOVE_FLY } from './party';
import { mulberry32 } from '../match/clock';
import type { Msg, PackedMon } from '../net/wire';

// POK-267: a bird dealt FLY leaves the fog the way a player would, rather than walking
// out of it. Two maps, neither connected to the other -- so walking is impossible and
// anything that gets the bot across is the flight.
const maps: WorldMap[] = [
  { id: 'FOGGED', group: 0, num: 1, w: 5, h: 5, section: 'A', outdoor: true, grid: '25x0', seams: [], warps: [], centre: null },
  { id: 'SAFE', group: 0, num: 2, w: 5, h: 5, section: 'B', outdoor: true, grid: '25x0', seams: [], warps: [], centre: null },
] as unknown as WorldMap[];

function run(party: PackedMon[]) {
  const sent: Msg[] = [];
  const bots = new Bots({
    world: new World(maps),
    targets: [{ mapId: 'SAFE', x: 2, y: 2 }],
    mapRef: (id) => (id === 'SAFE' ? { group: 0, num: 2 } : { group: 0, num: 1 }),
    send: (m) => sent.push(m),
    rng: mulberry32(7),
    inside: (id) => id === 'SAFE',
    deal: () => party,
    seed: 7,
  });
  bots.start([{ seat: 31, grade: 1, name: 'BIRD', skin: 0, map: { group: 0, num: 1 }, mapId: 'FOGGED', x: 1, y: 1 }], 0);
  bots.tick(1000);
  return { bots, sent };
}

const withFly: PackedMon[] = [
  { species: 296, level: 30, hp: 40, maxHp: 40, status: 0, moves: [{ id: MOVE_FLY, pp: 15, ppUps: 0 }], heldItem: 0, otId: 0, personality: 1, exp: 0, nickname: 'TAILLOW', ot: 'BR' },
];
const withoutFly: PackedMon[] = [{ ...withFly[0], moves: [{ id: 33, pp: 35, ppUps: 0 }] }];

describe('a bird in the fog flies out of it (POK-267)', () => {
  it('knows whether it can', () => {
    expect(canFly(withFly)).toBe(true);
    expect(canFly(withoutFly)).toBe(false);
  });

  it('lands inside the ring, on a map it could never have walked to', () => {
    const { bots } = run(withFly);
    expect(bots.spotOf(31)?.map).toBe('SAFE');
  });

  it('leaves a bot that cannot fly where it is', () => {
    const { bots } = run(withoutFly);
    expect(bots.spotOf(31)?.map).toBe('FOGGED');
  });

  it('is dealt to birds at the rung, and not before it', () => {
    let birds = 0;
    for (let seat = 16; seat < 32; seat++) if (canFly(dealParty(5, seat, 12))) birds++;
    expect(birds).toBeGreaterThan(0);
    for (let seat = 16; seat < 32; seat++) expect(canFly(dealParty(5, seat, 1))).toBe(false);
  });
});
