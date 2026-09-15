import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayClient, type WebSocketLike } from './relay';

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

  it('does not reconnect after an intentional close()', () => {
    const { factory, sockets } = makeFactory();
    const relay = new RelayClient(factory);
    relay.connect('ws://relay.test');
    sockets[0].open();
    relay.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
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
