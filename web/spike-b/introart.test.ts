import { describe, expect, it } from 'vitest';
import { crc32, findPal, unlz } from './introart';
import { sceneScale } from './loading';

describe('introart', () => {
  it('crc32 is the zip one', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('unlz reads literals and back-references', () => {
    // header 0x10, size 8; flags 0b0000_1000: four literals, then one 4-byte copy from 4 back
    const rom = new Uint8Array([0x10, 8, 0, 0, 0x08, 1, 2, 3, 4, 0x10, 0x03]);
    expect([...unlz(rom, 0, 8)]).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it('a palette is found where retail has it, or anywhere near its art', () => {
    const rom = new Uint8Array(0x1000);
    const pal = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
    rom.set(pal, 0x340);
    const crc = crc32(pal);
    expect(findPal(rom, 0x400, { near: 'grass', delta: -0xc0, crc })).toBe(0x340);
    expect(findPal(rom, 0x400, { near: 'grass', delta: -0x20, crc })).toBe(0x340);
    expect(findPal(rom, 0x400, { near: 'grass', delta: -0x20, crc: crc ^ 1 })).toBeNull();
  });

  it('the scene is scaled by whole pixels, wide enough for the riders', () => {
    expect(sceneScale(390, 844)).toBe(2);
    expect(sceneScale(1280, 720)).toBe(2);
    expect(sceneScale(1920, 1080)).toBe(4);
    expect(sceneScale(200, 300)).toBe(1);
  });
});
