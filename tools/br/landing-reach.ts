// Which drop cells can you actually leave? (POK-251.)
//
// The exporter writes every walkable outdoor cell it finds into landing.json, and the
// Director deals from all of them. But Hoenn is half ocean and half gated: Southern
// Island, the islets on Route 125, Lavaridge behind the cable car. A trainer dropped
// on one of those has no route to the rest of the match -- the fog closes on a section
// they cannot walk to, and they bleed out in a corner having never met anybody.
//
// So: flood the real world graph with the real World class (no second implementation
// of seams, warps, ledges and surf to drift out of step), find the components, and mark
// every landing cell outside the biggest one `off`. The Director and the bots skip
// those; nothing else changes.
//
//   npx vite-node tools/br/landing-reach.ts
//
// Run it after tools/br/export-world.py. It rewrites web/src/data/landing.json.
import fs from 'node:fs';
import path from 'node:path';
import { World, type Spot, type WorldMap } from '../../web/src/bots/world';

const DATA = path.resolve(import.meta.dirname, '../../web/src/data');
const maps = (JSON.parse(fs.readFileSync(path.join(DATA, 'world.json'), 'utf8')) as { maps: WorldMap[] }).maps;
const landing = JSON.parse(fs.readFileSync(path.join(DATA, 'landing.json'), 'utf8')) as {
  map: string;
  x: number;
  y: number;
  off?: 1;
}[];
const world = new World(maps);

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

function flood(from: Spot, id: number): number {
  const key = (s: Spot) => `${s.map}:${s.x},${s.y}`;
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
  const id = seen.get(`${cell.map}:${cell.x},${cell.y}`);
  if (id === biggest.id) {
    delete cell.off;
  } else {
    cell.off = 1;
    off++;
    byMap.set(cell.map, (byMap.get(cell.map) ?? 0) + 1);
  }
}

fs.writeFileSync(path.join(DATA, 'landing.json'), JSON.stringify(landing));
console.log(`${components.length} components; the biggest holds ${biggest.cells} cells`);
console.log(`${off} of ${landing.length} landing cells marked off (${Math.round((off / landing.length) * 100)}%)`);
console.log(
  [...byMap]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([m, n]) => `${m.replace('MAP_', '')} ${n}`)
    .join(', '),
);
