import { describe, expect, it } from 'vitest';

import world from './world.json';
import regionmap from './regionmap.json';
import landing from './landing.json';
import worldMeta from './world.meta.json';

type Warp = { x: number; y: number; to: string; toX: number | null; toY: number | null; kind: string };
type Seam = { dir: 'north' | 'south' | 'east' | 'west'; to: string; offset: number };
type MapEntry = {
  id: string;
  group: number;
  num: number;
  w: number;
  h: number;
  section: string;
  outdoor: boolean;
  grid: string;
  seams: Seam[];
  warps: Warp[];
  centre: { counterX: number; counterY: number } | null;
};

const maps = (world as { maps: MapEntry[] }).maps;
const byId = new Map(maps.map((m) => [m.id, m]));

// The exporter's own run-length format: "<count>x<class>;<count>x<class>;..."
function decodeGrid(m: MapEntry): number[] {
  const cells: number[] = [];
  if (m.grid) {
    for (const token of m.grid.split(';')) {
      const [count, cls] = token.split('x').map(Number);
      for (let i = 0; i < count; i++) cells.push(cls);
    }
  }
  expect(cells.length).toBe(m.w * m.h);
  return cells;
}

function isWalkable(cls: number): boolean {
  // 0 walkable, 7 tall grass -- both fine to stand on. Ledges (3-6) are only
  // one-directional and doors/warps (8) still occupy a real, standable tile.
  return cls === 0 || cls === 7 || cls === 8 || (cls >= 3 && cls <= 6);
}

const OPPOSITE: Record<Seam['dir'], Seam['dir']> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

describe('world.json shape', () => {
  it('has at least one map and every id is unique', () => {
    expect(maps.length).toBeGreaterThan(0);
    expect(byId.size).toBe(maps.length);
  });

  it('every grid decodes to exactly w*h cells', () => {
    for (const m of maps) decodeGrid(m);
  });

  it('every outdoor map has a section in regionmap.json', () => {
    const sections = (regionmap as { sections: Record<string, unknown> }).sections;
    for (const m of maps) {
      if (m.outdoor) expect(sections[m.section]).toBeDefined();
    }
  });
});

describe('Littleroot -> Route 101 -> Oldale is a connected walk through seams', () => {
  const littleroot = byId.get('MAP_LITTLEROOT_TOWN')!;
  const route101 = byId.get('MAP_ROUTE101')!;
  const oldale = byId.get('MAP_OLDALE_TOWN')!;

  it('all three maps are exported', () => {
    expect(littleroot).toBeDefined();
    expect(route101).toBeDefined();
    expect(oldale).toBeDefined();
  });

  it('Littleroot has a seam into Route 101, and Route 101 has the reciprocal seam back', () => {
    const out = littleroot.seams.find((s) => s.to === 'MAP_ROUTE101');
    expect(out).toBeDefined();
    const back = route101.seams.find((s) => s.to === 'MAP_LITTLEROOT_TOWN');
    expect(back).toBeDefined();
    expect(back!.dir).toBe(OPPOSITE[out!.dir]);
  });

  it('Route 101 has a seam into Oldale, and Oldale has the reciprocal seam back', () => {
    const out = route101.seams.find((s) => s.to === 'MAP_OLDALE_TOWN');
    expect(out).toBeDefined();
    const back = oldale.seams.find((s) => s.to === 'MAP_ROUTE101');
    expect(back).toBeDefined();
    expect(back!.dir).toBe(OPPOSITE[out!.dir]);
  });

  it('so a bot can walk Littleroot -> Route 101 -> Oldale via seams alone', () => {
    const path = ['MAP_LITTLEROOT_TOWN', 'MAP_ROUTE101', 'MAP_OLDALE_TOWN'];
    for (let i = 0; i < path.length - 1; i++) {
      const from = byId.get(path[i])!;
      expect(from.seams.some((s) => s.to === path[i + 1])).toBe(true);
    }
  });
});

