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
import { BOT_FILL } from '../src/match/room';
import { keysOf, makeRoom, type Actor, type Bag, type Room, type RoomEvent } from './shared/room';
import type { FameMon } from '../src/ui/results';
import type { Again, CardRecord, Listed, PeekBag, Settings, SpMsg, WireFrame, WorldDown, WorldUp } from './shared/wire';

export interface WorldLink {
  readonly room: Room;
  readonly me: number;
  readonly online: boolean;
  /** What a reload brings back to rejoin as the same trainer (online only). */
  readonly key?: string;
  /** One frame: my keys in, the battles that started for me out. */
  frame(bits: number): RoomEvent[];
  /** My trainer as it is drawn (none for the frame before the room has me). */
  mine(): Actor | undefined;
  /** My battle is over (`fled`: it never got going, or was run from; `won`: I beat a bot). */
  end(fled?: boolean, won?: boolean): void;
  /** What my team could do on the field now (FIELD_*). */
  field(bits: number): void;
  /** The bots the room gave me to fight: `winner` won (0, no answer). */
  bots(a: number, b: number, winner: number): void;
  /** Where to drop me when the Safari ends. */
  pick(map: string): void;
  /** My trade with event `n`'s trader is over: I gave him `given` (0, nothing). */
  traded(n: number, given: number): void;
  /** My catch with a full party let these go: they lie beside me (room.ts `released`). */
  released(mons: { species: number; level: number }[]): void;
  /** I opened event `n`'s REGI wall. */
  open(n: number): void;
  /** I sail to story `to`'s island, or ('') back to Lilycove. */
  sail(to: string): void;
  /** FLY off the MAP landed me on `map` at x, y. */
  fly(map: string, x: number, y: number): void;
  /** The ball `key` would not go in my bag: put it back. */
  drop(key: number, rest?: Bag): void;
  /** My team is down: off the map. `by` who beat me, `wild` a wild POKeMON did. */
  out(bag?: Bag, by?: number, wild?: boolean): void;
  /** A link block for the trainer I am fighting (online only). */
  bt(q: number, d: number[]): void;
  /** Where the blocks from the trainer I am fighting go. */
  onBt: ((q: number, d: number[]) => void) | null;
  /** Whose battles come to me (0: nobody's), and the eye they see. */
  watch(id: number): void;
  /** What my ROM published of the battle I am in, for whoever watches it. */
  /** `as`: a bots' fight this page judges, published as that bot (wire.ts). */
  sp(m: SpMsg, as?: number): void;
  /** The battle the trainer I watch is in, message by message from its start. */
  onSp: ((from: number, m: SpMsg) => void) | null;
  /** How many are watching me. */
  onEyes: ((n: number) => void) | null;
  /** My team as it stands, for the hall of fame if I win; my bag for a watcher. */
  team(mons: FameMon[], bag?: PeekBag): void;
  /** Every trainer's team as they last told it. */
  readonly teams: Map<number, FameMon[]>;
  /** And their bag, for a watcher's START (players only: a bot's is its room loot). */
  readonly bags: Map<number, PeekBag>;
  /** For the stats line. */
  status(): string;
}


/** What a world of the page's own is dealt: the debug flags' pace, seed and bots
 *  (#fast, #fog=, #safari=, #nobots; frames), and who plays it. */
export interface SoloOpts { bots?: number; ringFrames?: number; openingFrames?: number; name?: string; skin?: number }

