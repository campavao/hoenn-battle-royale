import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEATEN_KEPT, MatchSession, type SessionDeps, type SessionView } from './session';
import { EndGrace } from './grace';
import { Director, type DirectorWorld } from './director';
import { botRows } from './lifecycle';
import { loadCareer } from './career';
import { loadLog } from './log';
import { Roster } from './roster';
import { soloRoster } from './host';
import type { Bots } from '../bots/brain';
import { createHostBots, type HostBots } from '../bots/host';
import regionmapData from '../data/regionmap.json';
import { Bridge } from '../net/bridge';
import { fakeEmulator, fakeRelay, memoryStore } from '../net/fakes.testutil';
import type { RosterEvent } from '../net/relay';
import { BR_CONT_FLAG, reassembleSlots, unpackSlot, type BinarySlot } from '../net/slots';
import { PROTOCOL, type MapRef, type Msg, type NpcOutMsg, type PackedMon, type SpillMsg, type StartMsg, type TickerMsg } from '../net/wire';

const BASE = 0x0203d178; // gBrMailbox, per br-symbols.json
const ROUTE_101: MapRef = { group: 0, num: 16 };
const ROUTE_102: MapRef = { group: 0, num: 17 };
const RUSTBORO_GYM: MapRef = { group: 11, num: 3 }; // ROXANNE is local id 1 (bosses.ts)

const start = (seats: number[], seed = 20260916): StartMsg => ({
  t: 'start',
  seed,
  spawns: seats.map((seat, i) => ({ seat, map: ROUTE_101, x: i, y: 0 })),
});
const room = (ids: number[]): RosterEvent => ({
  code: 'ABC123', host: 0, open: false, max: 8, pass: false,
  members: ids.map((id) => ({ id, name: `P${id}` })),
});
const bag = (seat: number, map = ROUTE_101): SpillMsg => ({
  t: 'spill',
  seat,
  map,
  mons: [],
  bag: { key: (seat << 8) | 0xff, x: 3, y: 4, items: [{ id: 13, n: 2 }, { id: 75, n: 1 }], money: 100 },
});
const place = (seat: number, map: MapRef): Msg => ({ t: 'place', v: PROTOCOL, seat, map, x: 5, y: 8, f: 1, st: 'alive' });
const mon: PackedMon = {
  species: 1, level: 5, hp: 20, maxHp: 20, status: 0, moves: [], heldItem: 0, otId: 0, personality: 0, exp: 0,
  nickname: 'ZIG', ot: 'MAY',
};

/** A brain that only says what it was told. */
function spyBots() {
  const spy = { challenged: vi.fn(), setParty: vi.fn(), noteSpent: vi.fn(), noteResult: vi.fn() };
  return { spy, bots: spy as unknown as Bots };
}

/** The books as a host at seat 0 keeps them, on a clock the test holds. */
function books(over: Partial<SessionDeps> = {}, roster = new Roster()) {
  let now = 1_000;
  const store = memoryStore();
  const toRom: Msg[] = [];
  const exit = vi.fn();
  roster.setMySeat(0);
  const view = { started: vi.fn(), decided: vi.fn(), partyLate: vi.fn() } satisfies SessionView;
  const deps: SessionDeps = {
    mySeat: () => 0,
    nameOf: (seat) => roster.nameOf(seat),
    rows: () => roster,
    relayRoster: () => null,
    dealing: () => true,
    bots: () => null,
    toRom: (m) => void toRom.push(m),
    defaultFog: () => 120,
    store,
    grace: new EndGrace({ graceMs: 4_000, winMaxMs: 60_000, pollMs: 500 }),
    exit,
    now: () => now,
    ...over,
  };
  const session = new MatchSession(deps, view);
  return { session, store, toRom, exit, view, roster, tick: (ms: number) => void (now += ms) };
}

