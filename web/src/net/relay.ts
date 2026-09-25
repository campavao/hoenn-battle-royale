// The page's connection to relay/server.js (POK-219/220): one WebSocket, one room.
// Ported from Kanto's `lib/relay.lua` (gen1recomp-multiplayer, mods/battle_royale) --
// same room vocabulary (host_room/join_room/to/all/roster/recv, see relay/README.md
// and server.js), rewritten for a browser WebSocket and a typed event-emitter instead
// of Lua's on()/callbacks, since the page has no 60 Hz fixed-step pump to drive an
// update() from.
//
// Seats: this room's `id` (1..MAX_SEAT, the lowest one free, handed out by
// host_room/join_room) doubles as the wire's `seat` -- both are "a fixed roster
// slot", just assigned by different code (docs/WIRE.md). bridge.ts uses `id` as its
// local seat and `to()`'s `seat` argument as the relay's own `id`.
//
// Reconnect: a dropped socket is retried with exponential backoff until connect()
// is called again or close() is called. Reconnecting does not re-join by itself: the
// relay holds the seat for a minute (POK-284) and rejoin() asks for it back, but
// whether to -- and what to do when the room has gone -- is app.ts's call, on `open`.
// A room that ENDED (room_closed) is not reconnected to at all: `closed` says so with
// `reconnecting: false`, and the socket is closed (POK-330 #47).

import { MAX_SEAT } from './wire';

export type RoomError =
  | 'not_found'
  | 'full'
  | 'locked'
  | 'passcode'
  | 'removed'
  | 'already_in_room'
  | 'server_full'
  | 'version';

export interface RosterMember {
  id: number;
  name: string;
  spectate?: boolean;
}

export interface RosterEvent {
  code: string;
  host: number;
  open: boolean;
  /** The humans the room seats: the host's MAX clamped to the relay's ceiling (16). */
  max: number;
  /** The host's MAX as asked, up to 30, bots filling what humans do not. Absent from
   *  an older relay, which only ever said `max` (POK-330 #29). */
  seats?: number;
  pass: boolean;
  members: RosterMember[];
}

export interface RecvEvent {
  from: number;
  m: unknown;
}

export interface RoomHostedEvent {
  code: string;
  id: number;
}

export interface RoomJoinedEvent {
  code: string;
  id: number;
  host: number;
}

export interface RoomErrorEvent {
  reason: RoomError | string;
  /** What the room's host runs, on a `version` refusal: see HostOpts.patch. */
  host?: { patch?: string; protocol?: number };
}

export interface RoomListing {
  code: string;
  host: string;
  skin?: string;
  players: number;
  seats: number;
  pass: boolean;
  /** Whether the door would refuse a join, from the relay that runs the door: it
   *  counts watchers and ids, which `players`/`seats` cannot (POK-330 #29). */
  full?: boolean;
  daily?: boolean;
  secs?: number;
}

/** The relay had nothing to seat you in: QUICK PLAY hosts instead. */
export interface NoRoomsEvent {
  reason: 'none';
}

/** Everything open is mid-match. Kanto's WATCH PLAY NEXT: join it as a spectator and
 *  be seated in the next one. */
export interface MatchRunningEvent {
  code: string;
  members: number;
}

export interface RoomsEvent {
  rooms: RoomListing[];
}

export interface InfoEvent {
  motd?: string[];
  rooms?: number;
  conns?: number;
  minProtocol?: number;
  daily?: { secs: number; label?: string };
}

export interface ClosedEvent {
  /** `closed`, `stale` (a half-open socket), `restart` (the relay is being redeployed,
   *  close code 1012), or a room_closed reason: `removed`, `host_left`, `host_gone`... */
  reason: string;
  /** Whether a new socket is on its way. False once the room itself is over, or after
   *  close(): there is nothing to go back to. */
  reconnecting: boolean;
}

/** The socket came up. `reconnected` is FALSE for the first one after connect() and
 *  TRUE for every one the backoff won back -- which is the only difference that
 *  matters to a caller, since the relay has forgotten the room by then. */
export interface OpenEvent {
  reconnected: boolean;
}

