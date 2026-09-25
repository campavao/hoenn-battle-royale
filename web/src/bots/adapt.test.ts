import { describe, expect, it } from 'vitest';
import { Bots, STEP_MS, type PlayerView } from './brain';
import { routeToBots } from './adapt';
import { dealBots } from './roster';
import { World, type WorldMap } from './world';
import { mulberry32 } from '../match/clock';
import { Bridge, type EmulatorLike } from '../net/bridge';
import { MAILBOX } from '../net/mailbox';
import { packSlot } from '../net/slots';
import { RelayClient, type WebSocketLike } from '../net/relay';
import { PROTOCOL, type Msg, type PackedMon } from '../net/wire';

// The bot's side of a fight is only ever heard: the ROM that ran it reports, the Bridge
// stamps what it can, and routeToBots is the one door into the brain. These run the
// real Bridge in front of it, because the stamp is where a bot that won used to get
// lost -- the ROM's `result` for the bot's seat reached the host under the player's.

const OPEN = '6x0;6x0;6x0;6x0;6x0;6x0';
const FIELD: WorldMap = { id: 'FIELD', group: 0, num: 1, w: 6, h: 6, section: 'S', outdoor: true, grid: OPEN, seams: [] };
const REF = { group: 0, num: 1 };
const HOST = 0;
const BASE = 0x0203d178;

const MON: PackedMon = {
  species: 277, level: 5, hp: 19, maxHp: 19, status: 0,
  moves: [{ id: 1, pp: 35, ppUps: 0 }],
  heldItem: 0, otId: 0, personality: 0, exp: 0, nickname: 'TREECKO', ot: 'BR',
};

