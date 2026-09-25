import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOT_FILL, botFillFor, canStart, clockLeftAt, dealable, decideStart, doorOf, fillLabel, FOG_STEPS, MAX_STEPS, nextDoor, nextFog, nextMax, nextTextSpeed, onRefused, roomView, startNote, textSpeedLabel, nextSafari, safariLabel, StartCountdown, startLabel, type StartState } from './room';
import { freshMatch, noteMatch, ringClockLeft } from './lifecycle';
import { Director, type DirectorWorld } from './director';
import type { RosterEvent } from '../net/relay';
import type { Msg } from '../net/wire';

const roster = (over: Partial<RosterEvent> = {}): RosterEvent => ({
  code: 'ABC123',
  host: 1,
  open: true,
  max: 8,
  pass: false,
  members: [
    { id: 1, name: 'BRENDAN' },
    { id: 2, name: 'MAY' },
  ],
  ...over,
});

describe('the room as everyone sees it', () => {
  it('counts trainers, not spectators', () => {
    const view = roomView(roster({ members: [{ id: 1, name: 'A' }, { id: 2, name: 'B', spectate: true }] }), 1, false);
    expect(view.players).toBe(1);
    expect(view.members).toHaveLength(2);
  });

  it('knows whose room it is, and marks you in it', () => {
    expect(roomView(roster(), 1, false).isHost).toBe(true);
    const guest = roomView(roster(), 2, false);
    expect(guest.isHost).toBe(false);
    expect(guest.members.find((m) => m.isMe)?.name).toBe('MAY');
  });

  it('fills the empty seats with bots, and none when FILL is off', () => {
    expect(roomView(roster({ max: 8 }), 1, true).fill).toBe(6);
    expect(roomView(roster({ max: 8 }), 1, false).fill).toBe(0);
    // Never negative: a room fuller than MAX (the host turned it down) deals nobody.
    expect(roomView(roster({ max: 2, members: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }] }), 1, true).fill).toBe(0);
  });
});

describe('MAX past the relay\'s sixteen humans (POK-330 #29)', () => {
  it('shows and fills to the seats asked for, not the humans the relay seats', () => {
    const view = roomView(roster({ max: 16, seats: 30 }), 1, true);
    expect(view.max).toBe(30);
    expect(view.fill).toBe(28);
    expect(startNote(view)).toBe('START: 2 trainers and 28 bots.');
    // ...and the ladder moves on from 30, instead of sticking at 16
    expect(nextMax(view.max)).toBe(MAX_STEPS[0]);
    expect(nextMax(roomView(roster({ max: 16, seats: 16 }), 1, true).max)).toBe(20);
  });

  it('reads an older relay\'s max as both', () => {
    const view = roomView(roster({ max: 8 }), 1, true);
    expect(view.max).toBe(8);
    expect(view.fill).toBe(6);
  });
});

describe('the host controls', () => {
  it('cycle MAX up the ladder and round', () => {
    expect(nextMax(2)).toBe(4);
    expect(nextMax(MAX_STEPS[MAX_STEPS.length - 1])).toBe(MAX_STEPS[0]);
    expect(nextMax(7)).toBe(MAX_STEPS[0]); // a value off the ladder starts it over
  });

  it('cycle the door through listed, unlisted, passcoded', () => {
    expect(doorOf({ open: true, pass: false })).toBe('open');
    expect(doorOf({ open: false, pass: false })).toBe('private');
    expect(doorOf({ open: true, pass: true })).toBe('pass');
    expect(nextDoor('open')).toBe('private');
    expect(nextDoor('private')).toBe('pass');
    expect(nextDoor('pass')).toBe('open');
  });
});

