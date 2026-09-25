// The page that runs the match, wired the way the room wires it (POK-330 #42): a real
// Bridge over the fake relay and mailbox, a real MatchSession, the world app.ts deals from,
// and a link that reads whichever Bridge the page has now. What the room hears is the
// socket's frames; what our own ROM is handed is what went through the link.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostRole, type HostLink, type HostOptions } from './host';
import type { DirectorWorld } from './director';
import { EndGrace } from './grace';
import { DOORSTEPS, HAND, LANDING } from './landing';
import { dealPlan } from './lifecycle';
import { MatchSession, type SessionView } from './session';
import { Bridge } from '../net/bridge';
import { fakeEmulator, fakeRelay, memoryStore, type FakeSocket } from '../net/fakes.testutil';
import { Mailbox } from '../net/mailbox';
import type { RosterEvent } from '../net/relay';
import { RomPort } from '../net/romport';
import { PROTOCOL, type MapRef, type Msg, type SpillMsg, type StartMsg } from '../net/wire';
import worldData from '../data/world.json';
import regionmapData from '../data/regionmap.json';

const BASE = 0x0203d178; // gBrMailbox, per br-symbols.json
const SEED = 20260916;
const ROUTE_101: MapRef = { group: 0, num: 16 };
const WORLD: DirectorWorld = {
  maps: worldData.maps as DirectorWorld['maps'],
  landing: LANDING,
  doorsteps: DOORSTEPS,
  hand: HAND,
  sections: regionmapData.sections as DirectorWorld['sections'],
};
/** A section the drop picker offers, by the MAPSEC number a `pick` carries. */
const SECTION = Object.values(WORLD.sections).find((s) => s.num !== undefined)!.num!;

type Frame = Record<string, unknown> & { type: string; m?: Msg };
const said = (f: Frame) => (f.type === 'all' || f.type === 'to' ? `${f.type}:${f.m!.t}` : `${f.type}:${String(f.locked)}`);
const tickers = (frames: Frame[]) => frames.filter((f) => f.m?.t === 'ticker').map((f) => (f.m as { text: string }).text);

/** A host at seat 0 with seats 1 and 2 in the room, attached the way wireRoom attaches:
 *  the books first, then the match this page runs. The director's clock is the fake one. */
function hosting(members = [0, 1, 2]) {
  const gba = fakeEmulator(BASE);
  gba.romInit();
  const rom = new RomPort(new Mailbox(gba.emu, BASE));
  let host: HostRole | null = null;
  let bridge!: Bridge;
  let socket!: FakeSocket;
  const roster: RosterEvent = {
    code: 'ABC123', host: 0, open: false, max: 8, pass: false,
    members: members.map((id) => ({ id, name: `P${id}` })),
  };
  /** A socket and a Bridge, as a (re)attach builds them. */
  const attach = (): FakeSocket => {
    bridge?.dispose();
    const net = fakeRelay();
    socket = net.socket;
    socket.receive({ type: 'room_hosted', code: 'ABC123', id: 0, token: 't' });
    bridge = new Bridge({ emu: gba.emu, mailboxBase: BASE, relay: net.relay, seat: 0, rom });
    socket.receive({ type: 'roster', ...roster });
    bridge.setOutObserver((msg) => {
      session.note(msg, 'rom');
      host?.hear(msg, 'rom');
    });
    bridge.onMessage((m, from) => {
      session.note(m, { from });
      host?.hear(m, { from });
    });
    socket.sent.length = 0;
    return socket;
  };
  const toRom: Msg[] = [];
  const pushed: Msg[] = [];
  const link: HostLink = {
    get seat() {
      return bridge.seat;
    },
    get roster() {
      return bridge.roster;
    },
    toRoom: (m) => bridge.relay.all(m),
    toSeat: (seat, m) => bridge.relay.to(seat, m),
    toRom: (m) => {
      toRom.push(m);
      rom.push(m);
    },
    pushToRom: (m) => {
      pushed.push(m);
      bridge.pushToRom(m);
    },
    lock: (locked, botSeats) => bridge.relay.lockRoom(locked, botSeats),
    linesFor: (seat) => bridge.linesFor(seat),
  };
  const view = { started: vi.fn(), decided: vi.fn(), partyLate: vi.fn() } satisfies SessionView;
  const session = new MatchSession(
    {
      mySeat: () => bridge.seat,
      nameOf: (seat) => bridge.roster.nameOf(seat),
      rows: () => bridge.roster,
      relayRoster: () => roster,
      dealing: () => host !== null,
      bots: () => host?.bots.bots ?? null,
      toRom: (m) => bridge.pushToRom(m),
      defaultFog: () => 60,
      store: memoryStore(),
      grace: new EndGrace({ graceMs: 4_000, winMaxMs: 60_000, pollMs: 500 }),
      exit: () => {},
      keepParties: true,
      now: () => Date.now(),
    },
    view,
  );
  attach();
  /** The deal: a fresh match, or the one this page has heard, taken over. */
  const deal = (over: Partial<HostOptions> & { takeOver?: boolean } = {}): HostRole => {
    const seats = over.seats ?? members;
    const plan = dealPlan(session.match, seats, 0, over.takeOver ?? false, () => SEED);
    host = new HostRole({
      session,
      link,
      world: WORLD,
      seats,
      present: seats,
      plan,
      fill: 0,
      botSafariSecs: 0,
      // No opening: the first ring comes with the first clock, five seconds in.
      options: { safariSecs: 0, fogSecs: 60 },
      zonePool: () => [],
      narration: { mine: () => ({ intro: 'HI', win: 'YES', lose: 'NO' }) },
      startLoop: (director) => {
        const id = setInterval(() => director.tick(), 1_000);
        return () => clearInterval(id);
      },
      now: () => Date.now(),
      ...over,
    });
    return host;
  };
  /** The room says something to us, as the relay delivers it. */
  const recv = (from: number, m: Msg) => socket.receive({ type: 'recv', from, m });
  return {
    ...gba,
    session,
    view,
    toRom,
    pushed,
    deal,
    recv,
    attach,
    frames: () => socket.sent as Frame[],
    socket: () => socket,
  };
}

