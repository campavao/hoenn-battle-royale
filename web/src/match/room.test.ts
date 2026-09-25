import { describe, expect, it } from 'vitest';
import { canStart, clockLeftAt, doorOf, FOG_STEPS, MAX_STEPS, nextDoor, nextFog, nextMax, nextTextSpeed, onRefused, ringClockLeft, roomView, startNote, textSpeedLabel, nextSafari, safariLabel } from './room';
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
    // the snapshot as the page keeps it (app.ts noteResult)
    const match = { ringPhase: 0, centre: undefined as { sx: number; sy: number; place?: string } | undefined, clockLeft: 0, clockAt: 0 };
    const host = directorAt(clock, sent);
    host.start();
    while (clock.t < (10 + FOG + 20) * 1000) {
      clock.t += 1000;
      const before = sent.length;
      host.tick();
      for (const m of sent.slice(before)) {
        if (m.t === 'ring') {
          match.ringPhase = m.phase;
          match.centre = { sx: m.sx, sy: m.sy, place: m.place };
          match.clockLeft = ringClockLeft(m.phase, FOG);
          match.clockAt = clock.t;
        } else if (m.t === 'clock') {
          match.clockLeft = m.left;
          match.clockAt = clock.t;
        }
      }
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
