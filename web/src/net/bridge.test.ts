import { describe, expect, it } from 'vitest';
import { BLOCKS_KEPT, Bridge, fightOf, type BridgeOptions } from './bridge';
import { MAILBOX, Mailbox, type RamAccess } from './mailbox';
import { NETLINK } from './netlink';
import { POSITIONAL_CAP, RomPort } from './romport';
import { BR_CONT_FLAG, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './slots';
import { PROTOCOL, type Msg, type SpillMsg, type StepMsg } from './wire';
import { fakeEmulator, fakeRelay } from './fakes.testutil';

const BASE = 0x0203d178; // gBrMailbox, per br-symbols.json

function decodeReassembled(slots: BinarySlot[]): Msg {
  const r = reassembleSlots(slots);
  return unpackSlot(r.type, r.payload);
}

describe('Bridge', () => {
  it('forwards a place from the ROM to the relay as all(), stamped with our seat', () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    // slots.ts's encodePlace/decodePlace round-trip `sprite` as a placeholder id (the
    // encoded string's own length, per its own comment) rather than the name itself,
    // so a 7-letter skin key comes back as "7" -- not a bridge bug, a documented gap
    // in the wire's sprite encoding.
    romEmit({ t: 'place', v: PROTOCOL, seat: 0, f: 1, st: 'alive', sprite: 'brendan' });
    frame();

    expect(socket.sent).toEqual([
      { type: 'all', m: { t: 'place', v: PROTOCOL, seat: 2, f: 1, st: 'alive', sprite: '7' } },
    ]);
    expect(bridge.stats.out).toBe(1);
  });

  it("leaves a report about somebody else's seat alone (POK-237)", () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    // We fought bot 31. What it has left and what it spent are reported under ITS
    // seat: stamping ours on them threw both away, and the bot walked off whole.
    romEmit({ t: 'spent', seat: 31, items: [13] });
    frame();

    expect(socket.sent).toEqual([{ type: 'all', m: { t: 'spent', seat: 31, items: [13] } }]);
  });

  it('lands a step from the relay in the ROM in-ring as the right bytes', () => {
    const { emu, frame, romInit, romDrainIn } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    const stepMsg: Msg = { t: 'step', seat: 5, d: 2, x: 7, y: 8, map: { group: 0, num: 3 } };
    socket.receive({ type: 'recv', from: 5, m: stepMsg });
    frame(); // the queue set up by 'recv' is flushed into the mailbox on the next frame

    const decoded = decodeReassembled(romDrainIn());
    expect(decoded).toEqual(stepMsg);
  });

  it('drops our own echo without touching the roster or the ROM ring', () => {
    const { emu, frame, romInit, romDrainIn } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    socket.receive({ type: 'recv', from: 2, m: { t: 'step', seat: 2, d: 1, x: 1, y: 1, map: { group: 0, num: 1 } } });
    frame();

    expect(romDrainIn()).toEqual([]);
    expect(bridge.stats.in).toBe(0);
    expect(bridge.roster.get(2)).toBeUndefined();
  });

  it('queues a push while the ROM ring is full and drains it once room frees up', () => {
    const { emu, frame, romInit, romDrainIn, ram } = fakeEmulator(BASE);
    romInit();
    // Saturate the in-ring exactly the way a real full ring looks: head - tail == RING_SLOTS.
    ram.write(BASE + MAILBOX.OFF_IN_HEAD, MAILBOX.RING_SLOTS, 16);
    ram.write(BASE + MAILBOX.OFF_IN_TAIL, 0, 16);

    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    const outMsg: Msg = { t: 'out', seat: 9 };
    socket.receive({ type: 'recv', from: 9, m: outMsg });
    frame(); // ring is full: the slot stays queued, nothing pushed

    expect(bridge.stats.pending).toBe(MAILBOX.RING_SLOTS);
    expect(bridge.stats.in).toBe(0);

    // The ROM drains its whole backlog (a real Task_BrNet would do this a little at
    // a time; draining it all at once here just frees the ring for the next frame).
    ram.write(BASE + MAILBOX.OFF_IN_TAIL, MAILBOX.RING_SLOTS, 16);
    frame();

    expect(bridge.stats.in).toBe(1);
    const decoded = decodeReassembled(romDrainIn());
    expect(decoded).toEqual(outMsg);
  });

  it('broadcasts a challenge, then remembers that seat for bt', () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    romEmit({ t: 'challenge', seat: 0, opponent: 7, nonce: 42 });
    frame();
    const challenge = { t: 'challenge', seat: 2, opponent: 7, nonce: 42 } as const;
    // Broadcast, not addressed: a bot is not a member of the room, so `to` its seat
    // reached nobody and the host walking it never heard the challenge (POK-238).
    expect(socket.sent[0]).toEqual({ type: 'all', m: { t: 'challenge', seat: 2, opponent: 7, nonce: 42 } });

    romEmit({ t: 'bt', seat: 0, seq: 1, data: [9, 9] });
    frame();
    expect(socket.sent[1]).toEqual({ type: 'to', id: 7, m: { t: 'bt', seat: 2, seq: 1, data: [9, 9], fight: fightOf(challenge) } });
  });

  it('updates the roster from both directions and from the relay roster event', () => {
    const { emu, frame, romInit, romEmit } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    socket.receive({ type: 'roster', code: 'ABC123', host: 2, open: true, max: 8, pass: false, members: [{ id: 2, name: 'ASH' }, { id: 7, name: 'MAY' }] });
    expect(bridge.roster.get(2)?.isMe).toBe(true);
    expect(bridge.roster.get(7)?.name).toBe('MAY');

    romEmit({ t: 'place', v: PROTOCOL, seat: 0, map: { group: 0, num: 9 }, x: 5, y: 8, f: 1, st: 'alive' });
    frame();
    expect(bridge.roster.get(2)).toMatchObject({ map: { group: 0, num: 9 }, x: 5, y: 8 });

    socket.receive({ type: 'recv', from: 7, m: { t: 'step', seat: 7, d: 4, x: 1, y: 1, map: { group: 0, num: 9 } } });
    expect(bridge.roster.get(7)).toMatchObject({ x: 1, y: 1, dir: 4 });
  });
});


