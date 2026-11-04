import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, SIDES_SIZE, overlaps, partyBalls, readSides, romName, sidesLayout } from './sides';
import { BATTLE_MENU, MAIN_IN_BATTLE_BIT, MAIN_IN_BATTLE_BYTE } from '../touch';

function mon(hp: number, maxHp: number, status = 0): number[] {
  const m = new Array(100).fill(0);
  m[80] = status;
  m[86] = hp & 0xff;
  m[87] = hp >> 8;
  m[88] = maxHp & 0xff;
  m[89] = maxHp >> 8;
  return m;
}

describe('sidesLayout', () => {
  it('parks theirs top right and ours bottom left of the picture when the sides have room', () => {
    const at = sidesLayout({ scale: 3, cols: 480, rows: 200, lcdCol: 120, lcdRow: 20 })!;
    expect(at.foe).toEqual({ x: 364, y: 20 });
    expect(at.mine).toEqual({ x: 120 - 4 - CARD_W, y: 20 + 160 - CARD_H });
  });

  it('puts both above the picture when only the top has room', () => {
    const at = sidesLayout({ scale: 2, cols: 260, rows: 400, lcdCol: 10, lcdRow: 120 })!;
    expect(at.foe.x + CARD_W).toBe(246);
    expect(at.mine.x).toBe(14);
    expect(at.foe.y + CARD_H).toBeLessThanOrEqual(120);
  });

  it('shows nothing on a screen with no room past the picture', () => {
    expect(sidesLayout({ scale: 2, cols: 240, rows: 160, lcdCol: 0, lcdRow: 0 })).toBeNull();
  });
});

describe('partyBalls', () => {
  it('one per mon: fainted, a status, fine, then empty slots past the count', () => {
    const bytes = Uint8Array.from([...mon(0, 20), ...mon(5, 20, 8), ...mon(20, 20), ...mon(9, 9), ...mon(0, 0), ...mon(0, 0)]);
    expect(partyBalls(bytes, 3)).toEqual(['fainted', 'status', 'ok', 'empty', 'empty', 'empty']);
  });
});

describe('romName', () => {
  it('reads up to EOS', () => {
    expect(romName(Uint8Array.from([0xbc, 0xc9, 0xce, 0xff, 0x00]))).toBe('BOT');
  });
});

describe('readSides', () => {
  const SYM: Record<string, number> = {
    gMain: 0x1000, gBattleTypeFlags: 0x2000, gBrSides: 0x3000, gBrBattle: 0x4000,
    gPlayerParty: 0x5000, gPlayerPartyCount: 0x6000, gEnemyParty: 0x7000, gEnemyPartyCount: 0x8000,
  };
  function emu(menu: number, flags = 8) {
    const mem = new Map<number, number>();
    mem.set(SYM.gMain + MAIN_IN_BATTLE_BYTE, MAIN_IN_BATTLE_BIT);
    mem.set(SYM.gBattleTypeFlags, flags);
    mem.set(SYM.gBrBattle + BATTLE_MENU, menu);
    mem.set(SYM.gPlayerPartyCount, 1);
    // Nothing in a battle sets gEnemyPartyCount (only trade.c does): a bot's card
    // leaves it 0 (battle-sides.txt), and the balls come from the party itself.
    mem.set(SYM.gEnemyPartyCount, 0);
    const sides = new Array(SIDES_SIZE).fill(0xff);
    sides[0] = 77;
    sides[1] = 71;
    sides.splice(2, 3, 0xbc, 0xc9, 0xce);
    sides.splice(18, 3, 0xbd, 0xbb, 0xc7);
    sides[26] = 1;
    sides[27] = 0;
    sides.forEach((b, i) => mem.set(SYM.gBrSides + i, b));
    mon(20, 20).forEach((b, i) => mem.set(SYM.gPlayerParty + i, b));
    [...mon(3, 20), ...mon(0, 20)].forEach((b, i) => mem.set(SYM.gEnemyParty + i, b));
    return {
      read: (a: number, bits: 8 | 16 | 32) => (bits === 8 ? mem.get(a) ?? 0 : (mem.get(a) ?? 0) | ((mem.get(a + 1) ?? 0) << 8)),
      bytes: (a: number, n: number) => Uint8Array.from({ length: n }, (_, i) => mem.get(a + i) ?? 0),
    };
  }
  const sym = (n: string) => SYM[n];

  it('waits for the first choice, then shows both sides until the fight ends', () => {
    const shown = { serial: 0 };
    expect(readSides(emu(0), sym, shown)).toBeNull(); // the intro: the opponent is still in the picture
    const s = readSides(emu(1), sym, shown)!;
    expect(s.foe).toEqual({ pic: 77, name: 'BOT', balls: ['ok', 'fainted', 'empty', 'empty', 'empty', 'empty'] });
    expect(s.mine).toEqual({ pic: 71, name: 'CAM', balls: ['ok', 'empty', 'empty', 'empty', 'empty', 'empty'] });
    expect(readSides(emu(0), sym, shown)).not.toBeNull(); // between choices it stays
  });

  it('keeps each ball with its mon while a screen the battle put up has the party in its own order', () => {
    const fightSym = (n: string) => (n === 'BattleMainCB2' ? 0x9000 : SYM[n]);
    const on = (cb2: number, read = emu(1)) => ({ ...read, read: (a: number, bits: 8 | 16 | 32) => (a === SYM.gMain + 4 ? cb2 : read.read(a, bits)) });
    const shown = { serial: 0 };
    const was = readSides(on(0x9001), fightSym, shown)!.mine.balls; // thumb bit set: the battle's own callback
    const up = emu(1);
    const swapped = { ...up, bytes: (a: number, n: number) => { const b = up.bytes(a, n); if (a === SYM.gPlayerParty) { b[86] = 0; b[186] = 9; b[188] = 9; } return b; } };
    expect(readSides(on(0x7777, swapped), fightSym, shown)!.mine.balls, 'on the party screen').toEqual(was);
    const back = readSides(on(0x9001, swapped), fightSym, shown)!.mine.balls;
    expect(back.slice(0, 2), 'and back on the battle, as it is').toEqual(['fainted', 'empty']);
  });

  it('is nothing in a wild battle', () => {
    expect(readSides(emu(1, 0), sym, { serial: 0 })).toBeNull();
  });
});

describe('overlaps', () => {
  const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
  it('is true only where two boxes share area', () => {
    expect(overlaps(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 10, 10)), 'edges touching').toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(0, 20, 10, 10))).toBe(false);
  });
});
