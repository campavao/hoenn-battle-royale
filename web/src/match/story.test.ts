import { describe, expect, it } from 'vitest';
import { Director, type DirectorWorld } from './director';
import { EVENT_MAX, eventKey, SUPPLIES } from './events';
import { STORIES, storyCells, storyDrop, storyLegend, storySealed } from './story';
import { mulberry32 } from './clock';
import { HOENN } from '../bots/hoenn';
import { DOORSTEPS, HAND, LANDING, worldReady } from './landing';
import { MAP_OFFSET } from '../net/cells';
import type { EventMsg, Msg, RingMsg, SpillMsg } from '../net/wire';
import { Bots, STEP_MS } from '../bots/brain';
import { dealBots } from '../bots/roster';
import { dealParty } from '../bots/party';
import { pageCell } from '../bots/space';
import regionmapData from '../data/regionmap.json';
import mapsecJson from '../../../src/data/region_map/region_map_sections.json';

await worldReady();

const MAPSECS = (mapsecJson as { map_sections: { id: string; name?: string }[] }).map_sections;
const SECTIONS = regionmapData.sections as DirectorWorld['sections'];
const WORLD: DirectorWorld = { maps: HOENN.maps, landing: LANDING, doorsteps: DOORSTEPS, hand: HAND, sections: SECTIONS };

/** Where a trainer comes in: every warp on another map that lands on this one, and for a
 *  route the sea joins to its neighbours (ROUTE 128), every cell of its edges they cross. */
function entries(map: string) {
  const doors = HOENN.maps.flatMap((m) => (m.warps ?? []).filter((w) => w.to === map && m.id !== map).map((w) => ({ map, x: w.toX, y: w.toY })));
  const m = HOENN.byId.get(map)!;
  const edges: { map: string; x: number; y: number }[] = [];
  for (const seam of (m as { seams?: { dir: string }[] }).seams ?? []) {
    const cells =
      seam.dir === 'north' || seam.dir === 'south'
        ? Array.from({ length: m.w }, (_, x) => ({ x, y: seam.dir === 'north' ? 0 : m.h - 1 }))
        : Array.from({ length: m.h }, (_, y) => ({ x: seam.dir === 'west' ? 0 : m.w - 1, y }));
    edges.push(...cells.filter((c) => HOENN.world.standable(map, c.x, c.y, true, true)).map((c) => ({ map, ...c })));
  }
  return [...doors, ...edges.filter((_, i) => i % 8 === 0)];
}

function run(seed: number): Msg[] {
  let t = 0;
  const sent: Msg[] = [];
  const d = new Director({ seats: [0, 1], seed, world: WORLD, options: { safariSecs: 5, fogSecs: 10 }, send: (m) => sent.push(m), now: () => t, onOut: () => () => {} });
  d.start();
  t += 5000;
  d.tick();
  for (let i = 0; i < 8; i++) {
    t += 10000;
    d.tick();
  }
  return sent;
}

