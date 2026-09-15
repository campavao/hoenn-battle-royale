import { describe, expect, it } from 'vitest';
import { HUD, writeHudLeft, writeHudClockSecs, writeMySeat } from './hud';
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
});
