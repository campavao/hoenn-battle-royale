// The page's end of the shared world. Either the relay runs the Room (online: every
// phone that opens /spike-b/ is in it) or, with no relay to reach, the page runs one
// itself with the bots (solo). main.ts does not care which: each 60 Hz frame it hands
// over its keys and gets back the battles that started for its trainer.
//
// Online, two copies of the room live here:
//  - `room`, the relay's, confirmed: frames are played out of a short buffer, one a
//    frame, so everybody else walks smoothly even when packets arrive in bunches.
//  - my trainer as drawn, predicted: the confirmed trainer plus every key I have sent
//    that the relay has not used yet, replayed. Walking answers the thumb at once; if
//    the relay disagrees (somebody stepped into the cell first) the next replay shows it.
// A battle starts only when the confirmed room says so, so two phones never both take
// one marked spot.

import type { World, WorldMap } from '../src/bots/world';
import type { PatchTable } from '../src/bots/patches';
import { tick } from './sim';
import { Host, play } from './shared/host';
import { keysOf, makeRoom, type Actor, type Room, type RoomEvent } from './shared/room';
import type { WireFrame, WorldDown, WorldUp } from './shared/wire';

export interface WorldLink {
  readonly room: Room;
  readonly me: number;
  readonly online: boolean;
  /** One frame: my keys in, the battles that started for me out. */
  frame(bits: number): RoomEvent[];
  /** My trainer as it is drawn (none for the frame before the room has me). */
  mine(): Actor | undefined;
  /** My battle is over. */
  end(): void;
  /** For the stats line. */
  status(): string;
}

const BOTS = 64;

export function soloLink(maps: WorldMap[], patches: PatchTable, world: World, seed: number): WorldLink {
  const host = new Host(makeRoom(maps, patches, seed, world), BOTS, maps, 0);
  const me = host.join('YOU', 0);
  host.advance();
  let seq = 0;
  return {
    room: host.room,
    me,
    online: false,
    frame(bits) {
      host.input(me, ++seq, [bits]);
      return host.advance().events.filter((e) => e.id === me);
    },
    mine: () => host.room.actor(me),
    end: () => host.end(me),
    status: () => 'solo: you and the bots (no relay)',
  };
}

/** Frames the playout keeps in hand before it starts (and again after running dry). */
const CUSHION = 3;

class Online implements WorldLink {
  room!: Room;
  me = 0;
  readonly online = true;
  private queue: WireFrame[] = [];
  private playing = false;
  /** The buffer's depth, smoothed over about a third of a second. */
  private depth = 0;
  private ticks = 0;
  private seq = 0;
  private acked = 0;
  private sent: { seq: number; bits: number }[] = [];
  private syncing = false;
  private syncAt = 0;
  private resyncs = 0;
  private rtt = 0;
  private lastSend = new Map<number, number>();
  private predicted: Actor | null = null;
  private closed = false;

  constructor(private readonly ws: WebSocket, private readonly make: (seed: number) => Room) {
    ws.addEventListener('close', () => { this.closed = true; });
  }

  /** The relay's answers; `hello` resolves `ready`. */
  receive(m: WorldDown, ready: () => void): void {
    if (m.t === 'hello') {
      this.room = this.make(m.state.seed);
      this.room.load(m.state);
      this.me = m.id;
      ready();
    } else if (m.t === 'state') {
      this.room.load(m.state);
      this.queue = [];
      this.syncing = false;
    } else if (m.t === 'f' && this.room && !this.syncing) {
      this.queue.push(...m.f);
    }
  }