describe("one match's books (POK-330 #42)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a start fills in the one match object, which the e2e holds', () => {
    const { session } = books();
    const match = session.match;
    session.note(start([0, 31, 30]), 'page');
    expect(session.match).toBe(match);
    expect(match.active).toBe(true);
    expect(match.seats).toEqual([0, 31, 30]);
    expect(session.fieldSize).toBe(3);
  });

  it('the page that dealt keeps its bot seats; a guest reads them off the room', () => {
    const dealt = books();
    const bots = new Set([31, 30]);
    dealt.session.match.botSeats = bots;
    dealt.session.note(start([0, 31, 30]), 'page');
    expect(dealt.session.match.botSeats).toBe(bots);

    const guest = books({ dealing: () => false, relayRoster: () => room([0, 1]) });
    guest.session.note(start([0, 1, 31, 30]), { from: 0 });
    expect([...guest.session.match.botSeats]).toEqual([31, 30]);
  });

  it('seats the bots on the roster before the log takes its names (#51), and says a match is on', () => {
    const { session, view } = books();
    session.match.botSeats = new Set([31, 30]);
    session.note(start([0, 31, 30], 77), 'page');
    const named = botRows(77, [31, 30]);
    expect(session.log.current(0)?.roster[31]).toBe(named.find((b) => b.seat === 31)?.name);
    expect(session.log.current(0)?.roster[31]).not.toBe('P31');
    expect(view.started).toHaveBeenCalledTimes(1);
  });

  // #16: the host never hears its own bots go out over the relay, so its books never saw
  // the field thin and its placement was counted against a field that never did.
  it("counts the host's own bots going out, and decides the match once", () => {
    const { session, store, toRom, exit, view, tick } = books();
    session.match.botSeats = new Set([31, 30, 29]);
    session.note(start([0, 31, 30, 29]), 'page');
    tick(30_000);
    session.note({ t: 'out', seat: 31 }, 'page');
    session.note({ t: 'out', seat: 30 }, 'page');
    session.note({ t: 'out', seat: 0 }, 'rom');
    session.note({ t: 'win', seat: 29 }, 'page');

    expect(session.results.forSeat(0, 0).placement).toBe(2); // 4th, had nobody's `out` counted
    expect(loadLog(store)).toHaveLength(1);
    expect(loadLog(store)[0].winner).toBe(29);
    expect(loadCareer(store)).toMatchObject({ matches: 1, wins: 0, best: 2 });
    expect(view.decided).toHaveBeenCalledTimes(1);
    expect(view.decided).toHaveBeenCalledWith('1 played · 0 won · best 2nd');
    expect(toRom).toEqual([{ t: 'result', seat: 29, outcome: 'win' }]);
    expect(session.recorded).toBe(true);

    vi.advanceTimersByTime(3_999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledTimes(1);

    session.note({ t: 'win', seat: 29 }, 'page');
    vi.advanceTimersByTime(10_000);
    expect(view.decided).toHaveBeenCalledTimes(1);
    expect(toRom).toHaveLength(1);
    expect(loadLog(store)).toHaveLength(1);
    expect(loadCareer(store).matches).toBe(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('decides nothing without a seat of our own', () => {
    const { session, store, view } = books({ mySeat: () => null });
    session.note(start([0, 1]), { from: 0 });
    session.note({ t: 'win', seat: 1 }, { from: 0 });
    expect(view.decided).not.toHaveBeenCalled();
    expect(loadLog(store)).toEqual([]);
  });

  it("draws the results again for the champion's team, which lands after the win", () => {
    const { session, view } = books();
    session.note(start([0, 7]), 'page');
    session.note({ t: 'party', seat: 7, mons: [mon] }, { from: 7 });
    expect(view.partyLate).not.toHaveBeenCalled(); // no results up yet
    session.note({ t: 'win', seat: 7 }, 'page');
    session.note({ t: 'party', seat: 7, mons: [mon, mon] }, { from: 7 });
    expect(view.partyLate).toHaveBeenCalledTimes(1);
    expect(session.parties.get(7)).toHaveLength(2);
  });

  it('what the page made itself is nobody busy and nothing for the bots', () => {
    const { spy, bots } = spyBots();
    const { session } = books({ bots: () => bots });
    session.note({ t: 'busy', seat: 31, kind: 'battle' }, 'page');
    session.note({ t: 'result', seat: 31, outcome: 'lose' }, 'page');
    session.note({ t: 'challenge', seat: 0, opponent: 31, nonce: 1 }, 'page');
    expect(session.busy.size).toBe(0);
    expect(spy.noteResult).not.toHaveBeenCalled();
    expect(spy.challenged).not.toHaveBeenCalled();
  });

  it("hands the bots a fight under whose ROM said it: ours, or the relay's `from` (#17)", () => {
    const { spy, bots } = spyBots();
    const { session } = books({ bots: () => bots, mySeat: () => 2 });
    session.note({ t: 'challenge', seat: 2, opponent: 31, nonce: 1 }, 'rom');
    session.note({ t: 'challenge', seat: 7, opponent: 30, nonce: 2 }, { from: 7 });
    session.note({ t: 'result', seat: 31, outcome: 'lose' }, 'rom');
    session.note({ t: 'result', seat: 30, outcome: 'lose' }, { from: 7 });
    session.note({ t: 'spent', seat: 30, items: [13] }, { from: 7 });
    expect(spy.challenged.mock.calls).toEqual([[31, 2], [30, 7]]);
    expect(spy.noteResult.mock.calls).toEqual([[31, 2], [30, 7]]);
    expect(spy.noteSpent.mock.calls).toEqual([[30, [13], 7]]);
  });

  it('keeps who is in a battle: a battle adds the seat, anything else or an out takes it off', () => {
    const { session } = books();
    session.note({ t: 'busy', seat: 7, kind: 'battle' }, { from: 7 });
    expect([...session.busy]).toEqual([7]);
    session.note({ t: 'busy', seat: 7 }, { from: 7 });
    expect(session.busy.size).toBe(0);
    session.note({ t: 'busy', seat: 7, kind: 'battle' }, { from: 7 });
    session.note({ t: 'busy', seat: 7, kind: 'menu' }, { from: 7 });
    expect(session.busy.size).toBe(0);
    session.note({ t: 'busy', seat: 2, kind: 'battle' }, 'rom');
    session.note({ t: 'out', seat: 2 }, 'rom');
    expect(session.busy.size).toBe(0);
  });

  // POK-280: the ROM never keeps what is in a bag, so the page hands it over.
  it("gives our own ROM a bag's contents when it takes the whole bag, then forgets the bag", () => {
    const { session, toRom } = books();
    const spill = bag(7);
    session.note(spill, { from: 7 });
    session.note({ t: 'pickup', seat: 7, key: spill.bag!.key, item: 13 }, { from: 7 }); // a stack, not the bag
    session.note({ t: 'pickup', seat: 9, key: 0x0999 }, { from: 9 }); // somebody else's, nothing here
    expect(toRom).toEqual([]);
    session.note({ t: 'pickup', seat: 0, key: spill.bag!.key }, 'rom');
    expect(toRom).toEqual([{ t: 'give', items: [{ id: 13, n: 1 }, { id: 75, n: 1 }] }]);
    expect(session.loot.forMap(ROUTE_101)).toBeNull();
  });

  it('hands our own ROM the loot where it stands, once per map it arrives on', () => {
    const { session, toRom } = books();
    const spilled = () => toRom.filter((m): m is SpillMsg => m.t === 'spill').map((m) => m.bag?.key);
    session.note(bag(7), { from: 7 });
    session.note(place(0, ROUTE_101), 'rom');
    expect(spilled()).toEqual([0x07ff]);
    session.note(place(0, ROUTE_101), 'rom');
    session.note({ t: 'out', seat: 0 }, 'rom');
    expect(spilled()).toEqual([0x07ff]);
    session.note(place(0, ROUTE_102), 'rom'); // nothing lying there
    expect(spilled()).toEqual([0x07ff]);
    session.note(place(0, ROUTE_101), 'rom');
    expect(spilled()).toEqual([0x07ff, 0x07ff]);
    // Somebody else arriving is nothing to our ROM, and neither is our own page's word.
    session.note(place(7, ROUTE_102), { from: 7 });
    session.note(place(0, ROUTE_102), 'page');
    session.note(place(7, ROUTE_101), { from: 7 });
    expect(spilled()).toEqual([0x07ff, 0x07ff]);
  });

  // POK-330 #22: PLAY AGAIN kept the last match, and each piece went wrong in the next.
  // POK-295: every page draws the line itself, off the `npcout` the room already hears --
  // and our own, which never comes back over the relay.
  it('says a gym leader fell, whoever beat them, and not when the fog took the gym', () => {
    const { session, toRom, roster } = books();
    roster.seatBots([{ seat: 7, name: 'WALLY', skin: 0 }]);
    const lines = () => toRom.filter((m) => m.t === 'ticker').map((m) => (m as TickerMsg).text);
    session.note({ t: 'npcout', seat: 7, map: RUSTBORO_GYM, localId: 1 }, { from: 7 });
    expect(lines()).toEqual(['WALLY BEAT ROXANNE!']);
    session.note({ t: 'npcout', seat: 0, map: RUSTBORO_GYM, localId: 1 }, 'rom');
    expect(lines()).toEqual(['WALLY BEAT ROXANNE!', 'P0 BEAT ROXANNE!']);
    session.note({ t: 'npcout', seat: 7, map: RUSTBORO_GYM, localId: 1, fog: true }, { from: 7 });
    session.note({ t: 'npcout', seat: 7, map: RUSTBORO_GYM, localId: 2 }, { from: 7 }); // a gym trainer
    session.note({ t: 'npcout', seat: 7, map: RUSTBORO_GYM, localId: 1 }, 'page'); // the page's own word
    expect(lines()).toHaveLength(2);
  });

  it('ends a match without letting go of the match object, and starts the next table clean', () => {
    const { session, toRom } = books();
    const match = session.match;
    session.note(start([0, 7]), 'page');
    session.note(bag(7), { from: 7 });
    session.note(place(0, ROUTE_101), 'rom');
    session.note({ t: 'busy', seat: 7, kind: 'battle' }, { from: 7 });
    session.greeted.add(7);
    session.owedLoot.add(7);
    session.note({ t: 'win', seat: 0 }, 'page');
    const loot = session.loot;

    session.endMatch();
    expect(session.match).toBe(match);
    expect(match).toMatchObject({ active: false, ended: false, seed: 0, seats: [] });
    expect(session.loot).not.toBe(loot);
    expect(session.loot.size()).toBe(0);
    expect([session.busy.size, session.greeted.size, session.owedLoot.size]).toEqual([0, 0, 0]);
    // What the results panel is still showing stays until the next start.
    expect(session.results.isOver()).toBe(true);
    expect(session.log.current(0)?.winner).toBe(0);
    // ...and the map we stand on is news again to the next table.
    session.note(bag(7), { from: 7 });
    toRom.length = 0;
    session.note(place(0, ROUTE_101), 'rom');
    expect(toRom).toEqual([expect.objectContaining({ t: 'spill', bag: expect.objectContaining({ key: 0x07ff }) })]);
  });

  // POK-331 #4. A trainer beaten while a seat's socket was down still stood on its screen,
  // to be beaten again. The host hands that seat the newest a ROM remembers when it is
  // back, and the ones it already had must not count twice on its card.
  it("keeps the match's beaten trainers for a seat back from a blip, and books each once", () => {
    const { session } = books();
    const beat = (seat: number, localId: number, fog?: true): NpcOutMsg => ({ t: 'npcout', seat, map: ROUTE_102, localId, ...(fog ? { fog } : {}) });
    session.note(start([0, 7]), 'page');
    session.note(beat(7, 3), { from: 7 });
    session.note(beat(7, 3), { from: 0 }); // handed again by a host catching us up
    session.note(beat(0, 4), 'rom');
    session.note(beat(0, 5, true), 'page'); // the fog's: no ROM remembers it, nor do we
    expect(session.record.forSeat(7).trainers).toBe(1);
    expect(session.beaten).toEqual([beat(7, 3), beat(0, 4)]);
    expect(session.hasBeaten(beat(7, 3))).toBe(true);

    for (let id = 10; id < 40; id++) session.note(beat(7, id), { from: 7 });
    expect(session.beaten).toHaveLength(BEATEN_KEPT);
    expect(session.beaten.at(-1)).toEqual(beat(7, 39));
    expect(session.record.forSeat(7).trainers).toBe(31);

    // A new match is a new world: the same trainer can fall in it again.
    session.note(start([0, 7], 99), 'page');
    expect(session.beaten).toEqual([]);
    session.note(beat(7, 3), { from: 7 });
    expect(session.record.forSeat(7).trainers).toBe(1);
    session.endMatch();
    expect(session.beaten).toEqual([]);
  });

  it("keeps drawing the champion's team through the reboot, and forgets it after", () => {
    const { session, view } = books();
    session.note(start([0, 7]), 'page');
    session.note({ t: 'win', seat: 7 }, 'page');
    session.endMatch();
    session.note({ t: 'party', seat: 7, mons: [mon] }, { from: 7 });
    expect(view.partyLate).toHaveBeenCalledTimes(1);

    session.forgetResult();
    expect(session.recorded).toBe(false);
    expect(session.parties.size).toBe(0);
    session.note({ t: 'party', seat: 7, mons: [mon] }, { from: 7 });
    expect(view.partyLate).toHaveBeenCalledTimes(1);
  });
});

// Solo keeps its books in the same session as the room (POK-330 #42), and the two had
// drifted before: solo never routed its fights to the bots (#17), and kept no champion's
// team (POK-331 #26). Kanto's solo is the room with nobody else in it (lib/localroom.lua),
// so what stays different is only the grace: 8 s out to the lobby, not 4 s back to a room.
describe('solo, on the same books', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The session the way runSolo builds it: seat 0 by our own name, no fog of its own, and
   *  the lobby for an exit. */
  function solo(over: Partial<SessionDeps> = {}, paradeDone?: () => boolean) {
    return books(
      {
        defaultFog: undefined,
        grace: new EndGrace({ graceMs: 8_000, winMaxMs: 60_000, pollMs: 500, paradeDone }),
        ...over,
      },
      soloRoster('MAY'),
    );
  }

  it("starts from the director's own fog, not a copy of it", () => {
    const { session } = solo();
    const sent: Msg[] = [];
    const world: DirectorWorld = {
      maps: [{ id: 'MAP_ALPHA', group: 0, num: 1, section: 'SEC_ALPHA', outdoor: true }],
      landing: Array.from({ length: 4 }, (_, x) => ({ map: 'MAP_ALPHA', x, y: 0 })),
      sections: { SEC_ALPHA: { x: 0, y: 0, w: 2, h: 2, name: 'ALPHA', num: 1 } },
    };
    // A director handed no fog, as solo's is when there is no `#quick`.
    new Director({ seats: [0], seed: 1, world, send: (m) => void sent.push(m), now: () => 0, onOut: () => () => {} }).start();
    expect(sent[0]).toMatchObject({ t: 'start', fog: session.fog });
  });

  it("hands our own ROM's challenge to the bot it names, and the bot's card comes to seat 0 (#17)", () => {
    const cards: { seat: number; msg: Msg }[] = [];
    let hb: HostBots | null = null;
    const { session } = solo({ bots: () => hb?.bots ?? null });
    hb = createHostBots({
      send: (m) => session.note(m, 'page'),
      sendTo: (seat, msg) => void cards.push({ seat, msg }),
      takenSeats: [0],
      seed: 20260916,
      fill: 7,
      loot: session.loot,
      players: () => [],
      busy: (seat) => session.busy.has(seat),
      sections: regionmapData.sections as DirectorWorld['sections'],
      now: () => 0,
      every: () => () => {},
    });
    const bot = hb.seats[0];
    session.note({ t: 'challenge', seat: 0, opponent: bot, nonce: 1 }, 'rom');
    expect(cards).toHaveLength(1);
    expect(cards[0].seat).toBe(0);
    expect(cards[0].msg).toMatchObject({ t: 'trainer', seat: bot });
  });

  it("counts the bots going out, and the director's win for us goes to the lobby 8 s later", () => {
    const { session, store, toRom, exit, view } = solo();
    session.match.botSeats = new Set([31, 30]);
    session.note(start([0, 31, 30]), 'page');
    session.note({ t: 'out', seat: 31 }, 'page');
    session.note({ t: 'out', seat: 30 }, 'page');
    session.note({ t: 'win', seat: 0 }, 'page');

    expect(session.results.forSeat(0, 0).placement).toBe(1);
    expect(session.results.forSeat(31, 0).placement).toBe(3);
    expect(session.results.forSeat(30, 0).placement).toBe(2);
    expect(view.decided).toHaveBeenCalledTimes(1);
    expect(view.decided).toHaveBeenCalledWith('1 played · 1 won · best 1st');
    expect(loadLog(store)).toHaveLength(1);
    expect(loadLog(store)[0].winner).toBe(0);
    expect(toRom).toEqual([{ t: 'result', seat: 0, outcome: 'win' }]);

    vi.advanceTimersByTime(7_999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('a champion with a parade to watch leaves on the first poll that finds it over, or at 60 s', () => {
    let done = false;
    const watched = solo({}, () => done);
    watched.session.note(start([0, 31]), 'page');
    watched.session.note({ t: 'out', seat: 31 }, 'page');
    watched.session.note({ t: 'win', seat: 0 }, 'page');
    vi.advanceTimersByTime(10_000); // past the 8 s a loser waits
    expect(watched.exit).not.toHaveBeenCalled();
    done = true;
    vi.advanceTimersByTime(500);
    expect(watched.exit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(watched.exit).toHaveBeenCalledTimes(1);

    const stuck = solo({}, () => false);
    stuck.session.note(start([0, 31]), 'page');
    stuck.session.note({ t: 'out', seat: 31 }, 'page');
    stuck.session.note({ t: 'win', seat: 0 }, 'page');
    vi.advanceTimersByTime(59_999);
    expect(stuck.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stuck.exit).toHaveBeenCalledTimes(1);
    stuck.session.grace.cancel();
  });

  // POK-331 #26 (D1): solo kept no party, so a solo champion's parade had nothing under
  // the results -- where the room's champion sees YOUR TEAM.
  it("keeps our own ROM's team as the parade starts, and draws the results again for it", () => {
    const { session, view } = solo();
    session.note(start([0, 31]), 'page');
    session.note({ t: 'out', seat: 31 }, 'page');
    session.note({ t: 'win', seat: 0 }, 'page');
    expect(view.partyLate).not.toHaveBeenCalled();
    session.note({ t: 'party', seat: 0, mons: [mon] }, 'rom');
    expect(session.parties.get(0)).toEqual([mon]);
    expect(view.partyLate).toHaveBeenCalledTimes(1);
  });

  // POK-331 #26 (D4): the gym line was drawn only by the room's own ear on our ROM.
  it('says so on our ticker when we beat a gym leader', () => {
    const { session, toRom } = solo();
    session.note({ t: 'npcout', seat: 0, map: RUSTBORO_GYM, localId: 1 }, 'rom');
    expect(toRom).toEqual([{ t: 'ticker', seat: 0, kind: 'kill', text: 'MAY BEAT ROXANNE!' }]);
  });

  // POK-331 #26 (D2): solo never restocked, so a bot's spill that the ROM's eight-piece
  // ground had no room for when it fell was never on the map when we got there.
  it("hands our own ROM a bot's spill when we arrive on its map, and again on coming back", () => {
    const { session, toRom } = solo();
    session.note(bag(31), 'page');
    session.note(place(0, ROUTE_101), 'rom');
    session.note(place(0, ROUTE_102), 'rom');
    session.note(place(0, ROUTE_101), 'rom');
    expect(toRom.map((m) => m.t === 'spill' && m.bag?.key)).toEqual([0x1fff, 0x1fff]);
  });
});

/** Every message the ROM would read off its in-ring now. */
function drainMsgs(romDrainIn: () => BinarySlot[]): Msg[] {
  const slots = romDrainIn();
  const out: Msg[] = [];
  for (let i = 0; i < slots.length; ) {
    const group = [slots[i++]];
    while (i < slots.length && (slots[i].type & BR_CONT_FLAG) !== 0) group.push(slots[i++]);
    const whole = reassembleSlots(group);
    out.push(unpackSlot(whole.type, whole.payload));
  }
  return out;
}

describe('the books behind a Bridge, wired the way the room wires them', () => {
  /** A guest at seat 2 in a room seat 1 hosts, with MAY at 7. */
  function joined() {
    const gba = fakeEmulator(BASE);
    gba.romInit();
    const { relay, socket } = fakeRelay();
    let roster: RosterEvent | null = null;
    relay.on('roster', (ev) => void (roster = ev));
    socket.receive({ type: 'room_joined', code: 'ABC123', id: 2, host: 1, token: 't' });
    const bridge = new Bridge({ emu: gba.emu, mailboxBase: BASE, relay, seat: 2 });
    socket.receive({
      type: 'roster', code: 'ABC123', host: 1, open: true, max: 8, pass: false,
      members: [{ id: 1, name: 'HOST' }, { id: 2, name: 'ME' }, { id: 7, name: 'MAY' }],
    });
    const view = { started: vi.fn(), decided: vi.fn(), partyLate: vi.fn() } satisfies SessionView;
    const session = new MatchSession(
      {
        mySeat: () => bridge.seat,
        nameOf: (seat) => bridge.roster.nameOf(seat),
        rows: () => bridge.roster,
        relayRoster: () => roster,
        dealing: () => false,
        bots: () => null,
        toRom: (m) => bridge.pushToRom(m),
        defaultFog: () => 120,
        store: memoryStore(),
        grace: new EndGrace({ graceMs: 4_000, winMaxMs: 60_000, pollMs: 500 }),
        exit: () => {},
      },
      view,
    );
    bridge.setOutObserver((msg) => session.note(msg, 'rom'));
    bridge.onMessage((m, from) => session.note(m, { from }));
    return { ...gba, socket, bridge, session, view };
  }

  it("answers our own ROM taking a bag with what was in it, and the table forgets it (POK-280)", () => {
    const { socket, frame, romEmit, romDrainIn, session } = joined();
    const spill = bag(7);
    socket.receive({ type: 'recv', from: 7, m: spill });
    frame();
    drainMsgs(romDrainIn); // the spill itself, into our ROM
    romEmit({ t: 'pickup', seat: 0, key: spill.bag!.key });
    frame(); // the Bridge reads the pickup, and the answer is queued
    frame(); // ...and written
    expect(drainMsgs(romDrainIn)).toEqual([{ t: 'give', items: [{ id: 13, n: 2 }, { id: 75, n: 1 }] }]);
    expect(session.loot.forMap(ROUTE_101)).toBeNull();
  });

  it("takes the host's start as a match on", () => {
    const { socket, session, view } = joined();
    socket.receive({ type: 'recv', from: 1, m: start([1, 2, 7, 31]) });
    expect(session.match.active).toBe(true);
    expect([...session.match.botSeats]).toEqual([31]); // the one seat nobody in the room holds
    expect(view.started).toHaveBeenCalledTimes(1);
  });

  it('never hears a start from anybody but the host (POK-330 #24)', () => {
    const { socket, session, view, bridge } = joined();
    socket.receive({ type: 'recv', from: 7, m: start([1, 2, 7, 31]) });
    expect(bridge.stats.refused).toBe(1);
    expect(session.match.active).toBe(false);
    expect(view.started).not.toHaveBeenCalled();
  });
});
