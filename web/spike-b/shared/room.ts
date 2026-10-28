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

import { World, type Spot, type WorldMap } from '../../src/bots/world';
import { dealPatches, type Patch, type PatchTable } from '../../src/bots/patches';
import { newMover, stepFn, tick, type Keys, type Mover, type StepFn } from '../sim';

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
  /** The keys held this frame, and last frame (A is a press, not a hold). */
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
  | { type: 'fight'; tick: number; id: number; foe: number };

/** A change that is not a key: applied at the start of its frame, before anybody moves. */
export type Command =
  | { c: 'join'; id: number; bot: boolean; name: string; skin: number; spot: Spot; facing: number }
  | { c: 'leave'; id: number }
  | { c: 'end'; id: number };

/** The marked spots grow back: the ring's phase does it in the game; here, a while. */
export const REGROW = 60 * 90;

/** Everything a Room is, as plain data: what a phone joining late is sent. */
export interface RoomState {
  tick: number;
  seed: number;
  actors: Actor[];
  taken: [number, number][];
}

export class Room {
  tick = 0;
  actors: Actor[] = [];
  /** Taken spots by key, and the frame they were taken. */
  taken = new Map<number, number>();
  private readonly base: StepFn;

  constructor(
    readonly world: World,
    /** The maps a trainer may walk on: the outdoor ones joined to Littleroot. */
    readonly maps: ReadonlyMap<string, WorldMap>,
    readonly patches: PatchTable,
    readonly seed: number,
  ) {
    this.base = stepFn(world);
  }

  state(): RoomState {
    return { tick: this.tick, seed: this.seed, actors: structuredClone(this.actors), taken: [...this.taken] };
  }

  load(s: RoomState): void {
    this.tick = s.tick;
    this.actors = structuredClone(s.actors);
    this.taken = new Map(s.taken);
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
    } else if (cmd.c === 'leave') {
      this.actors = this.actors.filter((a) => a.id !== cmd.id);
    } else {
      const a = this.actor(cmd.id);
      if (!a) return;
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

  patchesOn(mapId: string): Patch[] {
    const m = this.maps.get(mapId);
    return m ? dealPatches(this.patches, m.id, m, this.seed) : [];
  }

  /** One frame: everybody's keys (setKeys first), then everybody moves, by id. */
  step(): RoomEvent[] {
    this.tick += 1;
    for (const [key, at] of this.taken) if (this.tick - at >= REGROW) this.taken.delete(key);
    const events: RoomEvent[] = [];
    for (const a of this.actors) {
      if (a.battling) { a.last = a.keys; continue; }
      const before = a.m.strides;
      tick(a.m, keysOf(a.keys), this.stepFor(a));
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
        if (!a.battling && (a.keys & KEY_A) && !(a.last & KEY_A)) {
          const foe = this.facing(a);
          if (foe && foe.bot && !foe.beaten && !foe.battling && !foe.m.action) {
            a.battling = foe.battling = foe.beaten = true;
            foe.m.facing = foe.m.moveDir = ({ 1: 2, 2: 1, 3: 4, 4: 3 } as Record<number, number>)[a.m.facing];
            a.foe = foe.id;
            events.push({ type: 'fight', tick: this.tick, id: a.id, foe: foe.id });
          }
        }
      } else if (!a.m.action) a.arriving = false;
      a.last = a.keys;
    }
    return events;
  }

  /** The trainer standing on the cell `a` faces. */
  facing(a: Actor): Actor | undefined {
    const d = ({ 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] } as Record<number, number[]>)[a.m.facing];
    const x = a.m.spot.x + d[0], y = a.m.spot.y + d[1];
    return this.actors.find((o) => o.id !== a.id && o.m.spot.map === a.m.spot.map && o.m.spot.x === x && o.m.spot.y === y);
  }

  /** Where `a` may step: the ROM's rules, a map this room has, and nobody standing there
   *  (a step's destination is the trainer's spot from its first frame, so two can't
   *  both walk into one cell). */
  stepFor(a: Actor): StepFn {
    return (from, dir) => {
      const r = this.base(from, dir);
      if (!r || !this.maps.has(r.to.map)) return null;
      const t = r.to;
      if (this.actors.some((o) => o.id !== a.id && o.m.spot.map === t.map && o.m.spot.x === t.x && o.m.spot.y === t.y)) return null;
      return r;
    };
  }

  /** A short fingerprint of the room: two machines that disagree find out within a second. */
  hash(): number {
    let h = 0x811c9dc5 ^ this.tick;
    const mix = (v: number) => { h = Math.imul(h ^ (v & 0xffff), 0x01000193) >>> 0; };
    for (const a of this.actors) {
      mix(a.id); mix(a.m.spot.x); mix(a.m.spot.y); mix(a.m.spot.map.length); mix(a.m.facing);
      mix(a.m.action ? a.m.action.t + 64 * a.m.action.len : 0); mix(a.battling ? 1 : 0); mix(a.keys);
    }
    for (const [k, t] of this.taken) { mix(k); mix(t); }
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
  const maps = new Map([...layout(all)].map(([id, p]) => [id, p.m]));
  return new Room(world ?? new World(all as WorldMap[]), maps, patches, seed);
}
