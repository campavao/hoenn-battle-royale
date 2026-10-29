// Bots all over Hoenn, so a spectator sees the whole map playing out. A bot wanders the
// way Emerald's own townsfolk do (MovementType_WanderAround, event_object_movement.c):
// stand a while (sMovementDelaysMedium: 32, 64, 96 or 128 frames), pick a direction, and
// walk one tile that way at walking pace; a way that is shut, or a ledge, it only faces.
// The facing and the shut way are the Room's (Room.move), so every copy of the room
// agrees; the host only picks when and where, and everybody else just gets its keys.

import { decodeGrid, sameSpot, type SeamDir, type Spot, type WorldMap } from '../../src/bots/world';
import { findPath, findPathToAny, type Path } from '../../src/bots/path';
import { KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, type Actor, type Room } from './room';

// The wardrobe (br_ghosts.c sSkinGraphics, career.ts SKINS): a bot wears a skin so the
// trainer you walk up to is the trainer the ROM puts in the battle.
export const SKIN_GFX = [0, 89, 100, 105, 55, 45, 31, 32, 42, 43, 21, 22, 25, 18, 35, 47];
export const SKIN_NAME = ['BRENDAN', 'MAY', 'BRENDAN', 'MAY', 'HIKER', 'BEAUTY', 'CAMPER', 'PICNIC', 'SWIMMER', 'SWIMMER', 'EXPERT', 'EXPERT', 'POKEFAN', 'POKEFAN', 'JOEY', 'LASS'];
export const botSkin = (n: number) => 4 + (n % 12);

/** `wait`: frames left to stand; `dir`: the way it went last. A bot with somewhere to be
 *  (inside the coming ring, or at an event) walks `steps` there; `plan` is the round and
 *  phase it last chose for, and `stuck` the frames it has pressed without moving. */
export interface Brain { rng: number; wait: number; dir: number; plan?: string; goal?: Spot | null; steps?: { dir: SeamDir; to: Spot }[]; stuck?: number; legs?: number }

// B held: a match runs unless B is held (br_boot.c / field_player_avatar.c), and a
// townsperson walks.
const KEY_OF: Record<number, number> = { 1: KEY_DOWN | KEY_B, 2: KEY_UP | KEY_B, 3: KEY_LEFT | KEY_B, 4: KEY_RIGHT | KEY_B };

function rand(b: Brain): number {
  let x = b.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  b.rng = x >>> 0;
  return b.rng / 4294967296;
}

const DELAYS = [32, 64, 96, 128];

const DIR_OF: Record<SeamDir, number> = { south: 1, north: 2, west: 3, east: 4 };

/** The cells inside the ring the room closes to next, once a phase (none while it does
 *  not close, nor when it closes on everything). */
const GRIDS = new WeakMap<WorldMap, Uint8Array>();
const INSIDE = new WeakMap<Room, { at: string; cells: Spot[] }>();
function insideNext(room: Room): Spot[] {
  const ring = room.ring();
  const at = `${ring.round}:${ring.phase}`;
  const hit = INSIDE.get(room);
  if (hit?.at === at) return hit.cells;
  const r = ring.next;
  const next = r === undefined || r === Infinity || r < 0 ? null : { ...ring, r: Math.max(r, 1.5) };
  // Any open cell of an outdoor map, not only Littleroot's walk: bots are dealt all over
  // (on land: one on its way crosses water, but stops on ground).
  const cells: Spot[] = [];
  if (next) {
    for (const id of room.places.keys()) {
      const m = room.maps.get(id)!;
      const grid = GRIDS.get(m) ?? GRIDS.set(m, decodeGrid(m.grid, m.w * m.h)).get(m)!;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const c = grid[y * m.w + x];
        if ((c === 0 || c === 7) && !room.inFog({ map: id, x, y }, next)) cells.push({ map: id, x, y });
      }
    }
  }
  INSIDE.set(room, { at, cells });
  return cells;
}

/** Where a bot goes this phase, or null to wander (Kanto's bots: into the ring before it
 *  closes, and to an event while its legendary stands, DESIGN §10). One in three heads for
 *  the newest event on the ground; the rest stay put inside the ring, and those outside
 *  it walk in to its nearest cell. */
function goal(room: Room, a: Actor, b: Brain): Spot | null {
  const ev = room.events[room.events.length - 1];
  if (ev && room.spills.has(ev.key) && !room.picked.has(ev.key) && rand(b) < 1 / 3 && !room.inFog({ map: ev.map, x: ev.x, y: ev.y })) {
    const near = room.reachable().filter((s) => s.map === ev.map && Math.abs(s.x - ev.x) + Math.abs(s.y - ev.y) <= 4 && !room.spillAt(s.map, s.x, s.y));
    if (near.length) return near[Math.floor(rand(b) * near.length)];
  }
  const cells = insideNext(room);
  if (!cells.length || cells.some((s) => sameSpot(s, a.m.spot))) return null;
  const p = room.places.get(a.m.spot.map);
  if (!p) return null;
  const x = p.gx + a.m.spot.x, y = p.gy + a.m.spot.y;
  // The inside map fewest crossings away on foot (an island's bot stays), then its cell
  // nearest the bot.
  const hops = new Map<string, number | undefined>();
  let best: Spot | null = null, bestH = Infinity, bestD = Infinity;
  for (const s of cells) {
    if (!hops.has(s.map)) hops.set(s.map, room.world.hops(a.m.spot.map, s.map, true, true));
    const h = hops.get(s.map);
    if (h === undefined || h > bestH) continue;
    const q = room.places.get(s.map)!;
    const d = Math.abs(q.gx + s.x - x) + Math.abs(q.gy + s.y - y);
    if (h < bestH || d < bestD) { bestH = h; bestD = d; best = s; }
  }
  return best;
}

