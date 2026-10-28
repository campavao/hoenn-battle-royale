// Spike B, stage 2: one Hoenn for the whole room.
//
// Everything that moves is here, and nothing else: who stands where, the keys each one
// holds this frame, the marked spots and who took them, who is fighting. It has no
// clock, no network and no drawing. A Room only goes forward by step(), one GBA frame,
// with every trainer's keys for that frame -- so two Rooms that start from the same
// state and are given the same keys frame by frame are the same Room. That is the whole
// design: the relay runs the Room and sends every frame's key changes; each phone runs
// the same Room from those keys and gets the same world, frame for frame (its own
// trainer predicted ahead of it, see net.ts).
//
// Walking is sim.ts, the ROM's rules, for everybody. A trainer is solid to the others.
// Stepping onto a marked spot nobody has taken, or pressing A at a bot, starts a battle:
// the trainer (and the bot) stand still until the phone says the battle is over.
//
// The fog closes in as a match's does (br_ring.c): a ring on a clock, the first phase an
// announcement, each later one smaller, the last everywhere -- then a new round with a new
// centre. It is the room's tick and seed and nothing else, so every phone has the same
// ring without a word on the wire. Outside it the page bleeds the team (main.ts).
//
// Items lie about as item balls (match/scatter.ts's table, a few on every map), dealt
// from the seed on cells a trainer can walk to from Littleroot. A ball is solid, as the
// ROM's are; A at one takes it, for that trainer and off everybody's map.

import { World, type Spot, type WorldMap } from '../../src/bots/world';
import { dealPatches, type Patch, type PatchTable } from '../../src/bots/patches';
import { scatterItem } from '../../src/match/scatter';
import { isTm, type BagRows } from './items';
import { dirOf, newMover, stepFn, tick, type Keys, type Mover, type StepFn } from '../sim';

export const KEY_UP = 1, KEY_DOWN = 2, KEY_LEFT = 4, KEY_RIGHT = 8, KEY_B = 16, KEY_A = 32;

export function keysOf(bits: number): Keys {
  return { up: !!(bits & KEY_UP), down: !!(bits & KEY_DOWN), left: !!(bits & KEY_LEFT), right: !!(bits & KEY_RIGHT), b: !!(bits & KEY_B), a: !!(bits & KEY_A) };
}

export function bitsOf(k: Keys): number {
  return (k.up ? KEY_UP : 0) | (k.down ? KEY_DOWN : 0) | (k.left ? KEY_LEFT : 0) | (k.right ? KEY_RIGHT : 0) | (k.b ? KEY_B : 0) | (k.a ? KEY_A : 0);
}

export interface Actor {
  id: number;
  bot: boolean;
  name: string;
  /** The wardrobe index: what the ROM draws this trainer as in a battle. */
  skin: number;
  m: Mover;
  /** The keys it moved on last, and the time before (A is a press, not a hold). A bot's
   *  are set for each frame; a trainer's are the phone's inputs, one per move. */
  keys: number;
  last: number;
  /** In a battle: stands still, keys ignored, until end(). */
  battling: boolean;
  /** A bot somebody has fought: it does not ask again. */
  beaten: boolean;
  /** The bot this trainer is fighting, 0 for none (ids start at 1). */
  foe: number;
  /** A step finished whose arrival has not been looked at yet (the spots). */
  arriving: boolean;
}

/** What a frame started: a phone starts the matching ROM battle for its own trainer. */
export type RoomEvent =
  | { type: 'wild'; tick: number; id: number; map: string; x: number; y: number; key: number }
  | { type: 'fight'; tick: number; id: number; foe: number }
  | { type: 'item'; tick: number; id: number; key: number; item: number }
  | { type: 'bag'; tick: number; id: number; key: number; bag: Bag; name: string };

/** What a trainer who is out carried: the bag's items (not its key items or machines)
 *  and money. */
export type Bag = BagRows;

/** A trainer's bag where they fell (POK-232). Its key is SPILL_KEY + their id. */
export interface Spill { key: number; map: string; x: number; y: number; name: string; bag: Bag }