describe('story events', () => {
  it('each has its section, its map, a cell for every piece, the supplies and the trader, all different', () => {
    for (const s of STORIES) {
      expect(SECTIONS[s.section]?.num, s.id).toBeDefined();
      expect(HOENN.byId.has(s.map), s.id).toBe(true);
      const pieces = (s.mons?.length ?? 0) + (s.rares ?? 0) + (s.items?.length ?? 0);
      expect(s.cells, s.id).toHaveLength(pieces + 2);
      expect(new Set(s.cells.map((c) => `${c.map ?? s.map},${c.x},${c.y}`)).size, s.id).toBe(s.cells.length);
      for (const c of s.cells) if (c.map) expect(HOENN.byId.has(c.map), s.id).toBe(true);
      for (const p of s.people ?? []) expect(s.cells[p.at], s.id).toBeDefined();
    }
    expect(new Set(STORIES.map((s) => s.id)).size).toBe(STORIES.length);
  });

  it("sails to an island by the island's own mapsec, from Lilycove's dock", () => {
    const boats = STORIES.filter((s) => s.boat);
    expect(boats.length).toBe(5);
    for (const s of boats) {
      expect(s.section, s.id).toBe('MAPSEC_LILYCOVE_CITY');
      // The enum is the json's order (tools/jsonproc's region_map_sections.constants).
      expect(MAPSECS[s.mapsec!]?.name && s.name.startsWith(MAPSECS[s.mapsec!].name!), s.id).toBe(true);
    }
  });

  it('lies where a trainer can walk to, from a door into its map, surfing', () => {
    for (const s of STORIES) {
      for (const c of s.cells) {
        const map = c.map ?? s.map;
        // An island is a ferry ride, not a walk: br_story.c's ferry and story-ferry.txt.
        if (s.boat) continue;
        const ways = entries(map);
        expect(ways.length, s.id).toBeGreaterThan(0);
        expect(HOENN.world.hops('MAP_LITTLEROOT_TOWN', map, true, true), s.id).toBeDefined();
        const ok = ways.some((w) => HOENN.world.reachOnMap(w, true, true).cell(c.x, c.y));
        expect(ok, `${s.id} ${c.x},${c.y}`).toBe(true);
      }
    }
  });

  it("drops the story's own reward, the supplies and a trader, on its cells and its map", () => {
    const story = STORIES.find((s) => s.id === 'mirage-tower')!;
    const map = HOENN.refOf(story.map)!;
    const msgs = storyDrop(mulberry32(5), story, { n: 1, phase: 4, seat: 0, mapsec: 199, place: story.name, map, cells: storyCells(story, (id) => HOENN.refOf(id)!) });
    const event = msgs[0] as EventMsg;
    expect(event).toMatchObject({ t: 'event', n: 1, mapsec: 199, place: 'MIRAGE TOWER', key: eventKey(1, 0) });
    expect(event.trader).toMatchObject({ map, x: 6 + MAP_OFFSET, y: 5 + MAP_OFFSET });
    const spills = msgs.slice(1) as SpillMsg[];
    expect(spills.every((s) => s.map.group === map.group && s.map.num === map.num)).toBe(true);
    expect(spills[0].mons.map((m) => [m.species, m.x - MAP_OFFSET, m.y - MAP_OFFSET, m.key])).toEqual([
      [388, 5, 4, eventKey(1, 0)],
      [390, 7, 4, eventKey(1, 1)],
    ]);
    expect(spills.map((s) => s.bag!.items)).toEqual([SUPPLIES]);
    expect(spills[0].bag).toMatchObject({ key: eventKey(1, 2), x: 6 + MAP_OFFSET, y: 3 + MAP_OFFSET });
  });

  it('gives an item story its items as balls of one, before the supplies', () => {
    const story = STORIES.find((s) => s.id === 'shoal-cave')!;
    const map = HOENN.refOf(story.map)!;
    const msgs = storyDrop(mulberry32(5), story, { n: 0, phase: 2, seat: 0, mapsec: 67, map, cells: storyCells(story, (id) => HOENN.refOf(id)!) });
    const bags = (msgs.slice(1) as SpillMsg[]).map((s) => s.bag!.items);
    expect(bags).toEqual([[{ id: 196, n: 1 }], [{ id: 219, n: 1 }], SUPPLIES]);
    expect((msgs.slice(1) as SpillMsg[]).flatMap((s) => s.mons)).toEqual([]);
  });

  it('the director tells a story this ring reaches when the match has one, never the same one twice', () => {
    const told = new Map<string, number>();
    for (let seed = 1; seed <= 300; seed++) {
      const sent = run(seed);
      const names = (sent.filter((m) => m.t === 'event') as EventMsg[]).map((e) => e.place);
      const stories = names.filter((p) => STORIES.some((s) => s.name === p));
      expect(new Set(stories).size, `seed ${seed}`).toBe(stories.length);
      for (const p of stories) told.set(p!, (told.get(p!) ?? 0) + 1);
      for (const e of sent.filter((m) => m.t === 'event') as EventMsg[]) {
        const story = STORIES.find((s) => s.name === e.place);
        if (!story) continue;
        const spills = (sent.filter((m) => m.t === 'spill') as SpillMsg[]).filter((s) => [...s.mons, ...(s.bag ? [s.bag] : [])].some((p) => (p.key & 0xfff0) === (e.key & 0xfff0)));
        const maps = new Set(story.cells.map((c) => c.map ?? story.map));
        expect(new Set(spills.map((s) => HOENN.idOf(s.map))), `seed ${seed}`).toEqual(maps);
        expect(e.mapsec).toBe(story.mapsec ?? SECTIONS[story.section].num);
      }
    }
    // Over three hundred matches every story the rings reach comes up somewhere. Lilycove
    // and east of it need not: every ring centre is west of Lilycove (landing.json), and a
    // story goes inside the next ring, which only now and then reaches Lilycove's dock (the
    // islands sail from it) and never Mossdeep or past it.
    const east = new Set(['MAPSEC_LILYCOVE_CITY', 'MAPSEC_AQUA_HIDEOUT', 'MAPSEC_MOSSDEEP_CITY', 'MAPSEC_SHOAL_CAVE', 'MAPSEC_ROUTE_128']);
    const west = STORIES.filter((s) => !east.has(s.section)).map((s) => s.name);
    expect(west.filter((n) => !told.has(n))).toEqual([]);
  });

  it("leaves the last event to the final ring's own section", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const sent = run(seed);
      const ring = sent.find((m) => m.t === 'ring') as RingMsg;
      const last = (sent.filter((m) => m.t === 'event') as EventMsg[]).find((e) => e.n === EVENT_MAX - 1);
      if (!last) continue;
      // An island's event is at the island and its section is the dock's (story.ts).
      const dock = STORIES.find((s) => s.boat && s.mapsec === last.mapsec);
      const section = dock ? SECTIONS[dock.section].num : last.mapsec;
      expect(section, `seed ${seed}`).toBe(Object.values(SECTIONS).find((s) => s.name === ring.place)?.num);
    }
  });

  it('a host that takes the match over does not tell a story the old one told', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let t = 0;
      const sent: Msg[] = [];
      const mk = () => new Director({ seats: [0, 1], seed, world: WORLD, options: { safariSecs: 5, fogSecs: 10 }, send: (m) => sent.push(m), now: () => t, onOut: () => () => {} });
      const a = mk();
      a.start();
      t += 5000;
      a.tick();
      for (let i = 0; i < 2; i++) {
        t += 10000;
        a.tick();
      }
      const before = sent.filter((m) => m.t === 'event') as EventMsg[];
      const ring = sent.filter((m) => m.t === 'ring').pop() as RingMsg;
      const b = mk();
      b.resume({ ringPhase: ring.phase, centre: { sx: ring.sx, sy: ring.sy, place: ring.place }, secsLeftInPhase: 1, events: before });
      for (let i = 0; i < 8; i++) {
        t += 10000;
        b.tick();
      }
      const places = (sent.filter((m) => m.t === 'event') as EventMsg[]).map((e) => e.place).filter((p) => STORIES.some((s) => s.name === p));
      expect(new Set(places).size, `seed ${seed}`).toBe(places.length);
    }
  });

  // Bots go for events like players (Cam, 2026-10-13): from the door outside, to the
  // story's first piece, however many floors in.
  const OUTSIDE: Record<string, { mapId: string; x: number; y: number }> = {
    'mirage-tower': { mapId: 'MAP_ROUTE111', x: 19, y: 59 },
    'stevens-house': { mapId: 'MAP_MOSSDEEP_CITY', x: 19, y: 11 },
    'new-mauville': { mapId: 'MAP_ROUTE110', x: 35, y: 25 },
    'shoal-cave': { mapId: 'MAP_ROUTE125', x: 22, y: 20 },
    'desert-ruins': { mapId: 'MAP_ROUTE111', x: 29, y: 88 },
    'island-cave': { mapId: 'MAP_ROUTE105', x: 9, y: 21 },
    'ancient-tomb': { mapId: 'MAP_ROUTE120', x: 7, y: 56 },
    'granite-cave': { mapId: 'MAP_GRANITE_CAVE_1F', x: 5, y: 11 },
    'lavaridge-egg': { mapId: 'MAP_LAVARIDGE_TOWN_POKEMON_CENTER_1F', x: 7, y: 7 },
    'abandoned-ship': { mapId: 'MAP_SLATEPORT_CITY', x: 28, y: 13 },
    'magma-hideout': { mapId: 'MAP_MAGMA_HIDEOUT_3F_3R', x: 16, y: 22 },
    'route128-kyogre': { mapId: 'MAP_ROUTE127', x: 37, y: 38 },
    'weather-institute': { mapId: 'MAP_ROUTE119_WEATHER_INSTITUTE_1F', x: 17, y: 2 },
    'aqua-hideout': { mapId: 'MAP_AQUA_HIDEOUT_B1F', x: 12, y: 2 },
    'mt-chimney': { mapId: 'MAP_MT_CHIMNEY_CABLE_CAR_STATION', x: 6, y: 10 },
    'space-center': { mapId: 'MAP_MOSSDEEP_CITY_SPACE_CENTER_1F', x: 13, y: 2 },
  };
  it('a bot outside walks in and takes it', () => {
    for (const story of STORIES.filter((s) => !s.boat)) {
      const from = OUTSIDE[story.id];
      expect(from, story.id).toBeDefined();
      const key = eventKey(0, 0);
      const ground = new Map([[key, { mapId: story.cells[0].map ?? story.map, x: story.cells[0].x, y: story.cells[0].y }]]);
      const sent: Msg[] = [];
      const bots = new Bots({
        world: HOENN.world,
        targets: [from],
        mapRef: (id) => HOENN.refOf(id)!,
        send: (m) => void sent.push(m),
        rng: mulberry32(3),
        deal: (bot, phase, mapId) => dealParty(5, bot.seat, phase, mapId),
        loot: {
          all: () => [...ground].map(([k, at]) => ({ key: k, mapId: at.mapId, ...pageCell(at.x, at.y) })),
          at: (mapId, { x, y }) => [...ground].find(([, c]) => c.mapId === mapId && c.x === x && c.y === y)?.[0],
        },
      });
      bots.start(dealBots(8, 1, [], [{ ...from, map: HOENN.refOf(from.mapId)! }]), 0);
      for (let t = STEP_MS; t <= 240_000 && ground.size > 0; t += STEP_MS) {
        bots.tick(t);
        for (const msg of sent) if (msg.t === 'pickup') ground.delete(msg.key);
      }
      expect(ground.size, story.id).toBe(0);
    }
  });

  it("keeps a REGI behind its wall, and STERN's thanks, from a bot that could not get them", () => {
    const at = (id: string, i = 0) => {
      const s = STORIES.find((x) => x.id === id)!;
      return { mapId: s.cells[i].map ?? s.map, x: s.cells[i].x, y: s.cells[i].y };
    };
    const bot = { flies: false, has: () => false, phase: 4, onGround: () => false };
    // Event 1 drops on phase 4.
    const key = eventKey(1, 0);
    expect(storySealed({ key, ...at('desert-ruins') }, bot)).toBe(false);
    expect(storySealed({ key, ...at('ancient-tomb') }, bot)).toBe(true);
    expect(storySealed({ key, ...at('ancient-tomb') }, { ...bot, flies: true })).toBe(false);
    expect(storySealed({ key, ...at('island-cave') }, bot)).toBe(true);
    expect(storySealed({ key, ...at('island-cave') }, { ...bot, phase: 5 })).toBe(false);
    // Outside the wall is anybody's.
    expect(storySealed({ key: eventKey(1, 1), ...at('ancient-tomb', 1) }, bot)).toBe(false);
    expect(storySealed({ key, ...at('abandoned-ship') }, bot)).toBe(true);
    expect(storySealed({ key, ...at('abandoned-ship') }, { ...bot, has: (id) => id === 278 })).toBe(false);
    expect(storySealed({ key: eventKey(1, 1), ...at('abandoned-ship', 1) }, bot)).toBe(false);
    // A fallen trainer's ball on the same cell is not the story's.
    expect(storySealed({ key: 0x1234, ...at('ancient-tomb') }, bot)).toBe(false);
  });

  it('calls a story with a legendary in it one, and the rest a rare find', () => {
    const legend = (id: string) => storyLegend(STORIES.find((s) => s.id === id)!);
    expect(['desert-ruins', 'magma-hideout', 'route128-kyogre'].map(legend)).toEqual([true, true, true]);
    expect(['new-mauville', 'mirage-tower', 'aqua-hideout'].map(legend)).toEqual([false, false, false]);
  });

  it("holds a gate's other pieces for a bot until its boss's is gone", () => {
    const s = STORIES.find((x) => x.id === 'mt-chimney')!;
    const at = (i: number) => ({ mapId: s.map, x: s.cells[i].x, y: s.cells[i].y });
    const bot = { flies: false, has: () => false, phase: 4 };
    const standing = { ...bot, onGround: (k: number) => k === eventKey(1, 2) };
    expect(storySealed({ key: eventKey(1, 0), ...at(0) }, standing)).toBe(true);
    expect(storySealed({ key: eventKey(1, 2), ...at(2) }, standing)).toBe(false);
    expect(storySealed({ key: eventKey(1, 0), ...at(0) }, { ...bot, onGround: () => false })).toBe(false);
  });
});