// POK-274. Kanto sends a player's own battle text with the challenge itself, so "each
// side holds the other's before the locks". Ours picked three lines nobody else could
// see: the `lines` field was in the wire schema, had a decoder, and was put on a
// challenge by nobody.
describe("the battle lines you picked (POK-274)", () => {
  it('rides out on our own challenge', () => {
    const { relay, socket } = fakeRelay();
    const { emu, romEmit, frame, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });
    bridge.myLines = { intro: 'FOUND YOU.', win: 'TOLD YOU.', lose: 'GOOD FIGHT.' };

    romEmit({ t: 'challenge', seat: 0, opponent: 5, nonce: 7 });
    frame();

    const sent = socket.sent.at(-1)!.m as Record<string, unknown>;
    expect(sent.t).toBe('challenge');
    expect(sent.lines).toEqual({ intro: 'FOUND YOU.', win: 'TOLD YOU.', lose: 'GOOD FIGHT.' });
  });

  it('is not stapled to everything else we send', () => {
    const { relay, socket } = fakeRelay();
    const { emu, romEmit, frame, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });
    bridge.myLines = { intro: 'FOUND YOU.' };

    romEmit({ t: 'place', v: PROTOCOL, seat: 0, f: 1, st: 'alive', sprite: 'brendan' });
    frame();

    expect((socket.sent.at(-1)!.m as Record<string, unknown>).lines).toBeUndefined();
  });

  it('remembers what somebody else said, and never mistakes it for our own', () => {
    const { relay, socket } = fakeRelay();
    const { emu, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    socket.receive({
      type: 'recv',
      from: 5,
      m: { t: 'challenge', v: PROTOCOL, seat: 5, opponent: 9, nonce: 1, lines: { win: 'NEXT!' } },
    });

    expect(bridge.linesFor(5)).toEqual({ win: 'NEXT!' });
    // A challenge that is about two other people still counts: the whole room hears
    // every duel announced, not only its own.
    expect(bridge.linesFor(9)).toBeUndefined();
    expect(bridge.linesFor(2)).toBeUndefined();
  });

  it('says nothing about a seat that has never challenged anybody', () => {
    const { relay } = fakeRelay();
    const { emu, romInit } = fakeEmulator(BASE);
    romInit();
    const bridge = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });
    // A bot never sends one, which is why its lines stay the seed's.
    expect(bridge.linesFor(30)).toBeUndefined();
  });
});

