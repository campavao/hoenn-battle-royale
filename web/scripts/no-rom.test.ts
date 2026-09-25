// The last ROM lock (POK-330 #57): scripts/no-rom.mjs finds a ROM by its header too, so
// a renamed one cannot ride a build out.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRoms, looksLikeRom } from './no-rom.mjs';

/** A cartridge header and nothing else: the logo's first bytes, the fixed 0x96, and a
 *  game code. No retail bytes beyond the header fields the check reads. */
function header(code = 'AXVE'): Uint8Array {
  const h = new Uint8Array(0x200);
  h.set([0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21], 4);
  h.set([...code].map((c) => c.charCodeAt(0)), 0xac);
  h[0xb2] = 0x96;
  return h;
}

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('no-rom', () => {
  it('knows a GBA header, and Emerald by its game code alone', () => {
    expect(looksLikeRom(header())).toBe(true);
    const emeraldOnly = new Uint8Array(0x200);
    emeraldOnly.set([0x42, 0x50, 0x45, 0x45], 0xac); // 'BPEE'
    expect(looksLikeRom(emeraldOnly)).toBe(true);
    expect(looksLikeRom(new TextEncoder().encode('x'.repeat(0x200)))).toBe(false);
    expect(looksLikeRom(header().subarray(0, 0x40))).toBe(false); // too short to be one
  });

  it('finds a ROM in dist by name, and a renamed one by its header', () => {
    dir = mkdtempSync(join(tmpdir(), 'no-rom-'));
    mkdirSync(join(dir, 'assets'));
    mkdirSync(join(dir, 'patch'));
    writeFileSync(join(dir, 'assets', 'main.js'), 'console.log("shell")'.repeat(40));
    writeFileSync(join(dir, 'patch', 'hoenn-br.bps'), new Uint8Array(0x400).fill(7));
    writeFileSync(join(dir, 'patch', 'pokeemerald.gba'), header('BPEE'));
    writeFileSync(join(dir, 'patch', 'game.bin'), header('BPEE'));
    writeFileSync(join(dir, 'assets', 'other-cart'), header('AXVE'));
    writeFileSync(join(dir, 'slot.sav'), new Uint8Array(0x100));

    const found = findRoms(dir).map((p: string) => p.slice(dir.length + 1).replace(/\\/g, '/')).sort();
    expect(found).toEqual(['assets/other-cart', 'patch/game.bin', 'patch/pokeemerald.gba', 'slot.sav']);
  });
});
