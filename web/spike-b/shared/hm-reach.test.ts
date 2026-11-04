// POK-437: SURF, CUT, STRENGTH and FLY for a team with somebody who could learn them, bots too, and
// Hoenn's trees and boulders back where vanilla has them without stranding anybody. Cam said yes on
// 2026-10-20. The rule for a trainer was already this (carry.ts fieldOf, couldFly); the bots had all
// of it, whatever their team (`a.bot ? 7 : a.field`), and no FLY.
import { describe, expect, it } from 'vitest';
import { decodeGrid, type Spot, type WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import { dealParty, teamField, teamFlies } from '../../src/bots/party';
import { gradeOf } from '../../src/bots/roster';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { botKeys, type Brain } from './bots';
import { Host, play } from './host';
import { ATTENDANT, BOATS, FIELD_SURF, KEY_A, KEY_B, KEY_DOWN, PORTS, makeRoom, type Room } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const ROUTE = 'MAP_ROUTE103';
const SEED = 99;

/** A seat whose team here could `want` the bits it asks for. */
function seat(pass: (bits: number, flies: boolean) => boolean, map = ROUTE): number {
  for (let id = 1; id < 400; id++) {
    const team = dealParty(SEED, id, 1, map, gradeOf(SEED, id));
    if (pass(teamField(team), teamFlies(team))) return id;
  }
  throw new Error('no such seat');
}

const shoreOf = (room: Room) => {
  const m = MAPS.find((x) => x.id === ROUTE)!;
  for (let y = 0; y < m.h - 2; y++) for (let x = 0; x < m.w; x++) {
    if (room.world.cell(ROUTE, x, y) === 0 && room.world.cell(ROUTE, x, y + 1) === 2 && room.world.cell(ROUTE, x, y + 2) === 2) return { x, y };
  }
  throw new Error('no shore');
};

describe('a bot follows a trainer\'s rule', () => {
  const walkDown = (room: Room, id: number, frames: number) => {
    const a = room.actor(id)!;
    for (let i = 0; i < frames; i++) { a.keys = KEY_DOWN | KEY_B | KEY_A; room.step(); }
    return a.m.spot;
  };

  it('with nobody who could SURF it stays on the shore; with somebody, it goes', () => {
    for (const [can, moved] of [[false, false], [true, true]] as const) {
      const room = makeRoom(MAPS, PATCHES, SEED);
      const shore = shoreOf(room);
      const id = seat((bits) => ((bits & FIELD_SURF) !== 0) === can);
      room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: ROUTE, ...shore }, facing: 1 });
      expect(((room.actor(id)!.field ?? 0) & FIELD_SURF) !== 0).toBe(can);
      const to = walkDown(room, id, 12);
      expect(to.y !== shore.y, `surf ${can}`).toBe(moved);
    }
  });

  it('a page cannot tell the room a bot could do more', () => {
    const room = makeRoom(MAPS, PATCHES, SEED);
    const id = seat((bits) => bits === 0);
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: ROUTE, x: 0, y: 0 }, facing: 1 });
    room.apply({ c: 'field', id, bits: 7 });
    expect(room.actor(id)!.field).toBe(0);
  });

  it('its search never routes it over water its team cannot cross', () => {
    const room = makeRoom(MAPS, PATCHES, SEED);
    (room as unknown as { opening: number }).opening = 0;
    const id = seat((bits) => (bits & FIELD_SURF) === 0, 'MAP_LITTLEROOT_TOWN');
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, facing: 1 });
    const a = room.actor(id)!;
    a.calm = 1e9;
    const brain: Brain = { rng: 5, wait: 0, dir: 1 };
    // Off to a town over the sea: no way there for this team, so no walk.
    brain.goal = { map: 'MAP_LILYCOVE_CITY', x: 20, y: 20 };
    for (let i = 0; i < 60 * 30; i++) {
      a.keys = botKeys(room, a, brain);
      room.step();
      expect(room.world.cell(a.m.spot.map, a.m.spot.x, a.m.spot.y), `at ${JSON.stringify(a.m.spot)}`).not.toBe(2);
    }
  });

  it('a team that could FLY gets out of the fog by air, on a mirror too; one that could not walks', async () => {
    for (const can of [true, false]) {
      const room = makeRoom(MAPS, PATCHES, SEED);
      room.ringPhase = 30 * 60;
      room.opening = 0;
      const id = seat((_, flies) => flies === can, 'MAP_LITTLEROOT_TOWN');
      const host = new Host(room, 0, MAPS, 0);
      room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, facing: 1 });
      room.apply({ c: 'join', id: id + 500, bot: true, name: 'F', skin: 4, spot: { map: 'MAP_RUSTBORO_CITY', x: 10, y: 10 }, facing: 1 });
      room.actor(id + 500)!.calm = 1e9;
      host.brains.set(id, { rng: 5, wait: 0, dir: 1 });
      room.actor(id)!.calm = 1e9;
      const mirror = makeRoom(MAPS, PATCHES, room.seed);
      mirror.load(structuredClone(room.state()));
      // Put the bot in the fog: the ring closed on it.
      const inFog = room.inFog.bind(room);
      room.inFog = (s: Spot, r) => (s.map === 'MAP_LITTLEROOT_TOWN' ? true : inFog(s, r));
      let flew = false;
      for (let i = 0; i < 60 * 3 && !flew; i++) {
        const { frame } = host.advance();
        play(mirror, frame);
        flew = !!frame.cmds?.some((c) => c.c === 'fly' && c.id === id);
      }
      expect(flew, `flies ${can}`).toBe(can);
      if (can) {
        expect(room.actor(id)!.m.spot.map).not.toBe('MAP_LITTLEROOT_TOWN');
        expect(mirror.actor(id)!.m.spot).toEqual(room.actor(id)!.m.spot);
      }
    }
  });

  it('the room turns down a flight for a team that could not', () => {
    const room = makeRoom(MAPS, PATCHES, SEED);
    room.opening = 0;
    const id = seat((_, flies) => !flies, 'MAP_LITTLEROOT_TOWN');
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, facing: 1 });
    room.step();
    room.apply({ c: 'fly', id, to: { map: 'MAP_OLDALE_TOWN', x: 10, y: 12 } });
    expect(room.actor(id)!.m.spot.map).toBe('MAP_LITTLEROOT_TOWN');
  });

  it('never forgets SURF in a round, whatever map it is dealt on next', () => {
    const room = makeRoom(MAPS, PATCHES, SEED);
    const id = seat((bits) => (bits & FIELD_SURF) !== 0);
    room.apply({ c: 'join', id, bot: true, name: 'B', skin: 4, spot: { map: ROUTE, x: 0, y: 0 }, facing: 1 });
    const a = room.actor(id)!;
    a.m = { ...a.m, spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 } };
    (room as unknown as { botLearns(a: unknown): void }).botLearns(a);
    expect((a.field ?? 0) & FIELD_SURF).toBe(FIELD_SURF);
  });
});

