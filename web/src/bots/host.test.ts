// The host's bots, on the real world.json, with the clock and the pump in the test's
// hands (POK-330 #42). Solo and the room both start them through createHostBots, so
// this is the one place their deal, their drop, their peek answer and their pump are
// pinned.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOT_TICK_MS, botGround, createHostBots, type HostBotsOptions } from './host';
import { STEP_MS } from './brain';
import { resumeAt } from './adapt';
import { dealBots } from './roster';
import { romCell } from './space';
import type { DirectorWorld } from '../match/director';
import { botRows } from '../match/lifecycle';
import { Loot } from '../match/loot';
import { NPC_FOG_TICK_MS, NPC_FOG_TICKS_TO_KILL } from '../match/npcfog';
import type { RosterEntry } from '../match/roster';
import { SAFARI_CELLS } from '../match/safari';
import { MAP_OFFSET } from '../net/cells';
import type { Msg, PlaceMsg } from '../net/wire';
import regionmapData from '../data/regionmap.json';
import TRAINERS from '../data/trainers.json';

const SEED = 20260916;
const SECTIONS = regionmapData.sections as DirectorWorld['sections'];
const GROUND = botGround();

/** A host with seat 0 taken and seven bots, its pump handed to nobody unless a test
 *  asks: a real setInterval here would outlive the test. */
function host(over: Partial<HostBotsOptions> = {}) {
  const sent: Msg[] = [];
  const to: { seat: number; msg: Msg }[] = [];
  const hb = createHostBots({
    send: (m) => sent.push(m),
    sendTo: (seat, msg) => to.push({ seat, msg }),
    takenSeats: [0],
    seed: SEED,
    fill: 7,
    loot: new Loot(),
    players: () => [],
    busy: () => false,
    sections: SECTIONS,
    now: () => 0,
    every: () => () => {},
    ...over,
  });
  return { hb, sent, to };
}

const places = (msgs: Msg[]): PlaceMsg[] => msgs.filter((m): m is PlaceMsg => m.t === 'place');
const where = (p: { seat: number; map?: unknown; x?: number; y?: number }) => ({ seat: p.seat, map: p.map, x: p.x, y: p.y });

afterEach(() => {
  vi.useRealTimers();
});

