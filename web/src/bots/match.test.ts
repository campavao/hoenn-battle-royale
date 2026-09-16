// POK-236's own acceptance test: thirty bots, sixteen simulated minutes, the real
// world graph and the real ring. Not a unit test of any one rule -- a check that the
// whole brain survives a match without breaking one of the three things a spectator
// would notice immediately.
import { describe, expect, it } from 'vitest';
import { Bots, STEP_MS } from './brain';
import { dealBots } from './roster';
import { dealParty } from './party';
import { World, sameSpot, type Spot, type WorldMap } from './world';
import { mulberry32 } from '../match/clock';
import { sectionInside } from '../match/ring';
import worldData from '../data/world.json';
import landingData from '../data/landing.json';
import regionData from '../data/regionmap.json';

const MAPS = (worldData as { maps: WorldMap[] }).maps;
const SECTIONS = (regionData as {
  sections: Record<string, { x: number; y: number; w: number; h: number }>;
}).sections;

// The ticket asks for thirty bots over sixteen minutes, which is ~115k bot-steps of
// A* across the whole of Hoenn and takes about seven minutes to run. That is a thing
// to run deliberately, not on every save, so the default is a quarter of it -- same
// rules, same world, same seed, small enough to live in the suite.
//
//   BR_FULL_MATCH=1 npx vitest run src/bots/match.test.ts
const FULL =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.BR_FULL_MATCH === '1';
const MINUTES = FULL ? 16 : 5;
const BOTS = FULL ? 30 : 12;
const SEED = 4242;

interface Run {
  world: World;
  bots: Bots;
  spots: Spot[][];
  seats: number[];
  sectionOf: Map<string, string>;
  ring: { sx: number; sy: number; r: number };
}

function match(): Run {
  const maps = MAPS;
  const world = new World(maps);
  const refById = new Map(maps.map((m) => [m.id, { group: m.group, num: m.num }]));
  const outdoor = new Set(maps.filter((m) => m.outdoor).map((m) => m.id));
  const sectionOf = new Map(maps.map((m) => [m.id, m.section]));
  const targets = (landingData as { map: string; x: number; y: number }[])
    .filter((c) => outdoor.has(c.map) && refById.has(c.map))
    .map((c) => ({ mapId: c.map, x: c.x, y: c.y }));

  // The fog closes on Littleroot's own section, the way the Director's does: a centre
  // and a radius that shrinks a rung at a time.
  let ring = { sx: 4, sy: 12, r: 12 };
  const bots = new Bots({
    world,
    targets,
    mapRef: (id) => refById.get(id),
    send: () => {},
    rng: mulberry32(SEED ^ 0x51ce),
    deal: (bot, phase) => dealParty(SEED, bot.seat, phase),
    centres: () => world.centres(),
    inside: (id) => sectionInside(SECTIONS[sectionOf.get(id) ?? ''], ring),
  });

  const spawns = targets.map((t) => ({ mapId: t.mapId, map: refById.get(t.mapId)!, x: t.x, y: t.y }));
  const dealt = dealBots(SEED, BOTS, [], spawns);
  bots.start(dealt, 0);

  const end = MINUTES * 60_000;
  const perPhase = end / 6;
  const spots: Spot[][] = [];
  let phase = 0;
  for (let t = STEP_MS; t <= end; t += STEP_MS) {
    const next = Math.floor(t / perPhase);
    if (next !== phase) {
      phase = next;
      ring = { ...ring, r: Math.max(1, 12 - phase * 2) };
      bots.ringMoved(phase);
    }
    bots.tick(t);
    spots.push(dealt.map((b) => bots.spotOf(b.seat)).filter((s): s is Spot => s !== undefined));
  }
  return { world, bots, spots, seats: dealt.map((b) => b.seat), sectionOf, ring };
}

const run = match();

describe('thirty bots, sixteen minutes', () => {
  it('never puts one on a cell nothing can stand on', () => {
    const bad: string[] = [];
    for (const tick of run.spots) {
      for (const at of tick) {
        // Surfing is allowed, so a water cell is only wrong if nothing may stand there
        // at all -- which is the wall class, and the void off the edge of a map.
        if (!run.world.standable(at.map, at.x, at.y, true)) bad.push(`${at.map} ${at.x},${at.y}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('never has two of them on the same tile', () => {
    const clashes: string[] = [];
    for (const tick of run.spots) {
      const seen = new Set<string>();
      for (const at of tick) {
        const key = `${at.map}:${at.x},${at.y}`;
        if (seen.has(key)) clashes.push(key);
        seen.add(key);
      }
    }
    expect(clashes.slice(0, 5)).toEqual([]);
  });

  it('never walks two of them through each other', () => {
    const swaps: string[] = [];
    for (let i = 1; i < run.spots.length; i++) {
      const before = run.spots[i - 1];
      const after = run.spots[i];
      for (let a = 0; a < before.length; a++) {
        for (let b = a + 1; b < before.length; b++) {
          if (sameSpot(before[a], after[b]) && sameSpot(before[b], after[a])) {
            swaps.push(`${before[a].map} ${before[a].x},${before[a].y}`);
          }
        }
      }
    }
    expect(swaps.slice(0, 5)).toEqual([]);
  });

  it('keeps most of them walking the whole match rather than parked', () => {
    // Not "everyone ends inside the ring" -- POK-251 is a drop that strands people,
    // and this test is about the brain, not about where it was put down. What it can
    // insist on is that a bot is still going somewhere at the end.
    const last = run.spots[run.spots.length - 1];
    const earlier = run.spots[run.spots.length - 60]; // fifteen seconds back
    const moving = last.filter((at, i) => earlier[i] && !sameSpot(at, earlier[i])).length;
    expect(moving).toBeGreaterThan(last.length / 2);
  });
});
