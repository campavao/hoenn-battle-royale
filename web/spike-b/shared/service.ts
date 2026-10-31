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
import { RING_PHASE, makeRoom } from './room';
import { BOT_FILL, FOG_STEPS, MAX_STEPS, SAFARI_STEPS, dealable } from '../../src/match/room';
import { cleanBag } from './items';
import { over } from './over';
import type { FameMon } from '../../src/ui/results';
import { HASH_EVERY, fillFor, type Again, type CardRecord, type Listed, type Member, type PeekBag, type Settings, type SpMsg, type WireFrame, type WorldDown, type WorldUp } from './wire';

/** A career off the wire, whole numbers or nothing: what a seat's card shows. */
function recOf(r: unknown): { rec?: CardRecord } {
  if (!r || typeof r !== 'object') return {};
  const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e6 ? (v as number) : undefined);
  const { wins, played, best } = r as { [k: string]: unknown };
  const w = n(wins), p = n(played), b = n(best);
  return w === undefined || p === undefined ? {} : { rec: { wins: w, played: p, ...(b ? { best: b } : {}) } };
}

/** A passcode: four of the room codes' letters (ui/entry.ts PASS_ENTRY). */
const isPass = (s: string) => s.length === 4 && [...s.toUpperCase()].every((c) => CODE_ALPHABET.includes(c));

/** A team off the wire, sane or nothing: six at most, each a species and a level, its
 *  name, HP and four moves (ui/results.ts FameMon). */
function teamOf(t: unknown): FameMon[] | undefined {
  if (!Array.isArray(t) || t.length > 6) return undefined;
  const int = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : undefined);
  const out: FameMon[] = [];
  for (const m of t as { [k: string]: unknown }[]) {
    if (!m || typeof m !== 'object') return undefined;
    const species = int(m.species, 0xffff), level = int(m.level, 100);
    if (!species || level === undefined) return undefined;
    const moves = Array.isArray(m.moves) ? (m.moves as { id?: unknown }[]).slice(0, 4).map((v) => int(v?.id, 0xffff)).filter((id): id is number => !!id).map((id) => ({ id })) : [];
    out.push({
      species,
      level,
      ...(typeof m.nickname === 'string' ? { nickname: m.nickname.slice(0, 10) } : {}),
      ...(int(m.hp, 999) !== undefined ? { hp: m.hp as number } : {}),
      ...(int(m.maxHp, 999) !== undefined ? { maxHp: m.maxHp as number } : {}),
      ...(m.shiny === true ? { shiny: true } : {}),
      ...(int(m.personality, 0xffffffff) !== undefined ? { personality: m.personality as number } : {}),
      ...(int(m.otId, 0xffffffff) !== undefined ? { otId: m.otId as number } : {}),
      moves,
    });
  }
  return out;
}

/** A bag as told for a watcher's peek: up to 120 stacks and the money, or nothing. */
function bagOf(b: unknown): PeekBag | undefined {
  if (!b || typeof b !== 'object') return undefined;
  const { items, money } = b as { items?: unknown; money?: unknown };
  if (!Array.isArray(items) || items.length > 120 || !Number.isInteger(money) || (money as number) < 0 || (money as number) > 999999) return undefined;
  const out: PeekBag['items'] = [];
  for (const s of items as { id?: unknown; n?: unknown }[]) {
    if (!s || !Number.isInteger(s.id) || !Number.isInteger(s.n)) return undefined;
    const id = s.id as number, n = s.n as number;
    if (id < 1 || id > 0xffff || n < 1 || n > 999) return undefined;
    out.push({ id, n });
  }
  return { items: out, money: money as number };
}

export interface Link { send(text: string): void; close(): void }
export interface Session { onText(text: string): void; onClose(): void }

