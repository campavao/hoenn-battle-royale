// Cam's own drop cells (POK-314): the ones he paints on, and the ones he paints off.
//
// landing-hand.json is one array, a row a cell. `{map, x, y}` is a PICK: a section with
// any deals from them first. `{map, x, y, veto: 1}` is a VETO: a cell the exporter calls
// walkable and the flood calls reachable that nobody would ever stand on -- Cam, on the
// Route 117 Day Care yard POK-307 dropped him into: "even tho that section is technically
// walkable, it should not be possible since there is no way to normally get in there in
// the game." Roofs, the strips behind buildings and fenced gardens are the same shape.
// `veto` rather than `off`, which already means "the flood marked it".
//
// Pure, so the painter (painter.ts), landing.ts and the tests share one reading of it.
import type { World, WorldMap } from '../bots/world';
import type { LandingCell } from './director';

/** One row of landing-hand.json. */
export interface HandRow {
  map: string;
  x: number;
  y: number;
  veto?: 1;
}

type At = { map: string; x: number; y: number };

export function cellKey(c: At): string {
  return `${c.map}:${c.x},${c.y}`;
}

/** The file's picks, and its vetoes as cellKeys. */
export function splitHand(rows: readonly unknown[]): { picks: LandingCell[]; veto: Set<string> } {
  const picks: LandingCell[] = [];
  const veto = new Set<string>();
  for (const row of rows as HandRow[]) {
    if (row.veto) veto.add(cellKey(row));
    else picks.push({ map: row.map, x: row.x, y: row.y });
  }
  return { picks, veto };
}

/** landing.json's two pools less the vetoed cells: the ordinary cells (not marked off by
 *  the flood, not a doorstep) and the doorsteps. A veto is per cell and over the whole
 *  map, not only today's cells: export-world.py re-samples every section on each export,
 *  so a yard is vetoed as an area and whatever lands in it next time stays out too. */
export function withoutVetoes(
  all: readonly LandingCell[],
  veto: ReadonlySet<string>,
): { landing: LandingCell[]; doorsteps: LandingCell[] } {
  const kept = all.filter((c) => !veto.has(cellKey(c)));
  return {
    landing: kept.filter((c) => !c.off && c.door === undefined),
    doorsteps: kept.filter((c) => c.door !== undefined),
  };
}

/** The cells of `map` a trainer can walk from to one of `to` without leaving the map, one
 *  flag a cell, row-major. On foot with CUT -- every contestant boots with the HMs
 *  (POK-256), the same kit landing-reach.ts floods with -- and over the World's own steps,
 *  so heights count: a cliff top one step from the street is not the street (POK-331 #2),
 *  and neither is a tree top, which Emerald's collision bits call passable.
 *
 *  Towards `to` rather than out from it, because a drop is one way. Somebody put on a cell
 *  has to be able to walk OFF it, and a pit below a ledge is somewhere you can get into and
 *  never out of. */
export function walksTo(world: World, map: WorldMap, to: Iterable<{ x: number; y: number }>): Uint8Array {
  const cells = map.w * map.h;
  // Every step on the map, backwards: into[j] is each cell a step onto j is taken from.
  const into: number[][] = Array.from({ length: cells }, () => []);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (!world.standable(map.id, x, y, false, true)) continue;
      for (const { to: t } of world.neighbours({ map: map.id, x, y }, false, true)) {
        if (t.map === map.id) into[t.y * map.w + t.x].push(y * map.w + x);
      }
    }
  }
  const out = new Uint8Array(cells);
  const queue: number[] = [];
  for (const c of to) {
    if (c.x < 0 || c.y < 0 || c.x >= map.w || c.y >= map.h) continue;
    const i = c.y * map.w + c.x;
    if (out[i]) continue;
    out[i] = 1;
    queue.push(i);
  }
  for (let q = 0; q < queue.length; q++) {
    for (const i of into[queue[q]]) {
      if (out[i]) continue;
      out[i] = 1;
      queue.push(i);
    }
  }
  return out;
}

