import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import serverSource from '../../../relay/server.js?raw';
import { RelayClient, type WebSocketLike } from './relay';
import { MAX_SEAT } from './wire';

/** A fake WebSocket: no network, driven by hand. `sent` records every frame the
 *  client sent, parsed back to objects so assertions read like the wire protocol. */
class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.onclose?.({});
  }

  // ---- test helpers ----
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }
  receive(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function makeFactory() {
  const sockets: FakeSocket[] = [];
  const factory = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s;
  };
  return { factory, sockets };
}

describe('RelayClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects, hosts a room, and tracks id/code/host from room_hosted', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();

    relay.host({ name: 'ASH', open: true, max: 8 });
    expect(sockets[0].sent[0]).toEqual({
      type: 'host_room', name: 'ASH', open: true, max: 8,
      skin: undefined, pass: undefined, patch: undefined, protocol: undefined,
    });

    const hosted = vi.fn();
    relay.on('room_hosted', hosted);
    sockets[0].receive({ type: 'room_hosted', code: 'ABC123', id: 2 });

    expect(hosted).toHaveBeenCalledWith({ code: 'ABC123', id: 2 });
    expect(relay.id).toBe(2);
    expect(relay.code).toBe('ABC123');
    expect(relay.hostId).toBe(2);
  });

  it('joins a room, forwarding pass and name', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();

    relay.join('ABC123', { name: 'MISTY', pass: 'secret' });
    expect(sockets[0].sent[0]).toMatchObject({ type: 'join_room', code: 'ABC123', name: 'MISTY', pass: 'secret' });

    const joined = vi.fn();
    relay.on('room_joined', joined);
    sockets[0].receive({ type: 'room_joined', code: 'ABC123', id: 5, host: 2 });
    expect(joined).toHaveBeenCalledWith({ code: 'ABC123', id: 5, host: 2 });
    expect(relay.hostId).toBe(2);
  });

  it('dispatches roster, recv, room_error, rooms and info to their own listeners', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();

    const roster = vi.fn();
    const recv = vi.fn();
    const error = vi.fn();
    const rooms = vi.fn();
    const info = vi.fn();
    relay.on('roster', roster);
    relay.on('recv', recv);
    relay.on('room_error', error);
    relay.on('rooms', rooms);
    relay.on('info', info);

    const rosterMsg = { type: 'roster', code: 'ABC123', host: 2, open: true, max: 8, pass: false, members: [{ id: 2, name: 'ASH' }] };
    sockets[0].receive(rosterMsg);
    expect(roster).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABC123', host: 2 }));

    sockets[0].receive({ type: 'recv', from: 5, m: { t: 'step', seat: 5, d: 1, x: 1, y: 1, map: { group: 0, num: 1 } } });
    expect(recv).toHaveBeenCalledWith({ from: 5, m: { t: 'step', seat: 5, d: 1, x: 1, y: 1, map: { group: 0, num: 1 } } });

    sockets[0].receive({ type: 'room_error', reason: 'full' });
    expect(error).toHaveBeenCalledWith({ reason: 'full' });

    sockets[0].receive({ type: 'rooms', rooms: [{ code: 'X', host: 'H', players: 1, seats: 8, pass: false }] });
    expect(rooms).toHaveBeenCalled();

    sockets[0].receive({ type: 'info', motd: ['hi'], rooms: 1, conns: 2, minProtocol: 1 });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ conns: 2 }));
  });

  it('ignores a recv whose m is not an object', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    const recv = vi.fn();
    relay.on('recv', recv);
    sockets[0].receive({ type: 'recv', from: 5, m: 'not-an-object' });
    expect(recv).not.toHaveBeenCalled();
  });

  it('sends to() and all() in the relay shape', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();

    relay.to(7, { t: 'bt', seat: 2, seq: 1, data: [1] });
    relay.all({ t: 'step', seat: 2, d: 1, x: 0, y: 0, map: { group: 0, num: 0 } });

    expect(sockets[0].sent).toEqual([
      { type: 'to', id: 7, m: { t: 'bt', seat: 2, seq: 1, data: [1] } },
      { type: 'all', m: { t: 'step', seat: 2, d: 1, x: 0, y: 0, map: { group: 0, num: 0 } } },
    ]);
  });

  it('does not send while the socket is not open', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    // socket still CONNECTING, not opened
    relay.all({ t: 'out', seat: 1 });
    expect(sockets[0].sent).toEqual([]);
  });

  it('queues host()/join() sent while still CONNECTING and flushes them in order on open', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    // host() is called the instant connect() returns, well before a real WebSocket
    // handshake completes -- it must not be lost.
    relay.host({ name: 'ASH' });
    expect(sockets[0].sent).toEqual([]);

    sockets[0].open();
    expect(sockets[0].sent).toEqual([
      { type: 'host_room', name: 'ASH', open: false, max: undefined, skin: undefined, pass: undefined, patch: undefined, protocol: undefined },
    ]);
  });

  it('pings every 20s while connected', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();

    vi.advanceTimersByTime(20_000);
    expect(sockets[0].sent).toEqual([{ type: 'ping', t: expect.any(Number) }]);
    vi.advanceTimersByTime(20_000);
    expect(sockets[0].sent).toHaveLength(2);
  });

  it('reconnects with backoff after an unexpected close, and stops pinging meanwhile', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();

    sockets[0].onclose?.({}); // the server dropped us -- not relay.close()
    expect(sockets).toHaveLength(1); // no reconnect attempt yet -- backoff pending

    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2); // first backoff step (500ms) elapsed

    // This second attempt fails before ever opening (never resets the backoff),
    // so the next retry is the doubled step.
    sockets[1].onclose?.({});
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3); // second step doubled to 1000ms
  });

  it('says whether an open is the first one or a recovery', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    const opens: boolean[] = [];

    relay.on('open', (ev) => void opens.push(ev.reconnected));
    relay.connect('ws://relay.test');
    sockets[0].open();
    expect(opens).toEqual([false]);

    // Dropped, and won back: the page has a room to put back together, which is a
    // different job from the one it did on the first open.
    sockets[0].onclose?.({});
    vi.advanceTimersByTime(500);
    sockets[1].open();
    expect(opens).toEqual([false, true]);
  });

  it('does not reconnect after an intentional close()', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    relay.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('refuses a seat past MAX_SEAT: gives it back and says the room is full (POK-330 #6)', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    const joined = vi.fn();
    const error = vi.fn();
    relay.on('room_joined', joined);
    relay.on('room_error', error);

    relay.join('ABC123', { name: 'LATE' });
    sockets[0].receive({ type: 'room_joined', code: 'ABC123', id: MAX_SEAT + 1, host: 1, token: 't' });
    expect(joined).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({ reason: 'full' });
    expect(relay.id).toBeNull();
    expect(relay.token).toBeNull();
    expect(relay.rejoin()).toBe(false); // nothing to come back to
    expect(sockets[0].sent.at(-1)).toEqual({ type: 'leave_room' });

    // the top seat itself is a seat
    sockets[0].receive({ type: 'room_joined', code: 'ABC123', id: MAX_SEAT, host: 1 });
    expect(joined).toHaveBeenCalledWith({ code: 'ABC123', id: MAX_SEAT, host: 1 });
  });

  it('locks with the bots\' seats so the relay never hands one out (POK-330 #6)', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    relay.lockRoom(true);
    relay.lockRoom(true, [31, 30]);
    relay.lockRoom(false);
    expect(sockets[0].sent).toEqual([
      { type: 'lock_room', locked: true },
      { type: 'lock_room', locked: true, bots: [31, 30] },
      { type: 'lock_room', locked: false },
    ]);
  });

  it('agrees with the relay on the highest seat', () => {
    expect(serverSource).toMatch(new RegExp(`export const MAX_SEAT = ${MAX_SEAT};`));
  });

  it('emits closed with the room_closed reason', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    const closed = vi.fn();
    relay.on('closed', closed);
    sockets[0].receive({ type: 'room_closed', reason: 'removed' });
    expect(closed).toHaveBeenCalledWith({ reason: 'removed' });
  });
});