export interface ServiceOptions {
  maps: WorldMap[];
  patches: PatchTable;
  /** Bots a match may have at most (0: none, a test's room); FILL deals the seats nobody
   *  has up to it. */
  bots: number;
  /** Trainers at most, in all rooms; the next is told `full`. */
  cap: number;
  /** The relay's WORLD_HASH: a join that does not carry it is told `old` (unset: no gate,
   *  a test's service). */
  world?: string;
  now: () => number;
  log: (line: string) => void;
  /** Seconds a ring phase lasts, for a local test (the match's 120 otherwise). */
  ringSecs?: number;
  /** Seconds of Safari each round opens with (room.ts SAFARI): a ring phase's, unless 0. */
  safariSecs?: number;
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
/** A published battle's BSTART and TURN bytes at most (web/src/net/wire.ts's decoders). */
const BSTART_MAX = 1400;
const TURN_MAX = 256;
/** One battle's stream kept for a watcher who comes in late, at most: a long fight is a
 *  few KB, and one past this is not worth starting a replay of. */
const STREAM_MAX = 64 * 1024;
/** Trainers in one room (Cam's cap). */
const ROOM_MAX = 30;
/** match/room.ts's AUTO_START_MS. */
const AUTO_START_MS = 60_000;
/** A page gone mid-match (a reload) keeps its trainer this long (Cam, 2026-10-20). */
const AWAY_MS = 60_000;
/** Where an away phone's frames go meanwhile. */
const NOWHERE: Link = { send: () => undefined, close: () => undefined };
/** Ids for trainers, clear of the bots' 1..n. */
const FIRST_ID = 1000;

interface Phone {
  id: number;
  name: string;
  skin: number;
  link: Link;
  heard: number;
  synced: number;
  /** What a reload comes back in with (Again), and since when it has been gone (0: here). */
  key: string;
  away: number;
  /** The trainer this one watches, 0 for nobody. */
  watching: number;
  /** Their career, as their page said it (a seat's card). */
  rec?: CardRecord;
  /** Out of the room (the host's KICK, or their own LEAVE): the socket's next join
   *  starts afresh. */
  kicked?: boolean;
  /** Their team as they last told it (the hall of fame's, when they win). */
  team?: FameMon[];
  /** Their bag as last told, for a watcher's START. */
  bag?: PeekBag;
}

/** The battle a phone's ROM is publishing, as sent: for a watcher who comes in after it
 *  started (the replay must start from its BSTART). */
interface Stream { battle: number; sent: string[]; bytes: number; foe: number }

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
  /** Each fighter's published battle, by who publishes it. */
  streams: Map<number, Stream>;
  /** The host's settings for its next match. */
  set: Settings;
  /** The passcode, when the door is `pass`: the host's to read out, nobody else's. */
  pass: string;
  /** The patched ROM its battles run on (join's `r`), as its first member brought it; ''
   *  for a page that did not say. */
  rom: string;
}

