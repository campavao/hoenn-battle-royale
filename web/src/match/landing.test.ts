import { describe, expect, it, vi } from 'vitest';
import worldData from '../data/world.json';
import handData from '../data/landing-hand.json';
import { HOENN } from '../bots/hoenn';
import { DOORSTEPS, HAND, LANDING, LANDING_ALL, VETO } from './landing';
import { cellKey, handProblems, walksTo } from './hand';

// A hand-painted cell is exempt from the reachability flood by definition, so this is the
// only thing standing between a painted cell and a wall (POK-314): every row of
// landing-hand.json is a real outdoor cell in the world.json the drop is dealt from, a
// pick is somewhere you can stand and walk off to a cell the drop already deals on its own
// map -- heights and all, so not a cliff top -- and nothing is written twice or both picked
// and vetoed. A re-export that moves a map fails here rather than dropping somebody into a
// fence. match/hand.test.ts holds each of those rules to a hand-built map.
const maps = new Map((worldData as { maps: { id: string }[] }).maps.map((m) => [m.id, m]));

describe('the hand-painted drop cells', () => {
  it('are each somewhere to stand and walk off, and each written once', () => {
    const seeds = LANDING_ALL.filter((c) => c.door !== undefined || !c.off);
    expect(handProblems(handData as unknown[], HOENN.byId, HOENN.world, seeds)).toEqual([]);
  });

  it('are split into picks and vetoes', () => {
    expect(HAND.length + VETO.size).toBe((handData as unknown[]).length);
    expect(HAND.some((c) => VETO.has(cellKey(c)))).toBe(false);
  });

  it('veto cells out of every pool the drop, the ring and the bots draw from', () => {
    expect(LANDING.filter((c) => VETO.has(cellKey(c)))).toEqual([]);
    expect(DOORSTEPS.filter((c) => VETO.has(cellKey(c)))).toEqual([]);
  });

  // The painter only lets Cam pick where walksTo says, so it had better say yes to a town:
  // each of the eight towns the flood left with doorsteps alone has a street to paint.
  it('leave every doorstep-only town a street to paint', () => {
    const towns = ['FORTREE_CITY', 'LILYCOVE_CITY', 'MOSSDEEP_CITY', 'DEWFORD_TOWN', 'PACIFIDLOG_TOWN', 'SOOTOPOLIS_CITY', 'EVER_GRANDE_CITY', 'LAVARIDGE_TOWN'];
    for (const town of towns.map((t) => `MAP_${t}`)) {
      const m = HOENN.byId.get(town)!;
      expect(LANDING.filter((c) => c.map === town), `${town} has ordinary cells now`).toEqual([]);
      const flags = walksTo(HOENN.world, m, DOORSTEPS.filter((c) => c.map === town));
      expect(flags.reduce((n, f) => n + f, 0), town).toBeGreaterThan(100);
    }
  });
});

// world.json and landing.json are a chunk of their own, fetched as the page starts (the
// audit's leftover e): a module fresh off the import has neither, says so when read,
// and has both once worldReady() is done.
describe('the world data', () => {
  it('is fetched on demand: read before worldReady() it throws, after it answers', async () => {
    vi.resetModules();
    const hoenn = await import('../bots/hoenn');
    const landing = await import('./landing');
    expect(() => hoenn.HOENN.maps).toThrow('HOENN was read before worldReady()');
    expect(() => landing.LANDING.length).toThrow('LANDING was read before worldReady()');
    expect(() => [...landing.DOORSTEPS]).toThrow('DOORSTEPS was read before worldReady()');
    expect(() => landing.LANDING_ALL.filter(Boolean)).toThrow('LANDING_ALL was read before worldReady()');

    const once = landing.worldReady();
    expect(landing.worldReady()).toBe(once);
    await once;
    expect(hoenn.HOENN.maps).toHaveLength(maps.size);
    const kept = landing.LANDING_ALL.filter((c) => !landing.VETO.has(cellKey(c)));
    expect(kept.length).toBe(landing.LANDING.length + landing.DOORSTEPS.length + kept.filter((c) => c.off && c.door === undefined).length);
    expect(landing.LANDING.every((c) => !c.off && c.door === undefined)).toBe(true);
    expect(landing.DOORSTEPS.length).toBeGreaterThan(0);
  });

  // POK-314: the committed hand file has no vetoes yet, so the tables above cannot show one
  // coming off. A file that vetoes a live cell and a doorstep, loaded fresh, does.
  it('comes with landing-hand.json\'s vetoes taken off, and its picks kept apart', async () => {
    const live = LANDING[0];
    const door = DOORSTEPS[0];
    const pick = LANDING[1];
    vi.resetModules();
    vi.doMock('../data/landing-hand.json', () => ({
      default: [
        { map: live.map, x: live.x, y: live.y, veto: 1 },
        { map: door.map, x: door.x, y: door.y, veto: 1 },
        { map: pick.map, x: pick.x, y: pick.y },
      ],
    }));
    try {
      const landing = await import('./landing');
      await landing.worldReady();
      expect(landing.HAND).toEqual([{ map: pick.map, x: pick.x, y: pick.y }]);
      expect([...landing.VETO]).toEqual([cellKey(live), cellKey(door)]);
      expect(landing.LANDING).toHaveLength(LANDING.length - 1);
      expect(landing.LANDING.some((c) => cellKey(c) === cellKey(live))).toBe(false);
      expect(landing.DOORSTEPS).toHaveLength(DOORSTEPS.length - 1);
      expect(landing.DOORSTEPS.some((c) => cellKey(c) === cellKey(door))).toBe(false);
      // The flood's marks and the exporter's rows are untouched: the veto is ours alone.
      expect(landing.LANDING_ALL).toHaveLength(LANDING_ALL.length);
    } finally {
      vi.doUnmock('../data/landing-hand.json');
      vi.resetModules();
    }
  });
});
