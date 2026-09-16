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
  /** Doors, stairs and mats: stepping onto one lands you somewhere else entirely.
   *  The exporter writes each map's own, and Emerald's warps come in pairs, so the
   *  way back is on the other map's list. */
  warps?: Warp[];
  /** Where the nurse's counter is, on the sixteen maps that have one. */
  centre?: { counterX: number; counterY: number };
}

export interface Warp {
  x: number;
  y: number;
  to: string;
  toX: number;
  toY: number;
  kind: string;
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
/** A cuttable tree or a smashable rock: the exporter overlays these at their object
 *  event's cell, because in Emerald they are objects rather than metatile behaviours.
 *  Nothing checked for them until POK-267, so bots walked through trees. */
const CLASS_CUT = 9;
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
  private readonly warps = new Map<string, Warp>();

  constructor(maps: WorldMap[]) {
    for (const m of maps) {
      this.maps.set(m.id, m);
      this.grids.set(m.id, decodeGrid(m.grid, m.w * m.h));
      for (const w of m.warps ?? []) this.warps.set(`${m.id}:${w.x},${w.y}`, w);
    }
  }

  /** The warp on this cell, if there is one. A door is a tile you walk onto, not a
   *  tile you walk through: this fires on arriving, which is why walking back out of
   *  a building works without any special case. */
  warpAt(id: string, x: number, y: number): Warp | undefined {
    return this.warps.get(`${id}:${x},${y}`);
  }

  /** Every Pokemon Centre in the world, with the tile you talk to the nurse from. */
  centres(): { mapId: string; x: number; y: number }[] {
    const out: { mapId: string; x: number; y: number }[] = [];
    for (const m of this.maps.values()) {
      if (m.centre) out.push({ mapId: m.id, x: m.centre.counterX, y: m.centre.counterY });
    }
    return out;
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

  /** Can a trainer stand here? A ledge tile is standable, it is only the crossing
   *  that is one-way. Water is not, unless they are surfing -- and a bot that can
   *  surf is the only thing that gets off Route 125 or Southern Island, where the
   *  drop is perfectly happy to put one. */
  standable(id: string, x: number, y: number, surf = false, cut = false): boolean {
    const cls = this.cell(id, x, y);
    if (cls === CLASS_WALL) return false;
    if (cls === CLASS_CUT) return cut;
    return cls !== CLASS_WATER || surf;
  }

  /** Where one step in `dir` from `spot` lands -- the next cell, the map across a
   *  seam, or null when it is a wall, the void, or a ledge facing the wrong way. */
  step(spot: Spot, dir: SeamDir, surf = false, cut = false): Spot | null {
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
        return this.standable(spot.map, jx, jy, surf, cut) ? { map: spot.map, x: jx, y: jy } : null;
      }
      if (!this.standable(spot.map, nx, ny, surf, cut)) return null;
      const warp = this.warpAt(spot.map, nx, ny);
      if (warp) {
        // Through the door. The landing is the other side's own cell, so this is a
        // `place` on the wire rather than a step -- the same as crossing a seam.
        return this.maps.has(warp.to) ? { map: warp.to, x: warp.toX, y: warp.toY } : null;
      }
      return { map: spot.map, x: nx, y: ny };
    }
    return this.acrossSeam(m, spot, dir, surf, cut);
  }

  /** Off the edge: the seam that joins this map to the next, at the offset the
   *  exporter recorded. A connection's offset shifts the neighbour's axis, which is
   *  why this is not just "same coordinate on the other map". */
  private acrossSeam(m: WorldMap, spot: Spot, dir: SeamDir, surf = false, cut = false): Spot | null {
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
    return this.standable(seam.to, x, y, surf, cut) ? { map: seam.to, x, y } : null;
  }

  /** Every step a trainer could take from here, with the direction that took it. */
  neighbours(spot: Spot, surf = false, cut = false): { dir: SeamDir; to: Spot }[] {
    const out: { dir: SeamDir; to: Spot }[] = [];
    for (const move of STEPS) {
      const to = this.step(spot, move.dir, surf, cut);
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
