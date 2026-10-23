// The towns' tileset animations the core plays (field-extra.ts TILE_ANIMS), held to
// tileset_anims.c: each frame table's length, and where and how much each one draws.
import { describe, expect, it } from 'vitest';
import { TILE_ANIMS, coreDrew, stillsOver } from './field-extra';
import type { Reached } from './field';

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

describe('coreDrew', () => {
  const map = (w: number, h: number) => ({ w, h }) as unknown as Reached['map'];
  // Route 101 with Oldale above it and Route 102 left of Oldale, as the core lists them.
  const drawn = Int32Array.from([1, 2, 0x08480000, 0, -20, 20, 20, -50, -20, 50, 20]);
  it('matches a map the core drew by its place and size', () => {
    expect(coreDrew(drawn, { map: map(20, 20), x: 0, y: -320, hops: 1 })).toBe(true);
    expect(coreDrew(drawn, { map: map(50, 20), x: -800, y: -320, hops: 2 })).toBe(true);
  });
  it('not one it left out, or one elsewhere', () => {
    expect(coreDrew(drawn, { map: map(40, 60), x: 320, y: 0, hops: 1 })).toBe(false);
    expect(coreDrew(drawn, { map: map(20, 20), x: 16, y: -320, hops: 1 })).toBe(false);
    expect(coreDrew(null, { map: map(20, 20), x: 0, y: -320, hops: 1 })).toBe(false);
  });
});

describe('stillsOver', () => {
  const map = (w: number, h: number) => ({ w, h }) as unknown as Reached['map'];
  const here = { map: map(20, 20), x: 0, y: 0, hops: 0 };
  const oldale = { map: map(20, 20), x: 0, y: -320, hops: 1 };
  const littleroot = { map: map(20, 20), x: 0, y: 320, hops: 1 };
  const r102 = { map: map(50, 20), x: -800, y: -320, hops: 2 };
  const reached = [here, oldale, littleroot, r102];
  it('without the core\'s list: the maps two seams away', () => {
    expect(stillsOver(reached, null)).toEqual([r102]);
    expect(stillsOver(reached, Int32Array.from([0, 0, 0]), 7)).toEqual([r102]);
  });
  it('with it: every joined map it left out, near or far', () => {
    expect(stillsOver(reached, Int32Array.from([1, 2, 7, 0, -20, 20, 20, -50, -20, 50, 20]), 7)).toEqual([littleroot]);
    expect(stillsOver(reached, Int32Array.from([1, 0, 7]), 7)).toEqual([oldale, littleroot, r102]);
  });
  it('none from a list made on another map than the camera\'s', () => {
    expect(stillsOver(reached, Int32Array.from([1, 2, 7, 0, -20, 20, 20, -50, -20, 50, 20]), 8)).toEqual([]);
  });
});
