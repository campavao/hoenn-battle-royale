// The towns' tileset animations the core plays (field-extra.ts TILE_ANIMS), held to
// tileset_anims.c: each frame table's length, and where and how much each one draws.
import { describe, expect, it } from 'vitest';
import { TILE_ANIMS } from './field-extra';

const source = (Object.values(import.meta.glob<string>('../../src/tileset_anims.c', { query: '?raw', import: 'default', eager: true }))[0] ?? '').replace(/\r\n/g, '\n');

/** The QueueAnimTiles_ function that draws from gTilesetAnims_`frames`. */
function queuer(frames: string): string {
  const at = source.search(new RegExp(`AppendTilesetAnimToBuffer\\(gTilesetAnims_${frames}\\[`));
  const fns = [...source.slice(0, at).matchAll(/static void (QueueAnimTiles_\w+)\(/g)];
  if (at < 0 || !fns.length) throw new Error(`nothing queues gTilesetAnims_${frames}`);
  return fns[fns.length - 1][1];
}

/** TilesetAnim_`set`'s body. */
function tilesetAnim(set: string): string {
  const m = new RegExp(`static void TilesetAnim_${set}\\(u16 timer\\)\\n\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!m) throw new Error(`no TilesetAnim_${set} in tileset_anims.c`);
  return m[1];
}

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
        const lag = a.lag ? `\\(timer \\+ ${-a.lag}\\) % \\(int\\)` : 'timer % ';
        expect(source, 'lag').toMatch(new RegExp(`i = ${lag}ARRAY_COUNT\\(gTilesetAnims_${a.frames}\\);\\n\\s*AppendTilesetAnimToBuffer\\(gTilesetAnims_${a.frames}\\[i\\], \\(u16 \\*\\)\\(BG_VRAM \\+ TILE_OFFSET_4BPP\\(NUM_TILES_IN_PRIMARY \\+ ${a.dest}\\)`));
        expect(source).toMatch(new RegExp(`gTilesetAnims_${a.frames}\\[i\\], \\(u16 \\*\\)\\(BG_VRAM \\+ TILE_OFFSET_4BPP\\(NUM_TILES_IN_PRIMARY \\+ ${a.dest}\\)\\), ${a.tiles} \\* TILE_SIZE_4BPP`));
      }
    });

    it(`${a.frames} at ${a.dest}: queued when timer % ${a.div} is ${a.eight ? '0..7' : a.phase ?? 0}`, () => {
      const body = tilesetAnim(a.set);
      const fn = queuer(a.frames);
      for (const k of a.eight ? [0, 1, 2, 3, 4, 5, 6, 7] : [a.phase ?? 0]) {
        const call = a.eight ? `${fn}\\(timer / ${a.div}, ${k}\\)` : `${fn}\\(timer / ${a.div}\\)`;
        expect(body).toMatch(new RegExp(`if \\(timer % ${a.div} == ${k}\\)\\s*\\{?\\s*(\\w+\\([^;]*\\);\\s*)*${call};`));
      }
    });
  }
});