export function soloLink(maps: WorldMap[], patches: PatchTable, world: World, seed: number, opts: SoloOpts = {}): WorldLink {
  const room = makeRoom(maps, patches, seed, world);
  if (opts.ringFrames) room.ringPhase = opts.ringFrames;
  room.opening = opts.openingFrames ?? room.ringPhase; // the Safari opening, as a match has it
  // The live game's offline QUICK PLAY: you and BOT_FILL bots.
  const host = new Host(room, opts.bots ?? BOT_FILL, maps, 0);
  const me = host.join(opts.name || 'YOU', opts.skin ?? 0);
  host.advance();
  let seq = 0;
  const teams = new Map<number, FameMon[]>();
  const bags = new Map<number, PeekBag>();
  // The bots' fights this page judges, as the relay keeps them (service.ts publish), for
  // watching one: from its BSTART, however late the watch begins.
  const streams = new Map<number, { foe: number; sent: SpMsg[] }>();
  let watching = 0;
  // Only the fight a bot is in now: its stream from an earlier one is never dropped.
  const fightOf = (id: number) => {
    const a = host.room.actor(id);
    if (!a?.battling) return undefined;
    if (streams.get(id)?.foe === a.foe) return id;
    return a.foe && streams.get(a.foe)?.foe === id ? a.foe : undefined;
  };
  const link: WorldLink = {
    room: host.room,
    me,
    online: false,
    frame(bits) {
      host.input(me, ++seq, [bits]);
      return host.advance().events.filter((e) => e.id === me);
    },
    mine: () => host.room.actor(me),
    end: (fled, won) => host.end(me, fled, won),
    field: (bits) => host.field(me, bits),
    bots: (a, b, winner) => host.bots(me, a, b, winner),
    traded: (n, given) => host.traded(me, n, given),
    released: (mons) => host.released(me, mons),
    open: (n) => host.open(me, n),
    sail: (to) => host.sail(me, to),
    fly: (map, x, y) => host.fly(me, map, x, y),
    pick: (map) => host.pick(me, map),
    drop: (key, rest) => host.drop(me, key, rest),
    out: (bag, by, wild) => host.out(me, bag, by, wild),
    bt: () => undefined,
    onBt: null,
    watch: (id) => {
      watching = id;
      const from = fightOf(id);
      if (from !== undefined) for (const m of streams.get(from)!.sent) link.onSp?.(from, m);
    },
    sp: (m, as) => {
      if (as === undefined) return;
      if (m.t === 'bstart') streams.set(as, { foe: host.room.actor(as)?.foe ?? 0, sent: [] });
      streams.get(as)?.sent.push(m);
      if (watching && fightOf(watching) === as) link.onSp?.(as, m);
    },
    onSp: null,
    onEyes: null,
    teams,
    bags,
    team: (mons, bag) => { teams.set(me, mons); if (bag) bags.set(me, bag); },
    status: () => 'solo: you and the bots (no relay)',
  };
  return link;
}

/** Frames the playout keeps in hand before it starts (and again after running dry). */
const CUSHION = 3;

export class Online implements WorldLink {
  room!: Room;
  me = 0;
  key?: string;
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
  onBt: ((q: number, d: number[]) => void) | null = null;
  onSp: ((from: number, m: SpMsg) => void) | null = null;
  onEyes: ((n: number) => void) | null = null;
  readonly teams = new Map<number, FameMon[]>();
  readonly bags = new Map<number, PeekBag>();

  constructor(private readonly ws: WebSocket, private readonly make: (seed: number) => Room) {
    // A hidden tab (walked away from) runs no frames; it says it is still here, under the
    // relay's QUIET_MS, or the relay drops it and it comes back to the menu (Cam 10-29).
    // A background tab's timers run at most once a minute: 20 s is well inside either.
    const here = setInterval(() => { if (typeof document !== 'undefined' && document.hidden) this.send({ t: 'here' }); }, 20_000);
    ws.addEventListener('close', () => { this.closed = true; clearInterval(here); });
  }

