// The relay's side of spike B: rooms as the live game has them (match/room.ts), each
// running its own Room once it starts. relay/world.js only joins it to the sockets; this
// file is bundled into relay/world/service.js (tools/br/bundle-world.mjs), so the relay
// and the page step the very same code.
//
// A phone comes in by QUICK PLAY (the fullest quick room still waiting, or a new one),
// HOST (a room of its own, with a code) or a code. It waits in the room -- the roster
// goes to everybody whenever it changes -- until the room's host presses START, or a
// quick room's count runs out. Then the room's Room is made, everybody in it joins it at
// the truck, and it is stepped at 60 Hz, every frame to every phone. Somebody who comes
// in while it runs watches. When the match is over (one left standing, everybody out, or
// the fog lifting) the Room goes and the room is a room again, for PLAY AGAIN.

import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import { CODE_ALPHABET, CODE_LENGTH } from '../../src/match/lobby';
import { Host } from './host';
import { makeRoom } from './room';
import { cleanBag } from './items';
import { over } from './over';
import { HASH_EVERY, type Member, type WireFrame, type WorldDown, type WorldUp } from './wire';

export interface Link { send(text: string): void; close(): void }
export interface Session { onText(text: string): void; onClose(): void }

export interface ServiceOptions {
  maps: WorldMap[];
  patches: PatchTable;
  bots: number;
  /** Trainers at most, in all rooms; the next is told `full`. */
  cap: number;
  now: () => number;
  log: (line: string) => void;
  /** Seconds a ring phase lasts, for a local test (the match's 120 otherwise). */
  ringSecs?: number;
  /** A quick room's count to its own start (match/room.ts's AUTO_START_MS). */
  autoStartMs?: number;
}

const FRAME_MS = 1000 / 60;
/** A phone that sends nothing this long (a tab hidden for good) is let go. */
const QUIET_MS = 120_000;
/** The whole room, at most this often a phone (it is ~20 KB against a 13 B ask). */
const SYNC_MS = 1000;
/** A link block's bytes, at most: Emerald's BLOCK_BUFFER_SIZE (link.h). */
const BT_MAX = 256;
/** Trainers in one room (Cam's cap). */
const ROOM_MAX = 30;
/** match/room.ts's AUTO_START_MS. */
const AUTO_START_MS = 60_000;
/** Ids for trainers, clear of the bots' 1..n. */
const FIRST_ID = 1000;

interface Phone {
  id: number;
  name: string;
  skin: number;
  link: Link;
  heard: number;
  synced: number;
}

interface Lobby {
  code: string;
  quick: boolean;
  /** The member who has START, and the room's settings. */
  owner: number;
  members: Map<number, Phone>;
  /** A quick room starts itself then (ms, `now`). */
  startsAt: number | null;
  /** The match under way. */
  host: Host | null;
  t0: number;
}

export class WorldService {
  private readonly rooms = new Map<string, Lobby>();
  private readonly where = new Map<number, Lobby>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextId = FIRST_ID;

  constructor(private readonly opts: ServiceOptions) {}

  /** Trainers on this relay, in every room. */
  get players(): number { return this.where.size; }
  /** The first running match's frame (a test's clock). */
  get tick(): number { return [...this.rooms.values()].find((r) => r.host)?.host!.room.tick ?? 0; }

