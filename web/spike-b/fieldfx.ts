// What a step leaves on the ground, as the ROM's field effects have it (event_object_movement.c
// GetAllGroundEffectFlags_OnBeginStep, field_effect_objects.h's anims): grass rustling, ash
// puffing off and leaving plain grass (field_tasks.c AshGrassPerStepCallback; Cam, 11-01: "the
// dust here should be showing, you know when you walk over it"), footprints in sand, tyre tracks,
// a puddle's splash, a ledge's dust. Spike B's field has no ROM sprites under it, so the page
// plays them, in the ROM's frames and timings, for whoever walks in view.

export const MB_TALL_GRASS = 2, MB_LONG_GRASS = 3, MB_DEEP_SAND = 6, MB_PUDDLE = 22, MB_SAND = 33, MB_ASHGRASS = 36;

export type FxKind = 'grass' | 'long' | 'ash' | 'foot' | 'deep' | 'tire' | 'splash' | 'dust';

/** A timeline's [frame of the sheet, how long], each one's sAnim. */
const TIMELINE: Record<'grass' | 'long' | 'ash' | 'splash' | 'dust', [number, number][]> = {
  grass: [[1, 10], [2, 10], [3, 10], [4, 10], [0, 10]],
  long: [[1, 3], [2, 3], [0, 4], [3, 4], [0, 4], [3, 4], [0, 4]],
  ash: [[0, 12], [1, 12], [2, 8], [3, 12], [4, 12]],
  splash: [[0, 4], [1, 4]],
  dust: [[0, 8], [1, 8], [2, 8]],
};

/** FadeFootprintsTireTracks: whole for 40 frames, then flickering to 56. */
const TRACK_WHOLE = 40, TRACK_GONE = 56;
/** UpdateAshFieldEffect's wait: StartAshFieldEffect's delay of 4, then the tile changes. */
export const ASH_DELAY = 4;
/** A ledge's hop is 32 frames (sim.ts), and the dust comes as it lands. */
const HOP_FRAMES = 32;

/** A track's look: the sheet's frame and its flips. */
export interface TrackLook { frame: number; hFlip: boolean; vFlip: boolean }

export interface Effect {
  kind: FxKind;
  /** World pixels of the cell it plays on, top-left. */
  x: number;
  y: number;
  /** The frame it starts on. */
  start: number;
  look?: TrackLook;
}

/** sAnimTable_SandFootprints, by DIR_SOUTH 1, NORTH 2, WEST 3, EAST 4. */
function footLook(dir: number): TrackLook {
  if (dir === 1) return { frame: 0, hFlip: false, vFlip: true };
  if (dir === 3) return { frame: 1, hFlip: false, vFlip: false };
  if (dir === 4) return { frame: 1, hFlip: true, vFlip: false };
  return { frame: 0, hFlip: false, vFlip: false };
}

/** bikeTireTracks_Transitions: the shape by the way it came and the way it goes. */
const TIRE_SHAPE = [[1, 2, 7, 8], [1, 2, 6, 5], [5, 8, 3, 4], [6, 7, 3, 4]];
/** sAnimTable_BikeTireTracks by that shape. */
const TIRE_LOOK: TrackLook[] = [
  { frame: 2, hFlip: false, vFlip: false }, // unused 0
  { frame: 2, hFlip: false, vFlip: false }, // south
  { frame: 2, hFlip: false, vFlip: false }, // north
  { frame: 1, hFlip: false, vFlip: false }, // west
  { frame: 1, hFlip: false, vFlip: false }, // east
  { frame: 0, hFlip: false, vFlip: false }, // SE corner
  { frame: 0, hFlip: true, vFlip: false }, // SW corner
  { frame: 3, hFlip: true, vFlip: false }, // NW corner
  { frame: 3, hFlip: false, vFlip: false }, // NE corner
];

export function tireLook(cameFrom: number, going: number): TrackLook {
  const row = TIRE_SHAPE[cameFrom - 1] ?? TIRE_SHAPE[0];
  return TIRE_LOOK[row[going - 1] ?? 1];
}

export interface Step {
  /** The behaviour of the cell left and the cell entered (romart.ts behavior). */
  from: number;
  to: number;
  /** World pixels of those cells. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** The way it goes, and the way it was going before. */
  dir: number;
  cameFrom: number;
  bike: boolean;
  hop: boolean;
  /** This cell's ash is already off. */
  ashGone: boolean;
}

/** What one step starts. */
export function stepEffects(s: Step, now: number): Effect[] {
  const out: Effect[] = [];
  if (s.to === MB_TALL_GRASS) out.push({ kind: 'grass', x: s.toX, y: s.toY, start: now });
  else if (s.to === MB_LONG_GRASS) out.push({ kind: 'long', x: s.toX, y: s.toY, start: now });
  else if (s.to === MB_PUDDLE) out.push({ kind: 'splash', x: s.toX, y: s.toY, start: now });
  else if (s.to === MB_ASHGRASS && !s.ashGone) out.push({ kind: 'ash', x: s.toX, y: s.toY, start: now + ASH_DELAY });
  else if (s.hop) out.push({ kind: 'dust', x: s.toX, y: s.toY, start: now + HOP_FRAMES });
  if (s.from === MB_SAND || s.from === MB_DEEP_SAND) {
    if (s.bike) out.push({ kind: 'tire', x: s.fromX, y: s.fromY, start: now, look: tireLook(s.cameFrom, s.dir) });
    else out.push({ kind: s.from === MB_SAND ? 'foot' : 'deep', x: s.fromX, y: s.fromY, start: now, look: footLook(s.dir) });
  }
  return out;
}

/** The sheet's frame an effect is on at `now`: null before it starts or between flickers,
 *  'done' once it is over. */
export function frameOf(e: Effect, now: number): number | null | 'done' {
  const t = now - e.start;
  if (t < 0) return null;
  if (e.kind === 'foot' || e.kind === 'deep' || e.kind === 'tire') {
    if (t > TRACK_GONE) return 'done';
    if (t > TRACK_WHOLE && t & 1) return null;
    return e.look!.frame;
  }
  let left = t;
  for (const [frame, n] of TIMELINE[e.kind]) {
    if (left < n) return frame;
    left -= n;
  }
  return 'done';
}

/** On the ground under everybody; the rest stand among them by where they are. */
export function isFloor(k: FxKind): boolean {
  return k === 'foot' || k === 'deep' || k === 'tire';
}

/** Each sheet's size: how many frames, and how tall (16 wide). */
export const SHEETS: Record<FxKind, { frames: number; h: number }> = {
  grass: { frames: 5, h: 16 },
  long: { frames: 4, h: 16 },
  ash: { frames: 5, h: 16 },
  foot: { frames: 2, h: 16 },
  deep: { frames: 2, h: 16 },
  tire: { frames: 4, h: 16 },
  splash: { frames: 2, h: 8 },
  dust: { frames: 3, h: 8 },
};

/** The ROM's ash grass under `block` gives way to this plain grass (AshGrassPerStepCallback). */
export function grassUnderAsh(block: number): number {
  const METATILE_Fallarbor_AshGrass = 0x20a, METATILE_Fallarbor_NormalGrass = 0x212, METATILE_Lavaridge_NormalGrass = 0x206;
  return (block & 0x3ff) === METATILE_Fallarbor_AshGrass ? METATILE_Fallarbor_NormalGrass : METATILE_Lavaridge_NormalGrass;
}