/** Every message the ROM has been handed, one per base slot and its continuations. */
function drainMsgs(romDrainIn: () => BinarySlot[]): Msg[] {
  const slots = romDrainIn();
  const out: Msg[] = [];
  for (let i = 0; i < slots.length; ) {
    const group = [slots[i++]];
    while (i < slots.length && (slots[i].type & BR_CONT_FLAG) !== 0) group.push(slots[i++]);
    out.push(decodeReassembled(group));
  }
  return out;
}

/** What the ROM reads over a few frames, reading its in-ring after each one as
 *  br_main.c's BrNet_Tick does. A link block goes in only once the ROM has read the one
 *  before it (romport.ts), so a burst of them takes a frame each. */
function readAcrossFrames(frame: () => void, romDrainIn: () => BinarySlot[], frames = 6): Msg[] {
  const out: Msg[] = [];
  for (let i = 0; i < frames; i++) {
    frame();
    out.push(...drainMsgs(romDrainIn));
  }
  return out;
}

/** A room we have joined as seat 2, with seat 1 its host and 7 and 9 in it too. */
function joined(opts: Partial<BridgeOptions> = {}) {
  const gba = fakeEmulator(BASE);
  gba.romInit();
  const { relay, socket } = fakeRelay();
  socket.receive({ type: 'room_joined', code: 'ABC123', id: 2, host: 1, token: 't' });
  const bridge = new Bridge({ emu: gba.emu, mailboxBase: BASE, relay, seat: 2, ...opts });
  socket.receive({
    type: 'roster', code: 'ABC123', host: 1, open: true, max: 8, pass: false,
    members: [{ id: 1, name: 'HOST' }, { id: 2, name: 'ME' }, { id: 7, name: 'MAY' }, { id: 9, name: 'WALLY' }],
  });
  const heard: [Msg, number][] = [];
  bridge.onMessage((m, from) => void heard.push([m, from]));
  return { ...gba, relay, socket, bridge, heard };
}