  open(link: Link): Session {
    let phone: Phone | null = null;
    return {
      onText: (text) => {
        let m: WorldUp;
        try { m = JSON.parse(text) as WorldUp; } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (phone) phone.heard = this.opts.now();
        if (m.t === 'join' && !phone) {
          if (this.where.size >= this.opts.cap) { this.send(link, { t: 'full' }); link.close(); return; }
          const room = this.pick(m);
          if (!room) { this.send(link, { t: 'no_room', code: String(m.code ?? '') }); return; }
          const name = String(m.name ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 10);
          const skin = Number.isInteger(m.skin) && m.skin >= 0 && m.skin < 16 ? m.skin : 0;
          const id = this.nextId++;
          phone = { id, name: name || `TRAINER ${id - FIRST_ID + 1}`.slice(0, 10), skin, link, heard: this.opts.now(), synced: -Infinity };
          room.members.set(id, phone);
          this.where.set(id, room);
          if (!room.owner) room.owner = id;
          this.opts.log(`world: ${phone.name}#${id} in room ${room.code}${room.quick ? ' (quick)' : ''}, ${room.members.size} there`);
          this.roster(room);
          // A match under way: in, to watch it until the next.
          if (room.host) {
            room.host.join(phone.name, phone.skin, undefined, id);
            this.send(link, { t: 'hello', id, state: room.host.room.state() });
          }
          this.run();
          return;
        }
        const room = phone ? this.where.get(phone.id) : undefined;
        if (!phone || !room) return;
        const host = room.host;
        if (m.t === 'start') {
          if (!host && (phone.id === room.owner)) this.start(room);
        } else if (!host) {
          return;
        } else if (m.t === 'in') {
          if (!Number.isInteger(m.s) || m.s < 1 || !Array.isArray(m.k) || m.k.length > 120) return;
          host.input(phone.id, m.s, m.k.map((v) => (Number(v) | 0) & 63));
        } else if (m.t === 'end') {
          host.end(phone.id, m.fled === true, m.won === true);
        } else if (m.t === 'out') {
          host.out(phone.id, cleanBag(m.bag) ?? undefined, Number.isInteger(m.by) && m.by! > 0 ? m.by : undefined, m.wild === true);
        } else if (m.t === 'drop') {
          if (Number.isInteger(m.k)) host.drop(phone.id, m.k, cleanBag(m.rest) ?? undefined);
        } else if (m.t === 'bt') {
          // Only to the one trainer this one is fighting, and only while they fight each
          // other: a block that reached any other battle would desync it (POK-330 #20).
          if (!Number.isInteger(m.q) || !Array.isArray(m.d) || m.d.length > BT_MAX) return;
          const me = host.room.actor(phone.id);
          const foe = me?.battling && me.foe ? host.room.actor(me.foe) : undefined;
          if (!foe || foe.bot || !foe.battling || foe.foe !== phone.id) return;
          const to = room.members.get(foe.id);
          if (to) this.send(to.link, { t: 'bt', q: m.q & 0xffff, d: m.d.map((v) => (Number(v) | 0) & 0xff) });
        } else if (m.t === 'sync') {
          const now = this.opts.now();
          if (now - phone.synced < SYNC_MS) return;
          phone.synced = now;
          this.send(link, { t: 'state', state: host.room.state() });
        }
      },
      onClose: () => {
        if (!phone) return;
        const room = this.where.get(phone.id);
        this.where.delete(phone.id);
        if (!room) return;
        room.members.delete(phone.id);
        room.host?.leave(phone.id);
        // START passes to whoever came in next.
        if (room.owner === phone.id) room.owner = room.members.keys().next().value ?? 0;
        this.opts.log(`world: #${phone.id} out of room ${room.code} (${room.members.size} there)`);
        if (!room.members.size) this.close(room);
        else this.roster(room);
        phone = null;
      },
    };
  }

  /** The room a join asks for: its code, a new one of its own (HOST), or quick play's. */
  private pick(m: Extract<WorldUp, { t: 'join' }>): Lobby | null {
    if (typeof m.code === 'string' && m.code) {
      const r = this.rooms.get(m.code.toUpperCase());
      return r && r.members.size < ROOM_MAX ? r : null;
    }
    if (m.host === true) return this.make(false);
    // The fullest quick room still waiting for its start; or a new one.
    let best: Lobby | null = null;
    for (const r of this.rooms.values()) {
      if (r.quick && !r.host && r.members.size < ROOM_MAX && (!best || r.members.size > best.members.size)) best = r;
    }
    return best ?? this.make(true);
  }

