// Bots all over Hoenn, so a spectator sees the whole map playing out. A bot wanders the
// way Emerald's own townsfolk do (MovementType_WanderAround, event_object_movement.c):
// stand a while (sMovementDelaysMedium: 32, 64, 96 or 128 frames), pick a direction, and
// walk one tile that way at walking pace; a way that is shut, or a ledge, it only faces.
// The facing and the shut way are the Room's (Room.move), so every copy of the room
// agrees; the host only picks when and where, and everybody else just gets its keys.

import { decodeGrid, sameSpot, type SeamDir, type Spot, type WorldMap } from '../../src/bots/world';
import { findPath, findPathToAny, type Path } from '../../src/bots/path';
import { NAMES } from '../../src/bots/roster';
import { teamFlies } from '../../src/bots/party';
import { mulberry32, pickIndex } from '../../src/match/clock';
import { hasBall } from '../../src/bots/bag';
import { ATTENDANT, BOATS, FIELD_SURF, KEY_A, KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, PORTS, SAFARI, TIDAL, TIDAL_BEDS, TIDAL_SAILOR, botParty, type Actor, type Room } from './room';

// The wardrobe (br_ghosts.c sSkinGraphics, career.ts SKINS): a bot wears a skin so the
// trainer you walk up to is the trainer the ROM puts in the battle.
export const SKIN_GFX = [0, 89, 100, 105, 55, 45, 31, 32, 42, 43, 21, 22, 25, 18, 35, 47];
export const botSkin = (n: number) => 4 + (n % 12);

/** `wait`: frames left to stand; `dir`: the way it went last. A bot with somewhere to be
 *  (inside the coming ring, or at an event) walks `steps` there; `plan` is the round and
 *  phase it last chose for, and `stuck` the frames it has pressed without moving. */
export interface Brain { rng: number; wait: number; dir: number; plan?: string; goal?: Spot | null; steps?: { dir: SeamDir; to: Spot }[]; stuck?: number; legs?: number; avoid?: Set<number>; flyTo?: Spot; flyAfter?: number;
  /** `goal` may be over the water, by the boats (rideFor). */
  byBoat?: boolean;
  /** Where to ask the boatman it faces to sail to, next frame (Host.advance, as `flyTo`). */
  sail?: string }

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
/** How near another bot has to be for a bot to walk up to it, and a trainer (on its
 *  screen, 15 x 10 cells round it) (brain.ts NEAR_TILES, NEAR_PLAYER). */
const NEAR_TILES = 4;
const NEAR_PLAYER = { x: 7, y: 5 };

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

/** brain.ts HURT: under this share of its team's HP, a bot goes to a CENTER. */
export const HURT = 0.5;

/** How much of a bot's team is standing, as its fights left it (room.ts wear): 1 whole. */
export function health(a: Actor): number {
  const w = a.wear;
  return w?.length ? w.reduce((s, v) => s + v, 0) / w.length : 1;
}

/** The counter inside a CENTER, where a trainer talks to the nurse (Room.move). */
function counterOf(room: Room, map: string): Spot | null {
  const c = room.maps.get(map)?.centre;
  return c ? { map, x: c.counterX, y: c.counterY } : null;
}

/** The CENTER a hurt bot walks to (brain.ts centreRoute): its counter, through the door fewest map
 *  crossings away, then nearest, out of the fog; none and it goes on as it was. */
function centreFor(room: Room, a: Actor): Spot | null {
  const inside = counterOf(room, a.m.spot.map);
  if (inside) return inside;
  const p = room.places.get(a.m.spot.map);
  if (!p) return null;
  let best: Spot | null = null, bestH = Infinity, bestD = Infinity;
  for (const s of room.centreSteps()) {
    if (room.inFog(s)) continue;
    const h = room.world.hops(a.m.spot.map, s.map, surfs(a), cuts(a));
    if (h === undefined || h > bestH) continue;
    const q = room.places.get(s.map)!;
    const d = Math.abs(q.gx + s.x - p.gx - a.m.spot.x) + Math.abs(q.gy + s.y - p.gy - a.m.spot.y);
    if (h < bestH || d < bestD) { bestH = h; bestD = d; best = s; }
  }
  // Up from its doorstep, through the door.
  const door = best && room.world.map(best.map)?.warps?.find((w) => w.x === best!.x && w.y === best!.y - 1 && room.world.map(w.to)?.centre);
  return door ? counterOf(room, door.to) : null;
}

