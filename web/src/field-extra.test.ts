// The towns' tileset animations the core plays (field-extra.ts TILE_ANIMS), held to
// tileset_anims.c: each frame table's length, and where and how much each one draws.
import { describe, expect, it } from 'vitest';
import { TILE_ANIMS } from './field-extra';

const source = (Object.values(import.meta.glob<string>('../../src/tileset_anims.c', { query: '?raw', import: 'default', eager: true }))[0] ?? '').replace(/\r\n/g, '\n');

function array(name: string): string[] {
  const m = new RegExp(`gTilesetAnims_${name}\\[\\]\\s*=\\s*\\{([^}]*)\\}`).exec(source);
  if (!m) throw new Error(`no gTilesetAnims_${name} in tileset_anims.c`);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

describe('TILE_ANIMS', () => {
  it('reads tileset_anims.c', () => expect(source.length).toBeGreaterThan(1000));

  for (const a of TILE_ANIMS) {
    it(`${a.frames} at ${a.dest}: its table's length, its tiles and where they go`, () => {
      expect(array(a.frames).length, 'frames').toBe(a.count);
      if (a.framesB) expect(array(a.framesB).length, 'framesB').toBe(a.countB);
      if (a.eight) {
        const vdests = a.frames === 'EverGrande_Flowers' ? 'EverGrande_VDests' : `${a.frames}_VDests`;
        expect(array(vdests).map((d) => Number(/NUM_TILES_IN_PRIMARY \+ (\d+)/.exec(d)?.[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((k) => a.dest + 4 * k));
        expect(source).toContain(`gTilesetAnims_${a.frames}[timer_div], gTilesetAnims_${vdests}[timer_mod], ${a.tiles} * TILE_SIZE_4BPP`);
      } else {
        expect(source).toMatch(new RegExp(`gTilesetAnims_${a.frames}\\[i\\], \\(u16 \\*\\)\\(BG_VRAM \\+ TILE_OFFSET_4BPP\\(NUM_TILES_IN_PRIMARY \\+ ${a.dest}\\)\\), ${a.tiles} \\* TILE_SIZE_4BPP`));
      }
    });
  }
});
