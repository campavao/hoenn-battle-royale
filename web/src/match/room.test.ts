import { describe, expect, it } from 'vitest';
import { BOT_FILL, botFillFor, dealable, doorLabel, FOG_STEPS, MAX_STEPS, nextFog, nextMax, nextTextSpeed, textSpeedLabel, nextSafari, safariLabel } from './room';
import { ringClockLeft } from './lifecycle';

describe('the host controls', () => {
  it('cycle MAX up the ladder and round', () => {
    expect(nextMax(2)).toBe(4);
    expect(nextMax(MAX_STEPS[MAX_STEPS.length - 1])).toBe(MAX_STEPS[0]);
    expect(nextMax(7)).toBe(MAX_STEPS[0]); // a value off the ladder starts it over
  });

  it("show the host the passcode it set, as Kanto's OPEN: PASS 1234 does (POK-320)", () => {
    expect(doorLabel('pass', 'AB23')).toBe('PASS AB23');
    // A host that took the room over never knew it.
    expect(doorLabel('pass', null)).toBe('PASSCODE');
    expect(doorLabel('open', null)).toBe('LISTED');
    expect(doorLabel('private', 'AB23')).toBe('UNLISTED');
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

  it('refuses a deal nobody could win, bots counted, however it is asked for (Kanto POK-197)', () => {
    // a quick room of one with FILL off counts itself down to exactly this
    expect(dealable(1, botFillFor({ max: 8 }, 1, false))).toBe(false);
    expect(dealable(1, botFillFor({ max: 8 }, 1, true))).toBe(true);
    expect(dealable(2, 0)).toBe(true);
    expect(dealable(0, 1)).toBe(false);
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

describe('the clock a match is picked up from (POK-330 #47 review)', () => {
  it('a ring puts the whole phase on the clock, and nothing once the fog is everywhere', () => {
    expect(ringClockLeft(1, 60)).toBe(60);
    expect(ringClockLeft(8, 60)).toBe(60);
    expect(ringClockLeft(9, 60)).toBe(0); // the last phase: the fog does not move again
  });

});
