// The ring map: where the MAP opens on, what it names safe, which way out the fog is, and
// the fog it lays over the ROM's picture.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../src/bots/world';
import type { PatchTable } from '../src/bots/patches';
import worldJson from './data/world.json';
import patchJson from '../src/data/patches.json';
import sectionsJson from '../../src/data/region_map/region_map_sections.json';
import { RING_PHASE, makeRoom, type Ring } from './shared/room';
import { RingMap } from './ringmap';
import type { RomArt } from './romart';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const SECTIONS = (sectionsJson as { map_sections: { id: string; name: string; x: number; y: number; width: number; height: number }[] }).map_sections;
const letters = (t: string) => [...t].map((c) => (c === ' ' ? 0 : c >= '0' && c <= '9' ? 0xa1 + c.charCodeAt(0) - 48 : 0xbb + c.charCodeAt(0) - 65));
/** The ROM's tables as pret's json has them: the enum is the json's order. */
const SYMS: Record<string, number> = { gPlttBufferFaded: 0x02000000, gMain: 0x03000000 };
const art = {
  mapsec: (group: number, num: number) => SECTIONS.findIndex((s) => s.id === MAPS.find((m) => m.group === group && m.num === num)!.section),
  sym: (n: string) => SYMS[n],
  section: (id: number) => ({ x: SECTIONS[id].x, y: SECTIONS[id].y, w: SECTIONS[id].width, h: SECTIONS[id].height, letters: letters(SECTIONS[id].name) }),
} as unknown as RomArt;
const room = makeRoom(MAPS, patchJson as unknown as PatchTable, 12345);
const map = new RingMap(room, art);
const place = (id: string) => room.places.get(id)!;
const ringAt = (cx: number, cy: number, r: number, next?: number): Ring => ({ round: 0, phase: 2, last: false, cx, cy, r, next, left: 60 });

