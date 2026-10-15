import { describe, expect, it } from 'vitest';
import table from '../data/patches.json';
import { dealPatches, type PatchTable } from './patches';

describe('the patches, dealt as the ROM deals them (POK-363)', () => {
  it("matches the ROM's own deal on ROUTE 107 under seed 4 (tools/br/drivers/patch-water.txt)", () => {
    // The driver reads gBrPatch: header 0x1C, eight patches, the eighth at (0x1E,0x14)
    // in the ROM's space -- (23,13) without MAP_OFFSET.
    const patches = dealPatches(table as PatchTable, 'MAP_ROUTE107', { group: 0, num: 22 }, 4);
    expect(patches).toHaveLength(8);
    expect(patches[7]).toEqual({ key: 0x2000 | (0x1c << 3) | 7, x: 0x1e - 7, y: 0x14 - 7 });
  });

  it('deals nothing without a seed, or on a map with no cells', () => {
    expect(dealPatches(table as PatchTable, 'MAP_ROUTE101', { group: 0, num: 16 }, 0)).toEqual([]);
    expect(dealPatches(table as PatchTable, 'MAP_LITTLEROOT_TOWN', { group: 0, num: 9 }, 4)).toEqual([]);
  });
});
