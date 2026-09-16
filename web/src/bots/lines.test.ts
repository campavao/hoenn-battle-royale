import { describe, expect, it } from 'vitest';
import { voiceFor } from './lines';
import { LINE_MAX, short } from '../match/ticker';

describe("a bot's three lines", () => {
  it('are the same from the same seed and seat', () => {
    expect(voiceFor(7, 31)).toEqual(voiceFor(7, 31));
  });

  it('differ between seats, so a room is not one voice', () => {
    const voices = new Set(Array.from({ length: 8 }, (_, i) => voiceFor(7, 31 - i).intro));
    expect(voices.size).toBeGreaterThan(1);
  });

  it('fit the ticker with a name in front of them', () => {
    for (let seat = 0; seat < 32; seat++) {
      const v = voiceFor(1234, seat);
      for (const line of [v.intro, v.win, v.lose]) {
        expect(`${short('FLANNERY')}: ${line}`.length).toBeLessThanOrEqual(LINE_MAX);
      }
    }
  });
});
