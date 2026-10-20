import { describe, expect, it } from 'vitest';
import { HUD, HUD_PAGE, readFogHp, writeHudLeft, writeHudClockSecs, writeHudEyes, writeHudNoCorner, writeMySeat } from './hud';
import type { RamAccess } from './mailbox';

function fakeRam(): { ram: RamAccess; mem: Map<number, number> } {
  const mem = new Map<number, number>();
  const ram: RamAccess = {
    read: (addr, width) => {
      let v = 0;
      for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | (mem.get(addr + i) ?? 0);
      return v >>> 0;
    },
    write: (addr, value, width) => {
      for (let i = 0; i < width / 8; i++) mem.set(addr + i, (value >>> (8 * i)) & 0xff);
    },
    bytes: () => new Uint8Array(0),
  };
  return { ram, mem };
}

describe('hud.ts (the page-writes fields of gBrHud)', () => {
  it('writes left at +0x00 as a byte', () => {
    const { ram } = fakeRam();
    writeHudLeft(ram, 0x1000, 12);
    expect(ram.read(0x1000 + HUD.OFF_LEFT, 8)).toBe(12);
  });

  it('writes the eye count at +0x1a as a byte', () => {
    const { ram } = fakeRam();
    writeHudEyes(ram, 0x1000, 3);
    expect(ram.read(0x1000 + HUD.OFF_EYES, 8)).toBe(3);
    writeHudEyes(ram, 0x1000, 0);
    expect(ram.read(0x1000 + HUD.OFF_EYES, 8)).toBe(0);
  });

  it('clamps left to a byte', () => {
    const { ram } = fakeRam();
    writeHudLeft(ram, 0x1000, 999);
    expect(ram.read(0x1000 + HUD.OFF_LEFT, 8)).toBe(255);
  });

  it('writes clockSecs at +0x02 as a u16', () => {
    const { ram } = fakeRam();
    writeHudClockSecs(ram, 0x1000, 3600);
    expect(ram.read(0x1000 + HUD.OFF_CLOCK_SECS, 16)).toBe(3600);
  });

  it('writes gBrMySeat as a plain byte at its own address', () => {
    const { ram } = fakeRam();
    writeMySeat(ram, 0x2000, 5);
    expect(ram.read(0x2000, 8)).toBe(5);
  });

  it('writes noCorner as the page and noBattleBox only for a phone (#30)', () => {
    const { ram } = fakeRam();
    writeHudNoCorner(ram, 0x1000, HUD_PAGE.CORNER);
    expect([ram.read(0x1000 + HUD.OFF_NO_CORNER, 8), ram.read(0x1000 + HUD.OFF_NO_BATTLE_BOX, 8)]).toEqual([2, 0]);
    writeHudNoCorner(ram, 0x1000, HUD_PAGE.SIGNS);
    expect([ram.read(0x1000 + HUD.OFF_NO_CORNER, 8), ram.read(0x1000 + HUD.OFF_NO_BATTLE_BOX, 8)]).toEqual([1, 1]);
    writeHudNoCorner(ram, 0x1000, HUD_PAGE.NONE);
    expect([ram.read(0x1000 + HUD.OFF_NO_CORNER, 8), ram.read(0x1000 + HUD.OFF_NO_BATTLE_BOX, 8)]).toEqual([0, 0]);
  });

  it('reads the fog HP of the first mon standing, only outside the ring', () => {
    const { ram } = fakeRam();
    const syms: Record<string, number> = { gBrRing: 0x3000, gPlayerParty: 0x4000, gPlayerPartyCount: 0x5000 };
    const sym = (n: string) => syms[n];
    ram.write(0x5000, 3, 8);
    // an egg (hasSpecies | isEgg) with HP of its own, passed over as LeadHp passes it
    ram.write(0x4000 + 0x13, 6, 8);
    ram.write(0x4000 + 0x56, 9, 16);
    ram.write(0x4000 + 0x58, 9, 16);
    // fainted
    ram.write(0x4000 + 100 + 0x13, 2, 8);
    ram.write(0x4000 + 100 + 0x58, 30, 16);
    ram.write(0x4000 + 200 + 0x13, 2, 8);
    ram.write(0x4000 + 200 + 0x56, 26, 16);
    ram.write(0x4000 + 200 + 0x58, 40, 16);
    expect(readFogHp(ram, sym)).toBeNull();
    ram.write(0x3000 + 5, 1, 8);
    expect(readFogHp(ram, sym)).toBe('HP 26/40');
    expect(readFogHp(ram, () => undefined)).toBeNull();
  });
});