  /** The relay's answers; `hello` resolves `ready`. */
  receive(m: WorldDown, ready: () => void): void {
    if (m.t === 'hello') {
      this.room = this.make(m.state.seed);
      this.room.load(m.state);
      this.me = m.id;
      this.key = m.key;
      this.teams.clear();
      ready();
    } else if (m.t === 'state') {
      this.room.load(m.state);
      this.queue = [];
      this.syncing = false;
    } else if (m.t === 'f' && this.room && !this.syncing) {
      this.queue.push(...m.f);
    } else if (m.t === 'bt') {
      this.onBt?.(m.q, m.d);
    } else if (m.t === 'sp') {
      this.onSp?.(m.from, m.m);
    } else if (m.t === 'eyes') {
      this.onEyes?.(m.n);
    } else if (m.t === 'team') {
      this.teams.set(m.id, m.mons);
      if (m.bag) this.bags.set(m.id, m.bag);
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
    // Stepped onto a marked spot: stand there until the relay says whose it is. A step
    // counts its stride as it starts, so the spot is asked once it is over, as Room.move
    // asks (`arriving`): asked as the stride counted, the step was never over yet, and the
    // drawn trainer walked on past the spot until the relay's battle pulled it back (Cam
    // 10-30, "it rubber bands me back").
    let arriving = a.arriving;
    for (const { bits } of this.sent) {
      const before = a.m.strides;
      tick(a.m, keysOf(bits), step);
      if (a.m.strides !== before) arriving = true;
      if (!arriving || a.m.action) continue;
      arriving = false;
      if (this.room.patchesOn(a.m.spot.map).some((q) => q.x === a.m.spot.x && q.y === a.m.spot.y && !this.room.isTaken(q.key))) break;
    }
    return (this.predicted = a);
  }

  end(fled = false, won = false): void { this.send({ t: 'end', ...(fled ? { fled } : {}), ...(won ? { won } : {}) }); }
  field(bits: number): void { this.send({ t: 'field', bits }); }

  team(mons: FameMon[], bag?: PeekBag): void {
    this.teams.set(this.me, mons);
    if (bag) this.bags.set(this.me, bag);
    this.send({ t: 'team', mons, ...(bag ? { bag } : {}) });
  }

  bots(a: number, b: number, winner: number): void { this.send({ t: 'bots', a, b, w: winner }); }

  traded(n: number, given: number): void { this.send({ t: 'traded', n, sp: given }); }
  released(mons: { species: number; level: number }[]): void { this.send({ t: 'released', mons: mons.map((m) => ({ sp: m.species, lv: m.level })) }); }
  open(n: number): void { this.send({ t: 'open', n }); }
  sail(to: string): void { this.send({ t: 'sail', to }); }
  fly(map: string, x: number, y: number): void { this.send({ t: 'fly', map, x, y }); }

  pick(map: string): void { this.send({ t: 'pick', map }); }

  drop(key: number, rest?: Bag): void { this.send({ t: 'drop', k: key, rest }); }

  out(bag?: Bag, by?: number, wild?: boolean): void { this.send({ t: 'out', bag, by, wild }); }

  bt(q: number, d: number[]): void { this.send({ t: 'bt', q, d }); }

  watch(id: number): void { this.send({ t: 'watch', id }); }

  sp(m: SpMsg, as?: number): void { this.send({ t: 'sp', m, ...(as === undefined ? {} : { as }) }); }

  status(): string {
    if (this.closed) return 'the relay closed the connection: reload to rejoin';
    return `online: ${this.room.actors.filter((a) => !a.bot).length + this.room.bench.length} here · keys reach the room in ${this.rtt.toFixed(0)} ms · ahead ${this.sent.length} · buffer ${this.queue.length}` +
      (this.resyncs ? ` · resyncs ${this.resyncs}` : '');
  }
}

/** The relay's side of spike B, from the menu on: one socket for the rooms and every match
 *  in them. `onMatch` hands over the match's link each time one starts for me (or I come
 *  into one under way, to watch). */
export interface WorldSocket {
  join(name: string, skin: number, how: { code?: string; host?: boolean; again?: Again; pass?: string; rec?: CardRecord }): void;
  start(): void;
  /** LEAVE: out of the room and its match; the socket stays for the menu. */
  leave(): void;
  /** LOBBIES: ask for the hosted rooms (`onRooms`). */
  list(): void;
  /** The host's settings for the room's next match (with the passcode, for a `pass` door). */
  set(set: Partial<Settings> & { pass?: string }): void;
  /** The host takes trainer `id` out of the room. */
  kick(id: number): void;
  close(): void;
}

/** The world this page was built with (vite's define, world-hash.ts); unset under vitest. */
declare const __WORLD_HASH__: string | undefined;
const WORLD = typeof __WORLD_HASH__ === 'string' ? __WORLD_HASH__ : undefined;
/** The build's world, short: a `stat` line's version (the relay keeps 16 characters). */
export const WORLD_HASH_SHORT = (WORLD ?? 'dev').slice(0, 8);
/** The patched ROM this page battles on (rom.ts romSha), sent with every join. */
let ROM_SHA = '';
export function battlesOn(sha: string): void { ROM_SHA = sha; }

export interface WorldHandlers {
  onRoom(r: Extract<WorldDown, { t: 'room' }>): void;
  /** No room by that code; `pass`: there is, and the passcode was wrong; `rom`: there is,
   *  and its battles run on another patch of the game. */
  onNoRoom(code: string, pass?: boolean, rom?: boolean): void;
  /** The host took me out of the room. */
  onKicked(): void;
  /** This page is an older (or newer) world than the relay's: it has to reload. */
  onOld(): void;
  onRooms(rooms: Listed[]): void;
  onMatch(link: WorldLink): void;
  /** The socket closed (or never opened) for good. */
  onClosed(): void;
  /** The socket opened the first time: the relay is there. */
  onOpen?(): void;
  /** The socket dropped and is being tried again (Reconnecting…). Without it, a drop
   *  is onClosed. */
  onDropped?(): void;
  /** Open again after a drop: what to send first to come back in (a join with `again`),
   *  if anything. */
  onReconnected?(): WorldUp | undefined;
}

/** How long a dropped socket is tried again: the relay's hold on an away trainer. */
export const RECONNECT_MS = 55_000;

export function connectWorld(url: string, make: (seed: number) => Room, h: WorldHandlers): WorldSocket {
  let ws: WebSocket | null = null;
  let match: Online | null = null;
  let closed = false;
  /** Tries since the socket last dropped, and when it dropped (0: it is up). */
  let tries = 0;
  let droppedAt = 0;
  let opened = false;
  const queue: WorldUp[] = [];
  const send = (m: WorldUp) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    else queue.push(m);
  };
  const open = (): boolean => {
    let sock: WebSocket;
    try { sock = new WebSocket(url); } catch { return false; }
    ws = sock;
    sock.addEventListener('open', () => {
      const back = droppedAt > 0;
      if (!opened) { opened = true; h.onOpen?.(); }
      droppedAt = 0;
      tries = 0;
      // Back after a drop: the page says how to come back in (the room, my id and key)
      // before anything queued while it was down.
      const again = back ? h.onReconnected?.() : undefined;
      if (again) sock.send(JSON.stringify(again));
      for (const m of queue.splice(0)) sock.send(JSON.stringify(m));
    });
    sock.addEventListener('close', () => {
      if (closed || ws !== sock) return;
      // A dropped socket (a phone's network blinking) comes back by itself for as long
      // as the relay holds the trainer (AWAY_MS); the page shows Reconnecting meanwhile.
      const now = Date.now();
      if (!droppedAt) droppedAt = now;
      if (h.onDropped && opened && now - droppedAt < RECONNECT_MS) {
        h.onDropped();
        setTimeout(() => { if (!closed && !open()) { closed = true; h.onClosed(); } }, Math.min(8000, 500 * 2 ** tries++));
        return;
      }
      closed = true;
      h.onClosed();
    });
    sock.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as WorldDown;
      if (m.t === 'room') h.onRoom(m);
      else if (m.t === 'no_room') h.onNoRoom(m.code, m.pass, m.rom);
      else if (m.t === 'kicked') h.onKicked();
      else if (m.t === 'old') h.onOld();
      else if (m.t === 'rooms') h.onRooms(m.rooms);
      else if (m.t === 'full') h.onNoRoom('');
      else if (m.t === 'hello') {
        const next = new Online(sock, make);
        next.receive(m, () => undefined);
        match = next;
        h.onMatch(next);
      } else match?.receive(m, () => undefined);
    });
    return true;
  };
  if (!open()) { setTimeout(() => h.onClosed(), 0); return { join: () => undefined, start: () => undefined, list: () => undefined, set: () => undefined, kick: () => undefined, leave: () => undefined, close: () => undefined }; }
  return {
    join: (name, skin, how) => send({ t: 'join', name, skin, ...how, ...(WORLD ? { w: WORLD } : {}), ...(ROM_SHA ? { r: ROM_SHA } : {}) }),
    start: () => send({ t: 'start' }),
    list: () => send({ t: 'list' }),
    set: (set) => send({ t: 'set', set }),
    kick: (id) => send({ t: 'kick', id }),
    leave: () => send({ t: 'leave' }),
    close: () => { closed = true; ws?.close(); },
  };
}
