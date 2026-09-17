import { describe, expect, it } from 'vitest';
import TRAINERS from '../data/trainers.json';
import { NPC_FOG_TICK_MS, NPC_FOG_TICKS_TO_KILL, NpcFog } from './npcfog';

// Two one-section maps: A at (0,0), B at (10,0). A ring of radius 2 on A takes B.
const sections = {
  A: { x: 0, y: 0, w: 1, h: 1 },
  B: { x: 10, y: 0, w: 1, h: 1 },
} as const;
const trainers = { A: [1, 2], B: [3] };
const fog = () => new NpcFog(trainers, (id) => sections[id as keyof typeof sections]);
const onA = { sx: 0, sy: 0, r: 2 };
const KILL_MS = NPC_FOG_TICK_MS * NPC_FOG_TICKS_TO_KILL;

describe('the fog and the trainers on a map it took', () => {
  it('leaves a map inside the ring alone, for ever', () => {
    const f = fog();
    for (let t = 0; t <= KILL_MS * 3; t += NPC_FOG_TICK_MS) expect(f.tick(t, onA)).not.toContain('A');
    expect(f.trainersOn('A')).toEqual([1, 2]);
  });

  it('gives a map outside the ring the same grace a player gets, then clears it once', () => {
    const f = fog();
    expect(f.tick(0, onA)).toEqual([]); // the clock starts; nothing has ticked
    let died: string[] = [];
    for (let t = NPC_FOG_TICK_MS; t < KILL_MS; t += NPC_FOG_TICK_MS) died = died.concat(f.tick(t, onA));
    expect(died).toEqual([]); // nine ticks in
    expect(f.tick(KILL_MS, onA)).toEqual(['B']); // the tenth
    expect(f.trainersOn('B')).toEqual([]);
    expect(f.tick(KILL_MS * 5, onA)).toEqual([]); // the dead stay dead, and are not reported again
  });

  it('reprieves a map the ring re-admits before its clock runs out', () => {
    const f = fog();
    f.tick(0, onA);
    f.tick(NPC_FOG_TICK_MS * 5, onA); // half way to dead
    f.tick(NPC_FOG_TICK_MS * 6, { sx: 10, sy: 0, r: 2 }); // the centre moved onto B
    // ...and back out: the clock starts from nothing.
    let died: string[] = [];
    for (let t = 7; t < 7 + NPC_FOG_TICKS_TO_KILL; t++) died = died.concat(f.tick(NPC_FOG_TICK_MS * t, onA));
    expect(died).toEqual([]);
    expect(f.tick(NPC_FOG_TICK_MS * (7 + NPC_FOG_TICKS_TO_KILL), onA)).toEqual(['B']);
  });

  it('does nothing before there is a ring, and takes everything in the last phase', () => {
    const f = fog();
    expect(f.tick(0, undefined)).toEqual([]);
    expect(f.tick(KILL_MS * 2, undefined)).toEqual([]);
    const all: string[] = [];
    for (let t = 0; t <= KILL_MS; t += NPC_FOG_TICK_MS) all.push(...f.tick(t, { sx: 0, sy: 0, r: -1 }));
    expect(all.sort()).toEqual(['A', 'B']);
  });
});

describe('the exported trainer list', () => {
  const data = TRAINERS as Record<string, number[]>;

  it('has ROXANNE at the top of her gym and HALEY on Route 104', () => {
    expect(data.MAP_RUSTBORO_CITY_GYM).toContain(1);
    expect(data.MAP_ROUTE104).toContain(3);
  });

  it('is local ids from 1, sorted, on maps with a trainer at all', () => {
    for (const [map, ids] of Object.entries(data)) {
      expect(ids.length, map).toBeGreaterThan(0);
      expect(ids, map).toEqual([...ids].sort((a, b) => a - b));
      expect(ids[0], map).toBeGreaterThanOrEqual(1);
    }
  });
});
