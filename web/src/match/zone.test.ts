import { describe, expect, it } from 'vitest';
import zoneHeader from '../../../include/br/br_zone.h?raw';
import { dealParty } from '../bots/party';
import { BR_ZONE, readZonePool } from './zone';

describe('the Zone pool, read out of the ROM', () => {
  it('reads the struct the way br_zone.h lays it out', () => {
    expect(zoneHeader).toMatch(/\/\*\s+0 \*\/ u32 dealtFor;/);
    expect(zoneHeader).toMatch(/\/\*\s+4 \*\/ u16 species\[BR_ZONE_SLOTS\];/);
    expect(zoneHeader).toMatch(/\/\*\s+28 \*\/ u16 items/); // 4 + 2 * 12
    expect(Number(/#define BR_ZONE_SLOTS (\d+)/.exec(zoneHeader)![1])).toBe(BR_ZONE.SLOTS);
  });

  const ram = (seed: number, species: number[]) => (addr: number, bits: number) => {
    if (addr === 0x1000 && bits === 32) return seed;
    const i = (addr - 0x1004) / 2;
    return bits === 16 && Number.isInteger(i) && i >= 0 && i < species.length ? species[i] : 0;
  };

  it('gives the twelve once they are dealt for this seed', () => {
    const pool = [283, 398, 388, 298, 43, 306, 277, 344, 367, 356, 382, 361];
    expect(readZonePool(ram(0x12345678, pool), 0x1000, 0x12345678)).toEqual(pool);
  });

  it('gives nothing for another seed, no seed, or a patch with no symbol', () => {
    expect(readZonePool(ram(7, [283]), 0x1000, 8)).toEqual([]);
    expect(readZonePool(ram(0, [283]), 0x1000, 0)).toEqual([]);
    expect(readZonePool(ram(7, [283]), undefined, 7)).toEqual([]);
  });
});

describe('a bot drafts its first Pokemon from the Zone', () => {
  const pool = [43, 306, 277, 344, 298]; // a GRASS match

  it('leads with something out of the pool, grown up to the rung', () => {
    for (let seat = 1; seat < 12; seat++) {
      const lead = dealParty(99, seat, 1, undefined, undefined, pool)[0];
      expect(pool).toContain(lead.species); // rung 5: nothing has evolved yet
    }
  });

  it('deals the same team to the same seat, whoever is asking', () => {
    expect(dealParty(99, 4, 5, 'MAP_ROUTE110', undefined, pool)).toEqual(
      dealParty(99, 4, 5, 'MAP_ROUTE110', undefined, pool),
    );
  });

  it('is what it always was with no pool to draft from', () => {
    expect(dealParty(99, 4, 5, 'MAP_ROUTE110', undefined, [])).toEqual(dealParty(99, 4, 5, 'MAP_ROUTE110'));
  });
});
