// The ring map: where the MAP has a trainer, what it names safe, and which way out the fog is.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../src/bots/world';
import type { PatchTable } from '../src/bots/patches';
import worldJson from './data/world.json';
import patchJson from '../src/data/patches.json';
import sectionsJson from '../../src/data/region_map/region_map_sections.json';
import { makeRoom, type Ring } from './shared/room';
import { RingMap } from './ringmap';
import type { RomArt } from './romart';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const SECTIONS = (sectionsJson as { map_sections: { id: string; name: string; x: number; y: number; width: number; height: number }[] }).map_sections;
const letters = (t: string) => [...t].map((c) => (c === ' ' ? 0 : c >= '0' && c <= '9' ? 0xa1 + c.charCodeAt(0) - 48 : 0xbb + c.charCodeAt(0) - 65));
/** The ROM's tables as pret's json has them: the enum is the json's order. */
const art = {
  mapsec: (group: number, num: number) => SECTIONS.findIndex((s) => s.id === MAPS.find((m) => m.group === group && m.num === num)!.section),
  section: (id: number) => ({ x: SECTIONS[id].x, y: SECTIONS[id].y, w: SECTIONS[id].width, h: SECTIONS[id].height, letters: letters(SECTIONS[id].name) }),
} as unknown as RomArt;
const room = makeRoom(MAPS, patchJson as unknown as PatchTable, 12345);
const map = new RingMap(room, art);
const place = (id: string) => room.places.get(id)!;
const ringAt = (cx: number, cy: number, r: number, next?: number): Ring => ({ round: 0, phase: 2, last: false, cx, cy, r, next, left: 60 });

describe('ring map', () => {
  it("has every leader's face, beaten or not, and mine (Cam, 11-04: \"I can't see my face anymore or the other faces\")", () => {
    const plots = map.plots({ spot: { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, gfx: 7 });
    expect(plots.gyms.length, 'all eight, from the start').toBe(8);
    expect(plots.gyms.every((g) => !g.beaten)).toBe(true);
    expect(plots.me?.gfx).toBe(7);
  });

  it('has the trainer in the section and cell they stand in', () => {
    const grid = (id: string) => { const s = SECTIONS.find((x) => x.id === id)!; return { x: s.x, y: s.y }; };
    expect(map.cellOf({ map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 })).toEqual(grid('MAPSEC_LITTLEROOT_TOWN'));
    // ROUTE 104 is one cell wide and three tall, its map 40 x 80 tiles.
    const r104 = grid('MAPSEC_ROUTE_104');
    expect(map.cellOf({ map: 'MAP_ROUTE104', x: 39, y: 79 })).toEqual({ x: r104.x, y: r104.y + 2 });
    expect(map.cellOf({ map: 'MAP_ROUTE104', x: 5, y: 30 })).toEqual({ x: r104.x, y: r104.y + 1 });
    // ROUTE 103: four cells across 80 tiles.
    const r103 = grid('MAPSEC_ROUTE_103');
    expect(map.cellOf({ map: 'MAP_ROUTE103', x: 61, y: 3 })).toEqual({ x: r103.x + 3, y: r103.y });
  });

  it('names the centre safe once the first ring has closed, and nowhere before or at the end', () => {
    const lr = place('MAP_LITTLEROOT_TOWN');
    const oldale = place('MAP_OLDALE_TOWN');
    expect(map.place(ringAt(oldale.gx + 4, oldale.gy + 15, 30))).toBe('OLDALE TOWN');
    expect(map.place(ringAt(lr.gx + 10, lr.gy + 10, 5))).toBe('LITTLEROOT TOWN');
    expect(map.place(ringAt(lr.gx + 10, lr.gy + 10, Infinity, 40))).toBe('');
    const last = { ...ringAt(lr.gx + 10, lr.gy + 10, -1), last: true };
    expect(map.place(last)).toBe('');
  });

  it('points the way out of the fog, one arrow or two', () => {
    const lr = place('MAP_LITTLEROOT_TOWN');
    const spot = { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 };
    const at = { x: lr.gx + 10.5, y: lr.gy + 10.5 };
    expect(map.way(spot, ringAt(at.x, at.y - 40, 5))).toBe('↑');
    expect(map.way(spot, ringAt(at.x + 30, at.y + 30, 5))).toBe('↓→');
    expect(map.way(spot, ringAt(at.x - 30, at.y - 10, 5))).toBe('←');
    // inside, no ring yet, and fog everywhere: nothing to point at
    expect(map.way(spot, ringAt(at.x + 2, at.y, 5))).toBe('');
    expect(map.way(spot, ringAt(at.x + 30, at.y, Infinity))).toBe('');
    expect(map.way(spot, ringAt(at.x + 30, at.y, -1))).toBe('');
  });

  it('indoors, looks and points from the building, never throws', () => {
    const inside = [...room.anchors.keys()].find((id) => !room.places.has(id) && room.anchors.get(id)!.gx > -1000)!;
    const spot = { map: inside, x: 3, y: 3 };
    const a = room.anchors.get(inside)!;
    // A ring far from the building, so it stands in the fog.
    const ring = ringAt(a.gx + 500, a.gy, 10);
    expect(map.way(spot, ring)).toBe('→');
    expect(() => map.pixelOf(spot)).not.toThrow();
    expect(map.way({ map: 'MAP_NOWHERE', x: 0, y: 0 }, ring)).toBe('');
  });
});