describe('rejoin (POK-284)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes back to the same room with the token the relay gave, as it joined before', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    expect(relay.rejoin()).toBe(false); // nothing to go back to yet
    relay.join('ABC123', { name: 'BLUE', pass: 'X1', patch: 7, protocol: 3 });
    sockets[0].receive({ type: 'room_joined', code: 'ABC123', id: 5, host: 2, token: 'tok-1' });
    expect(relay.token).toBe('tok-1');

    // The socket drops and comes back: the client asks for its seat.
    sockets[0].onclose?.({});
    vi.advanceTimersByTime(60_000);
    const again = sockets[sockets.length - 1];
    expect(again).not.toBe(sockets[0]);
    again.open();
    expect(relay.rejoin()).toBe(true);
    expect(again.sent.filter((m) => m.type === 'join_room')).toEqual([
      { type: 'join_room', code: 'ABC123', name: 'BLUE', pass: 'X1', skin: undefined, spectate: undefined, patch: 7, protocol: 3, token: 'tok-1' },
    ]);
    // ...and the relay's answer carries a new token: the old one is spent.
    again.receive({ type: 'room_joined', code: 'ABC123', id: 5, host: 2, token: 'tok-2' });
    expect(relay.id).toBe(5);
    expect(relay.token).toBe('tok-2');
  });

  it('a host has a token too, and a relay that gives none leaves rejoin with nothing', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    relay.host({ name: 'RED', open: true, max: 8 });
    sockets[0].receive({ type: 'room_hosted', code: 'ABC123', id: 1 });
    expect(relay.rejoin()).toBe(false);
    sockets[0].receive({ type: 'room_hosted', code: 'ABC123', id: 1, token: 'h-1' });
    expect(relay.rejoin()).toBe(true);
    expect(sockets[0].sent.at(-1)).toMatchObject({ type: 'join_room', code: 'ABC123', name: 'RED', token: 'h-1' });
  });
});