// POK-330 #24. The relay stamps every `recv` with who sent it, and nothing read it: any
// member of a quick-play room could wipe every team with one `duel`, fill every bag with
// a `give`, or end the match with an `again`.
describe('who may say what (POK-330 #24)', () => {
  it('never hands the ROM a duel, a give or a follow off the relay', () => {
    const { socket, frame, romDrainIn, bridge, heard } = joined();
    const mon = { species: 1, level: 5, hp: 20, maxHp: 20, status: 0, moves: [], heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'ZIG', ot: 'MAY' };
    // Not even from the host: these are a page's word to its own ROM.
    socket.receive({ type: 'recv', from: 1, m: { t: 'duel', seatA: 30, seatB: 31, a: [mon], b: [mon] } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'give', items: [{ id: 1, n: 99 }] } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'follow', seat: 7 } });
    frame();
    expect(drainMsgs(romDrainIn)).toEqual([]);
    expect(heard).toEqual([]);
    expect(bridge.stats.refused).toBe(3);
  });

  it("takes the room's word only from the room's host", () => {
    const { socket, frame, romDrainIn, bridge, heard } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'again', seat: 7 } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'win', seat: 7 } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'clock', seat: 1, left: 1 } });
    frame();
    expect(heard).toEqual([]);
    expect(drainMsgs(romDrainIn)).toEqual([]);
    expect(bridge.stats.refused).toBe(3);

    socket.receive({ type: 'recv', from: 1, m: { t: 'again', seat: 1 } });
    socket.receive({ type: 'recv', from: 1, m: { t: 'clock', seat: 1, left: 90 } });
    frame();
    expect(heard).toEqual([[{ t: 'again', seat: 1 }, 1], [{ t: 'clock', seat: 1, left: 90 }, 1]]);
    expect(drainMsgs(romDrainIn)).toEqual([{ t: 'clock', seat: 1, left: 90 }]);
  });

  it('takes the host at its word when the relay moves it', () => {
    const { socket, heard } = joined();
    socket.receive({
      type: 'roster', code: 'ABC123', host: 7, open: true, max: 8, pass: false,
      members: [{ id: 2, name: 'ME' }, { id: 7, name: 'MAY' }],
    });
    socket.receive({ type: 'recv', from: 1, m: { t: 'win', seat: 1 } }); // the old host, too late
    socket.receive({ type: 'recv', from: 7, m: { t: 'win', seat: 7 } });
    expect(heard).toEqual([[{ t: 'win', seat: 7 }, 7]]);
  });

  it('lets a seat speak for itself, and the host for anybody', () => {
    const { socket, heard, bridge } = joined();
    const step = (seat: number) => ({ t: 'step', seat, d: 1, x: 1, y: 1, map: { group: 0, num: 1 } });
    socket.receive({ type: 'recv', from: 9, m: step(7) }); // 9 walking 7 about
    socket.receive({ type: 'recv', from: 7, m: step(7) });
    socket.receive({ type: 'recv', from: 1, m: step(30) }); // the host walks its bots
    expect(heard.map(([m, from]) => [(m as { seat: number }).seat, from])).toEqual([[7, 7], [30, 1]]);
    expect(bridge.roster.get(7)?.x).toBe(1);
    expect(bridge.stats.refused).toBe(1);
  });

  it("takes a report on a bot's fight from whoever fought it, and on a person's from nobody else", () => {
    const { socket, heard } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'spent', seat: 30, items: [13] } }); // 30: a bot
    socket.receive({ type: 'recv', from: 7, m: { t: 'result', seat: 30, outcome: 'lose' } });
    socket.receive({ type: 'recv', from: 7, m: { t: 'result', seat: 9, outcome: 'lose' } }); // 9: a person
    expect(heard.map(([m]) => m)).toEqual([
      { t: 'spent', seat: 30, items: [13] },
      { t: 'result', seat: 30, outcome: 'lose' },
    ]);
  });

  it('decodes once, hands on who sent it, and lets go on dispose', () => {
    const { socket, bridge, heard } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'out', seat: 7 } });
    expect(heard).toEqual([[{ t: 'out', seat: 7 }, 7]]);
    bridge.dispose();
    socket.receive({ type: 'recv', from: 9, m: { t: 'out', seat: 9 } });
    expect(heard).toHaveLength(1);
  });

  // POK-330 #25: a seat back from a blip learns it was eliminated while it was gone from
  // the host, which is the one `out` naming us that is not our own echo.
  it('passes an `out` naming us from the host, and from nobody else', () => {
    const { socket, frame, romDrainIn, bridge, heard } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'out', seat: 2 } });
    expect(heard).toEqual([]);
    socket.receive({ type: 'recv', from: 1, m: { t: 'out', seat: 2 } });
    frame();
    expect(heard).toEqual([[{ t: 'out', seat: 2 }, 1]]);
    expect(bridge.roster.get(2)?.alive).toBe(false);
    expect(drainMsgs(romDrainIn)).toEqual([{ t: 'out', seat: 2 }]);
  });

  // The host's `win` names the winner: a guest that won dropped it as its own echo, and
  // never drew its results, recorded the match or saw its Hall of Fame.
  it('hears the host say anything about us: the win, the land, a ticker line', () => {
    const { socket, frame, romDrainIn, heard } = joined();
    const land = { t: 'land', seat: 2, map: { group: 0, num: 9 }, x: 4, y: 5 };
    const line = { t: 'ticker', seat: 2, kind: 'kill', text: 'ME BEAT MAY' };
    socket.receive({ type: 'recv', from: 1, m: { t: 'win', seat: 2 } });
    socket.receive({ type: 'recv', from: 1, m: land });
    socket.receive({ type: 'recv', from: 1, m: line });
    frame();
    expect(heard.map(([m, from]) => [m.t, from])).toEqual([['win', 1], ['land', 1], ['ticker', 1]]);
    expect(drainMsgs(romDrainIn).map((m) => m.t)).toEqual(['land', 'ticker']);
  });

  it('still drops a message naming us from anybody but the host', () => {
    const { socket, heard } = joined();
    // Before the first roster lists us, a report under our seat looks like a bot's.
    socket.receive({ type: 'recv', from: 7, m: { t: 'result', seat: 2, outcome: 'lose' } });
    expect(heard).toEqual([]);
  });
});

// POK-330 #20 and #7: a link battle's blocks go to the one seat being fought and are
// taken from it alone, once each, and a rejoin mid-fight neither forgets the opponent
// nor loses the block the blip swallowed.
/** The relay's roster for the room `joined()` sits in, with these seats in it. */
function roster(socket: { receive(msg: Record<string, unknown>): void }, ids: number[]): void {
  socket.receive({
    type: 'roster', code: 'ABC123', host: 1, open: true, max: 8, pass: false,
    members: ids.map((id) => ({ id, name: `P${id}` })),
  });
}

