import { describe, expect, it } from 'vitest';
import { BOT_SKINS, botSeats, botSkin, dealBots } from './roster';

const SPAWN = [{ mapId: 'FIELD', map: { group: 0, num: 9 }, x: 1, y: 1 }] as unknown as Parameters<typeof dealBots>[3];

describe('bot clothes (2026-10-05 play-test)', () => {
  it('never deals the starting BRENDAN or MAY, or the rivals', () => {
    for (let seat = 0; seat < 32; seat++) expect(botSkin(seat)).toBeGreaterThanOrEqual(4);
  });

  it('dresses a room of twelve bots in twelve different classes', () => {
    const bots = dealBots(7, 12, [0], SPAWN);
    expect(new Set(bots.map((b) => b.skin)).size).toBe(BOT_SKINS.length);
  });

  it('puts each bot in the clothes the lobby showed for its seat', () => {
    const taken = [0, 31, 29];
    const bots = dealBots(3, 5, taken, SPAWN);
    expect(bots.map((b) => b.seat)).toEqual(botSeats(5, taken));
    expect(bots.map((b) => b.skin)).toEqual(botSeats(5, taken).map(botSkin));
  });
});
