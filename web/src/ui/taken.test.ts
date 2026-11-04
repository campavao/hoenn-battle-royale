// The rule of ui/taken.ts on a little cartridge of its own. That it is the ROM's rule is what
// spikeb-summary.spec.ts holds, against the real thing.
import { describe, expect, it } from 'vitest';
import { takenMon, teamSeed } from './taken';

const ROM = 0x08000000;
const AT = { info: ROM, sets: ROM + 0x1000, moves: ROM + 0x2000, evos: ROM + 0x3000, natures: ROM + 0x4000, exp: ROM + 0x5000, lists: ROM + 0x6000 };
const NORMAL = 0, FIRE = 10;

function cart(learn: Record<number, [number, number][]>, evos: Record<number, [number, number, number][]> = {}) {
  const bytes = new Uint8Array(0x8000);
  const w16 = (a: number, v: number) => { bytes[a - ROM] = v & 255; bytes[a - ROM + 1] = v >> 8; };
  const w32 = (a: number, v: number) => { w16(a, v & 0xffff); w16(a + 2, v >>> 16); };
  // Species 1 evolves at 16 in every cartridge: it's how the table's row size is told.
  for (const [sp, rows] of Object.entries({ 1: [[4, 16, 2]], ...evos })) {
    rows.forEach(([m, p, t], i) => { const e = AT.evos + Number(sp) * 40 + i * 8; w16(e, m); w16(e + 2, p); w16(e + 4, t); });
  }
  for (let sp = 0; sp < 8; sp++) {
    const s = AT.info + sp * 0x1c;
    bytes.set([50, 80, 50, 50, 40, 50, sp === 3 ? FIRE : NORMAL, sp === 3 ? FIRE : NORMAL], s - ROM);
  }
  // EXP as the level: every species on the one table.
  for (let lv = 0; lv <= 100; lv++) w32(AT.exp + lv * 4, lv);
  let at = AT.lists;
  for (const [sp, rows] of Object.entries(learn)) {
    w32(AT.sets + Number(sp) * 4, at);
    for (const [lv, move] of rows) { w16(at, (lv << 9) | move); at += 2; }
    w16(at, 0xffff);
    at += 2;
  }
  // Move n: an attack of n x 10 power, n >= 10 of FIRE's type; 9 is a status move.
  for (let id = 1; id < 30; id++) {
    const m = AT.moves + id * 12;
    bytes.set([id === 9 ? 1 : 0, id === 9 ? 0 : id * 10, id >= 10 ? FIRE : NORMAL, 100, 20], m - ROM);
  }
  const syms: Record<string, number> = { gSpeciesInfo: AT.info, gLevelUpLearnsets: AT.sets, gBattleMoves: AT.moves, gEvolutionTable: AT.evos, gNatureStatTable: AT.natures, gExperienceTables: AT.exp };
  return { bytes, sym: (n: string) => syms[n] };
}

describe('takenMon', () => {
  it('rolls as the game does, and the ball seeds it', () => {
    // gRngValue * 1103515245 + 24691, by hand, for the personality's two halves off seed 7's first ball.
    expect(teamSeed(7, 0)).toBe(0x1e001e07);
    const rom = cart({ 2: [[1, 1]] });
    expect(takenMon(rom, 2, 10, teamSeed(7, 0))!.personality).toBe((0xcf9d | (0x9809 << 16)) >>> 0);
  });

  it('knows the best four it could have by its level, not the last four written', () => {
    // 1..5 are all NORMAL: a second of a type is worth less, so one attack and... the status move.
    const rom = cart({ 2: [[1, 8], [2, 1], [3, 2], [4, 3], [5, 4], [99, 9]] });
    const t = takenMon(rom, 2, 10, null)!;
    expect(t.moves, 'the move past its level is no part of it').not.toContain(9);
    expect(t.moves, 'the strongest it has').toContain(8);
    expect(t.moves.length).toBe(4);
  });

  it('comes grown up as far as levelling goes, and learns as what it grew into', () => {
    const rom = cart({ 2: [[1, 1]], 3: [[1, 2], [1, 12]], 4: [[1, 3]] }, { 2: [[4, 20, 3]], 3: [[4, 60, 4]] });
    const low = takenMon(rom, 2, 19, null)!;
    expect(low.species).toBe(2);
    expect(low.moves).toEqual([1]);
    const up = takenMon(rom, 2, 30, null)!;
    expect(up.species, 'one step: the next is at 60').toBe(3);
    expect(up.moves).toEqual([1, 2, 12]);
    expect(takenMon(rom, 2, 60, null)!.species, 'a big jump is two').toBe(4);
  });

  it('asks the clock of one that evolves by the hour, and is as fond as can be', () => {
    const rom = cart({ 2: [[1, 1]], 3: [[1, 1]], 4: [[1, 1]] }, { 2: [[2, 0, 3], [3, 0, 4]] });
    expect(takenMon(rom, 2, 5, null, 15)!.species).toBe(3);
    expect(takenMon(rom, 2, 5, null, 3)!.species).toBe(4);
  });

  it('says nothing without the tables', () => {
    expect(takenMon({ bytes: new Uint8Array(0), sym: () => undefined }, 2, 5, null)).toBeNull();
  });
});