const block = (seat: number, seq: number, fight?: number) => ({ t: 'bt', seat, seq, data: [seq], ...(fight === undefined ? {} : { fight }) });
/** The fight a challenge starts (POK-331 #3): every block sent in it says so. */
const F = (challenger: number, nonce: number) => fightOf({ t: 'challenge', seat: challenger, opponent: 0, nonce });

describe('a link battle, across a blip (POK-330 #20, #7)', () => {

  it('drops a block when it knows no opponent, rather than telling the whole room', () => {
    const { romEmit, frame, socket, bridge } = joined();
    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    frame();
    expect(socket.sent).toEqual([]);
    expect(bridge.stats.drops).toBe(1);
  });

  it('carries the opponent, its lines and our last blocks into the Bridge a rejoin builds', () => {
    const { romEmit, frame, socket, bridge, relay, emu } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1, lines: { win: 'HA' } } });
    for (let seq = 1; seq <= BLOCKS_KEPT + 1; seq++) romEmit({ t: 'bt', seat: 0, seq, data: [seq] });
    frame();

    const carry = bridge.carry();
    bridge.dispose();
    const again = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2, carry });
    socket.sent.length = 0;
    again.resendBlocks();
    // The last few, to the opponent alone: never the room.
    expect(socket.sent).toEqual(
      Array.from({ length: BLOCKS_KEPT }, (_, i) => ({ type: 'to', id: 7, m: block(2, i + 2, F(7, 1)) })),
    );
    expect(again.linesFor(7)).toEqual({ win: 'HA' });

    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 9, data: [9] });
    frame();
    expect(socket.sent).toEqual([{ type: 'to', id: 7, m: block(2, 9, F(7, 1)) }]);
  });

  it('takes a block only from the seat it is fighting, and each one once', () => {
    const { socket, frame, romDrainIn, bridge } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    frame();
    romDrainIn(); // the challenge itself

    socket.receive({ type: 'recv', from: 9, m: block(9, 1) }); // another pair's fight
    socket.receive({ type: 'recv', from: 7, m: block(7, 1) });
    socket.receive({ type: 'recv', from: 7, m: block(7, 1) }); // said again after a gap
    socket.receive({ type: 'recv', from: 7, m: block(7, 2) });
    expect(readAcrossFrames(frame, romDrainIn)).toEqual([block(7, 1), block(7, 2)]);
    expect(bridge.stats.refused).toBe(1);
  });

  it('counts a new fight from one again', () => {
    const { socket, frame, romDrainIn, romEmit } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 1) });
    socket.receive({ type: 'recv', from: 7, m: block(7, 2) });
    romEmit({ t: 'result', seat: 0, outcome: 'lose' });
    frame();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 2 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 1) });
    expect(readAcrossFrames(frame, romDrainIn).filter((m) => m.t === 'bt')).toEqual([block(7, 1), block(7, 2), block(7, 1)]);
  });

  // POK-331 #3. A seat whose socket went across the end of one fight and a new challenge
  // between the same two seats said the last fight's blocks again on its way back, and the
  // new fight took the first of them as its own next.
  it('takes no block of the last fight between the same two seats into the next one', () => {
    const { socket, frame, romDrainIn, romEmit } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 1, F(7, 1)) });
    romEmit({ t: 'result', seat: 0, outcome: 'lose' });
    frame();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 2 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 3, F(7, 1)) }); // 7, back, saying fight 1's again
    socket.receive({ type: 'recv', from: 7, m: block(7, 1, F(7, 2)) });
    expect(readAcrossFrames(frame, romDrainIn).filter((m) => m.t === 'bt')).toEqual([block(7, 1), block(7, 1)]);
  });

  it('says its last blocks again when the opponent is back in the room', () => {
    const { romEmit, frame, socket } = joined();
    const roster = (ids: number[]) =>
      socket.receive({
        type: 'roster', code: 'ABC123', host: 1, open: true, max: 8, pass: false,
        members: ids.map((id) => ({ id, name: `P${id}` })),
      });
    romEmit({ t: 'challenge', seat: 0, opponent: 7, nonce: 1 });
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    frame();
    roster([1, 2, 9]); // 7's socket went: what we send now goes nowhere
    socket.sent.length = 0;
    roster([1, 2, 7, 9]);
    expect(socket.sent).toEqual([{ type: 'to', id: 7, m: block(2, 1, F(2, 1)) }]);
  });

  // The ROM says RESULT seconds after the last exchange. Forgetting our blocks then left an
  // opponent that lost our last one waiting on it for ever, on the fight's final turn.
  it('keeps its last blocks past its own result, for an opponent the blip cost the last one', () => {
    const { romEmit, frame, socket } = joined();
    romEmit({ t: 'challenge', seat: 0, opponent: 7, nonce: 1 });
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    romEmit({ t: 'bt', seat: 0, seq: 2, data: [2] });
    frame();
    roster(socket, [1, 2, 9]); // 7's socket goes over the last exchange...
    romEmit({ t: 'result', seat: 0, outcome: 'win' }); // ...and our ROM plays the ending out
    frame();
    socket.sent.length = 0;
    roster(socket, [1, 2, 7, 9]);
    expect(socket.sent).toEqual([
      { type: 'to', id: 7, m: block(2, 1, F(2, 1)) },
      { type: 'to', id: 7, m: block(2, 2, F(2, 1)) },
    ]);
  });

  it("lets them go once the opponent's result says it has played the fight out", () => {
    const { romEmit, frame, socket } = joined();
    romEmit({ t: 'challenge', seat: 0, opponent: 7, nonce: 1 });
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    frame();
    socket.receive({ type: 'recv', from: 7, m: { t: 'result', seat: 7, outcome: 'lose' } });
    roster(socket, [1, 2, 9]);
    socket.sent.length = 0;
    roster(socket, [1, 2, 7, 9]);
    expect(socket.sent).toEqual([]);
  });

  // br_netlink.c's HandleChallenge ignores a challenge while gBrNetlink.active. The page
  // did not: a third seat's challenge naming us mid-fight sent our blocks to it and
  // refused our real opponent's, and the fight deadlocked.
  it("ignores a third seat's challenge mid-fight, as the ROM does", () => {
    const { romEmit, frame, socket, romDrainIn } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 1) });
    socket.receive({ type: 'recv', from: 9, m: { t: 'challenge', seat: 9, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 2) });
    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    expect(readAcrossFrames(frame, romDrainIn).filter((m) => m.t === 'bt')).toEqual([block(7, 1), block(7, 2)]);
    expect(socket.sent).toEqual([{ type: 'to', id: 7, m: block(2, 1, F(7, 1)) }]);

    // Our RESULT is the end of it: the next challenge is a new fight.
    romEmit({ t: 'result', seat: 0, outcome: 'win' });
    frame();
    socket.receive({ type: 'recv', from: 9, m: { t: 'challenge', seat: 9, opponent: 2, nonce: 2 } });
    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    frame();
    expect(socket.sent).toEqual([{ type: 'to', id: 9, m: block(2, 1, F(9, 2)) }]);
  });

  it('takes the latest challenge until a block has moved, as a ROM that has not started does', () => {
    const { romEmit, frame, socket } = joined();
    // In a menu, the ROM parks the challenge, and a later one takes its place.
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 9, m: { t: 'challenge', seat: 9, opponent: 2, nonce: 1 } });
    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    frame();
    expect(socket.sent).toEqual([{ type: 'to', id: 9, m: block(2, 1, F(9, 1)) }]);
  });

  it('stands the fight down when the ROM is back on the map with no RESULT (the watchdog)', () => {
    const { romEmit, frame, socket } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] }); // our start block; 7 never answers
    romEmit({ t: 'busy', seat: 0 }); // br_netlink.c's TickWatchdog closed the link
    frame();
    socket.receive({ type: 'recv', from: 9, m: { t: 'challenge', seat: 9, opponent: 2, nonce: 1 } });
    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    frame();
    expect(socket.sent).toEqual([{ type: 'to', id: 9, m: block(2, 1, F(9, 1)) }]);
  });

  it('carries a fight in progress into the Bridge a rejoin builds', () => {
    const { frame, socket, bridge, relay, emu, romDrainIn } = joined();
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 1) });
    const carry = bridge.carry();
    bridge.dispose();
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2, carry, rom: bridge.rom });
    socket.receive({ type: 'recv', from: 9, m: { t: 'challenge', seat: 9, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 7, m: block(7, 2) });
    expect(readAcrossFrames(frame, romDrainIn).filter((m) => m.t === 'bt')).toEqual([block(7, 1), block(7, 2)]);
  });
});