describe('Hoenn with the trees and boulders back', () => {
  const room = makeRoom(MAPS, PATCHES, 1);
  const w = room.world;
  const LITTLEROOT: Spot = { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 };
  const key = (s: Spot) => `${s.map}:${s.x},${s.y}${s.z === undefined ? '' : '@' + s.z}`;
  const boatSteps = new Map<string, Spot[]>();
  for (const b of [...BOATS, { ...ATTENDANT, to: ['slateport'] }]) for (const to of b.to) for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const k = key({ map: b.map, x: b.x + dx, y: b.y + dy });
    boatSteps.set(k, [...(boatSteps.get(k) ?? []), PORTS[to].land]);
  }
  const mapsFrom = (from: Spot, surf: boolean, cut: number, boats = true) => {
    const seen = new Set([key(from)]), q = [from], maps = new Set([from.map]);
    while (q.length) {
      const at = q.pop()!;
      for (const t of [...w.neighbours(at, surf, cut).map((n) => n.to).filter((t) => room.maps.has(t.map)), ...(boats ? boatSteps.get(key(at)) ?? [] : [])]) {
        const k = key(t);
        if (!seen.has(k)) { seen.add(k); q.push(t); maps.add(t.map); }
      }
    }
    return maps;
  };

  it('every tree, rock and boulder vanilla has is on the grid (none lost, none extra)', () => {
    const all = import.meta.glob('../../../data/maps/*/map.json', { eager: true }) as Record<string, { id: string; object_events?: { graphics_id: string; x: number; y: number }[] }>;
    expect(Object.keys(all).length).toBeGreaterThan(400);
    const want: Record<string, number> = { OBJ_EVENT_GFX_CUTTABLE_TREE: 9, OBJ_EVENT_GFX_BREAKABLE_ROCK: 9, OBJ_EVENT_GFX_PUSHABLE_BOULDER: 10 };
    const count: Record<number, number> = { 9: 0, 10: 0 };
    for (const json of Object.values(all)) {
      const m = MAPS.find((x) => x.id === json.id);
      for (const o of json.object_events ?? []) {
        const c = want[o.graphics_id];
        if (!c || !m) continue;
        count[c]++;
        expect(decodeGrid(m.grid, m.w * m.h)[o.y * m.w + o.x], `${json.id} ${o.x},${o.y}`).toBe(c);
      }
    }
    expect(count).toEqual({ 9: 77, 10: 59 });
    const onGrid = { 9: 0, 10: 0 } as Record<number, number>;
    for (const m of MAPS) for (const c of decodeGrid(m.grid, m.w * m.h)) if (c === 9 || c === 10) onGrid[c]++;
    expect(onGrid).toEqual(count);
  });

  it('the harbours stay open with no HM at all (Cam: keep the ferries)', () => {
    const none = mapsFrom(LITTLEROOT, false, 0);
    for (const h of ['MAP_SLATEPORT_CITY', 'MAP_SLATEPORT_CITY_HARBOR', 'MAP_LILYCOVE_CITY', 'MAP_LILYCOVE_CITY_HARBOR']) expect(none.has(h), h).toBe(true);
  });

  it('what each HM opens from Littleroot, boats counted', () => {
    const n = (surf: boolean, cut: number) => mapsFrom(LITTLEROOT, surf, cut).size;
    expect({ none: n(false, 0), cut: n(false, 1), strength: n(false, 2), surf: n(true, 0), all: n(true, 3) }).toEqual({ none: 148, cut: 183, strength: 148, surf: 255, all: 267 });
    const surf = mapsFrom(LITTLEROOT, true, 0), all = mapsFrom(LITTLEROOT, true, 3);
    // Past SURF, only these are shut behind a tree or a boulder, and none is a town.
    expect([...all].filter((m) => !surf.has(m)).sort()).toEqual([
      'MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_1F', 'MAP_EVER_GRANDE_CITY_POKEMON_LEAGUE_2F', 'MAP_MAGMA_HIDEOUT_2F_1R', 'MAP_MAGMA_HIDEOUT_2F_2R', 'MAP_MAGMA_HIDEOUT_2F_3R',
      'MAP_MAGMA_HIDEOUT_3F_1R', 'MAP_MAGMA_HIDEOUT_3F_2R', 'MAP_MAGMA_HIDEOUT_3F_3R', 'MAP_MAGMA_HIDEOUT_4F', 'MAP_MIRAGE_TOWER_4F', 'MAP_SHOAL_CAVE_LOW_TIDE_ICE_ROOM', 'MAP_VICTORY_ROAD_B2F',
    ]);
  }, 60_000);

  it('a drop the room deals never strands a team that can do nothing: it walks to a harbour, boats counted', () => {
    const main = room.mainland(), land = room.landing();
    expect(main.size).toBeGreaterThan(15_000);
    const offMain = new Set([...land].filter((k) => !main.has(k)).map((k) => k.slice(0, k.indexOf(':'))));
    expect([...offMain].sort()).toEqual(['MAP_EVER_GRANDE_CITY', 'MAP_MOSSDEEP_CITY', 'MAP_ROUTE115']);
    // Each kind of ground it keeps, by flood, with the same steps a trainer has.
    for (const k of [...main].filter((_, i) => i % 2000 === 0)) {
      const [map, x, y] = k.split(':');
      const m = mapsFrom({ map, x: +x, y: +y }, false, 0);
      expect(m.has('MAP_SLATEPORT_CITY_HARBOR') || m.has('MAP_LILYCOVE_CITY_HARBOR'), k).toBe(true);
    }
    // And the room's own deal: every bot out of the Zone lands on it.
    const r = makeRoom(MAPS, PATCHES, 11);
    r.ringPhase = 7200; r.opening = 60;
    const host = new Host(r, 31, MAPS, 0);
    host.lock();
    for (let i = 0; i < 70; i++) host.advance();
    for (const a of r.actors) expect(main.has(`${a.m.spot.map}:${a.m.spot.x}:${a.m.spot.y}`), JSON.stringify(a.m.spot)).toBe(true);
  }, 60_000);

  it('a pick off the fly map still lands where it asked, island or not', () => {
    const r = makeRoom(MAPS, PATCHES, 11);
    r.ringPhase = 7200; r.opening = 60;
    r.apply({ c: 'join', id: 1000, bot: false, name: 'ME', skin: 0, spot: { map: 'MAP_SAFARI_ZONE_SOUTH', x: 32, y: 34 }, facing: 1 });
    for (let i = 0; i < 70; i++) r.step(new Map());
    r.apply({ c: 'pick', id: 1000, map: 'MAP_MOSSDEEP_CITY' });
    expect(r.actor(1000)!.m.spot.map).toBe('MAP_MOSSDEEP_CITY');
  });
});
