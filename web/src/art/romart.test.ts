import { describe, expect, it } from 'vitest';
import { artRequest } from './client';
import { lz77, rgba } from './romart';

const LITTLEROOT = { group: 0, num: 9 };
const ref = (id: string) => (id === 'MAP_LITTLEROOT_TOWN' ? LITTLEROOT : undefined);

describe('artRequest', () => {
  it('reads the paths the page has always drawn from', () => {
    expect(artRequest('/field-maps/MAP_LITTLEROOT_TOWN.png', ref)).toEqual({ t: 'map', group: 0, num: 9, layer: 'ground' });
    expect(artRequest('/field-maps/MAP_LITTLEROOT_TOWN.cover.png', ref)).toEqual({ t: 'map', group: 0, num: 9, layer: 'cover' });
    expect(artRequest('/field-maps/MAP_LITTLEROOT_TOWN.border.png', ref)).toEqual({ t: 'map', group: 0, num: 9, layer: 'border' });
    expect(artRequest('/field-sprites/0.png', ref)).toEqual({ t: 'sheet', gfx: 0, frames: 18 });
    expect(artRequest('/field-sprites/1000.png', ref)).toEqual({ t: 'surf' });
    expect(artRequest('/field-sprites/fog.png', ref)).toEqual({ t: 'fog' });
    expect(artRequest('/field-sprites/patch-tall-grass.png', ref)).toEqual({ t: 'mark', mark: 'tall-grass' });
    expect(artRequest('/field-sprites/patch-water.png', ref)).toEqual({ t: 'mark', mark: 'water' });
    expect(artRequest('/field-sprites/patch-shadow.png', ref)).toEqual({ t: 'mark', mark: 'shadow' });
    expect(artRequest('/mon-pics/1.png', ref)).toEqual({ t: 'mon', species: 1, shiny: false });
    expect(artRequest('/mon-pics/439s.png', ref)).toEqual({ t: 'mon', species: 439, shiny: true });
    expect(artRequest('/trainer-pics/0.png', ref)).toEqual({ t: 'trainer', pic: 0 });
    expect(artRequest('/trainer-pics/92.png', ref)).toEqual({ t: 'trainer', pic: 92 });
  });

  it('has nothing for a path that is not the ROM\'s art, or names nothing', () => {
    expect(artRequest('/ui/font-normal.png', ref)).toBeNull();
    expect(artRequest('/mon-pics/0.png', ref)).toBeNull();
    expect(artRequest('/mon-pics/440.png', ref)).toBeNull();
    expect(artRequest('/trainer-pics/93.png', ref)).toBeNull();
    expect(artRequest('/field-maps/MAP_NOWHERE.png', ref)).toBeNull();
    expect(artRequest('/field-sprites/999.png', ref)).toBeNull();
    expect(artRequest('/field-sprites/0.cover.png', ref)).toBeNull();
  });
});

describe('lz77', () => {
  it('expands literals and a back reference', () => {
    // 6 bytes: 'a' 'b' literal, then copy 4 from 2 back (len 4 = 1+3, disp 2 = 1+1).
    const rom = Uint8Array.from([0x10, 6, 0, 0, 0b0010_0000, 0x61, 0x62, 0x10, 0x01]);
    expect(Array.from(lz77(rom, 0))).toEqual([0x61, 0x62, 0x61, 0x62, 0x61, 0x62]);
  });

  it('refuses what is not LZ77', () => {
    expect(() => lz77(Uint8Array.from([0x11, 0, 0, 0]), 0)).toThrow('not LZ77');
  });
});

describe('rgba', () => {
  it('widens BGR555 as render-maps.py does, opaque', () => {
    expect(rgba(0x7fff)).toBe(0xfff8f8f8);
    expect(rgba(31)).toBe(0xff0000f8);
    expect(rgba(31 << 10)).toBe(0xfff80000);
  });
});