// gBrNetlink where the fake ROM keeps it.
const NETLINK_AT = 0x02030000;
const SYMBOLS = new Map([['gBrNetlink', NETLINK_AT]]);
/** br_netlink.c's BrNetlink_StartBattle with `peer` (or its Close, with null). */
function link(ram: RamAccess, peer: number | null): void {
  ram.write(NETLINK_AT + NETLINK.OFF_ACTIVE, peer === null ? 0 : 1, 8);
  if (peer !== null) ram.write(NETLINK_AT + NETLINK.OFF_PEER_SEAT, peer, 8);
}

// POK-331 #5. The page learnt its ROM was in a fight from the first block to move, and the
// ROM starts one a second or more before that: a challenge that landed in between still
// pointed the page somewhere else. gBrNetlink says so from the frame the fight starts.
describe("the ROM's own word on the fight it is in (POK-331 #5)", () => {
  it("ignores a third seat's challenge once the ROM has started a fight, before any block has moved", () => {
    const { socket, frame, romDrainIn, romEmit, ram } = joined({ symbols: SYMBOLS });
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    frame();
    link(ram, 7); // HandleChallenge -> BrNetlink_StartBattle(1, 7)
    socket.receive({ type: 'recv', from: 9, m: { t: 'challenge', seat: 9, opponent: 2, nonce: 1 } });
    // 7's start block, before this page has run another frame: it is still 7's fight.
    socket.receive({ type: 'recv', from: 7, m: block(7, 1, F(7, 1)) });
    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    expect(readAcrossFrames(frame, romDrainIn).filter((m) => m.t === 'bt')).toEqual([block(7, 1)]);
    expect(socket.sent).toEqual([{ type: 'to', id: 7, m: block(2, 1, F(7, 1)) }]);
  });

  it('follows the ROM to the one it started when two challenges land together', () => {
    const { socket, frame, romDrainIn, romEmit, ram } = joined({ symbols: SYMBOLS });
    // Both before the ROM runs: on the field it starts on 7's and ignores 9's.
    socket.receive({ type: 'recv', from: 7, m: { t: 'challenge', seat: 7, opponent: 2, nonce: 1 } });
    socket.receive({ type: 'recv', from: 9, m: { t: 'challenge', seat: 9, opponent: 2, nonce: 4 } });
    link(ram, 7);
    socket.sent.length = 0;
    romEmit({ t: 'bt', seat: 0, seq: 1, data: [1] });
    frame();
    expect(socket.sent).toEqual([{ type: 'to', id: 7, m: block(2, 1, F(7, 1)) }]);
    socket.receive({ type: 'recv', from: 9, m: block(9, 1, F(9, 4)) });
    socket.receive({ type: 'recv', from: 7, m: block(7, 1, F(7, 1)) });
    expect(readAcrossFrames(frame, romDrainIn).filter((m) => m.t === 'bt')).toEqual([block(7, 1)]);
  });
});

