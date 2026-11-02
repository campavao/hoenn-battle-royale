// Spike B: the player's movement, frame for frame the ROM's (field_player_avatar.c,
// event_object_movement.c). Pure, so timing.test.ts can feed it the same keys a ROM
// trace was taken with and compare every frame.
//
//   input: up > down > left > right, read only when no movement action is running
//          (field_control_avatar.c GetPlayerInput)
//   NOT_MOVING -> a new direction while not MOVING turns in place: walk-in-place fast,
//          8 frames, then the step (CheckMovementInputNotOnBike)
//   a step: 16 frames at 1 px walking, 8 at 2 px running; BR runs unless B is held
//   a wall: walk-in-place slow, 32 frames, no movement (PlayerNotOnBikeCollide); a new
//          direction cuts it short
//   a ledge: 32 frames at 1 px, lifted by sJumpY_High[t >> 1] (DoJumpSpriteMovement)
//   the MACH BIKE (bike.c): SELECT gets on and off where a bike may go; on it each step
//          is 16, then 8, then 4 frames while a direction is held, and let go it coasts
//          down the same speeds to a stop; a wall stops it dead (walk in place, 16)

import type { Spot, SeamDir } from '../src/bots/world';

export const DIR_SOUTH = 1, DIR_NORTH = 2, DIR_WEST = 3, DIR_EAST = 4;
export const SEAM_OF: Record<number, SeamDir> = { 1: 'south', 2: 'north', 3: 'west', 4: 'east' };
const DXY: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };
const JUMP_Y_HIGH = [-4, -6, -8, -10, -11, -12, -12, -12, -11, -10, -9, -8, -6, -4, 0, 0];

export const NOT_MOVING = 0, TURN_DIRECTION = 1, MOVING = 2;

export interface Keys { up?: boolean; down?: boolean; left?: boolean; right?: boolean; b?: boolean; a?: boolean; select?: boolean }

export type ActionKind = 'step' | 'turn' | 'bump' | 'hop' | 'warp';
export interface Action { kind: ActionKind; t: number; len: number; speed: number; dir: number; land?: Spot }

export interface Mover {
  spot: Spot;
  /** The ROM's previousCoords: the tile a step is leaving, caught up when the next
   *  action is chosen (ShiftObjectEventCoords / the step's end). */
  prev: Spot;
  facing: number;
  moveDir: number;
  runningState: number;
  action: Action | null;
  /** Pixels walked off the tile the step left: (dx, dy) world px, and the hop's lift. */
  px: number;
  py: number;
  lift: number;
  run: boolean;
  /** Whole frames counted toward the walk anim (feet alternate per step). */
  strides: number;
  /** Just through a door: the way to walk on, off the mat or the door (Cam 11-01). */
  walkOn?: number;
  /** On the MACH BIKE, and gPlayerAvatar's bikeSpeed and bikeFrameCounter for it. */
  bike: boolean;
  bikeSpeed: number;
  bikeCount: number;
  /** SELECT was held when the last action was chosen: a press is a new one. */
  sel: boolean;
}

/** Where a step toward `dir` lands, or null for a wall. 2 cells away is a ledge hop; `warp`
 *  is a door, stairs or a cave mouth, which lands on the other side's own cell. */
export type StepFn = ((from: Spot, dir: number) => { to: Spot; hop: boolean; warp?: boolean; water?: boolean } | null) & {
  /** Whether a bike may be ridden on `s`'s map; none of it without. */
  cycling?: (s: Spot) => boolean;
};

/** export-world.py's water class: SURF's ground. */
export const CLASS_WATER = 2;

/** Frames a door takes: the screen fades out and back in (the field's 16-frame fades). */
export const WARP_FRAMES = 32;

export function newMover(spot: Spot, facing = DIR_SOUTH): Mover {
  return { spot, prev: spot, facing, moveDir: facing, runningState: NOT_MOVING, action: null, px: 0, py: 0, lift: 0, run: true, strides: 0, bike: false, bikeSpeed: 0, bikeCount: 0, sel: false };
}

export function dirOf(k: Keys): number {
  if (k.up) return DIR_NORTH;
  if (k.down) return DIR_SOUTH;
  if (k.left) return DIR_WEST;
  if (k.right) return DIR_EAST;
  return 0;
}

/** One frame. Returns the step that began this frame, if any (for encounters etc. the
 *  ROM checks on arrival; the caller decides). */
