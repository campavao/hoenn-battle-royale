// pret's own map data, read off disk: where each map's neighbours sit (data/maps/*/map.json
// connections), for the still check's `around` (still.ts). Node side only.
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve(import.meta.dirname, '../../data');
// The page cuts a still of every outdoor map out of the ROM (web/src/art).
const WORLD = path.resolve(import.meta.dirname, '../src/data/world.json');
let outdoor: Set<string> | null = null;
const hasStill = (id: string) =>
  (outdoor ??= new Set((JSON.parse(fs.readFileSync(WORLD, 'utf8')) as { maps: { id: string; outdoor?: boolean }[] }).maps.filter((m) => m.outdoor).map((m) => m.id))).has(id);

type MapJson = { id: string; layout: string; connections?: { map: string; offset: number; direction: string }[] | null };
type Known = { ref: string; folder: string; json: MapJson; width: number; height: number };

let known: Map<string, Known> | null = null;

function load(): Map<string, Known> {
  if (known) return known;
  const groups = JSON.parse(fs.readFileSync(path.join(DATA, 'maps/map_groups.json'), 'utf8')) as Record<string, string[]> & { group_order: string[] };
  const layouts = new Map<string, { width: number; height: number }>();
  for (const l of (JSON.parse(fs.readFileSync(path.join(DATA, 'layouts/layouts.json'), 'utf8')) as { layouts: { id?: string; width: number; height: number }[] }).layouts) {
    if (l.id) layouts.set(l.id, l);
  }
  known = new Map();
  groups.group_order.forEach((g, group) => groups[g].forEach((folder, num) => {
    const json = JSON.parse(fs.readFileSync(path.join(DATA, 'maps', folder, 'map.json'), 'utf8')) as MapJson;
    const l = layouts.get(json.layout);
    if (l) known!.set(json.id, { ref: `${group}:${num}`, folder, json, width: l.width, height: l.height });
  }));
  return known;
}

/** 'group:num' of a MAP_ id. */
export function mapRef(id: string): string {
  const m = load().get(id);
  if (!m) throw new Error(`no map ${id}`);
  return m.ref;
}

/** Each map's neighbours and their top-left in its pixels, for every map named and every
 *  map joined to one of them; and the still of each. */
export function aroundOf(ids: string[]): { around: Record<string, { ref: string; dx: number; dy: number }[]>; stills: Record<string, string> } {
  const all = load();
  const around: Record<string, { ref: string; dx: number; dy: number }[]> = {};
  const stills: Record<string, string> = {};
  for (const id of ids) {
    const m = all.get(id);
    if (!m) throw new Error(`no map ${id}`);
    if (hasStill(id)) stills[m.ref] = `/field-maps/${id}.png`;
    around[m.ref] = [];
    for (const c of m.json.connections ?? []) {
      const n = all.get(c.map);
      if (!n) continue;
      const off = c.offset * 16;
      const at =
        c.direction === 'up' ? { dx: off, dy: -n.height * 16 }
        : c.direction === 'down' ? { dx: off, dy: m.height * 16 }
        : c.direction === 'left' ? { dx: -n.width * 16, dy: off }
        : c.direction === 'right' ? { dx: m.width * 16, dy: off }
        : null;
      if (!at) continue; // dive and emerge join nothing on screen
      around[m.ref].push({ ref: n.ref, ...at });
      if (hasStill(c.map)) stills[n.ref] = `/field-maps/${c.map}.png`;
    }
  }
  return { around, stills };
}