describe("a bot's RESULT (POK-330 #20)", () => {
  it('keeps the seat of a bot that lost, and stamps ours on our own', () => {
    const { romEmit, frame, socket, bridge } = joined();
    bridge.roster.seatBots([{ seat: 31, name: 'MAX', skin: 0 }]);
    socket.sent.length = 0;
    // br_bot.c after we beat bot 31: our own RESULT, then one under the bot.
    romEmit({ t: 'result', seat: 0, outcome: 'win' });
    romEmit({ t: 'result', seat: 31, outcome: 'lose' });
    frame();
    expect(socket.sent).toEqual([
      { type: 'all', m: { t: 'result', seat: 2, outcome: 'win' } },
      { type: 'all', m: { t: 'result', seat: 31, outcome: 'lose' } },
    ]);
  });
});

// POK-330 #44. The room's messages queued for the ROM with no cap, and a tab in the
// background (no frames, the socket still delivering) came back to seconds of stale steps
// with every `out` behind them. The host's director had a second queue into the same ring.
describe('the feed into the ROM (POK-330 #44)', () => {
  /** Frames run and the ROM drains 16 slots after each, as BrNet_Tick does. */
  const run = (frame: () => void, romDrainIn: (n: number) => BinarySlot[], frames: number) => {
    const slots: BinarySlot[] = [];
    for (let i = 0; i < frames; i++) {
      frame();
      slots.push(...romDrainIn(16));
    }
    return slots;
  };
  /** Regroups raw in-ring slots into whole messages: a slot of one message between two of
   *  another's does not reassemble. */
  const messages = (slots: BinarySlot[]): Msg[] => {
    const out: Msg[] = [];
    for (let i = 0; i < slots.length; ) {
      const group = [slots[i++]];
      while (i < slots.length && (slots[i].type & BR_CONT_FLAG) !== 0) group.push(slots[i++]);
      out.push(decodeReassembled(group));
    }
    return out;
  };

  it("a tab back from the background hands the ROM the room's `out` within frames, not behind every step it missed", () => {
    const { emu, frame, romInit, romDrainIn } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2 });

    // A minute hidden: no frames, and three seats walking the whole time.
    for (let i = 0; i < 600; i++) {
      const seat = 5 + (i % 3);
      socket.receive({ type: 'recv', from: seat, m: { t: 'step', seat, d: 4, x: i, y: 1, map: { group: 0, num: 9 } } });
    }
    socket.receive({ type: 'recv', from: 9, m: { t: 'out', seat: 9 } });

    let frames = 0;
    const heard: Msg[] = [];
    while (!heard.some((m) => m.t === 'out') && frames < 60) {
      heard.push(...messages(run(frame, romDrainIn, 1)));
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(Math.ceil((POSITIONAL_CAP + 1) / 16) + 1);
    // ...and where each of them ended up is still in what it got.
    const lastX = (seat: number) => heard.filter((m): m is StepMsg => m.t === 'step' && m.seat === seat).at(-1)?.x;
    expect([5, 6, 7].map(lastX)).toEqual([597, 598, 599]);
  });

  it("the host's director and the room share one port, so neither splits the other's spill", () => {
    const { emu, frame, romInit, romDrainIn, ram } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const rom = new RomPort(new Mailbox(emu, BASE));
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2, rom });
    const spill = (seat: number): SpillMsg => ({
      t: 'spill',
      seat,
      map: { group: 0, num: 9 },
      mons: [1, 2, 3, 4, 5, 6].map((k) => ({ key: seat * 16 + k, x: k, y: 1, species: 277, level: 5 })),
      bag: { key: seat * 16, x: 1, y: 1, items: [{ id: 13, n: 1 }], money: 100 },
    });
    expect(packSlot(spill(9)).length).toBeGreaterThan(1);
    // One slot free: the bot's spill cannot go in whole yet.
    ram.write(BASE + MAILBOX.OFF_IN_HEAD, MAILBOX.RING_SLOTS - 1, 16);

    rom.push(spill(30)); // a bot, from the host's own director
    socket.receive({ type: 'recv', from: 9, m: spill(9) }); // a player, from the room
    frame();
    expect(romDrainIn(MAILBOX.RING_SLOTS)).toHaveLength(MAILBOX.RING_SLOTS - 1); // what filled it
    const got = messages(run(frame, romDrainIn, 4));
    expect(got.map((m) => (m as SpillMsg).seat)).toEqual([30, 9]);
  });

  it("a rejoin's Bridge hands the ROM what the last one had not got to", () => {
    const { emu, frame, romInit, romDrainIn, ram } = fakeEmulator(BASE);
    romInit();
    const { relay, socket } = fakeRelay();
    const rom = new RomPort(new Mailbox(emu, BASE));
    const first = new Bridge({ emu, mailboxBase: BASE, relay, seat: 2, rom });
    ram.write(BASE + MAILBOX.OFF_IN_HEAD, MAILBOX.RING_SLOTS, 16); // the ROM is behind
    socket.receive({ type: 'recv', from: 9, m: { t: 'out', seat: 9 } });
    frame();

    first.dispose();
    new Bridge({ emu, mailboxBase: BASE, relay, seat: 2, rom });
    ram.write(BASE + MAILBOX.OFF_IN_TAIL, MAILBOX.RING_SLOTS, 16);
    expect(messages(run(frame, romDrainIn, 1))).toEqual([{ t: 'out', seat: 9 }]);
  });
});