export function tick(m: Mover, keys: Keys, step: StepFn): void {
  // Walking into a wall is the one action a key can cut short: a new direction, or the
  // same one once the way is clear (TryInterruptObjectEventSpecialAnim).
  if (m.action?.kind === 'bump') {
    const dir = dirOf(keys);
    if (dir && (dir !== m.moveDir || step(m.spot, dir))) m.action = null;
  }
  if (!m.action) begin(m, keys, step);
  const a = m.action;
  if (!a) return;
  if (a.kind === 'step' || a.kind === 'hop') {
    const [dx, dy] = DXY[a.dir];
    m.px += dx * a.speed;
    m.py += dy * a.speed;
    m.lift = a.kind === 'hop' ? JUMP_Y_HIGH[a.t >> 1] : 0;
  }
  a.t += 1;
  // A ledge hop moves the trainer's coords a tile at its start and the second at its
  // halfway frame (InitJump's sJumpInitDisplacements, UpdateJumpAnim's sJumpDisplacements).
  if (a.kind === 'hop' && a.t === a.len >> 1 && a.land) {
    const [dx, dy] = DXY[a.dir];
    m.spot = a.land;
    m.px -= dx * 16;
    m.py -= dy * 16;
  }
  if (a.t >= a.len) {
    m.action = null;
    m.px = 0;
    m.py = 0;
    m.lift = 0;
    if (a.kind === 'warp') m.walkOn = a.dir;
  }
}

/** bike.c's sMachBikeSpeedCallbacks: PlayerWalkNormal, PlayerWalkFast, PlayerWalkFaster. */
const BIKE_PX = [1, 2, 4];

function begin(m: Mover, keys: Keys, step: StepFn): void {
  m.prev = m.spot;
  // SELECT, the registered MACH BIKE (GetOnOffBike): on where cycling is allowed, off anywhere.
  const press = !!keys.select && !m.sel;
  m.sel = !!keys.select;
  if (press && (m.bike || step.cycling?.(m.spot))) {
    m.bike = !m.bike;
    m.bikeSpeed = m.bikeCount = 0;
    m.runningState = NOT_MOVING;
    return;
  }
  const on = m.walkOn ?? 0;
  m.walkOn = 0;
  const walking = on ? step(m.spot, on) : null;
  const going = walking && !walking.warp && !walking.hop && !walking.water;
  if (m.bike) return bikeBegin(m, going ? on : dirOf(keys), step);
  const dir = going ? on : dirOf(keys);
  if (going) m.moveDir = on;
  if (!dir) {
    m.runningState = NOT_MOVING;
    return;
  }
  if (dir !== m.moveDir && m.runningState !== MOVING) {
    m.runningState = TURN_DIRECTION;
    m.facing = m.moveDir = dir;
    m.action = { kind: 'turn', t: 0, len: 8, speed: 0, dir };
    return;
  }
  m.runningState = MOVING;
  m.facing = m.moveDir = dir;
  const to = step(m.spot, dir);
  if (!to) {
    m.action = { kind: 'bump', t: 0, len: 32, speed: 0, dir };
    return;
  }
  m.run = !keys.b;
  // The ROM's coords move to the destination as the step starts; the pixels catch up.
  m.prev = m.spot;
  m.strides += 1;
  if (to.warp) {
    // Through a door: there at once, standing, while the screen fades over.
    m.spot = to.to;
    m.action = { kind: 'warp', t: 0, len: WARP_FRAMES, speed: 0, dir };
    m.px = 0;
    m.py = 0;
  } else if (to.hop) {
    m.spot = { map: to.to.map, x: to.to.x - DXY[dir][0], y: to.to.y - DXY[dir][1] };
    m.action = { kind: 'hop', t: 0, len: 32, speed: 1, dir, land: to.to };
    m.px = -DXY[dir][0] * 16;
    m.py = -DXY[dir][1] * 16;
  } else {
    m.spot = to.to;
    // On the water it is SURF's pace, two pixels a frame, B or no B (PLAYER_SPEED_FAST).
    const speed = m.run || to.water ? 2 : 1;
    m.action = { kind: 'step', t: 0, len: 16 / speed, speed, dir };
    m.px = -DXY[dir][0] * 16;
    m.py = -DXY[dir][1] * 16;
  }
}

/** GetMachBikeTransition and its four transitions: face, turn, speed up, slow down. */
function bikeBegin(m: Mover, input: number, step: StepFn): void {
  let dir = input;
  if (!dir) {
    dir = m.moveDir;
    if (m.bikeSpeed === 0) { m.runningState = NOT_MOVING; m.bikeCount = 0; return; }
    m.runningState = MOVING;
    return bikeGo(m, dir, step, true);
  }
  if (dir !== m.moveDir && m.runningState !== MOVING) {
    if (m.bikeSpeed !== 0) { m.runningState = MOVING; return bikeGo(m, m.moveDir, step, true); }
    m.runningState = TURN_DIRECTION;
    m.facing = m.moveDir = dir;
    m.bikeCount = 0;
    m.action = { kind: 'turn', t: 0, len: 8, speed: 0, dir };
    return;
  }
  m.runningState = MOVING;
  bikeGo(m, dir, step, false);
}