describe('ring map', () => {
  it('opens the MAP on the section and cell the trainer stands in', () => {
    expect(map.look({ map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 }, room.ring(2 * RING_PHASE)))
      .toMatchObject({ mapsec: 0, cellX: 0, cellY: 0, r: 127 });
    // ROUTE 104 is one cell wide and three tall, its map 40 x 80 tiles.
    expect(map.look({ map: 'MAP_ROUTE104', x: 39, y: 79 })).toMatchObject({ mapsec: 19, cellX: 0, cellY: 2 });
    expect(map.look({ map: 'MAP_ROUTE104', x: 5, y: 30 })).toMatchObject({ cellY: 1 });
    // ROUTE 103: four cells across 80 tiles.
    expect(map.look({ map: 'MAP_ROUTE103', x: 61, y: 3 })).toMatchObject({ mapsec: 18, cellX: 3, cellY: 0 });
  });

  it('names the centre safe once the first ring has closed, and nowhere before or at the end', () => {
    const lr = place('MAP_LITTLEROOT_TOWN');
    const oldale = place('MAP_OLDALE_TOWN');
    expect(map.place(ringAt(oldale.gx + 4, oldale.gy + 15, 30))).toBe('OLDALE TOWN');
    expect(map.look({ map: 'MAP_LITTLEROOT_TOWN', x: 1, y: 1 }, ringAt(lr.gx + 10, lr.gy + 10, 5)).place).toEqual(letters('LITTLEROOT TOWN'));
    expect(map.place(ringAt(lr.gx + 10, lr.gy + 10, Infinity, 40))).toBe('');
    const last = { ...ringAt(lr.gx + 10, lr.gy + 10, -1), last: true };
    expect(map.place(last)).toBe('');
    expect(map.look({ map: 'MAP_LITTLEROOT_TOWN', x: 1, y: 1 }, last)).toMatchObject({ r: -1, place: [] });
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
    expect(() => map.look(spot, ring)).not.toThrow();
    expect(map.way({ map: 'MAP_NOWHERE', x: 0, y: 0 }, ring)).toBe('');
  });

  it('blends the fog over the picture, solid over a sprite under it, none over the cursor', () => {
    // The picture all one colour, RGB(8, 16, 24); the fog, RGB(13, 3, 22), in BG palette 10.
    const mem = new Map<number, number>();
    const fogColour = 13 | (3 << 5) | (22 << 10);
    mem.set(SYMS.gPlttBufferFaded + (10 * 16 + 1) * 2, fogColour);
    // OBJ palette 1 holds the picture's colour; every OAM entry hidden but two 16x16 ones.
    const lcdColour = 8 | (16 << 5) | (24 << 10);
    mem.set(SYMS.gPlttBufferFaded + (256 + 16 + 3) * 2, lcdColour);
    const oam = (k: number, x: number, y: number, priority: number, pal: number) => {
      mem.set(SYMS.gMain + 0x38 + k * 8, y);
      mem.set(SYMS.gMain + 0x38 + k * 8 + 2, x | (1 << 14));
      mem.set(SYMS.gMain + 0x38 + k * 8 + 4, (priority << 10) | (pal << 12));
    };
    for (let k = 0; k < 128; k++) mem.set(SYMS.gMain + 0x38 + k * 8, 2 << 8);
    oam(0, 40, 40, 1, 1); // the cursor
    oam(1, 100, 60, 2, 1); // a gym head
    oam(2, 160, 80, 2, 2); // one whose colours the picture has none of
    const emu = {
      read: (a: number) => mem.get(a) ?? 0,
      lcdPixels: (out: Uint8ClampedArray) => {
        for (let i = 0; i < out.length; i += 4) out.set([8 << 3, 16 << 3, 24 << 3, 255], i);
        return true;
      },
    };
    // A ring nowhere near the MAP: every grid pixel fogged.
    const px = map.fog(emu, 0, ringAt(1e6, 1e6, 1));
    const rgb = (p: number) => [p & 0xff, (p >> 8) & 0xff, (p >> 16) & 0xff].map((v) => v >> 3);
    // (10 fog + 6 picture) / 16 per channel
    expect(rgb(px[30 * 240 + 20])).toEqual([11, 7, 22]);
    expect(rgb(px[65 * 240 + 105])).toEqual([13, 3, 22]);
    expect(px[45 * 240 + 45]).toBe(0);
    expect(rgb(px[85 * 240 + 165])).toEqual([11, 7, 22]);
    // the frame round the grid, and the prompt's row under it, are the ROM's own
    expect(px[5 * 240 + 120]).toBe(0);
    expect(px[150 * 240 + 120]).toBe(0);
    expect(px[30 * 240 + 4]).toBe(0);
  });

  it('blinks what the next ring takes, 48 frames on and 48 off', () => {
    const lr = place('MAP_LITTLEROOT_TOWN');
    const emu = { read: () => 0, lcdPixels: (out: Uint8ClampedArray) => { out.fill(0); return true; } };
    const count = (f: number, ring: Ring) => map.fog(emu as never, f, ring).reduce((n, p) => n + (p ? 1 : 0), 0);
    const announced = ringAt(lr.gx + 10, lr.gy + 10, Infinity, 30);
    expect(count(0, announced)).toBeGreaterThan(20000);
    expect(count(48, announced)).toBe(0);
    const closing = ringAt(lr.gx + 10, lr.gy + 10, 60, 30);
    expect(count(47, closing)).toBeGreaterThan(count(48, closing));
    expect(count(95, closing)).toBe(count(48, closing));
  });
  it("marks the MAP with the room's beaten leaders and this round's events, grey once taken", () => {
    const r = makeRoom(MAPS, patchJson as unknown as PatchTable, 12345);
    const m = new RingMap(r, art);
    expect(m.marks()).toEqual({ gyms: 0, events: [] });
    r.gyms.push([0, 'ROXANNE'], [2, 'WATTSON']);
    const spill = (key: number) => r.spills.set(key, { key, map: 'MAP_ROUTE110', x: 12, y: 30, name: '', bag: { items: [], money: 0, mons: [] } });
    r.events.push({ n: 0, key: 7, map: 'MAP_ROUTE110', x: 12, y: 30, species: 0 });
    r.events.push({ n: 1, key: 8, map: 'MAP_ROUTE110', x: 12, y: 31, species: 144 });
    r.events.push({ n: 2, key: 9, map: 'MAP_ROUTE110', x: 12, y: 32, species: 145 });
    spill(8); spill(9); r.picked.set(9, 1);
    const route110 = SECTIONS.findIndex((x) => x.id === 'MAPSEC_ROUTE_110');
    expect(m.marks()).toEqual({
      gyms: 0b101,
      // A story with no legendary is never grey; one lying on the ground is not taken yet.
      events: [{ mapsec: route110, taken: false }, { mapsec: route110, taken: false }, { mapsec: route110, taken: true }],
    });
    r.spills.delete(8);
    expect(m.marks().events[1].taken).toBe(true);
  });
});