/** Where a bot goes this phase, or null to wander (Kanto's bots: into the ring before it
 *  closes, and to an event while its legendary stands, DESIGN §10). One in three heads for
 *  the newest event on the ground; the rest stay put inside the ring, and those outside
 *  it walk in to its nearest cell. */
/** Where a spot is on Hoenn's plane: its map's place, or indoors (PETALBURG WOODS, a cave
 *  on the way) the one point the room keeps for that map. */
function planeOf(room: Room, s: Spot): { x: number; y: number } | null {
  const p = room.places.get(s.map);
  if (p) return { x: p.gx + s.x, y: p.gy + s.y };
  const c = room.anchors.get(s.map);
  return c ? { x: c.gx, y: c.gy } : null;
}

/** The Safari: the next marked grass or ball on this map, one of the nearest it can walk to,
 *  as somebody catching what they can would (Cam, 11-01: "they should look like they're
 *  actually doing something"). */
function safariGoal(room: Room, a: Actor, b: Brain): Spot | null {
  const { map, x, y } = a.m.spot;
  const reach = room.world.reachOnMap(a.m.spot, surfs(a), cuts(a));
  // Grass nobody has been through yet, while it has room for what it catches: taken, it shows nothing.
  const spots: { x: number; y: number }[] = partyRoom(room, a) ? room.patchesOn(map).filter((p) => !room.isTaken(p.key)) : [];
  for (const g of room.ground().values()) if (g.map === map && !g.gift && !room.picked.has(g.key)) spots.push(g);
  const near = spots
    .filter((s) => (s.x !== x || s.y !== y) && reach.cell(s.x, s.y))
    .map((s) => ({ s, d: Math.abs(s.x - x) + Math.abs(s.y - y) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, 5);
  if (!near.length) return null;
  const { s } = near[Math.floor(rand(b) * near.length)];
  return { map, x: s.x, y: s.y };
}

function goal(room: Room, a: Actor, b: Brain): Spot | null {
  b.byBoat = false;
  if (room.ring().safari) return safariGoal(room, a, b);
  // Hurt: a CENTER first (brain.ts, HURT), as long as there is one out of the fog; in the fog, out
  // of it first, which is on the way to any of them.
  if (health(a) < HURT && !room.inFog(a.m.spot)) {
    const c = centreFor(room, a);
    if (c) return c;
  }
  // The hunt (brain.ts HUNT_AT, Kanto's rule): with three left, a bot aims at somebody,
  // the nearest still standing, rather than at a cell; otherwise the last three wait for
  // each other in a shrinking ring.
  if (hunting(room)) {
    const p = planeOf(room, a.m.spot);
    let best: Actor | undefined, bestD = Infinity;
    for (const o of room.actors) {
      const q = planeOf(room, o.m.spot);
      // Not one in a fight: it went and stood by them until it was over, a minute and more (Cam,
      // 11-02: "Bots stand next to each other without fighting").
      if (o === a || o.away || o.battling || !p || !q || room.inFog(o.m.spot)) continue;
      const d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    // However far: the last three would otherwise wait for the fog across the water from each other.
    if (best) { b.byBoat = true; return { ...best.m.spot }; }
  }
  // One thought in two after what lies about, or four with eight or fewer standing: always after
  // the next ball, a small match's bots stopped meeting (seed 7, eight bots: 3.5 minutes between
  // fights, room.test.ts 'still go about and meet').
  // Off the frame, not its dice: a walk it would have taken anyway stays the walk it takes.
  const lootMood = (Math.imul(room.tick + a.id, 0x9e3779b1) >>> 30) < (room.results.entrants.length - room.results.fallen.length > 8 ? 2 : 1);
  // A legendary on this very map, before anything else it might do here.
  const legend = lootMood ? lootGoal(room, a, b, true) : null;
  if (legend) return legend;
  // The newest event whose legendary still stands (and this bot has not tried), or the newest:
  // once there, lootGoal has what lies about. Cam, 11-02: "Not sure why they're not getting cleaned up".
  const standing = (e: Room['events'][number]) => room.spills.has(e.key) && !room.picked.has(e.key) && !room.inFog({ map: e.map, x: e.x, y: e.y });
  const ev = [...room.events].reverse().find((e) => standing(e) && room.spills.get(e.key)?.legend && !a.tried?.includes(e.key)) ?? room.events[room.events.length - 1];
  if (ev && standing(ev) && rand(b) < (lootMood && room.spills.get(ev.key)?.legend ? 1 : 1 / 3)) {
    const near = room.landedOn(ev.map).filter((s) => Math.abs(s.x - ev.x) + Math.abs(s.y - ev.y) <= 4 && !room.spillAt(s.map, s.x, s.y));
    if (near.length) return near[Math.floor(rand(b) * near.length)];
  }
  const cells = insideNext(room);
  if (!cells.length || cells.some((s) => sameSpot(s, a.m.spot))) return (lootMood ? lootGoal(room, a, b) : null) ?? wander(room, a, b);
  const p = planeOf(room, a.m.spot);
  if (!p) return null;
  const { x, y } = p;
  // The inside map fewest crossings away on foot (an island's bot stays), then its cell
  // nearest the bot.
  // One of those within a few steps of the nearest: the bots outside, all aimed at the
  // one cell, queued for it in the fog.
  const hops = new Map<string, number | undefined>();
  const near: { s: Spot; h: number; d: number }[] = [];
  let bestH = Infinity, bestD = Infinity;
  for (const s of cells) {
    if (!hops.has(s.map)) hops.set(s.map, room.world.hops(a.m.spot.map, s.map, surfs(a), cuts(a)));
    const h = hops.get(s.map);
    if (h === undefined || h > bestH) continue;
    const q = room.places.get(s.map)!;
    const d = Math.abs(q.gx + s.x - x) + Math.abs(q.gy + s.y - y);
    if (h < bestH) { bestH = h; bestD = d; near.length = 0; }
    else if (d < bestD) bestD = d;
    if (d <= bestD + SPREAD) near.push({ s, h, d });
  }
  const pool = near.filter((n) => n.h === bestH && n.d <= bestD + SPREAD);
  if (pool.length) return pool[Math.floor(rand(b) * pool.length)].s;
  // No way there on foot: a boat, as a trainer would, to the nearest of it the boats go to.
  const rides = ridesFrom(room, a);
  const nearest = new Map<string, { s: Spot; d: number } | null>();
  for (const s of cells) {
    let n = nearest.get(s.map);
    if (n === undefined) nearest.set(s.map, (n = rides.some((r) => room.world.hops(r.from.map, s.map, surfs(a), cuts(a)) !== undefined) ? { s, d: Infinity } : null));
    if (!n) continue;
    const q = room.places.get(s.map)!;
    const d = Math.abs(q.gx + s.x - x) + Math.abs(q.gy + s.y - y);
    if (d < n.d) { n.s = s; n.d = d; }
  }
  const ways = [...nearest.values()].filter((n): n is { s: Spot; d: number } => !!n).sort((p, q) => p.d - q.d).slice(0, 8);
  for (const { s } of ways) if (rides.some((r) => walks(room, a, r.from, s))) { b.byBoat = true; return s; }
  return null;
}

/** The boats (Room's BOATS and ATTENDANT, as Room.mainland counts them): each row a boatman and one
 *  place he sails to. Not the runs to a story's islands: no walk of a bot's is ever going there. */
const RIDES: { map: string; x: number; y: number; to: string }[] = [...BOATS.flatMap((o) => o.to.map((to) => ({ map: o.map, x: o.x, y: o.y, to }))), { ...ATTENDANT, to: 'slateport' }];

/** The cells beside `who` (a boatman, a bed) that somebody could stand on, and the way to face them. */
function besideOf(room: Room, who: Spot): { at: Spot; face: number }[] {
  const out: { at: Spot; face: number }[] = [];
  for (const [dx, dy, face] of [[0, 1, 2], [0, -1, 1], [1, 0, 3], [-1, 0, 4]]) {
    if (room.world.standable(who.map, who.x + dx, who.y + dy)) out.push({ at: { map: who.map, x: who.x + dx, y: who.y + dy }, face });
  }
  return out;
}

/** `to` can be walked to from `from`, by this team. */
function walks(room: Room, a: Actor, from: Spot, to: Spot): boolean {
  const w = room.world, surf = surfs(a), cut = cuts(a);
  if (from.map === to.map && w.reachOnMap(from, surf, cut).cell(to.x, to.y)) return true;
  return !!w.firstCrossing(from, to.map, surf, cut, (r) => r.cell(to.x, to.y))?.length;
}

type Ride = { to: string; beside: { at: Spot; face: number }[] };

/** Everywhere the boats land this bot, fewest boats first, each with the first boat on the way and
 *  the cells it can walk to beside his boatman. Asked only of a walk that has no way on foot. */
function ridesFrom(room: Room, a: Actor): { from: Spot; first: Ride }[] {
  const out: { from: Spot; first: Ride }[] = [];
  const used = new Set<number>();
  let front: { from: Spot; first: Ride | null }[] = [{ from: a.m.spot, first: null }];
  while (front.length) {
    const next: { from: Spot; first: Ride }[] = [];
    for (const f of front) {
      RIDES.forEach((r, i) => {
        if (used.has(i)) return;
        const beside = besideOf(room, r).filter((c) => walks(room, a, f.from, c.at));
        if (!beside.length) return;
        used.add(i);
        next.push({ from: PORTS[r.to].land, first: f.first ?? { to: r.to, beside } });
      });
    }
    out.push(...next);
    front = next;
  }
  return out;
}

/** The first boat on the way to `to`; none, when there is no way even by boat. */
function rideFor(room: Room, a: Actor, to: Spot): Ride | null {
  return ridesFrom(room, a).find((r) => walks(room, a, r.from, to))?.first ?? null;
}

/** Aboard the SS TIDAL, as a trainer has it (Room's cruise): a rest in cabin No. 2 moves the crossing
 *  on, and once she has made land the sailor sees it off. The keys when it is there; undefined, walk. */
function aboard(room: Room, a: Actor, b: Brain): number | undefined {
  const c = a.cruise!;
  const stands = c.leg === 'land' ? besideOf(room, TIDAL_SAILOR).filter((s) => s.at.x === TIDAL.x && s.at.y === TIDAL.y) : TIDAL_BEDS.flatMap((bed) => besideOf(room, bed));
  const here = stands.find((s) => sameSpot(s.at, a.m.spot));
  b.steps = here ? undefined : b.steps;
  if (here) {
    b.goal = null;
    // A press, then let go (A is a press, on a bed as on anything).
    if ((room.tick + a.id * 7) % 30) return 0;
    if (c.leg === 'land') { b.sail = c.to; b.plan = undefined; }
    return KEY_OF[here.face] | KEY_A;
  }
  if (!b.goal || !stands.some((s) => sameSpot(s.at, b.goal!))) { b.goal = stands[0].at; b.steps = undefined; b.legs = 0; }
  return undefined;
}

/** What this bot's team could cross, as the world's searches ask it (POK-437): a bot goes where a
 *  trainer with that team could, no further. */
const surfs = (a: Actor) => ((a.field ?? 0) & FIELD_SURF) !== 0;
const cuts = (a: Actor) => (a.field ?? 0) & 3;

/** brain.ts FLY_COOLDOWN_MS and FLY_CLEAR: a flight at most this often, and never onto somebody's
 *  screen. */
const FLY_EVERY = 60 * 60;
const FLY_CLEAR = { x: 9, y: 7 };

/** Out of the fog the fast way, for a team that could FLY (brain.ts tryFly): a landing cell in the
 *  heart of the ring. Not at the end, when the ring is one section and a bird lands in a fight. */
function flyGoal(room: Room, a: Actor, b: Brain): Spot | null {
  if (a.cruise || hunting(room) || room.tick < (b.flyAfter ?? 0) || !teamFlies(botParty(room.seed, a, room.ring().phase + 1))) return null;
  const seen = (s: Spot) => room.actors.some((o) => o !== a && o.m.spot.map === s.map && Math.abs(o.m.spot.x - s.x) <= FLY_CLEAR.x && Math.abs(o.m.spot.y - s.y) <= FLY_CLEAR.y);
  const main = room.mainland();
  const home = heart(room).filter((s) => main.has(`${s.map}:${s.x}:${s.y}`) && room.places.has(s.map) && room.world.cell(s.map, s.x, s.y) === 0 && !room.groundAt(s.map, s.x, s.y) && !room.spillAt(s.map, s.x, s.y));
  for (let i = 0; i < 8 && home.length; i++) {
    const s = home[Math.floor(rand(b) * home.length)];
    if (!seen(s)) return s;
  }
  return null;
}

/** How far along its own map a bot will go out of its way for a ball (a legendary, any way):
 *  about a screen, so it is seen going for it and still gets on to the ring's heart. */
const LOOT_NEAR = 14;

/** Something on this map to go and take, as somebody playing would (brain.ts's "loot in the ring
 *  beats wandering"; Cam, 11-02: bots should go and pick things up): one of the nearest balls and
 *  bags with something in them it would take, and any legendary it has not tried. Not a gift
 *  (those are the trainers'), a person, or a piece a boss guards; nothing in the fog. */
function lootGoal(room: Room, a: Actor, b: Brain, legendOnly = false): Spot | null {
  const { map, x, y } = a.m.spot;
  const reach = room.world.reachOnMap(a.m.spot, surfs(a), cuts(a));
  const near: { s: Spot; d: number }[] = [];
  const see = (s: Spot, far: boolean) => {
    const d = Math.abs(s.x - x) + Math.abs(s.y - y);
    if (d && (far || d <= LOOT_NEAR) && reach.cell(s.x, s.y) && !room.inFog(s)) near.push({ s, d });
  };
  if (!legendOnly) for (const g of room.ground().values()) if (g.map === map && !g.gift && !room.picked.has(g.key)) see({ map, x: g.x, y: g.y }, false);
  for (const p of room.spills.values()) {
    if (p.map !== map || room.picked.has(p.key) || p.person || p.guard !== undefined) continue;
    // A legendary only with a ball to catch it and a team fit to try: a loss is the match.
    if (p.legend ? !a.tried?.includes(p.key) && hasBall(a.loot?.items ?? []) && health(a) >= HURT : !legendOnly && (p.bag.items.length > 0 || p.bag.money > 0 || (!!p.bag.mons?.length && partyRoom(room, a)))) see({ map, x: p.x, y: p.y }, !!p.legend);
  }
  if (!near.length) return null;
  near.sort((p, q) => p.d - q.d);
  return near[Math.floor(rand(b) * Math.min(3, near.length))].s;
}

const partyRoom = (room: Room, a: Actor) => botParty(room.seed, a, room.ring().phase + 1).length < 6;

/** goal: how much further than the nearest cell inside the ring a bot may aim. */
const SPREAD = 6;

/** The heart of the ring it is closing to: a wander out to its edge is a walk back into
 *  the fog, and bots dealt all over Hoenn that keep to its rim never meet. Once a phase:
 *  Hoenn's landing cells are tens of thousands. */
const HEART = new WeakMap<Room, { at: string; cells: Spot[] }>();
function heart(room: Room): Spot[] {
  const ring = room.ring();
  const at = `${ring.round}:${ring.phase}`;
  const hit = HEART.get(room);
  if (hit?.at === at) return hit.cells;
  const next = ring.next === undefined || ring.next < 0 ? ring.r : ring.next;
  const to = next === Infinity ? ring : { ...ring, r: Math.max(next / 2, 1.5) };
  const cells = room.landed().filter((s) => !room.inFog(s, to));
  HEART.set(room, { at, cells });
  return cells;
}

/** Somewhere to walk to inside the ring (brain.ts's wander: a cell of the landing pool,
 *  this map's own first, else anywhere in it). Live's bots are always on their way
 *  somewhere, so they cross paths and fight; standing about waiting for the fog, the
 *  last four or five of a match never met (Cam 10-30, "bots just idle around"). */
function wander(room: Room, a: Actor, b: Brain): Spot | null {
  const ring = room.ring();
  if (ring.safari) return null;
  const inside = heart(room);
  const here = inside.filter((s) => s.map === a.m.spot.map);
  const pool = here.length && rand(b) < 0.5 ? here : inside;
  return pool.length ? pool[Math.floor(rand(b) * pool.length)] : null;
}

/** The next leg towards `to`: there, when it is in reach on this map, or the first
 *  crossing on the way, region by region (World.firstCrossing, the live match's own): a
 *  map's halves can be joined only through another, as Route 104's are through PETALBURG
 *  WOODS, and a route across Hoenn is too long for one search. */
function leg(room: Room, a: Actor, to: Spot, avoid?: ReadonlySet<number>): Path | null {
  const w = room.world, from = a.m.spot, surf = surfs(a), cut = cuts(a);
  if (from.map === to.map && w.reachOnMap(from, surf, cut).cell(to.x, to.y)) return findPath(w, from, to, 6000, surf, cut, avoid);
  const over = w.firstCrossing(from, to.map, surf, cut, (r) => r.cell(to.x, to.y));
  return over?.length ? findPathToAny(w, from, over, 6000, surf, cut, avoid) : null;
}

/** A trainer sees the marked grass and can go round it, and one with somewhere to be does: hurt, in
 *  the fog, or hunting the last of them. A wild mon that costs it the match is no way to go. */
function pastPatches(room: Room, a: Actor, b: Brain): ReadonlySet<number> | undefined {
  if (!hunting(room) && health(a) >= HURT && !room.inFog(a.m.spot)) return b.avoid;
  const out = new Set(b.avoid);
  const { map } = a.m.spot;
  for (const p of room.patchesOn(map)) if (!room.isTaken(p.key)) out.add(room.world.key({ map, x: p.x, y: p.y }));
  return out;
}

/** brain.ts HUNT_AT: under this many still standing, the hunt. */
const HUNT_AT = 3;
function hunting(room: Room): boolean {
  const r = room.results;
  return !room.ring().safari && r.entrants.length > 0 && r.entrants.length - r.fallen.length <= HUNT_AT;
}

export function botKeys(room: Room, a: Actor, b: Brain): number {
  // One frame of the key is one tile (or one turn to face a shut way): then let go.
  if (a.m.action) return 0;
  // Somebody in its eyes, mid-step: the fight is as soon as they land.
  if (room.sightsWalker(a)) return 0;
  const ring = room.ring();
  // Hurt is a plan of its own: it rethinks the moment a fight leaves it under HURT.
  const at = `${ring.round}:${ring.phase}:${room.events.length}${health(a) < HURT ? ':hurt' : ''}`;
  // Dropped out of the Zone: its grass is no goal now, and a walk to it would hold them there.
  if (!ring.safari && b.goal && b.goal.map !== a.m.spot.map && b.goal.map.startsWith(SAFARI)) {
    b.goal = null;
    b.steps = undefined;
  }
  // At the counter: A at the nurse while it is hurt and she is open (Room.move), a moment, and on.
  const counter = b.goal && sameSpot(a.m.spot, b.goal) ? counterOf(room, a.m.spot.map) : null;
  if (counter && sameSpot(a.m.spot, counter)) {
    if (a.wear && !room.inFog(a.m.spot)) return KEY_UP | KEY_B | KEY_A;
    b.goal = null;
    b.steps = undefined;
    b.wait = 120;
    return 0;
  }
  // Aboard, the crossing is its plan until it is off.
  if (a.cruise) {
    const keys = aboard(room, a, b);
    if (keys !== undefined) return keys;
  }
  // A new phase or event: each bot rethinks on its own frame of the next half second, so
  // sixty-four searches never land on one frame.
  // One the fog has caught with nowhere to go (its walk gave up) thinks again too.
  // A hunter's quarry moves: it looks again whenever its walk runs out, and every 4 s.
  const hunt = hunting(room) && (!b.steps?.length || (room.tick + a.id * 7) % 240 === 0);
  // There, or given up: on somewhere else after a few seconds (brain.ts's next wander).
  const idle = !b.goal && !b.steps?.length && (room.tick + a.id * 7) % (ring.safari ? 60 : 300) === 0;
  if (!a.cruise && (b.plan !== at || hunt || idle || (!b.goal && room.inFog(a.m.spot, ring))) && (room.tick + a.id * 7) % 30 === 0) {
    // A hunter looking again has nowhere new to be: what it gave up on stays given up on. A trader in
    // a corridor had one walking into him, forgetting him every 4 s, until the fog came (seed 4242).
    if (b.plan !== at) b.avoid = undefined;
    b.plan = at;
    b.goal = goal(room, a, b);
    b.steps = undefined;
    b.legs = 0;
  }
  // The fog has it and its team could FLY: out at once, wherever its walk was going.
  if (!ring.safari && (room.tick + a.id * 7) % 30 === 0 && room.inFog(a.m.spot, ring)) {
    const to = flyGoal(room, a, b);
    if (to) {
      b.flyTo = to;
      b.flyAfter = room.tick + FLY_EVERY;
      b.goal = null;
      b.steps = undefined;
      return 0;
    }
  }
  // Between legs, on its own frame: the next one, until it is there (or has tried enough).
  if (b.goal && !b.steps?.length && (room.tick + a.id * 7) % 30 === 0) {
    let path = !sameSpot(a.m.spot, b.goal) && (b.legs = (b.legs ?? 0) + 1) <= 24 ? leg(room, a, b.goal, pastPatches(room, a, b)) : null;
    // No way round: through it.
    if (!path?.found && !sameSpot(a.m.spot, b.goal) && (b.legs ?? 0) <= 24) path = leg(room, a, b.goal, b.avoid);
    // No way on foot: the boat on the way, up to its boatman and his word, as a trainer does.
    if (!path?.found && b.byBoat && !a.cruise && (b.legs ?? 0) <= 24) {
      const ride = rideFor(room, a, b.goal);
      const here = ride?.beside.find((s) => sameSpot(s.at, a.m.spot));
      if (here) { b.sail = ride!.to; return KEY_OF[here.face] | KEY_A; }
      path = ride ? leg(room, a, ride.beside[0].at, b.avoid) : null;
    }
    b.steps = path?.found ? path.steps : undefined;
    // A hunt ends beside its quarry, in its eyeline, not on it.
    const end = b.steps?.[b.steps.length - 1]?.to;
    if (end && room.actors.some((o) => o !== a && sameSpot(o.m.spot, end))) b.steps = b.steps!.slice(0, -1);
    if (!b.steps?.length) { b.steps = undefined; b.goal = null; }
    b.stuck = 0;
  }
  // Somebody to fight close by (brain.ts approach): a trainer on the bot's screen, or
  // another bot within NEAR_TILES while a bot fight could start (the room's one at a
  // time). Up to them, so the eyelines meet. Out of the fog first.
  if (!b.steps?.length && (room.tick + a.id * 7) % 30 === 0 && room.tick >= a.calm && !ring.safari && !room.inFog(a.m.spot, ring)) {
    const here = (o: Actor) => o !== a && !o.battling && !o.away && room.tick >= o.calm && o.m.spot.map === a.m.spot.map;
    const dx = (o: Actor) => Math.abs(o.m.spot.x - a.m.spot.x), dy = (o: Actor) => Math.abs(o.m.spot.y - a.m.spot.y);
    // Another bot may be over a seam: the page draws the two maps as one street.
    const p = planeOf(room, a.m.spot);
    const near = (o: Actor) => {
      if (o === a || o.battling || o.away || room.tick < o.calm) return false;
      const q = planeOf(room, o.m.spot);
      return !!p && !!q && (o.m.spot.map === a.m.spot.map || !!room.maps.get(a.m.spot.map)?.seams.some((s) => s.to === o.m.spot.map)) && Math.abs(q.x - p.x) + Math.abs(q.y - p.y) <= NEAR_TILES;
    };
    const o = room.actors.find((o) => !o.bot && here(o) && dx(o) <= NEAR_PLAYER.x && dy(o) <= NEAR_PLAYER.y) ??
      (room.tick >= room.duelAfter ? room.actors.find((o) => o.bot && near(o)) : undefined);
    const path = o ? findPath(room.world, a.m.spot, o.m.spot, 2000, surfs(a), cuts(a)) : null;
    if (path?.found && path.steps.length >= 2) { b.steps = path.steps.slice(0, -1); b.stuck = 0; }
  }
  if (b.steps?.length) {
    if (sameSpot(b.steps[0].to, a.m.spot)) { b.steps.shift(); b.stuck = 0; }
    // A way the room will not let it take (a ledge, a door, somebody standing there):
    // a moment's wait, then it gives the walk up for this phase.
    // Somebody in the way: a new leg round them, from its next turn.
    // The world's routes know the ground, not what stands on it: a gift's ball (which a
    // bot leaves for the trainers), a person. The cell it gave up at is gone round from
    // then on, until it has somewhere new to be: Oldale's ball at the north exit held a
    // hunter there for the rest of the match.
    // Two in a fight in the way will be there for a minute: round them from the first.
    else if ((b.stuck = (b.stuck ?? 0) + 1) > 90 || room.actors.some((o) => o.battling && sameSpot(o.m.spot, b.steps![0].to))) {
      const k = room.world.key(b.steps[0].to);
      if (k >= 0) (b.avoid ??= new Set()).add(k);
      b.steps = undefined;
    }
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
  // Named as the live match names its bots (bots/roster.ts), so no two rows of the
  // standings read the same (HBR-96): Hoenn's names, dealt from the seed, then BOTn.
  const deal = mulberry32(room.seed ^ 0x8b07);
  const names = [...NAMES];
  const add = (spot: Spot, facing: number, skin: number) => {
    taken.add(`${spot.map}:${spot.x}:${spot.y}`);
    const n = out.length + 1;
    const name = names.length > 0 ? names.splice(pickIndex(deal, names.length), 1)[0] : `BOT${n}`;
    out.push({ name, skin, spot, facing, brain: { rng: (n * 2654435761) >>> 0 || 1, wait: Math.floor(r() * 60), dir: 1 } });
  };
  for (const [x, y] of [[7, 12], [13, 13], [11, 16]].slice(0, count)) add({ map: 'MAP_LITTLEROOT_TOWN', x, y }, 1, botSkin(out.length * 7 + 1));
  // Anywhere a trainer may land, as the live match deals them (bots/host.ts: its spawns
  // are its targets): the ring closes anywhere in Hoenn (Room.centre), and a bot SURFs
  // and CUTs its way to it if its team could, region by region (leg). Nowhere that strands a
  // team that cannot (Room.mainland).
  const main = room.mainland();
  const cells = room.landed().filter((s) => {
    const m = grids.get(s.map);
    const c = m?.[s.y * room.maps.get(s.map)!.w + s.x];
    return m && (c === 0 || c === 7) && !room.groundAt(s.map, s.x, s.y) && (c !== 0 || main.has(`${s.map}:${s.x}:${s.y}`)) &&
      !(s.map === 'MAP_LITTLEROOT_TOWN' && s.x >= 7 && s.x <= 13 && s.y >= 9 && s.y <= 13);
  });
  for (let tries = 0; out.length < count && cells.length && tries < 50000; tries++) {
    const s = cells[Math.floor(r() * cells.length)];
    if (taken.has(`${s.map}:${s.x}:${s.y}`)) continue;
    add(s, 1 + Math.floor(r() * 4), botSkin(Math.floor(r() * 12)));
  }
  return out;
}