/** MachBikeTransition_TrySpeedUp (`slow` false) or _TrySlowDown toward `dir`. */
function bikeGo(m: Mover, dir: number, step: StepFn, slow: boolean): void {
  if (slow && m.bikeSpeed !== 0) m.bikeCount = --m.bikeSpeed;
  m.facing = m.moveDir = dir;
  const to = step(m.spot, dir);
  if (!to) {
    // Bike_SetBikeStill, then PlayerOnBikeCollide's walk in place.
    m.bikeSpeed = m.bikeCount = 0;
    m.action = { kind: 'bump', t: 0, len: 16, speed: 0, dir };
    return;
  }
  m.prev = m.spot;
  m.strides += 1;
  if (to.warp) {
    m.spot = to.to;
    m.action = { kind: 'warp', t: 0, len: WARP_FRAMES, speed: 0, dir };
    m.px = m.py = 0;
    // Into a building or a cave the bike is put away (no cycling there).
    if (!step.cycling?.(to.to)) m.bike = false;
    m.bikeSpeed = m.bikeCount = 0;
    return;
  }
  if (to.hop) {
    m.spot = { map: to.to.map, x: to.to.x - DXY[dir][0], y: to.to.y - DXY[dir][1] };
    m.action = { kind: 'hop', t: 0, len: 32, speed: 1, dir, land: to.to };
    m.px = -DXY[dir][0] * 16;
    m.py = -DXY[dir][1] * 16;
    return;
  }
  m.spot = to.to;
  let speed = BIKE_PX[m.bikeCount];
  if (to.water) {
    // Onto the water the bike goes: SURF's pace.
    m.bike = false;
    m.bikeSpeed = m.bikeCount = 0;
    speed = 2;
  } else if (!slow) {
    m.bikeSpeed = m.bikeCount + (m.bikeCount >> 1);
    if (m.bikeCount < 2) m.bikeCount += 1;
  }
  m.action = { kind: 'step', t: 0, len: 16 / speed, speed, dir };
  m.px = -DXY[dir][0] * 16;
  m.py = -DXY[dir][1] * 16;
}

/** A StepFn off the bots' World, corrected to the ROM: a ledge's collision bits are set,
 *  so its cell is a wall to anything but the hop it faces (World lets a trainer stand on
 *  one, which never mattered while export-world.py classed every ledge as a wall). */
export function stepFn(world: {
  step(s: Spot, d: SeamDir, surf?: boolean, cut?: number): Spot | null;
  cell(id: string, x: number, y: number): number;
  warpAt(id: string, x: number, y: number): { to: string; toX: number; toY: number; kind: string } | undefined;
  map(id: string): { outdoor: boolean } | undefined;
}, field: { surf: boolean; cut: number } = { surf: false, cut: 0 }): StepFn {
  const fn: StepFn = (from, dir) => {
    const to = world.step(from, SEAM_OF[dir], field.surf, field.cut);
    if (!to) {
      // A building's doormat is an arrow: down on it goes out (MetatileBehavior's
      // south-arrow warp), though the step itself runs into the map's edge.
      const mat = dir === DIR_SOUTH && !world.map(from.map)?.outdoor ? world.warpAt(from.map, from.x, from.y) : undefined;
      return mat && mat.kind === 'door' ? { to: { map: mat.to, x: mat.toX, y: mat.toY }, hop: false, warp: true } : null;
    }
    const [dx, dy] = DXY[dir];
    const door = world.warpAt(from.map, from.x + dx, from.y + dy);
    if (door && to.map === door.to && to.x === door.toX && to.y === door.toY) return { to, hop: false, warp: true };
    const hop = to.map === from.map && Math.abs(to.x - from.x) + Math.abs(to.y - from.y) === 2;
    const cls = world.cell(to.map, to.x, to.y);
    if (!hop && cls >= 3 && cls <= 6) return null;
    return cls === CLASS_WATER ? { to, hop, water: true } : { to, hop };
  };
  // Where the live dock's BIKE is lit (ui/phonehud.ts contextFor): outdoors, not the Safari.
  fn.cycling = (s) => !!world.map(s.map)?.outdoor && !s.map.startsWith('MAP_SAFARI_ZONE') && world.cell(s.map, s.x, s.y) !== CLASS_WATER;
  return fn;
}
