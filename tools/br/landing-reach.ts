// Which drop cells can you actually leave? (POK-251.)
//
// The exporter writes every walkable outdoor cell it finds into landing.json, and the
// Director deals from all of them. But Hoenn is half ocean and half gated: Southern
// Island, the islets on Route 125, Lavaridge behind the cable car. A trainer dropped
// on one of those has no route to the rest of the match -- the fog closes on a section
// they cannot walk to, and they bleed out in a corner having never met anybody.
//
// So: flood the real world graph -- the very World the bots walk, bots/hoenn.ts's (no
// second implementation of seams, warps, ledges and surf to drift out of step) -- find
// the components, and mark every landing cell outside the biggest one `off`. The
// Director and the bots skip those; nothing else changes.
//
//   npx vite-node tools/br/landing-reach.ts
//
// Run it after tools/br/export-world.py. It rewrites web/src/data/landing.json.
import fs from 'node:fs';
import path from 'node:path';
import { HOENN } from '../../web/src/bots/hoenn';
import type { Spot } from '../../web/src/bots/world';

const DATA = path.resolve(import.meta.dirname, '../../web/src/data');
type Row = { map: string; x: number; y: number; off?: 1; door?: number };
const landing = (JSON.parse(fs.readFileSync(path.join(DATA, 'landing.json'), 'utf8')) as Row[])
  // The doorsteps below are rebuilt from scratch every run, so a previous run's are not
  // flooded as if they were ordinary cells.
  .filter((c) => c.door === undefined);
// world.json, indexed the one way the page indexes it (POK-331 #20).
const { maps, world } = HOENN;

// On foot. Surfing needs a water mon that knows SURF, which a trainer may never be
// dealt and a bot does not have until rung 30 -- so a drop that requires it is a drop
// that strands somebody. Route 108, the Abandoned Ship's island, is the case that
// made the point: reachable by surf, and two bots sat on it for a whole match.
const SURF = false;
// But CUT is free. Every contestant boots with all eight HMs (POK-256) and the free
// MOVES relearner is one menu away (POK-225), so a tree is a fence anybody in a match
// can open -- and treating it as a wall is what dropped the usable pool from 945 cells
// to 134 the moment trees stopped being walked straight through (POK-267).
const CUT = true;

const seen = new Map<string, number>();
const components: { id: number; cells: number }[] = [];
// A bridge's level is a place of its own (POK-331 #2): the Route 110 cycling road and the
// path under it share three cells, and reaching them from below first must not close
// them to the road.
const key = (s: Spot) => (s.z === undefined ? `${s.map}:${s.x},${s.y}` : `${s.map}:${s.x},${s.y}@${s.z}`);

function flood(from: Spot, id: number): number {
  if (seen.has(key(from))) return 0;
  let n = 0;
  const queue: Spot[] = [from];
  seen.set(key(from), id);
  while (queue.length > 0) {
    const at = queue.pop()!;
    n++;
    for (const { to } of world.neighbours(at, SURF, CUT)) {
      if (seen.has(key(to))) continue;
      seen.set(key(to), id);
      queue.push(to);
    }
  }
  return n;
}

for (const cell of landing) {
  const spot = { map: cell.map, x: cell.x, y: cell.y };
  const id = components.length;
  const cells = flood(spot, id);
  if (cells > 0) components.push({ id, cells });
}

const biggest = components.reduce((a, b) => (b.cells > a.cells ? b : a), { id: -1, cells: 0 });
let off = 0;
const byMap = new Map<string, number>();
for (const cell of landing) {
  // A cell on a bridge is dropped onto at no level -- pret spawns a trainer at height 0,
  // off at either -- which is a place nothing else walks onto, so its own flood is the
  // bridge and little more. It is in if either level is: it can walk off at that one.
  const at = { map: cell.map, x: cell.x, y: cell.y };
  const inside = [at, ...world.levels(cell.map, cell.x, cell.y).map((z) => ({ ...at, z }))];
  if (inside.some((s) => seen.get(key(s)) === biggest.id)) {
    delete cell.off;
  } else {
    cell.off = 1;
    off++;
    byMap.set(cell.map, (byMap.get(cell.map) ?? 0) + 1);
  }
}

// ---- doorsteps (POK-307) ----------------------------------------------------------
//
// Cam, after a drop that put him on the wrong map entirely: "if a location cannot be
// found, drop them in front of a Poke Center, a Poke Mart, or a Building."
//
// He is owed one either way, and half the towns the picker offers have nothing to give
// him: the flood above runs on foot, and on foot most of eastern Hoenn is across water,
// so Fortree, Lilycove, Mossdeep, Dewford, Pacifidlog, Sootopolis and Ever Grande come
// out of it with every cell marked off. Picking one used to deal a cell from ANYWHERE.
//
// A door's warp cell is the tile you step ONTO to go in; the tile you are put back on
// coming out is the one below it, which is where FieldCB_DefaultWarpExit lands you, so
// it is standable by construction -- and it is unmistakably in the town you picked.
// Ranked so the nicest answer comes first, which is Cam's own order.
const KIND_RANK: Record<string, number> = { centre: 0, mart: 1, gym: 2, door: 3 };
// ...except the Battle Frontier, which the match does not go to (POK-304 shut the ferry
// and the Frontier is an island you cannot walk off). The drop picker still offers it,
// because MAPSECTYPE_BATTLE_FRONTIER is one of the two types Emerald's own map lets you
// choose; with no cells and no doorsteps a pick there lands in the nearest real section
// of Hoenn instead, which is the right answer and needs no change to the ROM.
const NOT_IN_THE_MATCH = new Set(['MAPSEC_BATTLE_FRONTIER']);

const steps: Row[] = [];
for (const m of maps) {
  if (!m.outdoor || NOT_IN_THE_MATCH.has(m.section)) continue;
  for (const warp of m.warps ?? []) {
    const rank = KIND_RANK[warp.kind];
    if (rank === undefined) continue;
    const y = warp.y + 1;
    // world.standable rather than a second reading of the grid: one implementation of
    // what a cell is, the same one the flood and the bots use.
    if (!world.standable(m.id, warp.x, y)) continue;
    steps.push({ map: m.id, x: warp.x, y, door: rank });
  }
}
steps.sort((a, b) => (a.door ?? 9) - (b.door ?? 9));
landing.push(...steps);

fs.writeFileSync(path.join(DATA, 'landing.json'), JSON.stringify(landing));
console.log(`${steps.length} doorsteps, for the sections the flood left with nothing`);
console.log(`${components.length} components; the biggest holds ${biggest.cells} cells`);
console.log(`${off} of ${landing.length} landing cells marked off (${Math.round((off / landing.length) * 100)}%)`);
console.log(
  [...byMap]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([m, n]) => `${m.replace('MAP_', '')} ${n}`)
    .join(', '),
);
