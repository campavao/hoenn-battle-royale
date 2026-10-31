// The primary tileset's animations spike B plays (tile-anims.ts GENERAL_ANIMS), held to
// tileset_anims.c, and the frame each one has on show as the counter goes round.
import { describe, expect, it } from 'vitest';
import { ANIM_COUNTER_MAX, GENERAL_ANIMS, TILE_ANIMS, framesShown } from './tile-anims';

const source = (Object.values(import.meta.glob<string>('../../src/tileset_anims.c', { query: '?raw', import: 'default', eager: true }))[0] ?? '').replace(/\r\n/g, '\n');

function array(name: string): string[] {
  const m = new RegExp(`gTilesetAnims_${name}\\[\\]\\s*=\\s*\\{([^}]*)\\}`).exec(source);
  if (!m) throw new Error(`no gTilesetAnims_${name} in tileset_anims.c`);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

describe('GENERAL_ANIMS', () => {
  it('reads tileset_anims.c, whose counter wraps at 256', () => {
    expect(source).toContain(`sPrimaryTilesetAnimCounterMax = ${ANIM_COUNTER_MAX};`);
  });

  for (const a of GENERAL_ANIMS) {
    it(`${a.frames}: its table's length, its tiles, where they go and when`, () => {
      expect(array(a.frames).length, 'frames').toBe(a.count);
      expect(source).toMatch(new RegExp(`AppendTilesetAnimToBuffer\\(gTilesetAnims_${a.frames}\\[i\\], \\(u16 \\*\\)\\(BG_VRAM \\+ TILE_OFFSET_4BPP\\(${a.dest}\\)\\), ${a.tiles} \\* TILE_SIZE_4BPP`));
      const fn = `QueueAnimTiles_${a.frames}`;
      expect(source).toMatch(new RegExp(`if \\(timer % ${a.div} == ${a.phase ?? 0}\\)\\n\\s*${fn}\\(timer / ${a.div}\\);`));
    });
  }
});

describe('framesShown', () => {
  // The table at 1000; a pointer read gives back the entry's address, so the frame on show
  // is (shown - 1000) / 4.
  const table = () => 1000;
  const ptr = (at: number) => at;
  const index = (a: (typeof GENERAL_ANIMS)[number], k = 0) => framesShown(a, k, table, ptr).map((f) => (f - 1000) / 4);

  it('the sea: a new frame every 16 steps from step 1, the last one carried round the wrap', () => {
    const water = GENERAL_ANIMS.find((a) => a.frames === 'General_Water')!;
    const shown = index(water);
    expect(shown[1]).toBe(0);
    expect(shown[16]).toBe(0);
    expect(shown[17]).toBe(1);
    expect(shown[255]).toBe(7);
    // Step 0 is before this round's first queue: still the frame step 241 put up.
    expect(shown[0]).toBe(15 % 8);
  });

  it("one of eight of Mauville's flowers: its own phase and lag, then the B table past 12", () => {
    const flower = TILE_ANIMS.find((a) => a.frames === 'Mauville_Flower1')!;
    const at = (name: string) => (name === 'Mauville_Flower1_B' ? 2000 : 1000);
    const shown = framesShown(flower, 3, at, ptr);
    // timer 3 + 8k queues (timer / 8 - 3): k < 3 wraps the u16 and reads B.
    expect(shown[3 + 8 * 3]).toBe(1000);
    expect(shown[3 + 8 * 14]).toBe(1000 + 11 * 4);
    expect(shown[3 + 8 * 15]).toBe(2000 + (12 % 4) * 4);
  });

  it("Rustboro's windy water keeps the last frame over an empty entry", () => {
    const windy = TILE_ANIMS.find((a) => a.frames === 'Rustboro_WindyWater')!;
    const shown = framesShown(windy, 0, table, (at) => ((at - 1000) / 4 === 2 ? 0 : at));
    expect(shown[16]).toBe(1000 + 4); // timer 16 queued entry 2: nothing, so entry 1 stays
  });
});
