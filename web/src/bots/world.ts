// The world as something to walk on (POK-236).
//
// `world.json` is the exporter's output (POK-235): one row a map, a run-length
// walkability grid, and the seams that join maps edge to edge. The Director reads the
// same file for landing cells and sections, but it never has to ask "can I stand
// here" or "where does this step land" -- a bot does, four times a second, for as long
// as the match runs. So this decodes the grids once and answers those two questions.
//
// Coordinates are map coords with no MAP_OFFSET, the way `landing.json` and the
// exporter write them; the wire adds MAP_OFFSET on its way to the ROM.

/** One map's row in world.json, with only what walking needs. */
export interface WorldMap {
  id: string;
  group: number;
  num: number;
  w: number;
  h: number;
  section: string;
  outdoor: boolean;
  grid: string;
  seams: { dir: SeamDir; to: string; offset: number }[];
}

export type SeamDir = 'north' | 'south' | 'east' | 'west';

/** A standing place: which map, and where on it. */
export interface Spot {
  map: string;
  x: number;
  y: number;
}

/** The exporter's cell classes. 0 is plain ground, 7 tall grass, 8 a door or warp
 *  tile -- all real tiles a trainer stands on. 3..6 are the four ledge directions,
 *  which can be stood on and only jumped one way. 1 and 2 are wall and water. */
const CLASS_WALL = 1;
const CLASS_WATER = 2;
const LEDGE_MIN = 3;
const LEDGE_MAX = 6;

/** Which way each ledge class can be crossed, and only that way. */
const LEDGE_DIR: Record<number, SeamDir> = {
  3: 'south',
  4: 'north',
  5: 'west',
  6: 'east',
};

const STEPS: { dir: SeamDir; dx: number; dy: number }[] = [
  { dir: 'north', dx: 0, dy: -1 },
  { dir: 'south', dx: 0, dy: 1 },
  { dir: 'west', dx: -1, dy: 0 },
  { dir: 'east', dx: 1, dy: 0 },
];

export function decodeGrid(grid: string, cells: number): Uint8Array {
  const out = new Uint8Array(cells);
  let at = 0;
  if (grid) {
    for (const token of grid.split(';')) {
      const [count, cls] = token.split('x').map(Number);
      for (let i = 0; i < count && at < cells; i++) out[at++] = cls;
    }
  }
  return out;
}

export class World {
  private readonly maps = new Map<string, WorldMap>();
  private readonly grids = new Map<string, Uint8Array>();

  constructor(maps: WorldMap[]) {
    for (const m of maps) {
      this.maps.set(m.id, m);
      this.grids.set(m.id, decodeGrid(m.grid, m.w * m.h));
    }
  }

  map(id: string): WorldMap | undefined {
    return this.maps.get(id);
  }

  /** The cell class, or the wall class for anything off the map or unknown. */
  cell(id: string, x: number, y: number): number {
    const m = this.maps.get(id);
    const grid = this.grids.get(id);
    if (!m || !grid || x < 0 || y < 0 || x >= m.w || y >= m.h) return CLASS_WALL;
    return grid[y * m.w + x];
  }

  /** Can a trainer on foot stand here? Water needs SURF, which is a later ticket's
   *  problem; a ledge tile is standable, it is only the crossing that is one-way. */
  standable(id: string, x: number, y: number): boolean {
    const cls = this.cell(id, x, y);
    return cls !== CLASS_WALL && cls !== CLASS_WATER;
  }

  /** Where one step in `dir` from `spot` lands -- the next cell, the map across a
   *  seam, or null when it is a wall, the void, or a ledge facing the wrong way. */
  step(spot: Spot, dir: SeamDir): Spot | null {
    const m = this.maps.get(spot.map);
    if (!m) return null;
    const move = STEPS.find((s) => s.dir === dir);
    if (!move) return null;
    const nx = spot.x + move.dx;
    const ny = spot.y + move.dy;
    if (nx >= 0 && ny >= 0 && nx < m.w && ny < m.h) {
      const cls = this.cell(spot.map, nx, ny);
      if (cls >= LEDGE_MIN && cls <= LEDGE_MAX && LEDGE_DIR[cls] === dir) {
        // A ledge taken the way it faces: the jump lands two cells on.
        const jx = nx + move.dx;
        const jy = ny + move.dy;
        return this.standable(spot.map, jx, jy) ? { map: spot.map, x: jx, y: jy } : null;
      }
      return this.standable(spot.map, nx, ny) ? { map: spot.map, x: nx, y: ny } : null;
    }
    return this.acrossSeam(m, spot, dir);
  }

  /** Off the edge: the seam that joins this map to the next, at the offset the
   *  exporter recorded. A connection's offset shifts the neighbour's axis, which is
   *  why this is not just "same coordinate on the other map". */
  private acrossSeam(m: WorldMap, spot: Spot, dir: SeamDir): Spot | null {
    const seam = m.seams.find((s) => s.dir === dir);
    if (!seam) return null;
    const to = this.maps.get(seam.to);
    if (!to) return null;
    let x: number;
    let y: number;
    switch (dir) {
      case 'north':
        x = spot.x - seam.offset;
        y = to.h - 1;
        break;
      case 'south':
        x = spot.x - seam.offset;
        y = 0;
        break;
      case 'west':
        x = to.w - 1;
        y = spot.y - seam.offset;
        break;
      default:
        x = 0;
        y = spot.y - seam.offset;
        break;
    }
    return this.standable(seam.to, x, y) ? { map: seam.to, x, y } : null;
  }

  /** Every step a trainer could take from here, with the direction that took it. */
  neighbours(spot: Spot): { dir: SeamDir; to: Spot }[] {
    const out: { dir: SeamDir; to: Spot }[] = [];
    for (const move of STEPS) {
      const to = this.step(spot, move.dir);
      if (to) out.push({ dir: move.dir, to });
    }
    return out;
  }
}

export function sameSpot(a: Spot, b: Spot): boolean {
  return a.map === b.map && a.x === b.x && a.y === b.y;
}

export function spotKey(s: Spot): string {
  return `${s.map}:${s.x},${s.y}`;
}