/** The next leg towards `to`: there on its own map, or over to the next outdoor map on
 *  the way (World.nextHops: a route across Hoenn is too long for one search). */
function leg(room: Room, from: Spot, to: Spot): Path | null {
  if (from.map === to.map) return findPath(room.world, from, to, 6000, true, true);
  const hops = room.world.nextHops(from.map, to.map, true, true);
  const hop = hops.find((m) => room.places.has(m));
  return hop ? findPathToAny(room.world, from, room.world.entryCells(from.map, hop, true, true), 6000, true, true) : null;
}

export function botKeys(room: Room, a: Actor, b: Brain): number {
  // One frame of the key is one tile (or one turn to face a shut way): then let go.
  if (a.m.action) return 0;
  const ring = room.ring();
  const at = `${ring.round}:${ring.phase}:${room.events.length}`;
  // A new phase or event: each bot rethinks on its own frame of the next half second, so
  // sixty-four searches never land on one frame.
  if (b.plan !== at && (room.tick + a.id * 7) % 30 === 0) {
    b.plan = at;
    b.goal = goal(room, a, b);
    b.steps = undefined;
    b.legs = 0;
  }
  // Between legs, on its own frame: the next one, until it is there (or has tried enough).
  if (b.goal && !b.steps?.length && (room.tick + a.id * 7) % 30 === 0) {
    const path = !sameSpot(a.m.spot, b.goal) && (b.legs = (b.legs ?? 0) + 1) <= 24 ? leg(room, a.m.spot, b.goal) : null;
    b.steps = path?.found ? path.steps : undefined;
    if (!b.steps) b.goal = null;
    b.stuck = 0;
  }
  if (b.steps?.length) {
    if (sameSpot(b.steps[0].to, a.m.spot)) { b.steps.shift(); b.stuck = 0; }
    // A way the room will not let it take (a ledge, a door, somebody standing there):
    // a moment's wait, then it gives the walk up for this phase.
    // Somebody in the way: a new leg round them, from its next turn.
    else if ((b.stuck = (b.stuck ?? 0) + 1) > 90) b.steps = undefined;
    const s = b.steps?.[0];
    // A held too: a bot on its way may jump a ledge (Room.move), a wanderer never does.
    if (s) return (b.stuck ?? 0) % 30 === 1 || b.stuck === 0 ? KEY_OF[DIR_OF[s.dir]] | KEY_A : 0;
  }
  if (b.wait > 0) { b.wait -= 1; return 0; }
  b.dir = 1 + Math.floor(rand(b) * 4);
  b.wait = DELAYS[Math.floor(rand(b) * DELAYS.length)];
  return KEY_OF[b.dir];
}

/** `count` bots on open ground or grass across the room's maps, and three in Littleroot
 *  to walk up to and battle. */
export function botSpawns(room: Room, maps: readonly WorldMap[], count: number): { name: string; skin: number; spot: Spot; facing: number; brain: Brain }[] {
  let rng = 0x9e3779b9 ^ room.seed;
  const r = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const land = maps.filter((m) => room.places.has(m.id) && !m.id.includes('SAFARI') && !m.id.includes('FRONTIER') && !m.id.includes('PROTOTYPE'));
  const grids = new Map(land.map((m) => [m.id, decodeGrid(m.grid, m.w * m.h)]));
  const out: { name: string; skin: number; spot: Spot; facing: number; brain: Brain }[] = [];
  const taken = new Set<string>();
  const add = (spot: Spot, facing: number, skin: number) => {
    taken.add(`${spot.map}:${spot.x}:${spot.y}`);
    const n = out.length + 1;
    out.push({ name: SKIN_NAME[skin], skin, spot, facing, brain: { rng: (n * 2654435761) >>> 0 || 1, wait: Math.floor(r() * 60), dir: 1 } });
  };
  for (const [x, y] of [[7, 12], [13, 13], [11, 16]]) add({ map: 'MAP_LITTLEROOT_TOWN', x, y }, 1, botSkin(out.length * 7 + 1));
  for (let tries = 0; out.length < count && tries < 50000; tries++) {
    const m = land[Math.floor(r() * land.length)];
    const x = Math.floor(r() * m.w), y = Math.floor(r() * m.h);
    const c = grids.get(m.id)![y * m.w + x];
    if ((c !== 0 && c !== 7) || taken.has(`${m.id}:${x}:${y}`) || room.groundAt(m.id, x, y)) continue;
    // Not on the new trainers' corner of Littleroot.
    if (m.id === 'MAP_LITTLEROOT_TOWN' && x >= 7 && x <= 13 && y >= 9 && y <= 13) continue;
    add({ map: m.id, x, y }, 1 + Math.floor(r() * 4), botSkin(Math.floor(r() * 12)));
  }
  return out;
}