  private send(m: WorldUp): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  frame(bits: number): RoomEvent[] {
    this.seq += 1;
    this.sent.push({ seq: this.seq, bits });
    this.lastSend.set(this.seq, performance.now());
    this.send({ t: 'in', s: this.seq, k: [bits] });
    // Play out: one frame a frame, none while it builds its cushion back. A buffer that
    // stays deep (this phone's clock runs slow, or the network settled after a bad
    // patch) is caught up gently: one extra frame in 15, one in 4 past 20 deep (a bad
    // bunch clears in seconds) -- never the 2-3x bursts that made everybody look sped
    // up (Cam).
    this.depth = this.depth * 0.95 + this.queue.length * 0.05;
    this.ticks += 1;
    if (!this.playing && this.queue.length >= CUSHION) this.playing = true;
    // Far behind (the tab was hidden): a few seconds are played through at once; past
    // that the relay's copy of the room is cheaper than replaying it.
    if (this.queue.length > 600) { this.resync(); return []; }
    // The relay answers one sync a second: one asked too soon goes unanswered, so ask again.
    if (this.syncing && performance.now() - this.syncAt > 1500) this.resync();
    const n = !this.playing ? 0
      : this.queue.length > 120 ? this.queue.length - CUSHION - 2
      : this.ticks % (this.depth > 20 ? 4 : 15) === 0 && this.depth > CUSHION + 3 ? 2 : 1;
    const events: RoomEvent[] = [];
    for (let i = 0; i < n && this.queue.length && !this.syncing; i++) {
      const f = this.queue.shift()!;
      if (f.tick <= this.room.tick) continue;
      if (f.tick !== this.room.tick + 1) { this.resync(); break; }
      events.push(...play(this.room, f).filter((e) => e.id === this.me));
      if (f.a !== undefined && f.a > this.acked) {
        const t = this.lastSend.get(f.a);
        if (t !== undefined) this.rtt = this.rtt ? this.rtt * 0.9 + (performance.now() - t) * 0.1 : performance.now() - t;
        this.acked = f.a;
      }
      if (f.h !== undefined && f.h !== this.room.hash()) { this.resync(); break; }
    }
    if (!this.queue.length) this.playing = false;
    while (this.sent.length && this.sent[0].seq <= this.acked) this.sent.shift();
    for (const s of this.lastSend.keys()) { if (s > this.acked - 120) break; this.lastSend.delete(s); }
    this.predicted = null;
    return events;
  }

  private resync(): void {
    this.syncing = true;
    this.syncAt = performance.now();
    this.resyncs += 1;
    this.queue = [];
    this.send({ t: 'sync' });
  }

  mine(): Actor | undefined {
    if (this.predicted) return this.predicted;
    const real = this.room.actor(this.me);
    if (!real) return undefined;
    if (real.battling) return (this.predicted = real);
    const a = structuredClone(real);
    const step = this.room.stepFor(a);
    for (const { bits } of this.sent) {
      const before = a.m.strides;
      tick(a.m, keysOf(bits), step);
      // Stepped onto a marked spot: stand there until the relay says whose it is.
      if (a.m.strides !== before && !a.m.action && this.room.patchesOn(a.m.spot.map).some((q) => q.x === a.m.spot.x && q.y === a.m.spot.y && !this.room.isTaken(q.key))) break;
    }
    return (this.predicted = a);
  }

  end(): void { this.send({ t: 'end' }); }

  status(): string {
    if (this.closed) return 'the relay closed the connection: reload to rejoin';
    return `online: ${this.room.actors.filter((a) => !a.bot).length} here · keys reach the room in ${this.rtt.toFixed(0)} ms · ahead ${this.sent.length} · buffer ${this.queue.length}` +
      (this.resyncs ? ` · resyncs ${this.resyncs}` : '');
  }
}

/** The relay's shared world, or null if it is not there within `ms`. */
export function onlineLink(url: string, name: string, skin: number, make: (seed: number) => Room, ms = 4000): Promise<WorldLink | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { resolve(null); return; }
    const link = new Online(ws, make);
    let done = false;
    const finish = (v: WorldLink | null) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { ws.close(); finish(null); }, ms);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'join', name, skin } satisfies WorldUp)));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as WorldDown;
      if (m.t === 'full') { finish(null); return; }
      link.receive(m, () => finish(link));
    });
    ws.addEventListener('error', () => finish(null));
    ws.addEventListener('close', () => finish(null));
  });
}
