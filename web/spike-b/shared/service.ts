// The relay's side of the shared world: one Room for everybody who opens /spike-b/,
// stepped at 60 Hz by a Host, every frame sent to every phone. relay/world.js only joins
// it to the sockets; this file is bundled into relay/world/service.js
// (tools/br/bundle-world.mjs), so the relay and the page step the very same code.

import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import { Host } from './host';
import { makeRoom } from './room';
import { cleanBag } from './items';
import { HASH_EVERY, type WireFrame, type WorldDown, type WorldUp } from './wire';

export interface Link { send(text: string): void; close(): void }
export interface Session { onText(text: string): void; onClose(): void }

export interface ServiceOptions {
  maps: WorldMap[];
  patches: PatchTable;
  bots: number;
  /** Trainers at most; the next is told `full`. */
  cap: number;
  now: () => number;
  log: (line: string) => void;
}

const FRAME_MS = 1000 / 60;
/** An empty world is kept this long (a reload comes back to it), then dropped. */
const IDLE_MS = 60_000;
/** A phone that sends no keys this long (a tab hidden for good) is let go. */
const QUIET_MS = 120_000;
/** The whole room, at most this often a phone (it is ~20 KB against a 13 B ask). */
const SYNC_MS = 1000;
/** A link block's bytes, at most (a battle's biggest is the party exchange's ~600). */
const BT_MAX = 1024;

export class WorldService {
  private host: Host | null = null;
  private readonly links = new Map<number, Link & { quiet(): boolean }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private t0 = 0;
  private emptySince = 0;

  constructor(private readonly opts: ServiceOptions) {}

  get players(): number { return this.links.size; }
  get tick(): number { return this.host?.room.tick ?? 0; }

  open(link: Link): Session {
    let id = 0;
    let heard = this.opts.now();
    let synced = -Infinity;
    const send = (m: WorldDown) => link.send(JSON.stringify(m));
    return {
      onText: (text) => {
        let m: WorldUp;
        try { m = JSON.parse(text) as WorldUp; } catch { return; }
        if (!m || typeof m !== 'object') return;
        heard = this.opts.now();
        if (m.t === 'join' && !id) {
          if (this.links.size >= this.opts.cap) { send({ t: 'full' }); link.close(); return; }
          const host = this.start();
          const name = String(m.name ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 10) || 'TRAINER';
          const skin = Number.isInteger(m.skin) && m.skin >= 0 && m.skin < 16 ? m.skin : 0;
          id = host.join(name, skin);
          this.links.set(id, { send: link.send, close: link.close, quiet: () => this.opts.now() - heard > QUIET_MS });
          send({ t: 'hello', id, state: host.room.state() });
          this.opts.log(`world: ${name}#${id} in (${this.links.size} here, tick ${host.room.tick})`);
        } else if (!id || !this.host) {
          return;
        } else if (m.t === 'in') {
          if (!Number.isInteger(m.s) || m.s < 1 || !Array.isArray(m.k) || m.k.length > 120) return;
          this.host.input(id, m.s, m.k.map((v) => (Number(v) | 0) & 63));
        } else if (m.t === 'end') {
          this.host.end(id);
        } else if (m.t === 'out') {
          this.host.out(id, cleanBag(m.bag) ?? undefined);
        } else if (m.t === 'drop') {
          if (Number.isInteger(m.k)) this.host.drop(id, m.k, cleanBag(m.rest) ?? undefined);
        } else if (m.t === 'bt') {
          // Only to the one trainer this one is fighting, and only while they fight each
          // other: a block that reached any other battle would desync it (POK-330 #20).
          if (!Number.isInteger(m.q) || !Array.isArray(m.d) || m.d.length > BT_MAX) return;
          const me = this.host.room.actor(id);
          const foe = me?.battling && me.foe ? this.host.room.actor(me.foe) : undefined;
          if (!foe || foe.bot || !foe.battling || foe.foe !== id) return;
          this.links.get(foe.id)?.send(JSON.stringify({ t: 'bt', q: m.q & 0xffff, d: m.d.map((v) => (Number(v) | 0) & 0xff) } satisfies WorldDown));
        } else if (m.t === 'sync') {
          const now = this.opts.now();
          if (now - synced < SYNC_MS) return;
          synced = now;
          send({ t: 'state', state: this.host.room.state() });
        }
      },
      onClose: () => {
        if (!id) return;
        this.links.delete(id);
        this.host?.leave(id);
        if (!this.links.size) this.emptySince = this.opts.now();
        this.opts.log(`world: #${id} out (${this.links.size} here)`);
        id = 0;
      },
    };
  }

  private start(): Host {
    if (this.host) return this.host;
    const seed = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
    this.host = new Host(makeRoom(this.opts.maps, this.opts.patches, seed), this.opts.bots, this.opts.maps);
    this.t0 = this.opts.now();
    this.timer = setInterval(() => this.pump(), 4);
    this.opts.log(`world: up, seed ${seed}, ${this.host.room.actors.length} bots`);
    return this.host;
  }

  /** Every frame that is due, sent; a host that fell far behind skips ahead instead. */
  pump(): void {
    try {
      this.frames();
    } catch (err) {
      // Once, not every 4 ms: the world stops, the matches on this relay go on.
      this.opts.log(`world: stopped on ${err instanceof Error ? err.stack : String(err)}`);
      this.stop();
    }
  }

  private frames(): void {
    const host = this.host;
    if (!host) return;
    const now = this.opts.now();
    for (const l of this.links.values()) if (l.quiet()) l.close();
    if (!this.links.size && now - this.emptySince > IDLE_MS) { this.stop(); return; }
    let due = Math.floor((now - this.t0) / FRAME_MS) - host.room.tick;
    if (due > 30) { this.t0 += (due - 2) * FRAME_MS; due = 2; }
    if (due <= 0) return;
    const out = new Map<number, WireFrame[]>();
    for (const id of this.links.keys()) out.set(id, []);
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
    }
    for (const [id, list] of out) this.links.get(id)?.send(JSON.stringify({ t: 'f', f: list } satisfies WorldDown));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host = null;
    for (const l of this.links.values()) l.close();
    this.links.clear();
  }
}