describe('the host deals its bots (POK-330 #42)', () => {
  it('deals the seed its bots, under the names the room gives them, and places each one as it deals', () => {
    const { hb, sent } = host();
    const dealt = dealBots(SEED, 7, [0], GROUND.spawns);
    expect(hb.seats).toEqual(dealt.map((b) => b.seat));
    // The roster names them off botRows (#51): it has to be the same field.
    const rows = botRows(SEED, hb.seats);
    expect(rows.map((r) => r.name)).toEqual(dealt.map((b) => b.name));
    // Before createHostBots returns: the room hears where they are straight away.
    const placed = places(sent);
    expect(placed.map(where)).toEqual(dealt.map(where));
    expect(placed.map((p) => p.sprite)).toEqual(rows.map((r) => String(r.skin)));
  });

  it('starts them in the Zone through the opening, and the drop sends each to its landing cell once', () => {
    const { hb, sent } = host({ safariSecs: 120 });
    const zone = new Set(SAFARI_CELLS.map((c) => c.map));
    const start = places(sent);
    expect(start).toHaveLength(7);
    for (const p of start) expect(zone.has(GROUND.idOf(p.map!) ?? '')).toBe(true);

    sent.length = 0;
    hb.drop();
    // The cells the seed deals out in Hoenn: the same bots, only standing elsewhere.
    expect(places(sent).map(where)).toEqual(dealBots(SEED, 7, [0], GROUND.spawns).map(where));
    sent.length = 0;
    hb.drop();
    expect(sent).toEqual([]);
  });

  it('picks up a match it did not deal: the same field, less whoever is out, stood where the room saw them', () => {
    const dealt = dealBots(SEED, 7, [0], GROUND.spawns);
    const botSeats = dealt.map((b) => b.seat);
    const [gone, moved] = botSeats;
    // Last seen on another bot's cell, which the roster holds in the wire's space.
    const there = dealt[3];
    const seen = { map: there.map, ...romCell(there.x + MAP_OFFSET, there.y + MAP_OFFSET) };
    const { hb, sent } = host({
      fill: 0,
      resume: { botSeats, humanSeats: [0], out: new Set([gone]), where: (seat) => (seat === moved ? seen : undefined) },
    });
    const standing = dealt.filter((b) => b.seat !== gone);
    expect(hb.seats).toEqual(standing.map((b) => b.seat));
    const placed = places(sent);
    // Same seats and skins as the deal, so the same bots under the same names.
    expect(placed.map((p) => p.sprite)).toEqual(standing.map((b) => String(b.skin)));
    const at = resumeAt(dealt[1], seen, GROUND.idOf);
    expect(where(placed.find((p) => p.seat === moved)!)).toEqual(where(at));
    for (const b of standing) if (b.seat !== moved) expect(where(placed.find((p) => p.seat === b.seat)!)).toEqual(where(b));
    expect(hb.partyFor(gone)).toBeNull();
  });

  it('answers a peek about its own bots and nobody else', () => {
    const { hb } = host();
    expect(hb.partyFor(0)).toBeNull(); // the player's seat
    expect(hb.partyFor(3)).toBeNull(); // nobody's
    const seat = hb.seats[0];
    expect(hb.bots.partyOf(seat).length).toBeGreaterThan(0);
    expect(hb.partyFor(seat)).toMatchObject({
      t: 'party',
      seat,
      mons: hb.bots.partyOf(seat),
      bag: { money: hb.bots.moneyOf(seat) },
    });
  });

  it('asks who is busy when a bot looks, not when it was dealt (POK-230)', () => {
    const bot = dealBots(SEED, 7, [0], GROUND.spawns)[0];
    // One cell north of the first bot, facing it: in the eyeline the moment it looks.
    const me: RosterEntry = {
      seat: 0, name: 'CAM', alive: true, map: bot.map, x: bot.x + MAP_OFFSET, y: bot.y - 1 + MAP_OFFSET, dir: 1, isMe: true,
    };
    const cardsFor = (fightingWhenItLooks: boolean): number => {
      let fighting = true;
      const busy = vi.fn(() => fighting);
      const { hb, to } = host({ players: () => [me], busy });
      expect(busy).not.toHaveBeenCalled();
      fighting = fightingWhenItLooks;
      hb.tick(STEP_MS);
      expect(busy).toHaveBeenCalledWith(0);
      return to.filter((c) => c.seat === 0 && c.msg.t === 'trainer').length;
    };
    expect(cardsFor(true)).toBe(0);
    expect(cardsFor(false)).toBeGreaterThan(0);
  });

  it('pumps every BOT_TICK_MS on the clock it is handed, and stops when disposed', () => {
    let t = 0;
    let pump: (() => void) | undefined;
    const stop = vi.fn();
    const every = vi.fn((fn: () => void, _ms: number) => {
      pump = fn;
      return stop;
    });
    const { hb, sent } = host({ now: () => t, every });
    expect(every).toHaveBeenCalledTimes(1);
    expect(every.mock.calls[0][1]).toBe(BOT_TICK_MS);
    const before = hb.bots.positions();
    for (let i = 1; i <= 20; i++) {
      t = i * STEP_MS;
      pump!();
    }
    expect(sent.some((m) => m.t === 'step')).toBe(true);
    expect(hb.bots.positions()).not.toEqual(before);
    expect(stop).not.toHaveBeenCalled();
    hb.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('leaves no timer behind once disposed, on the default pump (#13)', () => {
    vi.useFakeTimers();
    const { hb } = host({ every: undefined, now: undefined });
    expect(vi.getTimerCount()).toBe(1);
    hb.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the fog\'s trainers under the first taken seat, and says so in one line (POK-299)', () => {
    const everyone = Object.entries(TRAINERS as Record<string, number[]>)
      .filter(([id]) => GROUND.refById.has(id))
      .reduce((n, [, ids]) => n + ids.length, 0);
    const fog = (opening: boolean) => {
      const { hb, sent } = host({ fill: 0, takenSeats: [2], safariSecs: opening ? 120 : 0 });
      hb.setRing({ sx: 0, sy: 0, r: -1 }, 6); // the last phase: fog on everything
      for (let i = 0; i <= NPC_FOG_TICKS_TO_KILL; i++) hb.tick(i * NPC_FOG_TICK_MS);
      return sent;
    };
    // Nobody's trainers go while everybody is still in the Zone.
    expect(fog(true)).toEqual([]);
    const sent = fog(false);
    const outs = sent.filter((m) => m.t === 'npcout');
    expect(outs).toHaveLength(everyone);
    expect(outs.every((m) => m.seat === 2 && m.fog === true)).toBe(true);
    expect(sent.filter((m) => m.t === 'ticker')).toHaveLength(1);
    expect(sent.at(-1)).toMatchObject({ t: 'ticker', seat: 2 });
  });
});
