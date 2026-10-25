// Which drop cells can you actually leave? (POK-251.)
//
// The exporter writes every walkable outdoor cell it finds into landing.json, and the
// Director deals from all of them. But Hoenn is half ocean and half gated: Southern
// Island, the islets on Route 125, Lavaridge behind the cable car. A trainer dropped
// on one of those has no route to the rest of the match -- the fog closes on a section
// they cannot walk to, and they bleed out in a corner having never met anybody.
//
// So: flood the real world graph -- the very World the bots walk, bots/hoenn.ts's (no
// second implementation of seams, warps, ledges and surf to drift out of step) from
// Littleroot, keep the cells you can reach and come back from, and mark every landing
// cell outside that set `off`. The Director and the bots skip those; nothing else changes.
//
//   npx vite-node tools/br/landing-reach.ts
//
// Run it after tools/br/export-world.py. It rewrites web/src/data/landing.json.
import fs from 'node:fs';
import path from 'node:path';
import { loadHoenn } from '../../web/src/bots/hoenn';
import type { Spot } from '../../web/src/bots/world';

const DATA = path.resolve(import.meta.dirname, '../../web/src/data');
type Row = { map: string; x: number; y: number; off?: 1; door?: number; open?: 1 };
const landing = (JSON.parse(fs.readFileSync(path.join(DATA, 'landing.json'), 'utf8')) as Row[])
  // The doorsteps below are rebuilt from scratch every run, so a previous run's are not
  // flooded as if they were ordinary cells.
  .filter((c) => c.door === undefined);
// world.json, indexed the one way the page indexes it (POK-331 #20), and fetched the way
// the page fetches it.
const { maps, world } = await loadHoenn();

// Surfing too, since the HMs went (2026-10-13, br_hm.h): walk into the water and you are
// surfing, with no Pokemon that knows the move, and the bots cross it the same way
// (bots/brain.ts, canSurf). On foot alone, everything east of Route 118 was across water
// and off, so the ring could never close on Lilycove, Mossdeep or Sootopolis.
const SURF = true;
// And CUT is free: there are no trees left to cut (br_strip.h).
const CUT = true;

// A bridge's level is a place of its own (POK-331 #2): the Route 110 cycling road and the
// path under it share three cells, and reaching them from below first must not close
// them to the road.
const key = (s: Spot) => (s.z === undefined ? `${s.map}:${s.x},${s.y}` : `${s.map}:${s.x},${s.y}@${s.z}`);

// The cells you can get to from Littleroot AND get back from: a ledge or a one-way warp
// is a way in that is not a way out, so the reach is the strongly connected set around
// the start, not whatever a flood from the first landing cell happened to touch. Forward
// from Littleroot, keeping every edge backwards, then back along them. That is stricter
// than a drop needs on purpose: a cell you can leave but never reach again (LAVARIDGE,
// down its ledges) is a fair drop but a bad ring centre, and one set serves both. Routes
// 131-134's currents run one way in the ROM and both ways here, so out there the set is a
// little generous.
const START = landing.find((c) => c.map === 'MAP_LITTLEROOT_TOWN')!;
const forward = new Set<string>();
const back = new Map<string, Spot[]>();
{
  const from: Spot = { map: START.map, x: START.x, y: START.y };
  const queue: Spot[] = [from];
  forward.add(key(from));
  while (queue.length > 0) {
    const at = queue.pop()!;
    for (const { to } of world.neighbours(at, SURF, CUT)) {
      const k = key(to);
      let into = back.get(k);
      if (!into) back.set(k, (into = []));
      into.push(at);
      if (forward.has(k)) continue;
      forward.add(k);
      queue.push(to);
    }
  }
}
const reach = new Set<string>([key({ map: START.map, x: START.x, y: START.y })]);
{
  const queue = [...reach];
  while (queue.length > 0) {
    const k = queue.pop()!;
    for (const prev of back.get(k) ?? []) {
      const pk = key(prev);
      if (reach.has(pk)) continue;
      reach.add(pk);
      queue.push(pk);
    }
  }
}

let off = 0;
const byMap = new Map<string, number>();
for (const cell of landing) {
  // A cell on a bridge is dropped onto at no level -- pret spawns a trainer at height 0,
  // off at either -- which is a place nothing else walks onto, so its own flood is the
  // bridge and little more. It is in if either level is: it can walk off at that one.
  const at = { map: cell.map, x: cell.x, y: cell.y };
  const inside = [at, ...world.levels(cell.map, cell.x, cell.y).map((z) => ({ ...at, z }))];
  if (inside.some((s) => reach.has(key(s)))) {
    delete cell.off;
  } else {
    cell.off = 1;
    off++;
    byMap.set(cell.map, (byMap.get(cell.map) ?? 0) + 1);
  }
}

// ---- open ground (HBR-41) -----------------------------------------------------------
//
// Where a legendary may stand. Cam, 2026-10-20, after a KYOGRE between two columns of
// trees: "only spawn it at the centre of a 3x3 area of walkable tiles", no ledges. Plain
// ground and tall grass, the two classes the exporter deals landing cells from, all
// round the cell; a ledge, water, a tree or a door anywhere in the nine is not open.
const GROUND = new Set([0, 7]);
let open = 0;
for (const cell of landing) {
  delete cell.open;
  if (cell.off) continue;
  let all = true;
  for (let dy = -1; dy <= 1 && all; dy++)
    for (let dx = -1; dx <= 1 && all; dx++) all = GROUND.has(world.cell(cell.map, cell.x + dx, cell.y + dy));
  if (all) {
    cell.open = 1;
    open++;
  }
}

// ---- doorsteps (POK-307) ----------------------------------------------------------
//
// Cam, after a drop that put him on the wrong map entirely: "if a location cannot be
// found, drop them in front of a Poke Center, a Poke Mart, or a Building."
//
// He is owed one either way, and half the towns the picker offers have nothing to give
// him: the flood above ran on foot, and on foot most of eastern Hoenn was across water,
// so Fortree, Lilycove, Mossdeep, Dewford, Pacifidlog, Sootopolis and Ever Grande came
// out of it with every cell marked off. Picking one used to deal a cell from ANYWHERE.
// Surfing, Sootopolis (in its crater: the way in is a dive the world does not model)
// and Lavaridge (behind the cable car and Jagged Pass's ledges) are the two left.
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
console.log(`${open} landing cells on open ground`);
console.log(`${steps.length} doorsteps, for the sections the flood left with nothing`);
console.log(`${reach.size} cells there and back from Littleroot`);
console.log(`${off} of ${landing.length} landing cells marked off (${Math.round((off / landing.length) * 100)}%)`);
console.log(
  [...byMap]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([m, n]) => `${m.replace('MAP_', '')} ${n}`)
    .join(', '),
);