export interface RelayEvents {
  open: OpenEvent;
  roster: RosterEvent;
  recv: RecvEvent;
  room_hosted: RoomHostedEvent;
  room_joined: RoomJoinedEvent;
  room_error: RoomErrorEvent;
  rooms: RoomsEvent;
  no_open_rooms: NoRoomsEvent;
  match_in_progress: MatchRunningEvent;
  info: InfoEvent;
  closed: ClosedEvent;
}

type EventName = keyof RelayEvents;
type Handler<K extends EventName> = (payload: RelayEvents[K]) => void;

/** What RelayClient needs from a WebSocket -- the real browser one satisfies this
 *  as-is; tests hand in a fake with no network. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

// WebSocket.CONNECTING/OPEN, spelled out so this file doesn't need the DOM lib's
// WebSocket type just for two constants.
const WS_CONNECTING = 0;
const WS_OPEN = 1;

// A half-open socket -- a phone that changed networks -- stays OPEN while everything
// sent on it vanishes, and nothing said so until the relay's 60 s seat hold had run
// out (POK-330 #36). So the pings are listened for: two in a row with nothing back,
// and the socket is called dead and reconnected, 20-30 s in, inside the hold.
const PING_EVERY_MS = 10_000;
const MISSED_PINGS = 2;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 15_000;
/** How long the relay holds a dropped seat, when it does not say (relay/server.js's
 *  limits.rejoinMs). */
export const REJOIN_MS = 60_000;

export interface HostOpts {
  name: string;
  open?: boolean;
  max?: number;
  skin?: string;
  pass?: string;
  /** The sha1 of the ROM running in this tab, which the relay's gate compares with
   *  the room's (POK-330 #3): both sides of a link battle must run the same build.
   *  relay/protocol.fixtures.json is the shape, and both test suites read it. */
  patch?: string;
  protocol?: number;
}

export interface JoinOpts {
  name: string;
  pass?: string;
  skin?: string;
  spectate?: boolean;
  /** As HostOpts.patch. */
  patch?: string;
  protocol?: number;
}

function isSeat(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id <= MAX_SEAT;
}

function defaultFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

export class RelayClient {
  /** Our own member id in the room, once host_room/join_room answers. */
  id: number | null = null;
  code: string | null = null;
  hostId: number | null = null;
  /** The relay's resume token for our seat (POK-284): presented on a rejoin so a
   *  dropped socket gets the id it had, which is the page's seat. Spent by the rejoin;
   *  the relay hands out a new one with every room_hosted/room_joined. */
  token: string | null = null;
  /** How long the relay holds a dropped seat for its rejoin, as it says in room_hosted/
   *  room_joined. A host gives a vanished player exactly this long (POK-330 #25): any
   *  shorter and a seat could come back into a match that had already eliminated it. */
  rejoinMs = REJOIN_MS;
  /** What we last joined or hosted as, and where, so a rejoin can ask the same way.
   *  `code` above is cleared with the socket; this survives it, which is the point. */
  private lastOpts: JoinOpts | null = null;
  private lastCode: string | null = null;

  private ws: WebSocketLike | null = null;
  private url: string | null = null;
  private closedByUser = true;
  /** Whether a socket has ever come up on this client, so the next one can say
   *  whether it is a first connection or a recovery. */
  private everOpened = false;
  private backoff = BACKOFF_START_MS;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** When anything last arrived on the socket, when our last ping went out, and how
   *  many pings in a row have gone out with nothing arriving after them. */
  private lastRx = 0;
  private lastPingAt = 0;
  private unanswered = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Keyed by event name, but kept as `unknown` internally: a mapped type indexed by
  // a generic K does not let TS see that on()'s own K ties the map's value back to
  // the same event -- the public on()/emit() signatures below are what keep this
  // typed for callers.
  private listeners = new Map<EventName, Set<(payload: unknown) => void>>();
  /** Frames sent while the socket was still CONNECTING (host()/join() typically
   *  fire right after connect(), before a real WebSocket's handshake completes) --
   *  flushed in order on open, dropped on close. */
  private pending: string[] = [];

