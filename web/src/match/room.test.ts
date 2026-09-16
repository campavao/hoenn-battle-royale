import { describe, expect, it } from 'vitest';
import { canStart, doorOf, FOG_STEPS, MAX_STEPS, nextDoor, nextFog, nextMax, nextTextSpeed, roomView, startNote, textSpeedLabel, nextSafari, safariLabel } from './room';
import type { RosterEvent } from '../net/relay';

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
