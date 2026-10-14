import { describe, expect, it } from 'vitest';
import { MOVE_NAME_SIZE, MOVE_SIZE, TYPE_NAME_SIZE, effectWords, effectiveness, kindOf, moveInfo, type Rom } from './movebook';
import { encodeGen3 } from '../text/gen3';

const BASE = 0x08000000;
const GRASS = 12;
const NORMAL = 0;
const ROCK = 5;
const GROUND = 4;
const GHOST = 7;
const WATER = 11;

/** A ROM with just the tables movebook reads, at made-up addresses. */
function fakeRom(): Rom {
  const bytes = new Uint8Array(0x4000).fill(0xff);
  const at = { gBattleMoves: 0x100, gMoveNames: 0x800, gMoveDescriptionPointers: 0x1000, gTypeNames: 0x1100, gTypeEffectiveness: 0x1200, desc: 0x1400 };
  const put = (o: number, b: number[]) => bytes.set(b, o);
  const str = (o: number, s: string) => put(o, [...encodeGen3(s), 0xff]);
  // move 71, ABSORB: grass, 20 power, 100 accuracy, 20 PP
  put(at.gBattleMoves + 71 * MOVE_SIZE, [3, 20, GRASS, 100, 20, 0, 0, 0, 0]);
  str(at.gMoveNames + 71 * MOVE_NAME_SIZE, 'ABSORB');
  str(at.gTypeNames + GRASS * TYPE_NAME_SIZE, 'GRASS');
  // its description, broken across the summary screen's lines as the ROM has it
  put(at.desc, [...encodeGen3('A full-'), 0xfe, ...encodeGen3('body hit.'), 0xfe, ...encodeGen3('Ouch.'), 0xff]);
  const ptr = BASE + at.desc;
  put(at.gMoveDescriptionPointers + 70 * 4, [ptr & 0xff, (ptr >> 8) & 0xff, (ptr >> 16) & 0xff, ptr >>> 24]);
  // the chart: grass x2 on rock and ground, normal x0.5 on rock; past foresight, normal x0 on ghost
  put(at.gTypeEffectiveness, [GRASS, ROCK, 20, GRASS, GROUND, 20, GRASS, GRASS, 5, NORMAL, ROCK, 5, 0xfe, 0xfe, 0, NORMAL, GHOST, 0, 0xff, 0xff, 0]);
  return { bytes, sym: (n) => (n in at && n !== 'desc' ? BASE + at[n as keyof typeof at] : undefined) };
}

describe("a move, out of the ROM's tables", () => {
  const rom = fakeRom();

  it('reads its name, type, numbers and description', () => {
    expect(moveInfo(rom, 71)).toEqual({
      id: 71,
      name: 'ABSORB',
      type: GRASS,
      typeName: 'GRASS',
      power: 20,
      accuracy: 100,
      pp: 20,
      kind: 'SPECIAL',
      desc: 'A full-body hit. Ouch.',
    });
    expect(moveInfo(rom, 0)).toBeNull();
    expect(moveInfo({ bytes: rom.bytes, sym: () => undefined }, 71)).toBeNull();
  });

  it("Gen 3's split: the type decides, and no power is a status move", () => {
    expect([kindOf(NORMAL, 40), kindOf(GRASS, 20), kindOf(WATER, 0)]).toEqual(['PHYSICAL', 'SPECIAL', 'STATUS']);
  });

  it('multiplies across both types, counts a pure type once, and keeps foresight', () => {
    expect(effectiveness(rom, GRASS, [ROCK, GROUND])).toBe(4);
    expect(effectiveness(rom, GRASS, [ROCK, ROCK])).toBe(2);
    expect(effectiveness(rom, NORMAL, [ROCK, GRASS])).toBe(0.5);
    expect(effectiveness(rom, NORMAL, [GHOST, GHOST])).toBe(0);
    expect(effectiveness(rom, WATER, [ROCK, GROUND])).toBe(1);
    expect(effectiveness({ bytes: rom.bytes, sym: () => undefined }, GRASS, [ROCK, ROCK])).toBeNull();
  });

  it('says it the way the battle does', () => {
    expect(effectWords(4, 20).text).toBe('SUPER EFF. ×4');
    expect(effectWords(2, 20).tone).toBe('super');
    expect(effectWords(0.5, 40).tone).toBe('weak');
    expect(effectWords(0, 40).text).toBe('NO EFFECT');
    expect(effectWords(1, 0).text).toBe('NO DAMAGE');
  });
});
