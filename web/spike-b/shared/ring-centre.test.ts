// Where the ring closes (Cam, 11-22: "it still feels like the ring only closes on early game
// routes ... even late game ones?"). The first towns and routes are many small maps, so a centre
// drawn map by map fell on them 43% of the time. Drawn cell by cell, each third of Hoenn by the
// story's order gets about a third of the rings.
import { expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { makeRoom } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const EARLY = ['DEWFORD_TOWN', 'LITTLEROOT_TOWN', 'OLDALE_TOWN', 'PETALBURG_CITY', 'ROUTE101', 'ROUTE102', 'ROUTE103', 'ROUTE104', 'ROUTE106', 'ROUTE107', 'ROUTE109', 'ROUTE110', 'ROUTE116', 'RUSTBORO_CITY', 'SLATEPORT_CITY'];
const LATE = ['EVER_GRANDE_CITY', 'FORTREE_CITY', 'LILYCOVE_CITY', 'MOSSDEEP_CITY', 'ROUTE118', 'ROUTE119', 'ROUTE120', 'ROUTE121', 'ROUTE122', 'ROUTE123'];

it('closes on the late towns and routes as often as on the first ones', () => {
  const band = { early: 0, mid: 0, late: 0 };
  const seen = new Set<string>();
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const room = makeRoom(MAPS, PATCHES, seed);
    const priv = room as unknown as { places: Map<string, { gx: number; gy: number }> };
    const c = room.centre(0);
    if (c.final) continue;
    let best = '', bd = Infinity;
    for (const s of room.landed()) {
      const p = priv.places.get(s.map)!;
      const d = Math.hypot(p.gx + s.x + 0.5 - c.cx, p.gy + s.y + 0.5 - c.cy);
      if (d < bd) { bd = d; best = s.map.replace('MAP_', ''); }
    }
    seen.add(best);
    band[EARLY.includes(best) ? 'early' : LATE.includes(best) ? 'late' : 'mid']++;
  }
  const all = band.early + band.mid + band.late;
  expect(band.late / all, JSON.stringify(band)).toBeGreaterThan(0.25);
  expect(band.early / all, JSON.stringify(band)).toBeLessThan(0.4);
  for (const m of ['LILYCOVE_CITY', 'MOSSDEEP_CITY', 'ROUTE119', 'ROUTE120', 'ROUTE123', 'FORTREE_CITY']) expect(seen.has(m), m).toBe(true);
}, 300_000);