describe('START', () => {
  it('is the host\'s and needs somebody to play against', () => {
    const alone = roomView(roster({ members: [{ id: 1, name: 'A' }] }), 1, false);
    expect(canStart(alone)).toBe(false);
    expect(startNote(alone)).toContain('FILL');
    expect(canStart(roomView(roster({ members: [{ id: 1, name: 'A' }] }), 1, true))).toBe(true);
    expect(canStart(roomView(roster(), 2, true))).toBe(false); // not the host
  });

  it('says what it would make', () => {
    expect(startNote(roomView(roster({ max: 8 }), 1, true))).toBe('START: 2 trainers and 6 bots.');
    expect(startNote(roomView(roster({ max: 2 }), 1, true))).toBe('START: 2 trainers.');
    expect(startNote(roomView(roster(), 2, true))).toContain('Waiting for the host');
  });
});

// Seven places in app.ts decided whether a match starts, each with its own copy of the
// rule. One rule per trigger now, each the condition its site wrote, quirks included.
describe('when a match starts (POK-330 #42)', () => {
  const page = (over: Partial<StartState> = {}): StartState => ({
    mode: 'quick',
    autoStarts: true,
    isHost: true,
    roomStarted: false,
    countingDown: false,
    played: false,
    match: freshMatch(),
    ...over,
  });
  const inFlight = { active: true, ended: false, seed: 7 };

  it('a quick or daily host counts down when it attaches, and a guest does not', () => {
    expect(decideStart({ t: 'attached' }, page({ isHost: false }))).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'attached' }, page({ mode: 'quick' }))).toEqual({ do: 'count-down' });
    expect(decideStart({ t: 'attached' }, page({ mode: 'daily' }))).toEqual({ do: 'count-down' });
  });

  // An attach looked at no count already running, nor at a match already on: every rejoin
  // counted down again, mid-match included (POK-331 #13).
  it('an attach into a match, one that has been won, or a count already running counts nothing', () => {
    expect(decideStart({ t: 'attached' }, page({ roomStarted: true, match: inFlight }))).toEqual({ do: 'nothing' });
    // a host back from a blip mid-match: the room screen was never down on its page
    expect(decideStart({ t: 'attached' }, page({ match: inFlight }))).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'attached' }, page({ roomStarted: true, match: { ...inFlight, ended: true } }))).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'attached' }, page({ countingDown: true }))).toEqual({ do: 'nothing' });
  });

  it('neither the buzzer nor a count that ran out deals over a match that is on', () => {
    expect(decideStart({ t: 'roster', members: [1, 2, 3] }, page({ match: inFlight }))).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'countdown' }, page({ match: inFlight }))).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'countdown' }, page({ match: { ...inFlight, ended: true } }))).toEqual({ do: 'nothing' });
  });

  it('a hosted, joined or watched room never counts down or buzzes, nor any under #noauto', () => {
    for (const s of [page({ mode: 'host' }), page({ mode: 'join' }), page({ mode: 'watch' }), page({ autoStarts: false })]) {
      expect(decideStart({ t: 'attached' }, s), s.mode).toEqual({ do: 'nothing' });
      expect(decideStart({ t: 'promoted', members: [1, 2] }, s), s.mode).toEqual({ do: 'nothing' });
      expect(decideStart({ t: 'roster', members: [1, 2, 3] }, s), s.mode).toEqual({ do: 'nothing' });
    }
  });

  it('an heir before any match counts a quick room down, unless it is on or counting already', () => {
    expect(decideStart({ t: 'promoted', members: [2] }, page())).toEqual({ do: 'count-down' });
    expect(decideStart({ t: 'promoted', members: [2] }, page({ countingDown: true }))).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'promoted', members: [2] }, page({ roomStarted: true }))).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'promoted', members: [2] }, page({ mode: 'host' })), 'a hosted room waits for START').toEqual({ do: 'nothing' });
  });

  it('an heir mid-match takes it over, and leaves one that has been won', () => {
    for (const mode of ['quick', 'host'] as const) {
      expect(decideStart({ t: 'promoted', members: [2, 3] }, page({ mode, match: inFlight }))).toEqual({ do: 'take-over', members: [2, 3] });
    }
    expect(decideStart({ t: 'promoted', members: [2, 3] }, page({ match: { ...inFlight, ended: true } }))).toEqual({ do: 'nothing' });
  });

  // The #42 split pinned a deal: a new `start` under every ROM in the room, mid-match,
  // fresh seed and fresh bots (POK-331 #13). The seed is what a match is picked up from.
  it('an heir that never heard the match dealt (a watcher) hands the room on rather than dealing one', () => {
    const unheard = { ...inFlight, seed: 0 };
    for (const mode of ['quick', 'host'] as const) {
      expect(decideStart({ t: 'promoted', members: [2, 3] }, page({ mode, match: unheard }))).toEqual({ do: 'step-aside' });
    }
    expect(decideStart({ t: 'host-again', members: [1, 2] }, page({ mode: 'host', match: unheard }))).toEqual({ do: 'step-aside' });
  });

  it('a host back from its own drop takes its match back', () => {
    expect(decideStart({ t: 'host-again', members: [1, 2] }, page({ mode: 'host', match: inFlight }))).toEqual({ do: 'take-over', members: [1, 2] });
  });

  it('a quick room deals once two are in it, and a hosted one waits for START (POK-320)', () => {
    expect(decideStart({ t: 'roster', members: [1] }, page())).toEqual({ do: 'nothing' });
    expect(decideStart({ t: 'roster', members: [1, 2] }, page())).toEqual({ do: 'deal', members: [1, 2] });
    expect(decideStart({ t: 'roster', members: [1, 2] }, page({ mode: 'host' }))).toEqual({ do: 'nothing' });
  });

  it('START, a countdown running out, and solo deal', () => {
    expect(decideStart({ t: 'start', members: [1, 4] }, page({ mode: 'host' }))).toEqual({ do: 'deal', members: [1, 4] });
    expect(decideStart({ t: 'start' }, page({ mode: 'host' }))).toEqual({ do: 'deal' });
    expect(decideStart({ t: 'countdown' }, page())).toEqual({ do: 'deal' });
    expect(decideStart({ t: 'solo' }, page({ mode: 'solo' }))).toEqual({ do: 'deal' });
  });

  // The #42 split pinned this as it was: back from a match nothing counted a quick room
  // down, so a room of one never started again unless its host pressed START, and one of
  // two or more dealt on its next roster at once, results still up (POK-331 #13). Kanto's
  // rematch (POK-167): the first lobby starts itself, the next match is READY UP's.
  describe('back in a room that starts itself after a match: READY UP', () => {
    const back = (over: Partial<StartState> = {}) => page({ played: true, match: freshMatch(), ...over });

    it('neither buzzes, counts down on an attach, nor counts down for an heir', () => {
      expect(decideStart({ t: 'roster', members: [1, 2] }, back())).toEqual({ do: 'nothing' });
      expect(decideStart({ t: 'roster', members: [1, 2, 3, 4] }, back({ mode: 'daily' }))).toEqual({ do: 'nothing' });
      expect(decideStart({ t: 'attached' }, back())).toEqual({ do: 'nothing' });
      expect(decideStart({ t: 'promoted', members: [2] }, back())).toEqual({ do: 'nothing' });
    });

    it("START arms the first lobby's count, and START inside it deals at once", () => {
      expect(startLabel(back())).toBe('READY UP');
      expect(decideStart({ t: 'start', members: [1] }, back())).toEqual({ do: 'count-down' });
      // a quick room of one restarts: the count runs out and deals
      expect(decideStart({ t: 'countdown' }, back({ countingDown: false }))).toEqual({ do: 'deal' });
      const counting = back({ countingDown: true });
      expect(startLabel(counting)).toBe('START');
      expect(decideStart({ t: 'start', members: [1, 2] }, counting)).toEqual({ do: 'deal', members: [1, 2] });
    });

    it('a hosted room, or any under #noauto, deals on START as it always has', () => {
      for (const s of [back({ mode: 'host' }), back({ autoStarts: false })]) {
        expect(startLabel(s)).toBe('START');
        expect(decideStart({ t: 'start', members: [1, 2] }, s)).toEqual({ do: 'deal', members: [1, 2] });
      }
    });

    it('the first lobby is unchanged: it starts itself, and START deals', () => {
      expect(startLabel(page())).toBe('START');
      expect(decideStart({ t: 'start', members: [1] }, page())).toEqual({ do: 'deal', members: [1] });
      expect(decideStart({ t: 'roster', members: [1, 2] }, page())).toEqual({ do: 'deal', members: [1, 2] });
    });
  });
});

