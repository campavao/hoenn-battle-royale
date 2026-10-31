// tileset_anims.c's animations, as tables: the classic shell's core plays the towns' on a
// joined map (field-extra.ts sendTileAnims), and spike B plays these and the primary
// tileset's on every map it draws from the ROM (spike-b/romart.ts). On their own, so
// spike B gets them without the classic field's code.

/** One of tileset_anims.c's animations of a tileset's own tiles, as its QueueAnimTiles_*
 *  call reads: `frames` (a pointer array) shown `tiles` tiles at `dest` (a tile of the
 *  set's own) on the frames whose timer % div is `phase`, frame (timer / div - lag) %
 *  count. `eight` is one of eight, its VDests: phase and lag k at dest + 4k, for k 0..7.
 *  Mauville's flowers switch to `framesB` (countB long) past their first 12. */
export type TileAnim = { set: string; frames: string; count: number; tiles: number; div: number; dest: number; phase?: number; lag?: number; eight?: true; framesB?: string; countB?: number };

/** tileset_anims.c's TilesetAnim_* for the outdoor towns (array lengths checked against
 *  the source by field-extra.test.ts). */
export const TILE_ANIMS: readonly TileAnim[] = [
  { set: 'Rustboro', frames: 'Rustboro_WindyWater', count: 8, tiles: 4, div: 8, dest: 128, eight: true },
  { set: 'Rustboro', frames: 'Rustboro_Fountain', count: 2, tiles: 4, div: 8, dest: 448 },
  { set: 'Dewford', frames: 'Dewford_Flag', count: 4, tiles: 6, div: 8, dest: 170 },
  { set: 'Slateport', frames: 'Slateport_Balloons', count: 4, tiles: 4, div: 16, dest: 224 },
  { set: 'Mauville', frames: 'Mauville_Flower1', count: 12, framesB: 'Mauville_Flower1_B', countB: 4, tiles: 4, div: 8, dest: 96, eight: true },
  { set: 'Mauville', frames: 'Mauville_Flower2', count: 12, framesB: 'Mauville_Flower2_B', countB: 4, tiles: 4, div: 8, dest: 128, eight: true },
  { set: 'Lavaridge', frames: 'Lavaridge_Steam', count: 4, tiles: 4, div: 16, dest: 288 },
  { set: 'Lavaridge', frames: 'Lavaridge_Steam', count: 4, tiles: 4, div: 16, dest: 292, lag: -2 },
  { set: 'Lavaridge', frames: 'Lavaridge_Cave_Lava', count: 4, tiles: 4, div: 16, phase: 1, dest: 160 },
  { set: 'EverGrande', frames: 'EverGrande_Flowers', count: 8, tiles: 4, div: 8, dest: 224, eight: true },
  { set: 'Pacifidlog', frames: 'Pacifidlog_LogBridges', count: 4, tiles: 30, div: 16, dest: 464 },
  { set: 'Pacifidlog', frames: 'Pacifidlog_WaterCurrents', count: 8, tiles: 8, div: 16, phase: 1, dest: 496 },
  { set: 'Sootopolis', frames: 'Sootopolis_StormyWater', count: 8, tiles: 96, div: 16, dest: 240 },
  { set: 'BattleFrontierOutsideWest', frames: 'BattleFrontierOutsideWest_Flag', count: 4, tiles: 6, div: 8, dest: 218 },
  { set: 'BattleFrontierOutsideEast', frames: 'BattleFrontierOutsideEast_Flag', count: 4, tiles: 6, div: 8, dest: 218 },
];

/** TilesetAnim_General, the primary tileset's: the flowers, the sea and its sandy and
 *  grassy edges, the waterfalls. `dest` is a primary tile. The core never needed these
 *  (the ROM's own VRAM has them); spike B draws every map itself. */
export const GENERAL_ANIMS: readonly TileAnim[] = [
  { set: 'General', frames: 'General_Flower', count: 4, tiles: 4, div: 16, dest: 508 },
  { set: 'General', frames: 'General_Water', count: 8, tiles: 30, div: 16, phase: 1, dest: 432 },
  { set: 'General', frames: 'General_SandWaterEdge', count: 8, tiles: 10, div: 16, phase: 2, dest: 464 },
  { set: 'General', frames: 'General_Waterfall', count: 4, tiles: 6, div: 16, phase: 3, dest: 496 },
  { set: 'General', frames: 'General_LandWaterEdge', count: 4, tiles: 10, div: 16, phase: 4, dest: 480 },
];

/** sPrimaryTilesetAnimCounterMax: every timer above runs 0..255 and round again. */
export const ANIM_COUNTER_MAX = 256;

/** The frame `a`'s run `k` (0 unless `eight`) has on show at each step of the counter: the
 *  last one queued at or before it, round the counter's wrap. `table(name)` is the frame
 *  table's address, `ptr(at)` a pointer read from the ROM; a 0 entry queues nothing (one
 *  of Rustboro's windy water frames). 0 where nothing was ever queued. */
export function framesShown(a: TileAnim, k: number, table: (name: string) => number, ptr: (at: number) => number): number[] {
  const phase = a.eight ? k : a.phase ?? 0;
  const lag = a.eight ? k : a.lag ?? 0;
  const at = table(a.frames);
  const atB = a.framesB ? table(a.framesB) : 0;
  // QueueAnimTiles_*'s index: a u16 timer / div, less the lag, past 12 Mauville's B table.
  const queued = (u: number): number => {
    const d = (Math.floor(u / a.div) - lag + 0x10000) & 0xffff;
    return a.framesB && d >= a.count ? ptr(atB + (d % a.countB!) * 4) : ptr(at + (d % a.count) * 4);
  };
  const out: number[] = [];
  for (let c = 0; c < ANIM_COUNTER_MAX; c++) {
    let f = 0;
    for (let back = 0; back < 2 * ANIM_COUNTER_MAX && !f; back++) {
      const u = (c - back + 2 * ANIM_COUNTER_MAX) % ANIM_COUNTER_MAX;
      if (u % a.div === phase) f = queued(u);
    }
    out.push(f);
  }
  return out;
}
