// The one machine that runs a Room for real: the relay (relay/world.js), or the page
// itself when nobody else is there. It decides each frame's keys -- a trainer's from
// what their phone sent, a bot's from its thumb on the pad -- steps the Room, and keeps
// a record of the frame for everybody who mirrors it (net.ts).

import type { Spot, WorldMap } from '../../src/bots/world';
import { botKeys, botSpawns, type Brain } from './bots';
import { Room, type Bag, type Command, type RoomEvent } from './room';
import { within } from './items';

/** One frame as a mirror needs it: what changed before anybody moved, the bots whose
 *  keys changed, and the trainers' inputs the frame used. Most frames a trainer uses one
 *  input, the same keys as the last, so only the rest are written: `ins` [id, ...bits]
 *  for a trainer who used other keys or two inputs, `stall` for one who used none. The
 *  service adds, per phone, the number of the last of its own inputs used. */
export interface Frame {
  tick: number;
  cmds?: Command[];
  keys?: [number, number][];
  ins?: number[][];
  stall?: number[];
  ack?: number;
}

interface Player {
  id: number;
  /** Inputs, one per phone frame, in order, not used yet; and the number of the last one
   *  used. */
  queue: number[];
  seq: number;
  started: boolean;
  /** Frames stood with inputs in hand, waiting for the cushion. */
  waited: number;
}

/** A trainer waits for this many inputs in hand before moving again, so a late packet
 *  rarely leaves it a frame short (spectators see a pause, not a stutter). Past
 *  JITTER + CATCH_UP it takes two every fourth frame until it is back. Nothing is ever
 *  dropped: every input moves the trainer exactly once, so the relay's walk is the
 *  thumb's. */
const JITTER = 3;
const CATCH_UP = 3;
/** A phone this far behind (ten seconds of keys) is not catching up: the oldest go. */
const MAX_QUEUE = 600;

export class Host {
  readonly room: Room;
  private players = new Map<number, Player>();
  private brains = new Map<number, Brain>();
  private pending: Command[] = [];
  private nextId = 1;

  /** `jitter` 0 is the page hosting itself: a key is used the frame it is pressed. */
  constructor(room: Room, bots: number, maps: readonly WorldMap[], private readonly jitter = JITTER) {
    this.room = room;
    for (const b of botSpawns(room, maps, bots)) {
      const id = this.nextId++;
      this.brains.set(id, b.brain);
      room.apply({ c: 'join', id, bot: true, name: b.name, skin: b.skin, spot: b.spot, facing: b.facing });
    }
  }

  /** A new trainer, in Littleroot by the truck (or at `spot`), standing on the next frame. */
  join(name: string, skin: number, spot?: Spot): number {
    const id = this.nextId++;
    if (!spot) {
      const free = [[10, 10], [9, 10], [11, 10], [10, 11], [9, 11], [11, 11], [10, 12], [8, 10], [12, 10]];
      // Not where somebody stands, nor where a join this frame will put them.
      const used = (x: number, y: number) =>
        this.room.actors.some((a) => a.m.spot.map === 'MAP_LITTLEROOT_TOWN' && a.m.spot.x === x && a.m.spot.y === y) ||
        this.pending.some((c) => c.c === 'join' && c.spot.map === 'MAP_LITTLEROOT_TOWN' && c.spot.x === x && c.spot.y === y);
      const at = free.find(([x, y]) => !used(x, y)) ?? [10, 10];
      spot = { map: 'MAP_LITTLEROOT_TOWN', x: at[0], y: at[1] };
    }
    this.pending.push({ c: 'join', id, bot: false, name, skin, spot, facing: 1 });
    this.players.set(id, { id, queue: [], seq: 0, started: false, waited: 0 });
    return id;
  }

  leave(id: number): void {
    this.players.delete(id);
    this.pending.push({ c: 'leave', id });
  }

  /** How many inputs a phone has sent that no frame has used yet. */
  backlog(id: number): number {
    return this.players.get(id)?.queue.length ?? 0;
  }

