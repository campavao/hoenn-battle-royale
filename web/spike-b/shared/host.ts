// The one machine that runs a Room for real: the relay (relay/world.js), or the page
// itself when nobody else is there. It decides each frame's keys -- a trainer's from
// what their phone sent, a bot's from its thumb on the pad -- steps the Room, and keeps
// a record of the frame for everybody who mirrors it (net.ts).

import type { Spot, WorldMap } from '../../src/bots/world';
import { botKeys, botSpawns, type Brain } from './bots';
import { Room, type Command, type RoomEvent } from './room';

/** One frame as a mirror needs it: what changed before anybody moved, then who now holds
 *  which keys (only the ones that changed), and -- per phone -- the last of its inputs
 *  this frame used. */
export interface Frame {
  tick: number;
  cmds?: Command[];
  keys?: [number, number][];
  ack?: number;
}

interface Player {
  id: number;
  /** Keys per frame, in order, not used yet; and the number of the last one used. */
  queue: number[];
  seq: number;
  held: number;
  started: boolean;
  /** Frames since the last input arrived in time. */
  dry: number;
}

/** Inputs wait this many frames before the first is used, so a late packet doesn't
 *  leave a frame without keys; past MAX_QUEUE a backlog is caught up (net.ts corrects). */
const JITTER = 3;
const MAX_QUEUE = 12;
/** Frames a trainer's keys stay held with nothing new from the phone. */
const DRY = 15;

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

  /** A new trainer, in Littleroot by the truck, standing on the next frame. */
  join(name: string, skin: number, spot?: Spot): number {
    const id = this.nextId++;
    if (spot) {
      this.pending.push({ c: 'join', id, bot: false, name, skin, spot, facing: 1 });
      this.players.set(id, { id, queue: [], seq: 0, held: 0, started: false, dry: 0 });
      return id;
    }
    const free = [[10, 10], [9, 10], [11, 10], [10, 11], [9, 11], [11, 11], [10, 12], [8, 10], [12, 10]];
    const at = free.find(([x, y]) => !this.room.actors.some((a) => a.m.spot.map === 'MAP_LITTLEROOT_TOWN' && a.m.spot.x === x && a.m.spot.y === y)) ?? [10, 10];
    this.pending.push({ c: 'join', id, bot: false, name, skin, spot: { map: 'MAP_LITTLEROOT_TOWN', x: at[0], y: at[1] }, facing: 1 });
    this.players.set(id, { id, queue: [], seq: 0, held: 0, started: false, dry: 0 });
    return id;
  }

  leave(id: number): void {
    this.players.delete(id);
    this.pending.push({ c: 'leave', id });
  }

  /** A phone's keys for its next frames, numbered: `first` is the number of k[0]. */
  input(id: number, first: number, k: number[]): void {
    const p = this.players.get(id);
    if (!p) return;
    const known = p.seq + p.queue.length;
    // Resent or overlapping: only the frames not seen yet.
    const skip = Math.max(0, known + 1 - first);
    for (let i = skip; i < k.length; i++) p.queue.push(k[i] & 63);
  }

  /** The phone's battle is over: its trainer (and the bot) walk again. */
  end(id: number): void {
    if (this.players.has(id)) this.pending.push({ c: 'end', id });
  }

  /** One frame. The record goes to every mirror; `acks` is each phone's last input used. */
  advance(): { frame: Frame; acks: Map<number, number>; events: RoomEvent[] } {
    const room = this.room;
    const cmds = this.pending;
    this.pending = [];
    for (const c of cmds) room.apply(c);
    const keys: [number, number][] = [];
    const acks = new Map<number, number>();
    for (const a of room.actors) {
      let bits = a.keys;
      if (a.bot) {
        const brain = this.brains.get(a.id);
        bits = brain && !a.battling ? botKeys(room, a, brain) : 0;
      } else {
        const p = this.players.get(a.id);
        if (p) {
          if (!p.started && p.queue.length >= Math.max(1, this.jitter)) p.started = true;
          if (p.started) {
            while (p.queue.length > MAX_QUEUE) { p.held = p.queue.shift()!; p.seq += 1; }
            if (p.queue.length) { p.held = p.queue.shift()!; p.seq += 1; p.dry = 0; }
            else p.started = false; // ran dry: wait for a cushion again
          }
          // Keys go on being held through a late packet, but not for good: a phone that
          // went quiet (a hidden tab, a dead network) lets go.
          if (!p.queue.length && ++p.dry > DRY) p.held = 0;
          bits = p.held;
          acks.set(a.id, p.seq);
        }
      }
      if (bits !== a.keys) { keys.push([a.id, bits]); a.keys = bits; }
    }
    const events = room.step();
    const frame: Frame = { tick: room.tick };
    if (cmds.length) frame.cmds = cmds;
    if (keys.length) frame.keys = keys;
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
  const events = room.step();
  if (room.tick !== f.tick) throw new Error(`frame ${f.tick} played as ${room.tick}`);
  return events;
}
