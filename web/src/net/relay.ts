// The page's connection to relay/server.js (POK-219/220): one WebSocket, one room.
// Ported from Kanto's `lib/relay.lua` (gen1recomp-multiplayer, mods/battle_royale) --
// same room vocabulary (host_room/join_room/to/all/roster/recv, see relay/README.md
// and server.js), rewritten for a browser WebSocket and a typed event-emitter instead
// of Lua's on()/callbacks, since the page has no 60 Hz fixed-step pump to drive an
// update() from.
//
// Seats: this room's `id` (a small integer, never reused within the room, handed out
// by host_room/join_room) doubles as the wire's `seat` -- both are "a fixed roster
// slot", just assigned by different code (docs/WIRE.md). bridge.ts uses `id` as its
// local seat and `to()`'s `seat` argument as the relay's own `id`.
//
// Reconnect: a dropped socket is retried with exponential backoff until connect()
// is called again or close() is called. Reconnecting does NOT re-host or re-join --
// the relay has already forgotten the old room by the time a new socket completes
// its handshake, and deciding what to do about that (rejoin, show a "lost the room"
// screen) is app.ts's call, not this module's. Listen for `closed` and decide there.

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
  max: number;
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
  host?: { patch?: number; protocol?: number };
}

export interface RoomListing {
  code: string;
  host: string;
  skin?: string;
  players: number;
  seats: number;
  pass: boolean;
  daily?: boolean;
  secs?: number;
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
  reason: string;
}

export interface RelayEvents {
  roster: RosterEvent;
  recv: RecvEvent;
  room_hosted: RoomHostedEvent;
  room_joined: RoomJoinedEvent;
  room_error: RoomErrorEvent;
  rooms: RoomsEvent;
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

const PING_EVERY_MS = 20_000;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 15_000;

export interface HostOpts {
  name: string;
  open?: boolean;
  max?: number;
  skin?: string;
  pass?: string;
  patch?: number;
  protocol?: number;
}

export interface JoinOpts {
  name: string;
  pass?: string;
  skin?: string;
  spectate?: boolean;
  patch?: number;
  protocol?: number;
}

function defaultFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

export class RelayClient {
  /** Our own member id in the room, once host_room/join_room answers. */
  id: number | null = null;
  code: string | null = null;
  hostId: number | null = null;

  private ws: WebSocketLike | null = null;
  private url: string | null = null;
  private closedByUser = true;
  private backoff = BACKOFF_START_MS;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
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
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => {
      /* onclose follows every onerror on a real WebSocket; nothing to do here */
    };
    ws.onclose = () => this.handleClose('closed');
  }

  private handleMessage(data: string): void {
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

    switch (type) {
      case 'room_hosted':
        this.id = msg.id as number;
        this.code = msg.code as string;
        this.hostId = msg.id as number;
        this.emit('room_hosted', { code: this.code, id: this.id });
        return;
      case 'room_joined':
        this.id = msg.id as number;
        this.code = msg.code as string;
        this.hostId = msg.host as number;
        this.emit('room_joined', { code: this.code, id: this.id, host: this.hostId });
        return;
      case 'roster':
        this.hostId = typeof msg.host === 'number' ? msg.host : this.hostId;
        this.emit('roster', {
          code: msg.code as string,
          host: msg.host as number,
          open: msg.open as boolean,
          max: msg.max as number,
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
      case 'room_closed':
        this.handleClose(typeof msg.reason === 'string' ? msg.reason : 'closed');
        return;
      case 'pong':
      case 'no_open_rooms':
      case 'match_in_progress':
        return; // not part of this bridge's scope; app.ts can add handlers later
      default:
        return; // an older/newer relay's unknown chatter is not fatal
    }
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
    this.emit('closed', { reason });
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
    this.pingTimer = setInterval(() => this.send({ type: 'ping', t: Date.now() }), PING_EVERY_MS);
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

  /** Host only. Shuts the door: the match is starting and nobody else is coming in. */
  lockRoom(locked: boolean): void {
    this.send({ type: 'lock_room', locked });
  }

  /** Asks for the open rooms. The answer arrives as a `rooms` event; the lobby asks
   *  again every few seconds, which is also what marks this connection as browsing. */
  listRooms(): void {
    this.send({ type: 'list_rooms' });
  }

  /** A game right now: the relay seats you in the fullest open room, or names a
   *  running one to watch, or tells you to host. */
  quickJoin(opts: JoinOpts): void {
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
    this.send({
      type: 'daily_join',
      name: opts.name,
      skin: opts.skin,
      patch: opts.patch,
      protocol: opts.protocol,
    });
  }

  join(code: string, opts: JoinOpts): void {
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

  /** Unicasts `msg` (a JSON-able wire.ts Msg) to one seat -- the relay's own member id. */
  to(seat: number, msg: unknown): void {
    this.send({ type: 'to', id: seat, m: msg });
  }

  /** Broadcasts `msg` to every other member of the room. */
  all(msg: unknown): void {
    this.send({ type: 'all', m: msg });
  }
}