  /** A phone's keys for its next frames, numbered: `first` is the number of k[0]. */
  input(id: number, first: number, k: number[]): void {
    const p = this.players.get(id);
    if (!p) return;
    const known = p.seq + p.queue.length;
    // Resent or overlapping: only the frames not seen yet.
    const skip = Math.max(0, known + 1 - first);
    for (let i = skip; i < k.length; i++) p.queue.push(k[i] & 63);
    while (p.queue.length > MAX_QUEUE) { p.queue.shift(); p.seq += 1; }
  }

  /** The phone's battle is over: its trainer (and the bot) walk again. */
  end(id: number): void {
    if (this.players.has(id) && this.room.actor(id)?.battling) this.pending.push({ c: 'end', id });
  }

  /** The ball `key` would not go in the phone's bag: back on the ground. A bag goes back
   *  with what did not fit, never more than it held. */
  drop(id: number, key: number, rest?: Bag): void {
    if (!this.players.has(id) || this.room.picked.get(key) !== id) return;
    const was = this.room.spills.get(key)?.bag;
    this.pending.push(was && rest ? { c: 'drop', id, key, rest: within(rest, was) } : { c: 'drop', id, key });
  }

  /** The phone's team is down: its trainer leaves the map, what they carried where they
   *  stood, and the phone watches. */
  out(id: number, bag?: Bag): void {
    if (this.players.has(id) && this.room.actor(id)) this.pending.push(bag ? { c: 'out', id, bag } : { c: 'out', id });
  }

  /** One frame. The record goes to every mirror; `acks` is each phone's last input used. */
  advance(): { frame: Frame; acks: Map<number, number>; events: RoomEvent[] } {
    const room = this.room;
    const cmds = this.pending;
    this.pending = [];
    for (const c of cmds) room.apply(c);
    const keys: [number, number][] = [];
    const ins: number[][] = [];
    const stall: number[] = [];
    const used = new Map<number, number[]>();
    const acks = new Map<number, number>();
    for (const a of room.actors) {
      if (a.bot) {
        const brain = this.brains.get(a.id);
        const bits = brain && !a.battling ? botKeys(room, a, brain) : 0;
        if (bits !== a.keys) { keys.push([a.id, bits]); a.keys = bits; }
        continue;
      }
      const p = this.players.get(a.id);
      if (!p) { stall.push(a.id); continue; }
      // Moving again once the cushion is in hand, or once what is in hand has waited as
      // long as a cushion would have (a lone tap after a quiet spell).
      if (!p.started && p.queue.length) {
        if (p.queue.length >= Math.max(1, this.jitter) || p.waited >= this.jitter) { p.started = true; p.waited = 0; }
        else p.waited += 1;
      }
      if (p.started) {
        // Catching up, a second input every fourth frame: the trainer a quarter fast for a
        // moment as others see it, not double speed.
        const n = p.queue.length > this.jitter + CATCH_UP && room.tick % 4 === 0 ? 2 : p.queue.length ? 1 : 0;
        if (!n) p.started = false; // ran dry: stand, and wait for a cushion again
        const take = p.queue.splice(0, n);
        p.seq += n;
        if (n) used.set(a.id, take);
      }
      const take = used.get(a.id);
      if (!take) stall.push(a.id);
      else if (take.length !== 1 || take[0] !== a.keys) ins.push([a.id, ...take]);
      acks.set(a.id, p.seq);
    }
    const events = room.step(used);
    const frame: Frame = { tick: room.tick };
    if (cmds.length) frame.cmds = cmds;
    if (keys.length) frame.keys = keys;
    if (ins.length) frame.ins = ins;
    if (stall.length) frame.stall = stall;
    return { frame, acks, events };
  }
}

/** A mirror's frame: the same order the host used. */
export function play(room: Room, f: Frame): RoomEvent[] {
  for (const c of f.cmds ?? []) room.apply(c);
  for (const [id, bits] of f.keys ?? []) {
    const a = room.actor(id);
    if (a) a.keys = bits;
  }
  const used = new Map<number, number[]>();
  for (const a of room.actors) if (!a.bot) used.set(a.id, [a.keys]);
  for (const id of f.stall ?? []) used.delete(id);
  for (const [id, ...bits] of f.ins ?? []) used.set(id, bits);
  const events = room.step(used);
  if (room.tick !== f.tick) throw new Error(`frame ${f.tick} played as ${room.tick}`);
  return events;
}