/** A trainer as the live relay's log lines name one (play-log.mjs NAME: no spaces). */
function who(p: { name: string; id: number }): string {
  return `${p.name.replace(/\s+/g, '_')}#${p.id}`;
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
        if (phone?.kicked) phone = null;
        if (phone) phone.heard = this.opts.now();
        if (m.t === 'here') return;
        if (m.t === 'list') { this.send(link, { t: 'rooms', rooms: this.listed() }); return; }
        // Another world than this one would replay another room, and resync forever.
        if (m.t === 'join' && !phone && this.opts.world && m.w !== this.opts.world) { this.send(link, { t: 'old' }); return; }
        if (m.t === 'join' && !phone && m.again && typeof m.again === 'object') {
          const back = this.back(m.again, link);
          if (back) { phone = back; return; }
        }
        if (m.t === 'join' && !phone) {
          if (this.where.size >= this.opts.cap) { this.send(link, { t: 'full' }); link.close(); return; }
          const room = this.pick(m);
          if (!room) { this.send(link, { t: 'no_room', code: String(m.code ?? '') }); return; }
          if (room === 'rom') { this.send(link, { t: 'no_room', code: String(m.code ?? '').toUpperCase(), rom: true }); return; }
          if (room.set.door === 'pass' && String(m.pass ?? '').toUpperCase() !== room.pass) { this.send(link, { t: 'no_room', code: room.code, pass: true }); return; }
          const name = String(m.name ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 10);
          const skin = Number.isInteger(m.skin) && m.skin >= 0 && m.skin < 16 ? m.skin : 0;
          const id = this.nextId++;
          phone = { id, name: name || `TRAINER ${id - FIRST_ID + 1}`.slice(0, 10), skin, link, heard: this.opts.now(), synced: -Infinity, key: Math.random().toString(36).slice(2, 12), away: 0, watching: 0, ...recOf(m.rec) };
          room.members.set(id, phone);
          this.where.set(id, room);
          const hosted = !room.owner && !room.quick;
          if (!room.owner) room.owner = id;
          this.opts.log(`world: ${phone.name}#${id} in room ${room.code}${room.quick ? ' (quick)' : ''}, ${room.members.size} there`);
          // The live relay's lines too, so tools/br/play-log.mjs counts these rooms (who).
          this.opts.log(hosted ? `room ${room.code} hosted by ${who(phone)}${room.set.door === 'open' ? ' (open)' : ''}` : `room ${room.code}: ${who(phone)} ${room.quick ? 'quick-joined' : room.host ? 'spectates' : 'joined'}`);
          this.roster(room);
          // A match under way: in, to watch it until the next.
          if (room.host) {
            room.host.join(phone.name, phone.skin, undefined, id);
            this.send(link, { t: 'hello', id, state: room.host.room.state(), key: phone.key });
            this.teamsTo(room, link);
          }
          this.run();
          return;
        }
        const room = phone ? this.where.get(phone.id) : undefined;
        if (!phone || !room) return;
        const host = room.host;
        if (m.t === 'start') {
          if (!host && phone.id === room.owner) this.start(room);
        } else if (m.t === 'set') {
          if (!host && phone.id === room.owner && !room.quick && m.set && typeof m.set === 'object') {
            const s = m.set;
            if (typeof s.bots === 'boolean') room.set.bots = s.bots;
            if (FOG_STEPS.includes(s.fogSecs as number)) room.set.fogSecs = s.fogSecs as number;
            if (SAFARI_STEPS.includes(s.safariSecs as number)) room.set.safariSecs = s.safariSecs as number;
            if (MAX_STEPS.includes(s.max as number)) room.set.max = s.max as number;
            if (s.textSpeed === 1 || s.textSpeed === 3 || s.textSpeed === 5) room.set.textSpeed = s.textSpeed;
            if (typeof s.animations === 'boolean') room.set.animations = s.animations;
            const door = room.set.door;
            if (s.door === 'open' || s.door === 'private') room.set.door = s.door;
            else if (s.door === 'pass' && typeof s.pass === 'string' && isPass(s.pass)) { room.set.door = 'pass'; room.pass = s.pass.toUpperCase(); }
            if (room.set.door !== door && room.set.door !== 'pass') this.opts.log(`room ${room.code} is now ${room.set.door}`);
            this.roster(room);
          }
        } else if (m.t === 'leave') {
          this.drop(phone);
          phone.kicked = true;
        } else if (m.t === 'kick') {
          const p = room.members.get(Number(m.id));
          if (host || phone.id !== room.owner || !p || p === phone) return;
          this.drop(p);
          p.kicked = true;
          this.send(p.link, { t: 'kicked' });
        } else if (m.t === 'team') {
          const mons = teamOf(m.mons);
          if (!mons) return;
          phone.team = mons;
          phone.bag = bagOf(m.bag);
          const bag = phone.bag;
          for (const p of room.members.values()) this.send(p.link, { t: 'team', id: phone.id, mons, ...(bag ? { bag } : {}) });
        } else if (!host) {
          return;
        } else if (m.t === 'in') {
          if (!Number.isInteger(m.s) || m.s < 1 || !Array.isArray(m.k) || m.k.length > 120) return;
          host.input(phone.id, m.s, m.k.map((v) => (Number(v) | 0) & 127));
        } else if (m.t === 'field') {
          if (Number.isInteger(m.bits)) host.field(phone.id, m.bits);
        } else if (m.t === 'pick') {
          if (typeof m.map === 'string') host.pick(phone.id, m.map.slice(0, 64));
        } else if (m.t === 'sail') {
          if (typeof m.to === 'string') host.sail(phone.id, m.to);
        } else if (m.t === 'fly') {
          if (typeof m.map === 'string' && Number.isInteger(m.x) && Number.isInteger(m.y)) host.fly(phone.id, m.map.slice(0, 64), m.x, m.y);
        } else if (m.t === 'open') {
          if (Number.isInteger(m.n)) host.open(phone.id, m.n);
        } else if (m.t === 'released') {
          if (Array.isArray(m.mons)) host.released(phone.id, m.mons.filter((r) => Number.isInteger(r?.sp) && r.sp > 0 && r.sp < 412 && Number.isInteger(r.lv) && r.lv >= 1 && r.lv <= 100).map((r) => ({ species: r.sp, level: r.lv })));
        } else if (m.t === 'traded') {
          if (Number.isInteger(m.n) && Number.isInteger(m.sp)) host.traded(phone.id, m.n, m.sp);
        } else if (m.t === 'bots') {
          if ([m.a, m.b, m.w].every(Number.isInteger)) host.bots(phone.id, m.a, m.b, m.w);
        } else if (m.t === 'end') {
          room.streams.delete(phone.id);
          host.end(phone.id, m.fled === true, m.won === true);
        } else if (m.t === 'out') {
          room.streams.delete(phone.id);
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
        } else if (m.t === 'sp') {
          this.publish(room, phone, m.m, m.as);

        } else if (m.t === 'watch') {
          if (!Number.isInteger(m.id) || m.id < 0 || m.id === phone.id || m.id === phone.watching) return;
          const was = phone.watching;
          phone.watching = m.id;
          this.eyes(room, was);
          this.eyes(room, m.id);
          // In the middle of a battle: the watcher's replay starts from its BSTART.
          const s = this.streamOf(room, m.id);
          if (s) for (const text of s.sent) link.send(text);
        } else if (m.t === 'sync') {
          const now = this.opts.now();
          if (now - phone.synced < SYNC_MS) return;
          phone.synced = now;
          this.send(link, { t: 'state', state: host.room.state() });
        }
      },
      onClose: () => {
        if (!phone) return;
        const p = phone;
        phone = null;
        // Taken over by a new socket with the key (back): that one is the phone now.
        if (p.link !== link) return;
        const room = this.where.get(p.id);
        const me = room?.host?.room.actor(p.id);
        // Gone, if only for a reload: watching nobody now (the reload says whom again).
        const was = p.watching;
        p.watching = 0;
        if (room) { room.streams.delete(p.id); this.eyes(room, was); }
        // Mid-match, a reload comes back within the minute to the trainer it left, or to
        // watching (out, or in for the next match): it went back to the menu, a match it
        // was still in (Cam 10-29, "the game reset"). A reload mid-battle is a forfeit (Cam).
        const benched = !me && room?.host?.room.bench.some((x) => x.id === p.id);
        if (room?.host && ((me && !me.battling) || benched)) {
          p.away = this.opts.now();
          p.link = NOWHERE;
          room.host.away(p.id, true);
          this.opts.log(`world: #${p.id} away from room ${room.code}`);
          return;
        }
        this.drop(p);
      },
    };
  }

  /** A phone gone for good: out of its room, and its trainer out of the match. */
  private drop(p: Phone): void {
    const room = this.where.get(p.id);
    this.where.delete(p.id);
    if (!room) return;
    room.members.delete(p.id);
    room.host?.leave(p.id);
    room.streams.delete(p.id);
    this.eyes(room, p.watching);
    // START passes to whoever came in next.
    if (room.owner === p.id) room.owner = [...room.members.values()].find((q) => !q.away)?.id ?? 0;
    this.opts.log(`world: #${p.id} out of room ${room.code} (${room.members.size} there)`);
    // A phone still away is coming back (a reload): the room waits for it, until pump
    // drops it at AWAY_MS.
    if (!room.members.size) this.close(room);
    else this.roster(room);
  }

  /** A reload's (or a dropped socket's) way back to the trainer it left, or null. The
   *  old socket may not have been seen to close yet (a dead one is found by the ping
   *  sweep): with the key, the new one takes the phone over all the same, in a match or
   *  in the room before one. */
  private back(again: Again, link: Link): Phone | null {
    const room = typeof again.code === 'string' ? this.rooms.get(again.code.toUpperCase()) : undefined;
    const p = room?.members.get(Number(again.id));
    if (!room || !p || p.key !== again.key || typeof again.key !== 'string') return null;
    if (!room.host && p.away) return null;
    const old = p.link;
    p.link = link;
    if (old !== NOWHERE && old !== link) old.close();
    if (!room.host) {
      p.heard = this.opts.now();
      this.opts.log(`world: #${p.id} back in room ${room.code}`);
      this.roster(room);
      return p;
    }
    p.away = 0;
    p.heard = this.opts.now();
    p.synced = -Infinity;
    room.host.away(p.id, false);
    this.opts.log(`world: #${p.id} back in room ${room.code}`);
    this.send(link, { t: 'hello', id: p.id, state: room.host.room.state(), key: p.key });
    this.teamsTo(room, link);
    this.roster(room);
    return p;
  }

  /** The room a join asks for: its code, a new one of its own (HOST), or quick play's. */
  /** LOBBIES: the live relay's list_rooms door. A hosted room a stranger could walk into
   *  now: not quick play's, not unlisted, not mid-match, not waiting on its host's reload;
   *  its count the trainers here of the host's MAX, fullest first. */
  private listed(): Listed[] {
    const out: Listed[] = [];
    for (const r of this.rooms.values()) {
      const owner = r.members.get(r.owner);
      if (r.quick || r.host || !owner || owner.away || r.set.door === 'private') continue;
      const players = [...r.members.values()].filter((p) => !p.away).length;
      out.push({ code: r.code, host: owner.name, skin: owner.skin, players, seats: r.set.max, playing: false, pass: r.set.door === 'pass' });
    }
    return out.sort((a, b) => b.players - a.players || (a.code < b.code ? -1 : 1));
  }

  /** The room a join goes to, or 'rom' for a room whose battles run on another patch. */
  private pick(m: Extract<WorldUp, { t: 'join' }>): Lobby | 'rom' | null {
    const rom = typeof m.r === 'string' ? m.r.slice(0, 16) : '';
    if (typeof m.code === 'string' && m.code) {
      const r = this.rooms.get(m.code.toUpperCase());
      if (r && r.rom && rom && r.rom !== rom) return 'rom';
      return r && r.members.size < (r.quick ? ROOM_MAX : r.set.max) ? r : null;
    }
    if (m.host === true) return this.make(false, rom);
    // The fullest quick room on this patch still waiting for its start; or a new one.
    let best: Lobby | null = null;
    for (const r of this.rooms.values()) {
      if (r.quick && !r.host && r.rom === rom && r.members.size < ROOM_MAX && (!best || r.members.size > best.members.size)) best = r;
    }
    return best ?? this.make(true, rom);
  }

  private make(quick: boolean, rom: string): Lobby {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    } while (this.rooms.has(code));
    const fogSecs = this.opts.ringSecs ?? RING_PHASE / 60;
    // The live room's: MAX 8 with FILL on (BOT_FILL), a quick room's the same.
    const set: Settings = { bots: this.opts.bots > 0, fogSecs, safariSecs: this.opts.safariSecs ?? fogSecs, max: BOT_FILL, door: 'open', textSpeed: 5, animations: false };
    const room: Lobby = { rom, pass: '', code, quick, owner: 0, members: new Map(), startsAt: quick ? this.opts.now() + (this.opts.autoStartMs ?? AUTO_START_MS) : null, host: null, t0: 0, streams: new Map(), set };
    this.rooms.set(code, room);
    return room;
  }

  /** START: the Room, everybody in it and FILL's bots for the seats nobody has, and the
   *  match locked to them. Not a match nobody could win (dealable: two at the least); a
   *  quick room's count that runs out on one counts again. */
  private start(room: Lobby): void {
    const bots = Math.min(this.opts.bots, fillFor(room.set, room.members.size));
    if (!dealable(room.members.size, bots)) {
      if (room.quick) { room.startsAt = this.opts.now() + (this.opts.autoStartMs ?? AUTO_START_MS); this.roster(room); }
      return;
    }
    const seed = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
    const r = makeRoom(this.opts.maps, this.opts.patches, seed);
    r.ringPhase = Math.round(room.set.fogSecs * 60);
    r.opening = Math.round(room.set.safariSecs * 60);
    const host = new Host(r, bots, this.opts.maps);
    for (const p of room.members.values()) { host.join(p.name, p.skin, undefined, p.id); p.heard = room.t0 = this.opts.now(); }
    host.lock();
    room.host = host;
    room.startsAt = null;
    room.t0 = this.opts.now();
    this.opts.log(`world: room ${room.code} starts, ${room.members.size} trainers and ${bots} bots, seed ${seed}`);
    this.opts.log(`match ${room.code} started (${room.quick ? 'quick' : 'host'}) | ${room.members.size} trainer${room.members.size === 1 ? '' : 's'} | max ${room.quick ? ROOM_MAX : room.set.max}`);
    const state = r.state();
    for (const p of room.members.values()) {
      p.team = undefined;
      this.send(p.link, { t: 'hello', id: p.id, state, key: p.key });
    }
    this.roster(room);
  }

  /** The match is over: the room waits for its next START (a quick one counts again). */
  private finish(room: Lobby): void {
    const res = room.host?.room.results;
    this.opts.log(`world: room ${room.code} over${res?.winner ? `, ${res.entrants.find(([id]) => id === res.winner)?.[1]} wins` : ''}`);
    if (room.host) this.opts.log(`match ${room.code} ended after ${Math.round((this.opts.now() - room.t0) / 1000)}s`);
    room.host = null;
    room.streams.clear();
    for (const p of room.members.values()) p.watching = 0;
    if (room.quick) room.startsAt = this.opts.now() + (this.opts.autoStartMs ?? AUTO_START_MS);
    this.roster(room);
  }

  private close(room: Lobby): void {
    // Whoever is still in it (pump's catch closes a room with its phones in) is nowhere now.
    for (const id of room.members.keys()) if (this.where.get(id) === room) this.where.delete(id);
    this.rooms.delete(room.code);
    if (!this.rooms.size) this.stop();
  }

  /** One of a fighter's published battle's messages: kept, and on to everybody watching
   *  either side of it. Only from a trainer in a battle, or from the judge of a bots'
   *  fight (`as`, the bot it is published as: its judge watching gets it too); a TURN only
   *  after its BSTART. */
  private publish(room: Lobby, phone: Phone, raw: SpMsg, as?: number): void {
    if (!raw || (raw.t !== 'bstart' && raw.t !== 'turn') || !Number.isInteger(raw.battle) || !Array.isArray(raw.data)) return;
    if (raw.data.length > (raw.t === 'bstart' ? BSTART_MAX : TURN_MAX)) return;
    const bot = as === undefined ? undefined : room.host?.room.actor(as);
    if (as !== undefined && (!bot?.bot || bot.judge !== phone.id)) return;
    const me = bot ?? room.host?.room.actor(phone.id);
    if (!me?.battling) return;
    const m: SpMsg = { t: raw.t, battle: raw.battle & 0xffff, data: raw.data.map((v) => (Number(v) | 0) & 0xff) };
    let s = room.streams.get(me.id);
    if (m.t === 'bstart') room.streams.set(me.id, (s = { battle: m.battle, sent: [], bytes: 0, foe: me.foe }));
    if (!s || s.battle !== m.battle) return;
    const text = JSON.stringify({ t: 'sp', from: me.id, m } satisfies WorldDown);
    if (s.bytes + text.length <= STREAM_MAX) { s.sent.push(text); s.bytes += text.length; }
    for (const w of room.members.values()) {
      if ((w !== phone || bot) && w.watching && (w.watching === me.id || w.watching === me.foe)) w.link.send(text);
    }
  }

  /** The battle trainer `id` is in now, as published: by their ROM, or by the ROM of the
   *  trainer they fight (a link battle is published by one side only). */
  private streamOf(room: Lobby, id: number): Stream | undefined {
    const r = room.host?.room;
    const a = r?.actor(id);
    if (!r || !a?.battling) return undefined;
    // A stream is the fight it began with: a bot's is never dropped (no end of its own
    // comes), so one against somebody else is an old fight, not this one.
    const own = room.streams.get(id);
    if (own && own.foe === a.foe) return own;
    const foe = a.foe ? r.actor(a.foe) : undefined;
    const theirs = foe?.battling && foe.foe === id ? room.streams.get(foe.id) : undefined;
    return theirs && theirs.foe === id ? theirs : undefined;
  }

  /** Every team the room's trainers have told, to one phone just in (the legendary's
   *  chip and the champion's hall of fame read them). */
  private teamsTo(room: Lobby, link: Link): void {
    for (const o of room.members.values()) if (o.team) this.send(link, { t: 'team', id: o.id, mons: o.team, ...(o.bag ? { bag: o.bag } : {}) });
  }

  /** How many watch trainer `id`, to them. */
  private eyes(room: Lobby, id: number): void {
    const to = id ? room.members.get(id) : undefined;
    if (!to) return;
    let n = 0;
    for (const p of room.members.values()) if (p.watching === id) n++;
    this.send(to.link, { t: 'eyes', n });
  }

  private roster(room: Lobby): void {
    const members: Member[] = [...room.members.values()].filter((p) => !p.away).map((p) => ({ id: p.id, name: p.name, skin: p.skin, ...(p.rec ? { rec: p.rec } : {}) }));
    const now = this.opts.now();
    for (const p of room.members.values()) {
      this.send(p.link, {
        t: 'room', code: room.code, quick: room.quick, you: p.id, key: p.key, owner: room.owner, members, playing: !!room.host,
        ...(room.startsAt !== null ? { startsIn: Math.max(0, room.startsAt - now) } : {}),
        set: room.set,
        ...(p.id === room.owner && room.set.door === 'pass' ? { pass: room.pass } : {}),
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
        if (room.host) for (const p of [...room.members.values()]) if (!p.away && now - p.heard > QUIET_MS) p.link.close();
        // Gone longer than a reload takes: out, as if they had left.
        for (const p of [...room.members.values()]) if (p.away && (now - p.away > AWAY_MS || !room.host)) this.drop(p);
        if (!this.rooms.has(room.code)) continue;
        if (!room.host && room.startsAt !== null && now >= room.startsAt) this.start(room);
        // Everybody away (one phone against the bots, reloading): the match waits for them,
        // bots and all (Cam, 2026-10-20).
        if (room.host && [...room.members.values()].some((p) => !p.away)) this.frames(room, now);
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
