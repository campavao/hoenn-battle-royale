// The encounter patches as each ROM deals them (src/br/br_patch.c), for the bots (Cam's
// 2026-10-14 play-test, POK-363: "the bot, just like a player, should trigger all of
// that"). The ROMs never tell the page where a map's patches are, and only the one a
// player stands on is dealt at all; the bots walk every map. So the page deals the same
// cells from the same list: tools/br/export-patches.py writes Eligible's cells for each
// map, and dealPatches is Pick() -- the seed's picks among them, by index.

/** One map's eligible cells (patches.json): its wild header row, its layout width, and
 *  the cells in row order as `start+len` runs. */
export interface PatchCells {
  header: number;
  w: number;
  runs: string;
}

export type PatchTable = Record<string, PatchCells>;

/** A patch: its PICKUP key and its cell, in the page's space (no MAP_OFFSET). */
export interface Patch {
  key: number;
  x: number;
  y: number;
}

/** include/br/br_patch.h. */
export const PATCH_KEY_BASE = 0x2000;
const PATCH_MAX = 8;
const PATCH_CELLS = 16;

/** br_patch.c's Mix, u32 for u32 (it is not quite mulberry32: its second step adds). */
function mix(t: number): number {
  t = (t + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t) >>> 0;
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
}

function cellsOf(entry: PatchCells): number[] {
  const out: number[] = [];
  for (const run of entry.runs.split(',')) {
    const [start, len] = run.split('+').map(Number);
    for (let i = 0; i < len; i++) out.push(start + i);
  }
  return out;
}

const cache = new Map<string, { seed: number; patches: Patch[] }>();

/** The patches a ROM deals on `mapId` (group/num `map`) under `seed`: none for a map
 *  with no cells or no seed, as BrPatch_Tick. */
export function dealPatches(table: PatchTable, mapId: string, map: { group: number; num: number }, seed: number): Patch[] {
  const hit = cache.get(mapId);
  if (hit && hit.seed === seed) return hit.patches;
  const entry = table[mapId];
  let patches: Patch[] = [];
  if (entry && seed !== 0) {
    const cells = cellsOf(entry);
    const want = Math.min(PATCH_MAX, Math.max(1, Math.floor(cells.length / PATCH_CELLS)));
    const key = ((map.group << 8) | map.num) << 8;
    const picks: number[] = [];
    for (let i = 0; i < want; i++) {
      let pick = mix((seed ^ 0x9a7c ^ key ^ i) >>> 0) % cells.length;
      // Distinct: a cell picked twice is the next one along, checked from the first again.
      for (let j = 0; j < i; j++) {
        if (picks[j] === pick) {
          pick = (pick + 1) % cells.length;
          j = -1;
        }
      }
      picks.push(pick);
    }
    patches = picks.map((pick, i) => ({
      key: PATCH_KEY_BASE | (entry.header << 3) | i,
      x: cells[pick] % entry.w,
      y: Math.floor(cells[pick] / entry.w),
    }));
  }
  cache.set(mapId, { seed, patches });
  return patches;
}

let loading: Promise<PatchTable> | null = null;

/** patches.json, fetched once and only by a page that runs bots. */
export function loadPatches(): Promise<PatchTable> {
  loading ??= import('../data/patches.json').then((m) => (m as { default: PatchTable }).default);
  return loading;
}
