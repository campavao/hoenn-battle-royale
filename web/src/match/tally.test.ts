import { describe, expect, it } from 'vitest';
import { lifetimeLines } from '../ui/profile';
import { tallyLines } from '../ui/results';
import { favourite, readTally, tallyMsg, TALLY_BYTES } from './tally';

/** gBrTally as include/br/br_tally.h lays it out, in a byte array the test holds. */
function ram(fill: (view: DataView) => void) {
  const bytes = new Uint8Array(TALLY_BYTES);
  const view = new DataView(bytes.buffer);
  fill(view);
  const read = (addr: number, bits: 8 | 16 | 32) =>
    bits === 8 ? view.getUint8(addr) : bits === 16 ? view.getUint16(addr, true) : view.getUint32(addr, true);
  const write = (addr: number, value: number, bits: 8 | 16 | 32) => {
    if (bits === 8) view.setUint8(addr, value);
    else if (bits === 16) view.setUint16(addr, value, true);
    else view.setUint32(addr, value, true);
  };
  return { bytes, read, write };
}

const names = { species: (id: number) => (id === 277 ? 'TREECKO' : `#${id}`), move: (id: number) => (id === 1 ? 'POUND' : undefined) };

describe("what our own ROM counted of the match (POK-416)", () => {
  it('reads the counts and the moves each species used, as the C struct has them', () => {
    const { read } = ram((v) => {
      v.setUint16(0, 312, true); // steps
      v.setUint16(2, 4, true); // won
      v.setUint16(4, 2, true); // caught
      v.setUint16(6, 3, true); // items
      v.setUint16(8, 277, true); // species[0]
      v.setUint16(10, 280, true); // species[1]
      v.setUint8(36, 9); // speciesN[0]
      v.setUint8(37, 2);
      v.setUint16(20, 1, true); // moves[0] POUND
      v.setUint16(22, 33, true); // moves[1]
      v.setUint8(42, 6);
      v.setUint8(43, 5);
    });
    expect(readTally(read, 0)).toEqual({ steps: 312, won: 4, caught: 2, items: 3, mons: { 277: 9, 280: 2 }, moves: { 1: 6, 33: 5 } });
  });

  it('names the favourite the one used most, a tie going to the lower id', () => {
    expect(favourite({})).toBeUndefined();
    expect(favourite({ 280: 3, 277: 3, 300: 1 })).toBe(277);
    expect(favourite({ 280: 4, 277: 3 })).toBe(280);
  });

  it('says every count, zero too, and a favourite only once there is one', () => {
    const none = tallyLines({ steps: 1, won: 0, caught: 0, items: 0 }, names);
    expect(none.map((l) => `${l.label} ${l.value}`)).toEqual(['WON 0', 'CAUGHT 0', 'STEPS 1', 'ITEMS 0']);
    const some = tallyLines(tallyMsg(0, { steps: 40, won: 2, caught: 1, items: 3, mons: { 277: 5, 280: 2 }, moves: { 1: 4 } }), names);
    expect(some.filter((l) => l.wide)).toEqual([
      { label: 'FAVORITE', value: 'TREECKO', wide: true },
      { label: 'TOP MOVE', value: 'POUND', wide: true },
    ]);
    // A move the page cannot name (no ROM tables) is left out rather than drawn as a number.
    expect(tallyLines({ steps: 0, won: 0, caught: 0, items: 0, move: 33 }, names).some((l) => l.label === 'TOP MOVE')).toBe(false);
  });

  it("says a career's lifetime totals for MY STATS, zeroes for a career with none yet", () => {
    expect(lifetimeLines(undefined, names).map((l) => l.value)).toEqual(['0', '0', '0', '0', '0', '0', '0']);
    const lines = lifetimeLines(
      { won: 12, caught: 4, steps: 2000, items: 9, trainers: 7, duelsWon: 2, took: 15, mons: { 277: 30 }, moves: { 1: 20 } },
      names,
    );
    expect(lines.map((l) => `${l.label} ${l.value}`)).toEqual([
      'BATTLES WON 12', 'CAUGHT 4', 'STEPS WALKED 2000', 'ITEMS USED 9', 'TRAINERS BEATEN 7', 'DUELS WON 2', 'LOOT TAKEN 15',
      'FAVORITE TREECKO', 'TOP MOVE POUND',
    ]);
  });
});