  private make(quick: boolean): Lobby {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    } while (this.rooms.has(code));
    const room: Lobby = { code, quick, owner: 0, members: new Map(), startsAt: quick ? this.opts.now() + (this.opts.autoStartMs ?? AUTO_START_MS) : null, host: null, t0: 0 };
    this.rooms.set(code, room);
    return room;
  }

  /** START: the Room, everybody in it at the truck, and the match locked to them. */
  private start(room: Lobby): void {
    const seed = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
    const r = makeRoom(this.opts.maps, this.opts.patches, seed);
    if (this.opts.ringSecs) r.ringPhase = Math.round(this.opts.ringSecs * 60);
    const host = new Host(r, this.opts.bots, this.opts.maps);
    for (const p of room.members.values()) { host.join(p.name, p.skin, undefined, p.id); p.heard = room.t0 = this.opts.now(); }
    host.lock();
    room.host = host;
    room.startsAt = null;
    room.t0 = this.opts.now();
    this.opts.log(`world: room ${room.code} starts, ${room.members.size} trainers, seed ${seed}`);
    const state = r.state();
    for (const p of room.members.values()) this.send(p.link, { t: 'hello', id: p.id, state });
    this.roster(room);
  }

  /** The match is over: the room waits for its next START (a quick one counts again). */
  private finish(room: Lobby): void {
    const res = room.host?.room.results;
    this.opts.log(`world: room ${room.code} over${res?.winner ? `, ${res.entrants.find(([id]) => id === res.winner)?.[1]} wins` : ''}`);
    room.host = null;
    if (room.quick) room.startsAt = this.opts.now() + (this.opts.autoStartMs ?? AUTO_START_MS);
    this.roster(room);
  }

  private close(room: Lobby): void {
    this.rooms.delete(room.code);
    if (!this.rooms.size) this.stop();
  }

  private roster(room: Lobby): void {
    const members: Member[] = [...room.members.values()].map((p) => ({ id: p.id, name: p.name, skin: p.skin }));
    const now = this.opts.now();
    for (const p of room.members.values()) {
      this.send(p.link, {
        t: 'room', code: room.code, quick: room.quick, you: p.id, owner: room.owner, members, playing: !!room.host,
        ...(room.startsAt !== null ? { startsIn: Math.max(0, room.startsAt - now) } : {}),
      });
    }
  }

  private send(link: Link, m: WorldDown): void {
    link.send(JSON.stringify(m));
  }

  private run(): void {
    if (!this.timer) this.timer = setInterval(() => this.pump(), 4);
  }

  /** Every room's frames that are due, sent; a quick room whose count ran out, started. */
  pump(): void {
    const now = this.opts.now();
    for (const room of [...this.rooms.values()]) {
      try {
        // Waiting in a room a phone has nothing to say (the socket's pings keep it honest).
        if (room.host) for (const p of [...room.members.values()]) if (now - p.heard > QUIET_MS) p.link.close();
        if (!room.host && room.startsAt !== null && now >= room.startsAt) this.start(room);
        if (room.host) this.frames(room, now);
      } catch (err) {
        // Once, not every 4 ms: this room's match stops, the others go on.
        this.opts.log(`world: room ${room.code} stopped on ${err instanceof Error ? err.stack : String(err)}`);
        for (const p of room.members.values()) p.link.close();
        this.close(room);
      }
    }
  }

  private frames(room: Lobby, now: number): void {
    const host = room.host!;
    let due = Math.floor((now - room.t0) / FRAME_MS) - host.room.tick;
    if (due > 30) { room.t0 += (due - 2) * FRAME_MS; due = 2; }
    if (due <= 0) return;
    const out = new Map<number, WireFrame[]>();
    for (const id of room.members.keys()) out.set(id, []);
    for (let i = 0; i < due; i++) {
      const { frame, acks } = host.advance();
      const h = frame.tick % HASH_EVERY === 0 ? host.room.hash() : undefined;
      for (const [id, list] of out) {
        const f: WireFrame = { ...frame };
        const a = acks.get(id);
        if (a !== undefined) f.a = a;
        if (h !== undefined) f.h = h;
        list.push(f);
      }
      if (over(host.room)) break;
    }
    for (const [id, list] of out) if (list.length) room.members.get(id)?.link.send(JSON.stringify({ t: 'f', f: list } satisfies WorldDown));
    if (over(host.room)) this.finish(room);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const room of this.rooms.values()) for (const p of room.members.values()) p.link.close();
    this.rooms.clear();
    this.where.clear();
  }
}