/** Spill keys, clear of the dealt balls' 1..n. */
export const SPILL_KEY = 1 << 20;

/** An item ball: its key, its cell and what is in it. */
export interface Ground { key: number; map: string; x: number; y: number; item: number }

/** Item balls a map gets: the match deals two a section, and a spike map is two or three
 *  of them (Cam, POK-354: "more items all over the place"). */
export const GROUND_PER_MAP = 6;

/** A change that is not a key: applied at the start of its frame, before anybody moves. */
export type Command =
  | { c: 'join'; id: number; bot: boolean; name: string; skin: number; spot: Spot; facing: number }
  | { c: 'leave'; id: number }
  | { c: 'end'; id: number }
  /** The ball `key` would not go in `id`'s bag: it lies where it was (POK-294, nothing
   *  leaves the match). A bag goes back down holding `rest`, what did not fit. */
  | { c: 'drop'; id: number; key: number; rest?: Bag }
  /** `id`'s team is down (the fog, or a lost battle): off the map, watching. What they
   *  carried lies where they stood (POK-232). */
  | { c: 'out'; id: number; bag?: Bag };

/** The marked spots grow back: the ring's phase does it in the game; here, a while. */
export const REGROW = 60 * 90;

/** Everything a Room is, as plain data: what a phone joining late is sent. */
export interface RoomState {
  tick: number;
  seed: number;
  actors: Actor[];
  taken: [number, number][];
  /** Item balls taken: key, and who took it. */
  picked?: [number, number][];
  /** Bags dropped by trainers who are out, taken or not (`picked` says). */
  spills?: Spill[];
}

const DEALS = new Map<string, ReadonlyMap<string, Ground>>();
/** Every cell a trainer can walk to from Littleroot, per set of maps. */
const REACH = new Map<string, Spot[]>();

/** A ring phase, in frames: the match's 120 s (DEFAULT_FOG_SECS, web/src/match/director.ts). */
export const RING_PHASE = 60 * 120;
/** What each phase leaves of the reachable world, as a share of its farthest cell from
 *  the centre: the first an announcement (no fog), then clock.ts's RING_RADII
 *  [28, 15, 9, 7, 5, 3, 2, 0, -1] as shares of its 28 -- 0 the centre cell alone, -1
 *  everywhere. The match measures in region-map sections; here it is tiles, on purpose:
 *  this world is walked tile by tile, and a section-sized ring would fog half a town. */
const RING_STEPS = [Infinity, 15 / 28, 9 / 28, 7 / 28, 5 / 28, 3 / 28, 2 / 28, 0, -1];

/** The ring at a frame, in the plane layout() places the maps in (tiles). `r` is Infinity
 *  for no fog and -1 for fog everywhere; `left` the frames to the next phase. */
export interface Ring { round: number; phase: number; last: boolean; cx: number; cy: number; r: number; next?: number; left: number }

export class Room {
  tick = 0;
  actors: Actor[] = [];
  /** Taken spots by key, and the frame they were taken. */
  taken = new Map<number, number>();
  /** Item balls taken, by key, and who took each (they do not grow back). */
  picked = new Map<number, number>();
  /** Bags trainers who went out left, by key; one is lying while `picked` has not got it. */
  spills = new Map<number, Spill>();
  private readonly base: StepFn;
  private dealt: ReadonlyMap<string, Ground> | null = null;

  constructor(
    readonly world: World,
    /** The maps a trainer may walk on: the outdoor ones joined to Littleroot. */
    readonly maps: ReadonlyMap<string, WorldMap>,
    readonly patches: PatchTable,
    readonly seed: number,
    /** Where each map sits in the plane (layout()): the ring is measured there. */
    readonly places: ReadonlyMap<string, { gx: number; gy: number }>,
  ) {
    this.base = stepFn(world);
  }

  state(): RoomState {
    return { tick: this.tick, seed: this.seed, actors: structuredClone(this.actors), taken: [...this.taken], picked: [...this.picked], spills: structuredClone([...this.spills.values()]) };
  }