class Socket implements WebSocketLike {
  readyState = 1;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

/** A GBA that is nothing but a mailbox: `emit` is the ROM's BrNet sending, `frame` is
 *  the frame end the Bridge polls on. */
function rom() {
  const mem = new Uint8Array(0x40000);
  const at = (addr: number) => addr - 0x02000000;
  const read = (addr: number, width: 8 | 16 | 32) => {
    let v = 0;
    for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | mem[at(addr) + i];
    return v >>> 0;
  };
  const write = (addr: number, value: number, width: 8 | 16 | 32) => {
    for (let i = 0; i < width / 8; i++) mem[at(addr) + i] = (value >>> (8 * i)) & 0xff;
  };
  let listeners: (() => void)[] = [];
  const emu: EmulatorLike = {
    read,
    write,
    bytes: (addr, len) => mem.subarray(at(addr), at(addr) + len),
    onFrame(l) {
      listeners.push(l);
      return () => {
        listeners = listeners.filter((x) => x !== l);
      };
    },
  };
  write(BASE + MAILBOX.OFF_PROTOCOL, PROTOCOL, 16);
  write(BASE + MAILBOX.OFF_PATCH, 1, 16);
  write(BASE + MAILBOX.OFF_SIZE, MAILBOX.SIZE, 16);
  write(BASE + MAILBOX.OFF_MAGIC, MAILBOX.MAGIC, 16);
  const emit = (msg: Msg) => {
    for (const slot of packSlot(msg)) {
      const head = read(BASE + MAILBOX.OFF_OUT_HEAD, 16);
      const addr = BASE + MAILBOX.OFF_OUT + (head % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      write(addr, slot.type, 8);
      write(addr + 1, slot.payload.length, 8);
      mem.set(slot.payload, at(addr + 2));
      write(BASE + MAILBOX.OFF_OUT_HEAD, (head + 1) & 0xffff, 16);
    }
  };
  return { emu, emit, frame: () => listeners.forEach((l) => l()) };
}

/** The host: its own ROM behind a Bridge, one bot, and the host's own trainer standing
 *  two tiles below the bot, in its eyeline. The Bridge's observer is wired the way
 *  app.ts wires it. */
function host() {
  const sent: Msg[] = [];
  const me: PlayerView = { seat: HOST, mapId: 'FIELD', x: 1, y: 3, dir: 2 };
  const bots = new Bots({
    world: new World([FIELD]),
    targets: [{ mapId: 'FIELD', x: 4, y: 4 }, { mapId: 'FIELD', x: 0, y: 5 }],
    mapRef: () => REF,
    send: (m) => void sent.push(m),
    rng: mulberry32(7),
    engage: { players: () => [me] },
    deal: () => [{ ...MON }],
  });
  const dealt = dealBots(1, 1, [HOST], [{ mapId: 'FIELD', map: REF, x: 1, y: 1 }]);
  const bot = dealt[0].seat;
  bots.start(dealt, 0);

  const gba = rom();
  const relay = new RelayClient(() => new Socket());
  relay.connect('ws://relay.test');
  const bridge = new Bridge({ emu: gba.emu, mailboxBase: BASE, relay, seat: HOST });
  bridge.setOutObserver((msg) => routeToBots(bots, msg, bridge.seat));

  let now = 0;
  const run = (ms: number) => {
    for (const end = now + ms; now < end; ) bots.tick((now += STEP_MS));
  };
  run(1000);
  // It saw us and challenged: the fight is ours to run, and it stands still for it.
  expect(sent.some((m) => m.t === 'challenge' && m.seat === bot && m.opponent === HOST)).toBe(true);
  me.busy = true; // our ROM says so with `busy` a beat later
  run(3000);
  return { bots, bot, sent, gba, run, me };
}

const released = (sent: Msg[], seat: number) => sent.some((m) => m.t === 'busy' && m.seat === seat && m.kind === undefined);

describe('a fight with a bot, as its ROM reports it', () => {
  it('lets a bot that won walk again (POK-330 #8)', () => {
    const { bots, bot, sent, gba, run, me } = host();
    expect(released(sent, bot)).toBe(false);

    // br_bot.c's return from a fight the bot won: its team, what it spent, and our own
    // RESULT -- no result under the bot's seat, because the bot did not lose.
    gba.emit({ t: 'party', seat: bot, mons: [{ ...MON, hp: 7 }] });
    gba.emit({ t: 'spent', seat: bot, items: [] });
    gba.emit({ t: 'result', seat: HOST, outcome: 'lose' });
    gba.frame();
    // ...and we walk off, out of its eyeline, so what moves it next is its own legs.
    Object.assign(me, { busy: false, mapId: 'ELSEWHERE' });

    expect(released(sent, bot)).toBe(true);
    expect(bots.partyOf(bot)[0].hp).toBe(7);
    const before = bots.spotOf(bot);
    run(5000);
    expect(bots.spotOf(bot)).not.toEqual(before);
  });

  it('hears the result the ROM wrote under the bot, which arrives under the player (POK-330 #8)', () => {
    const { bot, sent, gba } = host();
    // The Bridge stamps it with our seat on the way out -- which is what the host used
    // to hand noteResult, where it matched nothing.
    gba.emit({ t: 'result', seat: bot, outcome: 'lose' });
    gba.frame();
    expect(released(sent, bot)).toBe(true);
  });

  it('takes a report on the fight only from the seat that fought it (POK-330 #8)', () => {
    const { bots, bot, sent } = host();
    const wiped = [{ ...MON, hp: 0 }];

    routeToBots(bots, { t: 'party', seat: bot, mons: wiped }, 5);
    routeToBots(bots, { t: 'result', seat: 5, outcome: 'win' }, 5);
    expect(bots.count()).toBe(1);
    expect(released(sent, bot)).toBe(false);

    routeToBots(bots, { t: 'party', seat: bot, mons: wiped }, HOST);
    expect(sent.some((m) => m.t === 'out' && m.seat === bot)).toBe(true);
    expect(bots.count()).toBe(0);
  });

  // Solo has no Bridge and no relay: runSolo drains its ROM itself and hands every
  // message here as the ROM wrote it, from seat 0 (POK-330 #17).
  describe('in solo, where nothing stamps the ROM', () => {
    function solo() {
      const sent: Msg[] = [];
      const cards: Msg[] = [];
      const me: PlayerView = { seat: HOST, mapId: 'ELSEWHERE', x: 1, y: 3, dir: 2 };
      const bots = new Bots({
        world: new World([FIELD]),
        targets: [{ mapId: 'FIELD', x: 4, y: 4 }],
        mapRef: () => REF,
        send: (m) => void sent.push(m),
        sendTo: (seat, m) => void (seat === HOST && cards.push(m)),
        rng: mulberry32(7),
        engage: { players: () => [me] },
        deal: () => [{ ...MON }],
        bagFor: () => [{ id: 13, n: 2 }],
      });
      const dealt = dealBots(1, 1, [HOST], [{ mapId: 'FIELD', map: REF, x: 1, y: 1 }]);
      bots.start(dealt, 0);
      bots.tick(STEP_MS);
      return { bots, bot: dealt[0].seat, sent, cards, me };
    }

    it('stages the card when we spot the bot first', () => {
      const { bots, bot, cards } = solo();
      routeToBots(bots, { t: 'challenge', seat: HOST, opponent: bot, nonce: 1 }, HOST);
      expect(cards).toHaveLength(1);
      expect((cards[0] as { seat: number }).seat).toBe(bot);
    });

    it('puts out a bot we beat, and spills what it had', () => {
      const { bots, bot, sent } = solo();
      routeToBots(bots, { t: 'challenge', seat: HOST, opponent: bot, nonce: 1 }, HOST);
      // br_bot.c's report when the bot lost, unstamped: both RESULTs keep their seats.
      routeToBots(bots, { t: 'party', seat: bot, mons: [{ ...MON, hp: 0 }] }, HOST);
      routeToBots(bots, { t: 'spent', seat: bot, items: [13] }, HOST);
      routeToBots(bots, { t: 'result', seat: HOST, outcome: 'win' }, HOST);
      routeToBots(bots, { t: 'result', seat: bot, outcome: 'lose' }, HOST);
      expect(sent.some((m) => m.t === 'spill' && m.seat === bot)).toBe(true);
      expect(sent.some((m) => m.t === 'out' && m.seat === bot)).toBe(true);
      expect(bots.count()).toBe(0);
    });

    it('lets a bot that beat us walk on, a potion lighter', () => {
      const { bots, bot, sent } = solo();
      routeToBots(bots, { t: 'challenge', seat: HOST, opponent: bot, nonce: 1 }, HOST);
      routeToBots(bots, { t: 'party', seat: bot, mons: [{ ...MON, hp: 4 }] }, HOST);
      routeToBots(bots, { t: 'spent', seat: bot, items: [13] }, HOST);
      routeToBots(bots, { t: 'result', seat: HOST, outcome: 'lose' }, HOST);
      expect(released(sent, bot)).toBe(true);
      expect(bots.bagOf(bot)).toEqual([{ id: 13, n: 1 }]);
      expect(bots.partyOf(bot)[0].hp).toBe(4);
    });
  });

  it('answers a challenge only from the challenger itself', () => {
    const { bots, bot, sent } = host();
    routeToBots(bots, { t: 'party', seat: bot, mons: [{ ...MON }] }, HOST); // the first fight is over
    const cards = () => sent.filter((m) => m.t === 'trainer').length;
    const before = cards();

    routeToBots(bots, { t: 'challenge', seat: 3, opponent: bot, nonce: 1 }, 5);
    expect(cards()).toBe(before);
    routeToBots(bots, { t: 'challenge', seat: 3, opponent: bot, nonce: 1 }, 3);
    expect(cards()).toBe(before + 1);
  });
});