const ROW_KEYS = new Set(['map', 'x', 'y', 'veto']);

/** Everything wrong with a hand file against the world it is dealt in; empty when nothing.
 *  `seeds` are the cells the drop already deals -- landing.json's live cells and doorsteps
 *  -- and a pick has to be able to walk to one of them on its own map (walksTo), which is
 *  what makes it as good a drop as a doorstep at worst. The file's own vetoes come off the
 *  seeds first. A veto only has to be somewhere feet could be: vetoing a wall says nothing. */
export function handProblems(
  rows: readonly unknown[],
  maps: ReadonlyMap<string, WorldMap>,
  world: World,
  seeds: readonly LandingCell[],
): string[] {
  const problems: string[] = [];
  const good: HandRow[] = [];
  for (const [i, row] of rows.entries()) {
    const r = row as Record<string, unknown> | null;
    const ok =
      typeof r === 'object' &&
      r !== null &&
      typeof r.map === 'string' &&
      Number.isInteger(r.x) &&
      Number.isInteger(r.y) &&
      (r.veto === undefined || r.veto === 1) &&
      Object.keys(r).every((k) => ROW_KEYS.has(k));
    if (ok) good.push(r as unknown as HandRow);
    else problems.push(`row ${i}: ${JSON.stringify(row)} is neither {map, x, y} nor {map, x, y, veto: 1}`);
  }
  const { veto } = splitHand(good);
  const live = seeds.filter((c) => !veto.has(cellKey(c)));
  const reach = new Map<string, Uint8Array>();
  const seen = new Map<string, boolean>();
  for (const cell of good) {
    const k = cellKey(cell);
    const vetoed = cell.veto === 1;
    const label = `${vetoed ? 'veto' : 'pick'} ${k}`;
    const m = maps.get(cell.map);
    if (!m) {
      problems.push(`${label}: there is no such map`);
      continue;
    }
    if (!m.outdoor) {
      problems.push(`${label}: indoors, where the drop never goes`);
      continue;
    }
    if (cell.x < 0 || cell.y < 0 || cell.x >= m.w || cell.y >= m.h) {
      problems.push(`${label}: off the ${m.w}x${m.h} map`);
      continue;
    }
    if (seen.has(k)) {
      problems.push(seen.get(k) === vetoed ? `${label}: written twice` : `${k}: both picked and vetoed`);
      continue;
    }
    seen.set(k, vetoed);
    if (vetoed) {
      if (!world.standable(m.id, cell.x, cell.y, false, true)) problems.push(`${label}: a wall or water, where nobody lands anyway`);
      continue;
    }
    if (!world.standable(m.id, cell.x, cell.y)) {
      problems.push(`${label}: not standable -- a wall, water or a tree to cut`);
      continue;
    }
    let flags = reach.get(m.id);
    if (!flags) {
      flags = walksTo(world, m, live.filter((c) => c.map === m.id));
      reach.set(m.id, flags);
    }
    if (!flags[cell.y * m.w + cell.x]) {
      problems.push(`${label}: cannot walk from there to any cell the drop deals on its map -- a cliff top, a tree top or a pit`);
    }
  }
  return problems;
}

/** The cells of the rectangle with corners `a` and `b`, both included, row by row. */
export function rectCells(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y });
  }
  return out;
}

/** The file as it is committed: sorted by map, then row, then column, and a row a line,
 *  so a diff of Cam's next pass shows the cells he changed and nothing else. */
export function handJson(rows: readonly HandRow[]): string {
  const sorted = [...rows].sort((a, b) => a.map.localeCompare(b.map) || a.y - b.y || a.x - b.x);
  if (sorted.length === 0) return '[]\n';
  const line = (r: HandRow) => JSON.stringify(r.veto ? { map: r.map, x: r.x, y: r.y, veto: 1 } : { map: r.map, x: r.x, y: r.y });
  return `[\n${sorted.map(line).join(',\n')}\n]\n`;
}