describe('landing.json', () => {
  const outdoorSections = new Set(maps.filter((m) => m.outdoor).map((m) => m.section));
  const sectionsWithLanding = new Set(landing.map((l: { map: string }) => byId.get(l.map)!.section));

  it('every outdoor section has at least one landing cell', () => {
    for (const section of outdoorSections) {
      expect(sectionsWithLanding.has(section)).toBe(true);
    }
  });

  it('every landing cell sits on a walkable, non-water, non-warp tile of its map', () => {
    const gridCache = new Map<string, number[]>();
    for (const entry of landing as { map: string; x: number; y: number }[]) {
      const m = byId.get(entry.map)!;
      let cells = gridCache.get(m.id);
      if (!cells) {
        cells = decodeGrid(m);
        gridCache.set(m.id, cells);
      }
      const cls = cells[entry.y * m.w + entry.x];
      expect(cls === 0 || cls === 7).toBe(true);
    }
  });

  it('never puts more than 48 landing cells in one section', () => {
    const perSection = new Map<string, number>();
    // Doorsteps do not count against the exporter's sampling cap: they are a separate
    // tier appended by landing-reach.ts, one per building rather than a sample of a
    // grid, and the drop only reaches them when a section has nothing else (POK-307).
    for (const entry of landing as { map: string; door?: number }[]) {
      if (entry.door !== undefined) continue;
      const section = byId.get(entry.map)!.section;
      perSection.set(section, (perSection.get(section) ?? 0) + 1);
    }
    for (const count of perSection.values()) expect(count).toBeLessThanOrEqual(48);
  });
});

describe('Pokemon Center counters', () => {
  const centers = maps.filter((m) => m.id.includes('POKEMON_CENTER_1F') && m.centre);

  it('found at least one Pokemon Center with a counter', () => {
    expect(centers.length).toBeGreaterThan(0);
  });

  it('every counter cell is reachable from the Center\'s own door warp', () => {
    for (const m of centers) {
      const cells = decodeGrid(m);
      const doorWarps = m.warps.filter((w) => w.kind === 'door' || w.kind === 'stairs' || w.kind === 'other');
      expect(doorWarps.length).toBeGreaterThan(0);

      const inBounds = (x: number, y: number) => x >= 0 && x < m.w && y >= 0 && y < m.h;
      const seen = new Set<number>();
      const queue: [number, number][] = [];
      for (const w of doorWarps) {
        const idx = w.y * m.w + w.x;
        if (!seen.has(idx)) {
          seen.add(idx);
          queue.push([w.x, w.y]);
        }
      }
      while (queue.length) {
        const [x, y] = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const idx = ny * m.w + nx;
          if (seen.has(idx)) continue;
          if (!isWalkable(cells[idx])) continue;
          seen.add(idx);
          queue.push([nx, ny]);
        }
      }
      const counterIdx = m.centre!.counterY * m.w + m.centre!.counterX;
      expect(seen.has(counterIdx)).toBe(true);
    }
  });
});

describe('Littleroot player house doors', () => {
  it('the door into a Littleroot player house is a warp of kind door', () => {
    const littleroot = byId.get('MAP_LITTLEROOT_TOWN')!;
    const houseWarps = littleroot.warps.filter(
      (w) => w.to === 'MAP_LITTLEROOT_TOWN_BRENDANS_HOUSE_1F' || w.to === 'MAP_LITTLEROOT_TOWN_MAYS_HOUSE_1F',
    );
    expect(houseWarps.length).toBeGreaterThan(0);
    for (const w of houseWarps) expect(w.kind).toBe('door');
  });
});

describe('world.json size budget', () => {
  // world.meta.json's gzip figure comes straight from the exporter (Python's
  // gzip.compress at level 9) right after it writes world.json, so this test
  // reports the same number the exporter printed rather than recompressing
  // in-process (which would need Node's zlib/fs typings this project doesn't
  // otherwise pull in).
  it('reports the gzip size the exporter measured and stays under the 400 KB target', () => {
    // eslint-disable-next-line no-console
    console.log(
      `world.json: ${worldMeta.worldJsonBytes} bytes raw, ${worldMeta.worldJsonGzipBytes} bytes gzipped`,
    );
    expect(worldMeta.worldJsonGzipBytes).toBeLessThan(400 * 1024);
  });
});