// It was a bare setTimeout per count and a one-second redraw for the page's life, and
// neither was ever cleared (POK-331 #13).
describe("a room's countdown to its own start", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const counting = () => {
    const clock = { t: 0 };
    const redraw = vi.fn();
    const go = vi.fn();
    const count = new StartCountdown({ ms: 10_000, redraw, now: () => clock.t });
    const pass = (ms: number) => {
      clock.t += ms;
      vi.advanceTimersByTime(ms);
    };
    return { count, redraw, go, pass };
  };

  it('counts whole seconds down to the start, redrawing each one, and is over before it deals', () => {
    const { count, redraw, go, pass } = counting();
    expect(count.running).toBe(false);
    expect(count.secondsLeft()).toBeNull();
    let seenRunning: boolean | null = null;
    go.mockImplementation(() => (seenRunning = count.running));
    count.arm(go);
    expect(count.secondsLeft()).toBe(10);
    pass(2_500);
    expect(count.secondsLeft()).toBe(8);
    expect(redraw).toHaveBeenCalledTimes(2);
    pass(7_500);
    expect(go).toHaveBeenCalledTimes(1);
    expect(seenRunning).toBe(false); // what `go` asks sees no count running
    expect(vi.getTimerCount()).toBe(0); // and nothing left ticking
    pass(10_000);
    expect(redraw).toHaveBeenCalledTimes(9);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('a start some other way lets go of the count and its redraw, and the count never deals', () => {
    const { count, redraw, go, pass } = counting();
    count.arm(go);
    pass(3_000);
    count.cancel(); // START pressed inside the count, or the page stood down
    expect(count.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    pass(60_000);
    expect(go).not.toHaveBeenCalled();
    expect(redraw).toHaveBeenCalledTimes(3);
  });

  it('counts one count at a time: arming again starts over', () => {
    const { count, go, pass } = counting();
    count.arm(go);
    pass(6_000);
    count.arm(go);
    expect(vi.getTimerCount()).toBe(2); // one timer, one redraw
    pass(6_000);
    expect(go).not.toHaveBeenCalled();
    pass(4_000);
    expect(go).toHaveBeenCalledTimes(1);
  });
});

describe('how many bots the host fills to', () => {
  it('fills to the seats asked for, past the relay\'s sixteen humans (POK-330 #29)', () => {
    expect(botFillFor({ max: 16, seats: 30 }, 2, true)).toBe(28);
  });

  it('reads an older relay\'s max, and the default with no roster at all', () => {
    expect(botFillFor({ max: 8 }, 3, true)).toBe(5);
    expect(botFillFor(null, 1, true)).toBe(BOT_FILL - 1);
  });

  it('is never negative', () => {
    expect(botFillFor({ max: 2 }, 3, true)).toBe(0);
    expect(botFillFor({ max: 16, seats: 4 }, 6, true)).toBe(0);
  });

  // The room screen said FILL OFF and drew no bot seats, and START dealt six bots anyway:
  // the deal read MAX and never the control (POK-331 #8). Kanto's botsAtStart: nothing to
  // fill to while FILL is off.
  it('deals none with FILL off, whatever MAX says', () => {
    expect(botFillFor({ max: 8 }, 2, false)).toBe(0);
    expect(botFillFor({ max: 16, seats: 30 }, 1, false)).toBe(0);
    expect(botFillFor(null, 1, false)).toBe(0);
    // ...and the room screen draws what START deals
    const off = roomView(roster({ max: 8 }), 1, false);
    expect(off.fill).toBe(botFillFor(roster({ max: 8 }), off.players, false));
    const on = roomView(roster({ max: 16, seats: 30 }), 1, true);
    expect(on.fill).toBe(botFillFor(roster({ max: 16, seats: 30 }), on.players, true));
  });

  it('refuses a deal nobody could win, bots counted, however it is asked for (Kanto POK-197)', () => {
    // a quick room of one with FILL off counts itself down to exactly this
    expect(dealable(1, botFillFor({ max: 8 }, 1, false))).toBe(false);
    expect(dealable(1, botFillFor({ max: 8 }, 1, true))).toBe(true);
    expect(dealable(2, 0)).toBe(true);
    expect(dealable(0, 1)).toBe(false);
  });
});

describe('the FILL control (POK-331 #8)', () => {
  it('says what the host set: the bots START would deal, or OFF', () => {
    expect(fillLabel(roomView(roster({ max: 8 }), 1, true))).toBe('FILL 6');
    expect(fillLabel(roomView(roster({ max: 8 }), 1, false))).toBe('FILL OFF');
  });

  it('reads ON for a room full to MAX, so pressing it turns FILL off rather than on', () => {
    const full = roomView(roster({ max: 2 }), 1, true);
    expect(full.fill).toBe(0);
    expect(fillLabel(full)).toBe('FILL 0');
  });
});

describe('the match options', () => {
  it('cycle the three text speeds the ROM knows, and name them', () => {
    expect(nextTextSpeed(1)).toBe(3);
    expect(nextTextSpeed(5)).toBe(1);
    expect(textSpeedLabel(5)).toBe('FAST');
  });

  it('cycle the fog length and wrap', () => {
    expect(nextFog(FOG_STEPS[0])).toBe(FOG_STEPS[1]);
    expect(nextFog(FOG_STEPS[FOG_STEPS.length - 1])).toBe(FOG_STEPS[0]);
    expect(nextFog(7)).toBe(FOG_STEPS[0]);
  });
});

describe('the opening length (POK-241)', () => {
  it('cycles through the steps and comes back round', () => {
    expect(nextSafari(0)).toBe(60);
    expect(nextSafari(60)).toBe(120);
    expect(nextSafari(180)).toBe(0);
    // Anything not on the ladder lands on its first rung rather than nowhere.
    expect(nextSafari(45)).toBe(0);
  });

  it('says what no Safari means rather than showing a zero', () => {
    expect(safariLabel(0)).toBe('NO SAFARI');
    expect(safariLabel(120)).toBe('SAFARI 120s');
  });
});

describe('a door that will not open (POK-330 #47)', () => {
  const host = { rejoining: true, wasHost: true, seat: 1 };

  it('hosts again when the room it was running is gone', () => {
    // a relay restart, or the seat hold ran out: the match is still in this tab
    expect(onRefused('not_found', host)).toBe('rehost');
  });

  it('is a dead end for anybody else, or for any other refusal', () => {
    expect(onRefused('not_found', { ...host, wasHost: false })).toBe('dead-end'); // a guest
    expect(onRefused('not_found', { ...host, rejoining: false })).toBe('dead-end'); // an old link
    // a new room seats its opener at 1: from any other seat we would come back as somebody else
    expect(onRefused('not_found', { ...host, seat: 3 })).toBe('dead-end');
    expect(onRefused('removed', host)).toBe('dead-end');
    expect(onRefused('version', host)).toBe('dead-end');
    expect(onRefused('already_in_room', host)).toBe('status');
  });
});

describe('the clock a match is picked up from (POK-330 #47 review)', () => {
  it('a ring puts the whole phase on the clock, and nothing once the fog is everywhere', () => {
    expect(ringClockLeft(1, 60)).toBe(60);
    expect(ringClockLeft(8, 60)).toBe(60);
    expect(ringClockLeft(9, 60)).toBe(0); // the last phase: the fog does not move again
  });

  it('counts whole seconds off since the clock was heard, and stops at zero', () => {
    expect(clockLeftAt({ clockLeft: 30, clockAt: 1000 }, 1000)).toBe(30);
    expect(clockLeftAt({ clockLeft: 30, clockAt: 1000 }, 12_999)).toBe(19);
    expect(clockLeftAt({ clockLeft: 30, clockAt: 1000 }, 99_000)).toBe(0);
    expect(clockLeftAt({ clockLeft: 30, clockAt: 5000 }, 1000)).toBe(30); // never counts up
  });

  // A lone phone host with bots blips 20 s into ring phase 2 and is back 25 s later. Its
  // page kept the match the way every page does, from what crossed the wire; the ring
  // put 0 on the clock, so the director it started again read the phase as spent and
  // sent phase 3 at once.
  const world: DirectorWorld = {
    maps: [{ id: 'MAP_A', group: 0, num: 1, section: 'SEC_A', outdoor: true }],
    landing: Array.from({ length: 8 }, (_, i) => ({ map: 'MAP_A', x: i, y: 0 })),
    sections: { SEC_A: { x: 0, y: 0, w: 2, h: 2, name: 'ALPHA', num: 1 } },
  };
  const FOG = 60;
  const directorAt = (clock: { t: number }, sent: Msg[]) =>
    new Director({
      seats: [1, 2],
      seed: 7,
      world,
      options: { safariSecs: 10, fogSecs: FOG },
      send: (m) => sent.push(m),
      now: () => clock.t,
      onOut: () => () => {},
    });

  it('a host back from a drop mid-ring carries on with the phase it left, counted on', () => {
    const clock = { t: 0 };
    const sent: Msg[] = [];
    // the snapshot as the page keeps it (lifecycle.ts noteMatch)
    const match = freshMatch();
    const host = directorAt(clock, sent);
    host.start();
    while (clock.t < (10 + FOG + 20) * 1000) {
      clock.t += 1000;
      const before = sent.length;
      host.tick();
      for (const m of sent.slice(before)) noteMatch(match, FOG, m, clock.t, { dealing: true, roster: null, defaultFog: FOG });
    }
    expect(match.ringPhase).toBe(2);
    expect(host.state.clockLeft).toBe(FOG - 20);

    // the socket goes: the page keeps the director's own clock (app.ts `closed`)
    match.clockLeft = host.state.clockLeft;
    match.clockAt = clock.t;
    host.stop();
    clock.t += 25_000;

    const again: Msg[] = [];
    const back = directorAt(clock, again);
    back.resume({ ringPhase: match.ringPhase, centre: match.centre, secsLeftInPhase: clockLeftAt(match, clock.t) });
    back.tick();
    expect(again.filter((m) => m.t === 'ring')).toEqual([]); // not phase 3 on arrival
    expect(back.state.ring?.phase).toBe(2);
    expect(back.state.clockLeft).toBe(FOG - 20 - 25);
    clock.t += (FOG - 20 - 25) * 1000;
    back.tick();
    expect(again.filter((m) => m.t === 'ring').map((m) => (m as { phase: number }).phase)).toEqual([3]);
  });

  it('an heir, which has only the wire, picks the phase up the same way', () => {
    // it heard phase 2's ring 20 s ago and no clock since
    const clock = { t: 100_000 };
    const match = { ringPhase: 2, centre: { sx: 0, sy: 0 }, clockLeft: ringClockLeft(2, FOG), clockAt: clock.t - 20_000 };
    const sent: Msg[] = [];
    const heir = directorAt(clock, sent);
    heir.resume({ ringPhase: match.ringPhase, centre: match.centre, secsLeftInPhase: clockLeftAt(match, clock.t) });
    heir.tick();
    expect(sent).toEqual([]);
    expect(heir.state.clockLeft).toBe(FOG - 20);
  });
});