  constructor(private readonly factory: WebSocketFactory = defaultFactory) {}

  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => set!.delete(handler as (payload: unknown) => void);
  }

  private emit<K extends EventName>(event: K, payload: RelayEvents[K]): void {
    for (const h of this.listeners.get(event) ?? []) h(payload);
  }

  /** Opens (or reopens) the socket to `url`. Cancels any pending reconnect. */
  connect(url: string): void {
    this.url = url;
    this.closedByUser = false;
    this.backoff = BACKOFF_START_MS;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.open();
  }

  /** Closes the socket on purpose: no reconnect follows. */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.pending = [];
    this.token = null; // closed on purpose: there is no seat to go back to
    this.lastCode = null;
    this.ws?.close();
    this.ws = null;
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN;
  }

  private open(): void {
    if (!this.url) return;
    const ws = this.factory(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = BACKOFF_START_MS;
      // host()/join() are typically called right after connect(), before a real
      // WebSocket has finished its handshake -- anything queued by send() while we
      // were CONNECTING goes out now, in order, before the ping cadence starts.
      const queued = this.pending;
      this.pending = [];
      for (const json of queued) ws.send(json);
      this.startPing();
      const again = this.everOpened;
      this.everOpened = true;
      this.emit('open', { reconnected: again });
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => {
      /* onclose follows every onerror on a real WebSocket; nothing to do here */
    };
    // 1012 is the relay restarting for a deploy (its SIGTERM, POK-330 #47): worth
    // telling apart from this page's own network going
    ws.onclose = (ev) => this.handleClose((ev as { code?: number } | null)?.code === 1012 ? 'restart' : 'closed');
  }

  private handleMessage(data: string): void {
    this.lastRx = Date.now(); // any frame at all says the socket is alive
    let msg: Record<string, unknown>;
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed !== 'object' || parsed === null) return;
      msg = parsed as Record<string, unknown>;
    } catch {
      return; // a malformed frame is dropped, not fatal to the connection
    }
    const type = msg.type;
    if (typeof type !== 'string') return;

    // An id is this page's seat, the ROM's gBrMySeat and every message's `seat`, and
    // all three have 32 (POK-330 #6). A relay that hands out one past that -- the old
    // one counted up forever -- would have us write gBrMySeat out of the ROM's tables
    // and send a `start` no guest can decode. Refused as the room being full, which is
    // what it is, and given back so the relay does not hold it for us.
    if ((type === 'room_hosted' || type === 'room_joined') && !isSeat(msg.id)) {
      this.send({ type: 'leave_room' });
      this.emit('room_error', { reason: 'full' });
      return;
    }

    switch (type) {
      case 'room_hosted':
        this.id = msg.id as number;
        this.code = msg.code as string;
        this.hostId = msg.id as number;
        this.token = typeof msg.token === 'string' ? msg.token : null;
        this.lastCode = this.code;
        this.noteRejoinMs(msg.rejoinMs);
        this.emit('room_hosted', { code: this.code, id: this.id });
        return;
      case 'room_joined':
        this.id = msg.id as number;
        this.code = msg.code as string;
        this.hostId = msg.host as number;
        this.token = typeof msg.token === 'string' ? msg.token : null;
        this.lastCode = this.code;
        this.noteRejoinMs(msg.rejoinMs);
        this.emit('room_joined', { code: this.code, id: this.id, host: this.hostId });
        return;
      case 'roster':
        this.hostId = typeof msg.host === 'number' ? msg.host : this.hostId;
        this.emit('roster', {
          code: msg.code as string,
          host: msg.host as number,
          open: msg.open as boolean,
          max: msg.max as number,
          seats: typeof msg.seats === 'number' ? msg.seats : undefined,
          pass: msg.pass as boolean,
          members: (msg.members as RosterMember[]) ?? [],
        });
        return;
      case 'recv':
        if (typeof msg.from === 'number' && typeof msg.m === 'object' && msg.m !== null) {
          this.emit('recv', { from: msg.from, m: msg.m });
        }
        return;
      case 'room_error':
        this.emit('room_error', { reason: msg.reason as RoomError | string, host: msg.host as RoomErrorEvent['host'] });
        return;
      case 'rooms':
        this.emit('rooms', { rooms: (msg.rooms as RoomListing[]) ?? [] });
        return;
      case 'info':
        this.emit('info', {
          motd: msg.motd as string[] | undefined,
          rooms: msg.rooms as number | undefined,
          conns: msg.conns as number | undefined,
          minProtocol: msg.minProtocol as number | undefined,
          daily: msg.daily as InfoEvent['daily'],
        });
        return;
      case 'room_closed': {
        // The room is over, which is not the socket dropping (POK-330 #47). It used to
        // be handled as one: the socket was let go without being closed, a new one was
        // opened, and the rejoin was refused -- an orphan left open until the relay's
        // idle sweep, and a round trip to learn what this message had already said.
        this.token = null;
        this.lastCode = null;
        this.closedByUser = true;
        const ws = this.ws;
        this.handleClose(typeof msg.reason === 'string' ? msg.reason : 'closed');
        ws?.close(); // let go of first, so its onclose cannot say it a second time
        return;
      }
      case 'no_open_rooms':
        this.emit('no_open_rooms', { reason: 'none' });
        return;
      case 'match_in_progress':
        this.emit('match_in_progress', {
          code: typeof msg.code === 'string' ? msg.code : '',
          members: typeof msg.members === 'number' ? msg.members : 0,
        });
        return;
      case 'pong':
        return;
      default:
        return; // an older/newer relay's unknown chatter is not fatal
    }
  }

  /** An older relay does not say, and keeps the default. */
  private noteRejoinMs(ms: unknown): void {
    this.rejoinMs = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : REJOIN_MS;
  }

  private handleClose(reason: string): void {
    this.stopPing();
    this.pending = []; // stale room actions from the old connection are not replayed
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
    }
    this.ws = null;
    this.id = null;
    this.code = null;
    this.hostId = null;
    this.emit('closed', { reason, reconnecting: !this.closedByUser });
    if (!this.closedByUser) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
  }

  private startPing(): void {
    this.stopPing();
    this.lastRx = Date.now();
    this.lastPingAt = 0;
    this.unanswered = 0;
    this.pingTimer = setInterval(() => this.pingTick(), PING_EVERY_MS);
  }

  private pingTick(): void {
    // Counted per ping, not by the clock: a background tab whose timers run once a
    // minute gets its pong a moment after each ping, and is not called dead for the
    // minute its own timer slept through.
    if (this.lastPingAt !== 0 && this.lastRx < this.lastPingAt) this.unanswered += 1;
    else this.unanswered = 0;
    if (this.unanswered >= MISSED_PINGS) {
      const ws = this.ws;
      // handleClose lets go of the socket first, so its own onclose -- which a
      // half-open socket may not fire for minutes -- cannot close us a second time
      this.handleClose('stale');
      ws?.close();
      return;
    }
    this.lastPingAt = Date.now();
    this.send({ type: 'ping', t: this.lastPingAt });
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Sends a raw room-protocol object (see relay/README.md's client -> server table).
   *  Queued (not dropped) while the socket is still CONNECTING -- see `pending`. */
  send(obj: Record<string, unknown>): void {
    if (!this.ws) return;
    const json = JSON.stringify(obj);
    if (this.ws.readyState === WS_OPEN) this.ws.send(json);
    else if (this.ws.readyState === WS_CONNECTING) this.pending.push(json);
    // CLOSING/CLOSED: dropped, same as before.
  }

  host(opts: HostOpts): void {
    this.lastOpts = { name: opts.name, pass: opts.pass, skin: opts.skin, patch: opts.patch, protocol: opts.protocol };
    this.send({
      type: 'host_room',
      name: opts.name,
      open: opts.open === true,
      max: opts.max,
      skin: opts.skin,
      pass: opts.pass,
      patch: opts.patch,
      protocol: opts.protocol,
    });
  }

  /** Host only. The room's seat count -- humans are held to the relay's own ceiling
   *  and the rest are bot seats (POK-241). */
  setMax(max: number): void {
    this.send({ type: 'set_max', max });
  }

  /** Host only. Whether the room appears in LOBBIES at all. */
  setOpen(open: boolean): void {
    this.send({ type: 'set_open', open });
  }

  /** Host only. A passcode on the door, or null to take it off. The roster carries
   *  only THAT one is set, so a guest can draw the padlock without holding the code. */
  setPass(pass: string | null): void {
    this.send({ type: 'set_pass', pass });
  }

  /** Host only. Shuts the door: the match is starting and nobody else is coming in.
   *  `bots` are the seats the match dealt its bots: the relay hands a latecomer the
   *  lowest id nobody is using, and a bot's seat looks unused to it (POK-330 #6). */
  lockRoom(locked: boolean, bots?: number[]): void {
    this.send(bots ? { type: 'lock_room', locked, bots } : { type: 'lock_room', locked });
  }

  /** Whether this client is willing to run the match if the host's tab goes away
   *  (POK-252). The relay promotes the longest-standing willing member; a client that
   *  has been eliminated withdraws by sending false. Nobody had ever sent this, so
   *  `heirOf` never found one and every host leaving closed the room. */
  canHost(ok: boolean): void {
    this.send({ type: 'can_host', ok });
  }

  /** Asks for the open rooms. The answer arrives as a `rooms` event; the lobby asks
   *  again every few seconds, which is also what marks this connection as browsing.
   *  `version` is this tab's, as every door is asked with (HostOpts.patch): the DAILY
   *  row describes the daily a press would land us in, which is our own build's
   *  (POK-331 #14). */
  listRooms(version?: { patch?: string; protocol?: number }): void {
    this.send({ type: 'list_rooms', patch: version?.patch, protocol: version?.protocol });
  }

  /** A game right now: the relay seats you in the fullest open room, or names a
   *  running one to watch, or tells you to host. */
  quickJoin(opts: JoinOpts): void {
    this.lastOpts = opts; // so a rejoin asks as we did: a seat found this way is held too
    this.send({
      type: 'quick_join',
      name: opts.name,
      skin: opts.skin,
      patch: opts.patch,
      protocol: opts.protocol,
    });
  }

  /** The daily game's one door: everybody who presses the row lands in the same room. */
  dailyJoin(opts: JoinOpts): void {
    this.lastOpts = opts; // ...and the daily's host above all, which is no other room
    this.send({
      type: 'daily_join',
      name: opts.name,
      skin: opts.skin,
      patch: opts.patch,
      protocol: opts.protocol,
    });
  }

  join(code: string, opts: JoinOpts): void {
    this.lastOpts = opts;
    this.send({
      type: 'join_room',
      code,
      name: opts.name,
      pass: opts.pass,
      skin: opts.skin,
      spectate: opts.spectate === true ? true : undefined,
      patch: opts.patch,
      protocol: opts.protocol,
    });
  }

  /** Back into the room we were in, as the seat we had (POK-284). The relay answers
   *  room_joined with the same id while it is still holding the seat, whatever the
   *  door says -- or room_error once it is not. False when there is nothing to go back
   *  to: no room, or a relay that never gave us a token. */
  rejoin(): boolean {
    if (this.lastCode === null || this.token === null || this.lastOpts === null) return false;
    this.send({
      type: 'join_room',
      code: this.lastCode,
      name: this.lastOpts.name,
      pass: this.lastOpts.pass,
      skin: this.lastOpts.skin,
      spectate: this.lastOpts.spectate === true ? true : undefined,
      patch: this.lastOpts.patch,
      protocol: this.lastOpts.protocol,
      token: this.token,
    });
    return true;
  }

  /** Shows one member the door (POK-241). Host only -- the relay checks -- and the
   *  seat is refused if it comes back. */
  kick(id: number): void {
    this.send({ type: 'kick', id });
  }

  /** Unicasts `msg` (a JSON-able wire.ts Msg) to one seat -- the relay's own member id. */
  to(seat: number, msg: unknown): void {
    this.send({ type: 'to', id: seat, m: msg });
  }

  /** Broadcasts `msg` to every other member of the room. */
  all(msg: unknown): void {
    this.send({ type: 'all', m: msg });
  }
}