const spill = (seat: number): SpillMsg => ({
  t: 'spill',
  seat,
  map: ROUTE_101,
  mons: [],
  bag: { key: (seat << 8) | 0xff, x: 3, y: 4, items: [{ id: 13, n: 2 }], money: 100 },
});
const place = (seat: number): Msg => ({ t: 'place', v: PROTOCOL, seat, map: ROUTE_101, x: 5, y: 8, f: 1, st: 'alive' });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the page that runs the match (POK-330 #42)', () => {
  it('shuts the door, places its bots, and holds their seats, all before any start', () => {
    const room = hosting();
    const host = room.deal({ fill: 2 });
    const frames = room.frames();
    expect(frames.map(said)).toEqual(['lock_room:true', 'all:place', 'all:place', 'lock_room:true']);
    expect(frames[0]).toEqual({ type: 'lock_room', locked: true });
    expect(frames[3]).toEqual({ type: 'lock_room', locked: true, bots: host.bots.seats });
    expect(frames.slice(1, 3).map((f) => (f.m as { seat: number }).seat)).toEqual(host.bots.seats);
    expect(host.bots.seats).toHaveLength(2);
    expect([...room.session.match.botSeats]).toEqual(host.bots.seats);
    expect(room.session.greeted).toEqual(new Set([0, 1, 2]));
    expect(room.session.match.active).toBe(false);
    host.dispose();
  });

  it('begins with a start, to the room and to our own ROM, and the books have a match on', () => {
    const room = hosting();
    const host = room.deal();
    host.begin();
    const start = room.frames().find((f) => f.m?.t === 'start')!.m as StartMsg;
    expect(start.seed).toBe(SEED);
    expect(start.spawns.map((s) => s.seat)).toEqual([0, 1, 2]);
    expect(room.toRom.filter((m) => m.t === 'start')).toEqual([start]);
    expect(room.session.match.active).toBe(true);
    expect(room.session.match.seats).toEqual([0, 1, 2]);
    expect(room.view.started).toHaveBeenCalledTimes(1);
    expect(tickers(room.frames())).toEqual(['CATCH WHAT YOU CAN! 0s', '3 TRAINERS ARE LOOSE IN HOENN!']);
    host.begin(); // once
    expect(room.frames().filter((f) => f.m?.t === 'start')).toHaveLength(1);
    host.dispose();
  });

  it('narrates an out from the room once, and the count drops once', () => {
    const room = hosting();
    const host = room.deal();
    host.begin();
    room.frames().length = 0;
    room.recv(1, { t: 'out', seat: 1 });
    expect(tickers(room.frames())).toEqual(['P1 IS OUT - 2 LEFT']);
    expect(host.director.state.alive).toBe(2);
    room.recv(1, { t: 'out', seat: 1 });
    expect(tickers(room.frames())).toEqual(['P1 IS OUT - 2 LEFT']);
    expect(host.director.state.alive).toBe(2);
    host.dispose();
  });

  it('the last out is the win, the door opening, `again`, and then the line that says who won', () => {
    const room = hosting();
    const host = room.deal();
    host.begin();
    room.recv(1, { t: 'out', seat: 1 });
    room.frames().length = 0;
    room.recv(2, { t: 'out', seat: 2 });
    expect(room.frames().map(said)).toEqual(['all:ticker', 'all:win', 'lock_room:false', 'all:again', 'all:ticker']);
    expect(room.frames()[3]).toEqual({ type: 'all', m: { t: 'again', seat: 0 } });
    expect(tickers(room.frames())).toEqual(['P2 IS OUT - 1 LEFT', 'P0 WINS!']);
    // ...and the host's own books decided it (#16): our ROM is told who won.
    expect(room.session.recorded).toBe(true);
    expect(room.view.decided).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it('lets go of everything it started, and hears nothing after (#13)', () => {
    const room = hosting();
    const host = room.deal({ fill: 2 });
    host.begin();
    host.watchDepartures([0, 1], { rejoinMs: 5_000, isHost: () => true, stillHere: () => false });
    // The bots' pump, the director's loop and seat 2's departure.
    expect(vi.getTimerCount()).toBe(3);
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
    room.frames().length = 0;
    // A stale handler still calling it, as the orphan director's subscription did.
    room.recv(1, { t: 'out', seat: 1 });
    room.recv(2, { t: 'out', seat: 2 });
    expect(room.frames().map(said)).toEqual([]);
    expect(host.director.state.alive).toBe(5);
    vi.advanceTimersByTime(10_000);
    expect(room.frames()).toEqual([]);
  });

  it('takes a seat the roster stopped listing out once the seat hold runs out, unless it is back (POK-271)', () => {
    const gone = hosting();
    const host = gone.deal();
    host.begin();
    gone.frames().length = 0;
    // Shorter than the first clock, which brings the ring and its own line.
    host.watchDepartures([0, 1], { rejoinMs: 3_000, isHost: () => true, stillHere: () => false });
    vi.advanceTimersByTime(2_999);
    expect(gone.frames().filter((f) => f.m?.t === 'out')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(gone.frames().filter((f) => f.m?.t === 'out').map((f) => f.m)).toEqual([{ t: 'out', seat: 2 }]);
    expect(tickers(gone.frames())).toEqual(['P2 IS OUT - 2 LEFT']);
    expect(gone.session.match.out).toEqual(new Set([2]));
    host.dispose();

    const back = hosting();
    const again = back.deal();
    again.begin();
    back.frames().length = 0;
    again.watchDepartures([0, 1], { rejoinMs: 5_000, isHost: () => true, stillHere: () => false });
    again.watchDepartures([0, 1, 2], { rejoinMs: 5_000, isHost: () => true, stillHere: () => false });
    vi.advanceTimersByTime(10_000);
    expect(back.frames().filter((f) => f.m?.t === 'out')).toEqual([]);
    // ...and a seat the relay lists again by the time the timer runs is not taken either.
    again.watchDepartures([0, 1], { rejoinMs: 5_000, isHost: () => true, stillHere: (seat) => seat === 2 });
    vi.advanceTimersByTime(10_000);
    expect(back.frames().filter((f) => f.m?.t === 'out')).toEqual([]);
    again.dispose();
  });

  it('never times a bot, which no roster lists (#4)', () => {
    const room = hosting();
    const host = room.deal({ fill: 2 });
    host.begin();
    const timers = vi.getTimerCount();
    host.watchDepartures([0, 1, 2], { rejoinMs: 5_000, isHost: () => true, stillHere: () => false });
    expect(vi.getTimerCount()).toBe(timers);
    host.dispose();
  });

  it('catches a newcomer up on the fog, the clock and who is gone, and pays its first place the loot owed (#25)', () => {
    const room = hosting();
    const host = room.deal();
    host.begin();
    room.recv(2, { t: 'out', seat: 2 });
    room.recv(1, spill(1)); // a bag on Route 101
    vi.advanceTimersByTime(5_000); // the first clock, and with no opening the ring
    expect(host.director.state.ring).toBeDefined();
    room.frames().length = 0;
    host.greet([0, 1, 3]);
    const caught = room.frames();
    expect(caught.every((f) => f.type === 'to' && f.id === 3)).toBe(true);
    expect(caught.map((f) => f.m!.t)).toEqual(['ring', 'clock', 'out']);
    expect(caught[2].m).toEqual({ t: 'out', seat: 2 });
    // Seat 2 left the room, so it is forgotten, and caught up again if it comes back.
    expect(room.session.greeted).toEqual(new Set([0, 1, 3]));
    host.greet([0, 1, 3]);
    expect(room.frames()).toHaveLength(3);

    room.frames().length = 0;
    room.recv(3, place(3));
    const paid = room.frames();
    expect(paid.map(said)).toEqual(['to:spill']);
    expect(paid[0].id).toBe(3);
    expect((paid[0].m as SpillMsg).bag?.key).toBe(spill(1).bag!.key);
    room.recv(3, place(3));
    expect(room.frames()).toHaveLength(1);
    host.dispose();
  });

  it('greets nobody once the match is won', () => {
    const room = hosting();
    const host = room.deal();
    host.begin();
    room.recv(1, { t: 'out', seat: 1 });
    room.recv(2, { t: 'out', seat: 2 });
    room.frames().length = 0;
    host.greet([0, 1, 2, 3]);
    expect(room.frames()).toEqual([]);
    host.dispose();
  });

  it('takes over the match it heard: the seats gone are out, unnarrated, and it says it has the clock (POK-252)', () => {
    const room = hosting([0, 1]);
    // The match as this page heard it before: dealt to 0, 1 and 3, and 3 is gone.
    room.session.note({ t: 'start', seed: 777, spawns: [0, 1, 3].map((seat, i) => ({ seat, map: ROUTE_101, x: i, y: 0 })) }, 'page');
    room.frames().length = 0;
    const host = room.deal({ seats: [0, 1], takeOver: true });
    expect(host.seed).toBe(777);
    host.begin();
    const frames = room.frames();
    expect(frames.some((f) => f.m?.t === 'start')).toBe(false);
    expect(frames.filter((f) => f.type === 'all').map((f) => f.m)).toEqual([
      { t: 'out', seat: 3 },
      { t: 'ticker', seat: 0, kind: 'say', text: 'P0: I HAVE THE CLOCK.' },
    ]);
    expect(host.director.state.alive).toBe(2);
    expect(room.session.match.out).toEqual(new Set([3]));
    host.dispose();
  });

  it("answers a peek at one of its bots with the bot's team, to whoever asked", () => {
    const room = hosting();
    const host = room.deal({ fill: 2 });
    host.begin();
    room.frames().length = 0;
    const bot = host.bots.seats[0];
    room.recv(1, { t: 'peek', seat: 1, target: bot });
    const answer = room.frames().filter((f) => f.m?.t === 'party');
    expect(answer).toHaveLength(1);
    expect(answer[0]).toMatchObject({ type: 'to', id: 1, m: { t: 'party', seat: bot } });
    host.dispose();
  });

  it("answers our own ROM's pick into our ROM, and anybody else's to them", () => {
    const room = hosting();
    const host = room.deal();
    host.begin();
    room.romEmit({ t: 'pick', seat: 0, section: SECTION });
    room.frame();
    expect(room.pushed.map((m) => m.t)).toEqual(['land']);
    expect(room.pushed[0]).toMatchObject({ t: 'land', seat: 0 });

    room.frames().length = 0;
    room.recv(2, { t: 'pick', seat: 2, section: SECTION });
    expect(room.frames().filter((f) => f.m?.t === 'land')).toEqual([
      { type: 'to', id: 2, m: expect.objectContaining({ t: 'land', seat: 2 }) },
    ]);
    expect(room.pushed).toHaveLength(1);
    host.dispose();
  });

  it('speaks on whichever Bridge the page has now: a rejoin swaps it mid-match', () => {
    const room = hosting();
    const host = room.deal();
    host.begin();
    const before = room.socket();
    before.sent.length = 0;
    const after = room.attach();
    room.recv(1, { t: 'out', seat: 1 });
    expect(before.sent).toEqual([]);
    expect(tickers(after.sent as Frame[])).toEqual(['P1 IS OUT - 2 LEFT']);
    host.dispose();
  });
});