  load(s: RoomState): void {
    this.tick = s.tick;
    this.actors = structuredClone(s.actors);
    this.taken = new Map(s.taken);
    this.picked = new Map(s.picked ?? []);
    this.spills = new Map(structuredClone(s.spills ?? []).map((b) => [b.key, b]));
  }

  actor(id: number): Actor | undefined {
    return this.actors.find((a) => a.id === id);
  }

  apply(cmd: Command): void {
    if (cmd.c === 'join') {
      if (this.actor(cmd.id)) return;
      const a: Actor = { id: cmd.id, bot: cmd.bot, name: cmd.name, skin: cmd.skin, m: newMover(cmd.spot, cmd.facing), keys: 0, last: 0, battling: false, beaten: false, foe: 0, arriving: false };
      // Ordered by id, on every machine: who moves first decides who gets a contested cell.
      this.actors.push(a);
      this.actors.sort((p, q) => p.id - q.id);
    } else if (cmd.c === 'drop') {
      if (this.picked.get(cmd.key) !== cmd.id) return;
      this.picked.delete(cmd.key);
      const b = this.spills.get(cmd.key);
      if (b && cmd.rest) b.bag = structuredClone(cmd.rest);
    } else if (cmd.c === 'leave' || cmd.c === 'out') {
      // A bot fought by somebody who left walks again.
      const a = this.actor(cmd.id);
      // Where they stood: nobody else can be on that cell, nor a ball (both are solid).
      if (a && cmd.c === 'out' && cmd.bag && (cmd.bag.items.length || cmd.bag.money)) {
        const key = SPILL_KEY + a.id;
        this.spills.set(key, { key, map: a.m.spot.map, x: a.m.spot.x, y: a.m.spot.y, name: a.name, bag: structuredClone(cmd.bag) });
      }
      const foe = a?.foe ? this.actor(a.foe) : undefined;
      if (foe) foe.battling = false;
      this.actors = this.actors.filter((o) => o.id !== cmd.id);
    } else {
      const a = this.actor(cmd.id);
      if (!a || !a.battling) return;
      a.battling = false;
      a.keys = a.last = 0;
      const foe = a.foe ? this.actor(a.foe) : undefined;
      if (foe) foe.battling = false;
      a.foe = 0;
    }
  }

  isTaken(key: number): boolean {
    const at = this.taken.get(key);
    return at !== undefined && this.tick - at < REGROW;
  }

  /** Every item ball the seed deals, taken or not, by cell (`map:x:y`). Walked out from
   *  Littleroot on foot over this room's maps, so none is on an island or behind a ledge
   *  that only goes one way out; each on plain ground, never a marked spot or a door, nor
   *  the corner new trainers stand on. */
  ground(): ReadonlyMap<string, Ground> {
    if (this.dealt) return this.dealt;
    // The same seed over the same maps deals the same balls: dealt once a process (the
    // relay makes one room; the tests and a phone's resyncs make many).
    const id = `${this.seed}:${[...this.maps.keys()].join()}`;
    const hit = DEALS.get(id);
    if (hit) return (this.dealt = hit);
    const land = new Map<string, Spot[]>();
    for (const at of this.reachable()) {
      if (this.world.cell(at.map, at.x, at.y) !== 0 || this.world.warpAt(at.map, at.x, at.y)) continue;
      const l = land.get(at.map) ?? [];
      l.push(at);
      land.set(at.map, l);
    }
    let state = (this.seed ^ 0x17e3ba11) >>> 0 || 1;
    const rng = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
    const out = new Map<string, Ground>();
    let n = 0;
    for (const id of [...land.keys()].sort()) {
      const marked = new Set(this.patchesOn(id).map((q) => `${q.x}:${q.y}`));
      const cells = land.get(id)!.filter((c) => !marked.has(`${c.x}:${c.y}`) &&
        !(id === 'MAP_LITTLEROOT_TOWN' && c.x >= 7 && c.x <= 13 && c.y >= 9 && c.y <= 13));
      for (let i = 0; i < GROUND_PER_MAP && cells.length; i++) {
        const c = cells.splice(Math.floor(rng() * cells.length), 1)[0];
        // No machines yet: in a match one off the ground is taught there and then (br_items.c
        // Found), which a bare GIVE would skip.
        let item = scatterItem(rng);
        while (isTm(item)) item = scatterItem(rng);
        out.set(`${id}:${c.x}:${c.y}`, { key: ++n, map: id, x: c.x, y: c.y, item });
      }
    }
    // A relay world makes one room a seed; keep the last few, not every one ever dealt.
    if (DEALS.size >= 8) DEALS.delete(DEALS.keys().next().value!);
    DEALS.set(id, out);
    return (this.dealt = out);
  }

