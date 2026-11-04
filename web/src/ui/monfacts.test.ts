import { describe, expect, it } from 'vitest';
import { learnsByNow, relearnable, speciesFacts, statusWord } from './monfacts';
import { learnList, machineTag } from './movesbox';
import { TMHM_MOVES } from './tmhm';
import { pageScale } from './pagewin';
import { statRows, type SummaryMon } from './summary';

const ROM_BASE = 0x08000000;
/** A cartridge of one species' row and one learnset, at the symbols' places. */
function rom(learnset: [number, number][]) {
  const bytes = new Uint8Array(0x1000);
  const INFO = 0x100, SETS = 0x400, SET = 0x500;
  const species = 3;
  bytes.set([45, 49, 50, 65, 66, 67, 12, 3], INFO + species * 0x1c);
  bytes[INFO + species * 0x1c + 0x16] = 65;
  bytes[INFO + species * 0x1c + 0x17] = 0;
  new DataView(bytes.buffer).setUint32(SETS + species * 4, ROM_BASE + SET, true);
  learnset.forEach(([level, move], i) => new DataView(bytes.buffer).setUint16(SET + i * 2, (level << 9) | move, true));
  new DataView(bytes.buffer).setUint16(SET + learnset.length * 2, 0xffff, true);
  const syms: Record<string, number> = { gSpeciesInfo: ROM_BASE + INFO, gLevelUpLearnsets: ROM_BASE + SETS };
  return { bytes, sym: (n: string) => syms[n] };
}

describe('what the cartridge says of a species', () => {
  it('reads the base stats in the game order, and the types and abilities', () => {
    const f = speciesFacts(rom([]), 3)!;
    expect(f.base).toEqual({ hp: 45, attack: 49, defense: 50, speed: 65, spAttack: 66, spDefense: 67 });
    expect(f.types).toEqual([12, 3]);
    expect(f.abilities).toEqual([65, 0]);
  });

  it('has nothing to say without the table, or of no species', () => {
    expect(speciesFacts({ bytes: new Uint8Array(4), sym: () => undefined }, 3)).toBeNull();
    expect(speciesFacts(rom([]), 0)).toBeNull();
  });
});

describe('the moves it could learn again (GetMoveRelearnerMoves)', () => {
  const r = rom([[1, 33], [1, 45], [10, 22], [10, 22], [20, 75], [32, 74]]);
  it('is its learnset up to its level, less what it knows and any repeat', () => {
    expect(relearnable(r, 3, 20, [33])).toEqual([45, 22, 75]);
  });
  it('takes a move learned at exactly its level, and none above', () => {
    expect(relearnable(r, 3, 19, [])).toEqual([33, 45, 22]);
    expect(relearnable(r, 3, 32, [])).toEqual([33, 45, 22, 75, 74]);
  });
  it('is nothing when it knows all of it', () => {
    expect(relearnable(r, 3, 10, [33, 45, 22])).toEqual([]);
  });
  it('knows a move learned by now from one off a machine', () => {
    expect(learnsByNow(r, 3, 20, 75)).toBe(true);
    expect(learnsByNow(r, 3, 19, 75)).toBe(false);
    expect(learnsByNow(r, 3, 99, 200)).toBe(false);
  });
});

describe('the status word', () => {
  it('says what struct Pokemon says, fainted first', () => {
    expect(statusWord(10, 0)).toBe('');
    expect(statusWord(10, 3)).toBe('SLP');
    expect(statusWord(10, 1 << 3)).toBe('PSN');
    expect(statusWord(10, 1 << 7)).toBe('PSN');
    expect(statusWord(10, 1 << 4)).toBe('BRN');
    expect(statusWord(10, 1 << 5)).toBe('FRZ');
    expect(statusWord(10, 1 << 6)).toBe('PAR');
    expect(statusWord(0, 1 << 6)).toBe('FNT');
  });
});

describe("the SUMMARY's six", () => {
  const row: SummaryMon = { species: 3, name: 'X', level: 5, hp: 7, maxHp: 20, status: 0, item: 0, itemName: '', ability: '', moves: [], active: false };
  it("are one of the party's real ones, HP as it stands, in the order Cam said them", () => {
    const { base, rows } = statRows({ ...row, stats: { attack: 1, defense: 2, speed: 3, spAttack: 4, spDefense: 5 } }, null);
    expect(base).toBe(false);
    expect(rows).toEqual([['HP', '7/20'], ['ATTACK', '1'], ['DEFENSE', '2'], ['SP. ATK', '4'], ['SP. DEF', '5'], ['SPEED', '3']]);
  });
  it("are the species' base stats, so called, for one off the ground", () => {
    const { base, rows } = statRows(row, { hp: 45, attack: 49, defense: 50, speed: 65, spAttack: 66, spDefense: 67 });
    expect(base).toBe(true);
    expect(rows[0]).toEqual(['HP', '45']);
    expect(rows[5]).toEqual(['SPEED', '65']);
  });
});

describe('a box on the screen', () => {
  it('is a whole step under the windows with a mouse, not the screen', () => {
    expect(pageScale(472, 256, 3, false, { w: 1920, h: 1080 })).toBe(2);
    expect(pageScale(472, 256, 4, false, { w: 2560, h: 1440 })).toBe(3);
  });
  it('fits a small window, whole pixels still', () => {
    expect(pageScale(232, 344, 2, false, { w: 800, h: 400 })).toBe(1);
  });
  it("is the windows' scale on a phone, or what fits", () => {
    expect(pageScale(232, 344, 1.56, true, { w: 390, h: 844 })).toBeCloseTo(382 / 232);
    expect(pageScale(232, 344, 1.5, true, { w: 375, h: 400 })).toBeCloseTo(384 / 344);
  });
});

describe('what MOVES lists', () => {
  const r = rom([[1, 33], [10, 22]]);
  const m = { species: 3, level: 20, moves: [{ id: 33 }] };
  it('is its own learnset, then the machines in the bag in their order', () => {
    expect(learnList(r, m, [289 + 25, 339 + 2])).toEqual([{ move: 22, machine: 0 }, { move: TMHM_MOVES[25], machine: 314 }, { move: TMHM_MOVES[52], machine: 341 }]);
  });
  it('leaves out a machine for a move it knows, or that its learnset lists, and anything else in the pocket', () => {
    const tm = TMHM_MOVES[0];
    expect(learnList(r, { ...m, moves: [{ id: 33 }, { id: tm }] }, [289, 13])).toEqual([{ move: 22, machine: 0 }]);
    const own = rom([[1, tm]]);
    expect(learnList(own, { species: 3, level: 5, moves: [] }, [289])).toEqual([{ move: tm, machine: 0 }]);
  });
  it('names a machine as the bag does', () => {
    expect(machineTag(0)).toBe('');
    expect(machineTag(289)).toBe('TM01');
    expect(machineTag(338)).toBe('TM50');
    expect(machineTag(339)).toBe('HM01');
  });
});
