import { describe, expect, it } from 'vitest';
import { Director, type DirectorWorld } from './director';
import { GIFT_KEY_BASE, GIFTS, isGiftKey, isGiftSection } from './gifts';
import { HOENN } from '../bots/hoenn';
import { DOORSTEPS, HAND, LANDING, worldReady } from './landing';
import type { Msg, SpillMsg, StartMsg } from '../net/wire';
import regionmapData from '../data/regionmap.json';

await worldReady();

const WORLD: DirectorWorld = {
  maps: HOENN.maps,
  landing: LANDING,
  doorsteps: DOORSTEPS,
  hand: HAND,
  sections: regionmapData.sections as DirectorWorld['sections'],
};

function buzzer(seed: number) {
  let t = 0;
  const sent: Msg[] = [];
  const director = new Director({ seats: [0, 1, 2], seed, world: WORLD, options: { safariSecs: 5, fogSecs: 10 }, send: (m) => sent.push(m), now: () => t, onOut: () => () => {} });
  director.start();
  t += 5000;
  director.tick();
  return sent;
}

describe("the towns' gift-givers", () => {
  it('stands one in every town and city at the buzzer, a one-item bag under a gift key, on a cell nobody was dealt', () => {
    const sent = buzzer(7);
    const ring = sent.findIndex((m) => m.t === 'ring');
    const gifts = (sent.filter((m) => m.t === 'spill') as SpillMsg[]).filter((s) => s.bag && isGiftKey(s.bag.key));
    expect(sent.indexOf(gifts[0])).toBeGreaterThan(ring); // after the buzzer's ring
    const towns = Object.keys(WORLD.sections).filter(isGiftSection);
    expect(towns).toHaveLength(16);
    expect(gifts).toHaveLength(towns.length);
    expect(gifts.map((g) => g.bag!.key)).toEqual(towns.map((_, i) => GIFT_KEY_BASE | i));
    for (const g of gifts) {
      expect(g.mons).toEqual([]);
      expect(g.bag!.items).toHaveLength(1);
      expect(GIFTS).toContain(g.bag!.items[0].id);
    }
    const start = sent.find((m) => m.t === 'start') as StartMsg;
    const spawned = new Set(start.spawns.map((s) => `${s.map.group}:${s.map.num}:${s.x + 7}:${s.y + 7}`));
    const cells = gifts.map((g) => `${g.map.group}:${g.map.num}:${g.bag!.x}:${g.bag!.y}`);
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells.some((c) => spawned.has(c))).toBe(false);
  });

  it('deals the same gifts from the same seed', () => {
    const gifts = (s: Msg[]) => s.filter((m) => m.t === 'spill' && m.bag && isGiftKey(m.bag.key));
    expect(gifts(buzzer(11))).toEqual(gifts(buzzer(11)));
  });
});