  /** Every cell a trainer can walk to from Littleroot, in the order a walk out finds them. */
  reachable(): readonly Spot[] {
    const id = [...this.maps.keys()].join();
    const hit = REACH.get(id);
    if (hit) return hit;
    const seen = new Set<string>();
    const out: Spot[] = [];
    const start: Spot = { map: 'MAP_LITTLEROOT_TOWN', x: 10, y: 10 };
    const queue = [start];
    seen.add(`${start.map}:${start.x}:${start.y}`);
    while (queue.length) {
      const at = queue.shift()!;
      out.push(at);
      for (let dir = 1; dir <= 4; dir++) {
        const r = this.base(at, dir);
        if (!r || !this.maps.has(r.to.map)) continue;
        const k = `${r.to.map}:${r.to.x}:${r.to.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(r.to);
      }
    }
    REACH.set(id, out);
    return out;
  }

  /** The ring this frame (or at `tick`). */
  ring(tick = this.tick): Ring {
    const len = this.ringPhase;
    const round = Math.floor(tick / (RING_STEPS.length * len));
    const t = tick - round * RING_STEPS.length * len;
    const phase = Math.floor(t / len);
    const { cx, cy, far } = this.centre(round);
    const at = (i: number) => (RING_STEPS[i] === Infinity || RING_STEPS[i] < 0 ? RING_STEPS[i] : RING_STEPS[i] * far);
    const last = phase === RING_STEPS.length - 1;
    return { round, phase, last, cx, cy, r: at(phase), next: last ? undefined : at(phase + 1), left: len - (t - phase * len) };
  }

  /** Frames a phase lasts: RING_PHASE, or shorter for a solo test (`?ring=` seconds). */
  ringPhase = RING_PHASE;

  private centres = new Map<number, { cx: number; cy: number; far: number }>();
  /** A round's centre: a cell a trainer can stand on, from the seed; and how far the
   *  farthest reachable cell is from it. */
  private centre(round: number): { cx: number; cy: number; far: number } {
    const hit = this.centres.get(round);
    if (hit) return hit;
    const cells = this.reachable();
    let h = Math.imul((this.seed ^ 0x51ed270b) >>> 0, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
    const c = cells[(h >>> 0) % cells.length];
    const p = this.places.get(c.map)!;
    const cx = p.gx + c.x + 0.5, cy = p.gy + c.y + 0.5;
    let far = 0;
    for (const s of cells) {
      const q = this.places.get(s.map)!;
      far = Math.max(far, Math.hypot(q.gx + s.x + 0.5 - cx, q.gy + s.y + 0.5 - cy));
    }
    const out = { cx, cy, far };
    if (this.centres.size > 4) this.centres.clear();
    this.centres.set(round, out);
    return out;
  }

  /** Is this cell in the fog now? */
  inFog(s: Spot, ring = this.ring()): boolean {
    if (ring.r === Infinity) return false;
    if (ring.r < 0) return true;
    const p = this.places.get(s.map);
    if (!p) return true;
    return Math.hypot(p.gx + s.x + 0.5 - ring.cx, p.gy + s.y + 0.5 - ring.cy) > ring.r;
  }

  /** The item ball still lying on a cell, if any. */
  groundAt(map: string, x: number, y: number): Ground | undefined {
    const g = this.ground().get(`${map}:${x}:${y}`);
    return g && !this.picked.has(g.key) ? g : undefined;
  }

  /** The bag lying on a cell, if any. */
  spillAt(map: string, x: number, y: number): Spill | undefined {
    for (const b of this.spills.values()) if (b.map === map && b.x === x && b.y === y && !this.picked.has(b.key)) return b;
    return undefined;
  }

  patchesOn(mapId: string): Patch[] {
    const m = this.maps.get(mapId);
    return m ? dealPatches(this.patches, m.id, m, this.seed) : [];
  }

  /** One frame, everybody in id order. A bot moves once, on its keys. A trainer moves
   *  once for each of its phone's inputs this frame used (`ins`): none while they are
   *  late, two while it catches up. So a trainer's walk is its thumb's, input for input,
   *  however the network bunched them -- the phone's own replay of the same inputs lands
   *  on the same tile (net.ts). */
  step(ins?: ReadonlyMap<number, readonly number[]>): RoomEvent[] {
    this.tick += 1;
    for (const [key, at] of this.taken) if (this.tick - at >= REGROW) this.taken.delete(key);
    const events: RoomEvent[] = [];
    for (const a of this.actors) {
      if (a.bot) this.move(a, a.keys, events);
      else for (const bits of ins?.get(a.id) ?? []) this.move(a, bits, events);
    }
    return events;
  }

  /** One move of one actor on `bits`: sim.ts's frame, then what it landed on or pressed. */
  private move(a: Actor, bits: number, events: RoomEvent[]): void {
    a.keys = bits;
    if (a.battling) { a.last = bits; return; }
    if (a.bot && !a.m.action) {
      const dir = dirOf(keysOf(bits));
      if (dir) {
        // A townsperson faces its way and walks at once (WanderAround_Step4 sets the
        // direction, no turn in place as the player has); a shut way, or a ledge
        // (wanderers never jump), it only faces.
        a.m.facing = a.m.moveDir = dir;
        const r = this.stepFor(a)(a.m.spot, dir);
        if (!r || r.hop) { a.last = bits; return; }
      }
    }
    const before = a.m.strides;
    tick(a.m, keysOf(bits), this.stepFor(a));
    if (a.m.strides !== before) a.arriving = true;
    if (!a.m.action && !a.bot) {
      if (a.arriving) {
        a.arriving = false;
        const p = this.patchesOn(a.m.spot.map).find((q) => q.x === a.m.spot.x && q.y === a.m.spot.y && !this.isTaken(q.key));
        if (p) {
          this.taken.set(p.key, this.tick);
          a.battling = true;
          events.push({ type: 'wild', tick: this.tick, id: a.id, map: a.m.spot.map, x: p.x, y: p.y, key: p.key });
        }
      }
      if (!a.battling && (bits & KEY_A) && !(a.last & KEY_A)) {
        const [x, y] = this.ahead(a);
        const g = this.groundAt(a.m.spot.map, x, y);
        const b = g ? undefined : this.spillAt(a.m.spot.map, x, y);
        const foe = g || b ? undefined : this.facing(a);
        if (g) {
          this.picked.set(g.key, a.id);
          events.push({ type: 'item', tick: this.tick, id: a.id, key: g.key, item: g.item });
        } else if (b) {
          this.picked.set(b.key, a.id);
          events.push({ type: 'bag', tick: this.tick, id: a.id, key: b.key, bag: structuredClone(b.bag), name: b.name });
        } else if (foe && foe.bot && !foe.beaten && !foe.battling && !foe.m.action) {
          a.battling = foe.battling = foe.beaten = true;
          foe.m.facing = foe.m.moveDir = ({ 1: 2, 2: 1, 3: 4, 4: 3 } as Record<number, number>)[a.m.facing];
          a.foe = foe.id;
          events.push({ type: 'fight', tick: this.tick, id: a.id, foe: foe.id });
        }
      }
    } else if (!a.m.action) a.arriving = false;
    a.last = bits;
  }

  /** The cell `a` faces, on its own map. */
  private ahead(a: Actor): [number, number] {
    const d = ({ 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] } as Record<number, number[]>)[a.m.facing];
    return [a.m.spot.x + d[0], a.m.spot.y + d[1]];
  }

  /** The trainer standing on the cell `a` faces. */
  facing(a: Actor): Actor | undefined {
    const [x, y] = this.ahead(a);
    return this.actors.find((o) => o.id !== a.id && o.m.spot.map === a.m.spot.map && o.m.spot.x === x && o.m.spot.y === y);
  }

  /** Where `a` may step: the ROM's rules, a map this room has, no item ball or bag, and nobody
   *  standing there (a step's destination is the trainer's spot from its first frame, so
   *  two can't both walk into one cell). */
  stepFor(a: Actor): StepFn {
    return (from, dir) => {
      const r = this.base(from, dir);
      if (!r || !this.maps.has(r.to.map)) return null;
      const t = r.to;
      if (this.groundAt(t.map, t.x, t.y) || this.spillAt(t.map, t.x, t.y)) return null;
      if (this.actors.some((o) => o.id !== a.id && o.m.spot.map === t.map && o.m.spot.x === t.x && o.m.spot.y === t.y)) return null;
      return r;
    };
  }

  /** A short fingerprint of the room: two machines that disagree find out within a second. */
  hash(): number {
    let h = 0x811c9dc5 ^ this.tick;
    const mix = (v: number) => { h = Math.imul(h ^ (v & 0xffff), 0x01000193) >>> 0; h = Math.imul(h ^ (v >>> 16), 0x01000193) >>> 0; };
    const str = (t: string) => { for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); };
    for (const a of this.actors) {
      const m = a.m;
      mix(a.id); str(m.spot.map); mix(m.spot.x); mix(m.spot.y); str(m.prev.map); mix(m.prev.x); mix(m.prev.y);
      mix(m.facing); mix(m.moveDir); mix(m.runningState); mix(m.run ? 1 : 0); mix(m.strides);
      mix(m.px + 1024); mix(m.py + 1024); mix(m.lift + 1024);
      mix(m.action ? m.action.t + 64 * m.action.len + 4096 * m.action.dir : 0xffff);
      mix((a.battling ? 1 : 0) | (a.beaten ? 2 : 0) | (a.arriving ? 4 : 0)); mix(a.foe); mix(a.keys); mix(a.last);
    }
    for (const [k, t] of this.taken) { mix(k); mix(t); }
    for (const [k, by] of this.picked) { mix(k); mix(by); }
    for (const b of this.spills.values()) {
      mix(b.key); str(b.map); mix(b.x); mix(b.y); mix(b.bag.money);
      for (const r of b.bag.items) { mix(r.id); mix(r.n); }
    }
    return h;
  }
}

/** Every outdoor map joined to Littleroot by its seams, each at its place in one plane
 *  (tiles): the maps a trainer may walk on, and where the page draws them. */
export function layout(maps: readonly WorldMap[]): Map<string, { m: WorldMap; gx: number; gy: number }> {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const placed = new Map<string, { m: WorldMap; gx: number; gy: number }>();
  const start = byId.get('MAP_LITTLEROOT_TOWN')!;
  placed.set(start.id, { m: start, gx: 0, gy: 0 });
  const queue = [start.id];
  while (queue.length) {
    const p = placed.get(queue.shift()!)!;
    for (const s of p.m.seams) {
      const to = byId.get(s.to);
      if (!to || !to.outdoor || placed.has(to.id)) continue;
      let gx = p.gx;
      let gy = p.gy;
      if (s.dir === 'north') { gx += s.offset; gy -= to.h; }
      else if (s.dir === 'south') { gx += s.offset; gy += p.m.h; }
      else if (s.dir === 'west') { gx -= to.w; gy += s.offset; }
      else { gx += p.m.w; gy += s.offset; }
      placed.set(to.id, { m: to, gx, gy });
      queue.push(to.id);
    }
  }
  return placed;
}

/** A room over world.json's maps: walking on every outdoor map joined to Littleroot. */
export function makeRoom(all: readonly WorldMap[], patches: PatchTable, seed: number, world?: World): Room {
  const placed = layout(all);
  const maps = new Map([...placed].map(([id, p]) => [id, p.m]));
  const places = new Map([...placed].map(([id, p]) => [id, { gx: p.gx, gy: p.gy }]));
  return new Room(world ?? new World(all as WorldMap[]), maps, patches, seed, places);
}
