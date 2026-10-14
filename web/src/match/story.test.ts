import { describe, expect, it } from 'vitest';
import { Director, type DirectorWorld } from './director';
import { eventKey, SUPPLIES } from './events';
import { STORIES, storyDrop } from './story';
import { mulberry32 } from './clock';
import { HOENN } from '../bots/hoenn';
import { DOORSTEPS, HAND, LANDING, worldReady } from './landing';
import { MAP_OFFSET } from '../net/cells';
import type { EventMsg, Msg, SpillMsg } from '../net/wire';
import { Bots, STEP_MS } from '../bots/brain';
import { dealBots } from '../bots/roster';
import { dealParty } from '../bots/party';
import { pageCell } from '../bots/space';
import regionmapData from '../data/regionmap.json';

await worldReady();

const SECTIONS = regionmapData.sections as DirectorWorld['sections'];
const WORLD: DirectorWorld = { maps: HOENN.maps, landing: LANDING, doorsteps: DOORSTEPS, hand: HAND, sections: SECTIONS };

/** Where a trainer comes in: every warp on another map that lands on this one. */
function entries(map: string) {
  return HOENN.maps.flatMap((m) => (m.warps ?? []).filter((w) => w.to === map && m.id !== map).map((w) => ({ map, x: w.toX, y: w.toY })));
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
      expect(new Set(s.cells.map((c) => `${c.x},${c.y}`)).size, s.id).toBe(s.cells.length);
    }
    expect(new Set(STORIES.map((s) => s.id)).size).toBe(STORIES.length);
  });

  it('lies where a trainer can walk to, from a door into its map, surfing', () => {
    for (const s of STORIES) {
      const ways = entries(s.map);
      expect(ways.length, s.id).toBeGreaterThan(0);
      expect(HOENN.world.hops('MAP_LITTLEROOT_TOWN', s.map, true, true), s.id).toBeDefined();
      for (const c of s.cells) {
        const ok = ways.some((w) => HOENN.world.reachOnMap(w, true, true).cell(c.x, c.y));
        expect(ok, `${s.id} ${c.x},${c.y}`).toBe(true);
      }
    }
  });

  it("drops the story's own reward, the supplies and a trader, on its cells and its map", () => {
    const story = STORIES.find((s) => s.id === 'mirage-tower')!;
    const map = HOENN.refOf(story.map)!;
    const msgs = storyDrop(mulberry32(5), story, { n: 1, phase: 4, seat: 0, mapsec: 199, place: story.name, map, cells: [...story.cells] });
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
    const msgs = storyDrop(mulberry32(5), story, { n: 0, phase: 2, seat: 0, mapsec: 67, map, cells: [...story.cells] });
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
        const spills = (sent.filter((m) => m.t === 'spill') as SpillMsg[]).filter((s) => [...s.mons, ...(s.bag ? [s.bag] : [])].some((p) => p.key === e.key));
        expect(spills.map((s) => HOENN.idOf(s.map)), `seed ${seed}`).toEqual([story.map]);
        expect(e.mapsec).toBe(SECTIONS[story.section].num);
      }
    }
    // Over three hundred matches every story comes up somewhere. The east's hardly do:
    // every ring centre is west of Lilycove (landing.json), so only the first event's
    // ring reaches as far as Mossdeep.
    expect([...told.keys()].sort()).toEqual(STORIES.map((s) => s.name).sort());
  });

  // Bots go for events like players (Cam, 2026-10-13): from the door outside, to the
  // story's first piece, however many floors in.
  const OUTSIDE: Record<string, { mapId: string; x: number; y: number }> = {
    'mirage-tower': { mapId: 'MAP_ROUTE111', x: 19, y: 59 },
    'stevens-house': { mapId: 'MAP_MOSSDEEP_CITY', x: 19, y: 11 },
    'new-mauville': { mapId: 'MAP_ROUTE110', x: 35, y: 25 },
    'shoal-cave': { mapId: 'MAP_ROUTE125', x: 22, y: 20 },
  };
  it('a bot outside walks in and takes it', () => {
    for (const story of STORIES) {
      const from = OUTSIDE[story.id];
      expect(from, story.id).toBeDefined();
      const key = eventKey(0, 0);
      const ground = new Map([[key, { mapId: story.map, ...story.cells[0] }]]);
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
});
