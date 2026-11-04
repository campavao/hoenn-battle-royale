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
//   the ACRO BIKE (bike.c): a step in 6 frames; B stood still is a wheelie, 40 frames more
//          of it a bunny hop that goes where nothing else does (a bumpy slope); B with a
//          direction at once is a jump, sideways or turning round, the way onto a rail's
//          isolated pieces. The page's three kindnesses to two thumbs are at acroHandle.

import type { Spot, SeamDir } from '../src/bots/world';

export const DIR_SOUTH = 1, DIR_NORTH = 2, DIR_WEST = 3, DIR_EAST = 4;
export const SEAM_OF: Record<number, SeamDir> = { 1: 'south', 2: 'north', 3: 'west', 4: 'east' };
const DXY: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };
const JUMP_Y_HIGH = [-4, -6, -8, -10, -11, -12, -12, -12, -11, -10, -9, -8, -6, -4, 0, 0];
/** sJumpYTable: JUMP_TYPE_HIGH, _LOW, _NORMAL. */
const JUMP_Y = [
  JUMP_Y_HIGH,
  [0, -2, -3, -4, -5, -6, -6, -6, -5, -5, -4, -3, -2, 0, 0, 0],
  [-2, -4, -6, -8, -9, -10, -10, -10, -9, -8, -6, -5, -3, -2, 0, 0],
];
const ARC_LOW = 1, ARC_NORMAL = 2;
/** sStep3Funcs, MOVE_SPEED_FAST_2: the ACRO BIKE's 16 pixels in 6 frames. */
const STEP3 = [2, 3, 3, 2, 3, 3];

export const NOT_MOVING = 0, TURN_DIRECTION = 1, MOVING = 2;

export interface Keys { up?: boolean; down?: boolean; left?: boolean; right?: boolean; b?: boolean; a?: boolean; select?: boolean }

export type ActionKind = 'step' | 'turn' | 'bump' | 'hop' | 'warp';
export interface Action {
  kind: ActionKind; t: number; len: number; speed: number; dir: number; land?: Spot;
  /** A jump of the ACRO BIKE's (16 frames): which of JUMP_Y lifts it. A ledge's has none. */
  arc?: number;
  /** A jump that comes down facing `dir` (a turn jump, turning at its halfway). */
  spin?: boolean;
  /** Which of the ACRO BIKE's wheelie anims it plays (acroFrame). */
  pose?: number;
}

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
  /** The bike ridden is the ACRO BIKE, and gPlayerAvatar's acroBikeState, newDirBackup; its
   *  key history (AcroBike_TryHistoryUpdate), the d-pad and the buttons and how long each
   *  has been so; and B as it was when the last action was chosen. */
  acro: boolean;
  acroState: number;
  acroTurn: number;
  keyDir: number;
  dirT: number;
  keyBtn: number;
  btnT: number;
  acroB: boolean;
}

/** Where a step toward `dir` lands, or null for a wall. 2 cells away is a ledge hop; `warp`
 *  is a door, stairs or a cave mouth, which lands on the other side's own cell. */
export type StepFn = ((from: Spot, dir: number, ride?: number) => { to: Spot; hop: boolean; warp?: boolean; water?: boolean } | null) & {
  /** Whether a bike may be ridden on `s`'s map; none of it without. */
  cycling?: (s: Spot) => boolean;
  /** Whether the ACRO BIKE may be where no other bike is: the Safari Zone. */
  acroCycling?: (s: Spot) => boolean;
  /** The ACRO BIKE's ground under `s` (WorldMap.acro), 0 for none. */
  acroAt?: (s: Spot) => number;
  /** SELECT, where either may go, gets on the ACRO BIKE (the room's `ride`, off the BAG). */
  likeAcro?: boolean;
};

/** How the ACRO BIKE comes at a cell, for StepFn's `ride`. Anybody else asks with none, and
 *  all of its ground is a wall (CheckAcroBikeCollision: the collisions it sets). */
export const RIDE_ALONG = 1, RIDE_HOP = 2, RIDE_JUMP = 3;
const ACRO_BUMPY = 1, ACRO_ISO_V = 2, ACRO_ISO_H = 3, ACRO_V = 4, ACRO_H = 5;

/** May a rider coming `ride` go onto `kind` heading `dir`? Along, a rail and not its isolated
 *  pieces or a rock (a collision under COLLISION_VERTICAL_RAIL); hopping, a rock too; jumping,
 *  a rail or an isolated piece that runs across the way of the jump (WillPlayerCollideWithCollision).
 *  In Emerald the MACH BIKE rides along a rail as well; here it is the ACRO BIKE's alone
 *  (Cam, 11-03: the thing that makes it different from the MACH BIKE). */
function rideOnto(kind: number, dir: number, ride: number): boolean {
  if (ride === RIDE_ALONG) return kind === ACRO_V || kind === ACRO_H;
  if (ride === RIDE_HOP) return kind === ACRO_BUMPY || kind === ACRO_V || kind === ACRO_H;
  if (ride !== RIDE_JUMP) return false;
  const across = dir === DIR_EAST || dir === DIR_WEST;
  return across ? kind === ACRO_ISO_V || kind === ACRO_V : kind === ACRO_ISO_H || kind === ACRO_H;
}

/** export-world.py's water class: SURF's ground. */
export const CLASS_WATER = 2;

/** Frames a door takes: the screen fades out and back in (the field's 16-frame fades). */
export const WARP_FRAMES = 32;

export function newMover(spot: Spot, facing = DIR_SOUTH): Mover {
  return { spot, prev: spot, facing, moveDir: facing, runningState: NOT_MOVING, action: null, px: 0, py: 0, lift: 0, run: true, strides: 0, bike: false, bikeSpeed: 0, bikeCount: 0, sel: false, acro: false, acroState: 0, acroTurn: 0, keyDir: 0, dirT: 0, keyBtn: 0, btnT: 0, acroB: false };
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
  if (m.bike && m.acro) acroHistory(m, keys);
  // Walking into a wall is the one action a key can cut short: a new direction, or the
  // same one once the way is clear (TryInterruptObjectEventSpecialAnim).
  if (m.action?.kind === 'bump') {
    const dir = dirOf(keys);
    if (dir && (dir !== m.moveDir || step(m.spot, dir, m.bike && m.acro ? RIDE_ALONG : 0))) m.action = null;
  }
  if (!m.action) begin(m, keys, step);
  const a = m.action;
  if (!a) return;
  if (a.kind === 'step' || a.kind === 'hop') {
    const [dx, dy] = DXY[a.dir];
    const speed = a.len === 6 ? STEP3[a.t] : a.speed;
    m.px += dx * speed;
    m.py += dy * speed;
    m.lift = a.kind !== 'hop' ? 0 : a.arc === undefined ? JUMP_Y_HIGH[a.t >> 1] : JUMP_Y[a.arc][a.t];
  }
  a.t += 1;
  // DoJumpInPlaceAnim: a turn jump turns round at the top of it.
  if (a.spin && a.t === a.len >> 1) m.facing = m.moveDir = a.dir;
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

/** How close to a rail or a rock SELECT reaches for the ACRO BIKE, in tiles. */
const ACRO_NEAR = 2;
/** The ACRO BIKE's ground is at hand: SELECT and the quick action offer that bike here, unless
 *  the MACH BIKE was USEd off the BAG (Cam, 11-04: "also what's on the smart action button when
 *  near it"). */
export function acroNear(step: StepFn, s: Spot): boolean {
  for (let dy = -ACRO_NEAR; dy <= ACRO_NEAR; dy++) {
    for (let dx = -ACRO_NEAR; dx <= ACRO_NEAR; dx++) {
      if (step.acroAt?.({ map: s.map, x: s.x + dx, y: s.y + dy })) return true;
    }
  }
  return false;
}

function begin(m: Mover, keys: Keys, step: StepFn): void {
  m.prev = m.spot;
  // SELECT, the registered bike (GetOnOffBike): on where cycling is allowed, off anywhere but
  // on a rail (ItemUseOutOfBattle_Bike's "You can't dismount your BIKE here").
  const press = !!keys.select && !m.sel;
  m.sel = !!keys.select;
  const under = step.acroAt?.(m.spot) ?? 0;
  if (press && (m.bike ? under < ACRO_ISO_V : step.cycling?.(m.spot) || step.acroCycling?.(m.spot))) {
    m.bike = !m.bike;
    // The Zone's one bike, and the only one that goes anywhere from its own ground.
    if (m.bike) m.acro = !step.cycling?.(m.spot) || under !== 0 || (step.likeAcro ?? acroNear(step, m.spot));
    bikeClear(m);
    // PlayerAvatarTransition_AcroBike, Bike_HandleBumpySlopeJump: up on its back wheel already.
    if (m.bike && m.acro && under === ACRO_BUMPY) m.acroState = ACRO_WHEELIE;
    m.acroB = !!keys.b;
    return;
  }
  const on = m.walkOn ?? 0;
  m.walkOn = 0;
  const walking = on ? step(m.spot, on) : null;
  const going = walking && !walking.warp && !walking.hop && !walking.water;
  if (m.bike && m.acro) return acroHandle(m, going ? on : dirOf(keys), !!keys.b, step);
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

/** BikeClearState and the runningState that goes with it. */
export function bikeClear(m: Mover): void {
  m.bikeSpeed = m.bikeCount = m.acroState = m.acroTurn = m.dirT = m.btnT = m.keyDir = m.keyBtn = 0;
  m.runningState = NOT_MOVING;
}

// ---- the ACRO BIKE: sAcroBikeInputHandlers and sAcroBikeTransitions, one frame at a time -----

export const ACRO_NORMAL = 0, ACRO_TURNING = 1, ACRO_WHEELIE = 2, ACRO_HOPPING = 3, ACRO_WHEELIE_MOVING = 4, ACRO_SIDE_JUMP = 5, ACRO_TURN_JUMP = 6;
/** Frames B has to be held in a standing wheelie for the bunny hop (AcroBikeHandleInputWheelieStanding). */
const HOP_FRAMES = 40;
/** AcroBike_GetJumpDirection's limit on how long ago B and the direction went down. Emerald's
 *  is 4 frames; two thumbs on glass need the 6 AcroBikeHandleInputTurning waits anyway. */
const JUMP_WINDOW = 6;
const POSE_POP = 1, POSE_END = 2, POSE_PEDAL = 3;

/** AcroBike_TryHistoryUpdate: each frame, riding or not moving. A change stops the bike. */
function acroHistory(m: Mover, keys: Keys): void {
  const dir = dirOf(keys), btn = (keys.a ? 1 : 0) | (keys.b ? 2 : 0) | (keys.select ? 4 : 0);
  if (dir === m.keyDir) m.dirT = Math.min(255, m.dirT + 1);
  else { m.keyDir = dir; m.dirT = 0; m.bikeSpeed = 0; }
  if (btn === m.keyBtn) m.btnT = Math.min(255, m.btnT + 1);
  else { m.keyBtn = btn; m.btnT = 0; m.bikeSpeed = 0; }
}

const canFace = (dir: number, under: number): boolean =>
  dir === DIR_EAST || dir === DIR_WEST ? under !== ACRO_ISO_V && under !== ACRO_V : under !== ACRO_ISO_H && under !== ACRO_H;
const bikeStill = (m: Mover) => { m.bikeCount = m.bikeSpeed = 0; };
const face = (m: Mover, dir: number) => { m.facing = m.moveDir = dir; };
/** The way `dir` if the rail underfoot lets the bike point there, or the way it is pointing. */
const faceIf = (m: Mover, dir: number, under: number) => face(m, canFace(dir, under) ? dir : m.moveDir);
const pop = (m: Mover, pose: number) => { m.action = { kind: 'turn', t: 0, len: 8, speed: 0, dir: m.moveDir, pose }; };
/** PlayerStandingHoppingWheelie: up and down on the spot. */
const hopOnSpot = (m: Mover, dir: number, under: number) => {
  faceIf(m, dir, under);
  m.action = { kind: 'hop', t: 0, len: 16, speed: 0, dir: m.moveDir, arc: ARC_LOW };
};

/** The rider goes: a step, or a door or a ledge or the water, which are the same on any bike. */
function rideTo(m: Mover, to: NonNullable<ReturnType<StepFn>>, dir: number, step: StepFn, go: Omit<Action, 'kind' | 't' | 'dir'> & { kind?: ActionKind }): void {
  m.prev = m.spot;
  m.strides += 1;
  if (to.warp) {
    m.spot = to.to;
    m.action = { kind: 'warp', t: 0, len: WARP_FRAMES, speed: 0, dir };
    m.px = m.py = 0;
    if (!step.cycling?.(to.to) && !step.acroCycling?.(to.to)) m.bike = false;
    bikeClear(m);
    return;
  }
  const [dx, dy] = DXY[dir];
  m.px = -dx * 16;
  m.py = -dy * 16;
  if (to.hop) {
    m.spot = { map: to.to.map, x: to.to.x - dx, y: to.to.y - dy };
    m.action = { kind: 'hop', t: 0, len: 32, speed: 1, dir, land: to.to };
    return;
  }
  m.spot = to.to;
  if (to.water) {
    m.bike = false;
    bikeClear(m);
    m.action = { kind: 'step', t: 0, len: 8, speed: 2, dir };
    return;
  }
  m.action = { kind: 'step', ...go, t: 0, dir };
}

/** AcroBikeTransition_Moving: MOVE_SPEED_FAST_2, walls and all. */
function acroMoving(m: Mover, dir: number, under: number, step: StepFn): void {
  if (!canFace(dir, under)) return face(m, m.moveDir);
  face(m, dir);
  const to = step(m.spot, dir, RIDE_ALONG);
  if (!to) { m.action = { kind: 'bump', t: 0, len: 16, speed: 0, dir }; return; }
  rideTo(m, to, dir, step, { len: 6, speed: 3 });
}

/** AcroBikeTransition_WheelieMoving and its rising and lowering twins, at running pace. */
function acroWheelieGo(m: Mover, dir: number, under: number, b: boolean, step: StepFn, pose: number): void {
  if (!canFace(dir, under)) {
    if (pose === POSE_POP) pop(m, POSE_POP);
    else if (pose === POSE_END) pop(m, POSE_END);
    return;
  }
  const to = step(m.spot, dir, RIDE_ALONG);
  if (to) {
    face(m, dir);
    rideTo(m, to, dir, step, { len: 8, speed: 2, pose });
    m.runningState = MOVING;
    return;
  }
  face(m, dir);
  if (pose === POSE_END) return pop(m, POSE_END);
  const [dx, dy] = DXY[dir];
  // Pushing at a rock. Emerald counts the 40 frames only with the d-pad let go, and a rider
  // up against a rock with both held just sits there; here it counts as well.
  if (step.acroAt?.({ map: m.spot.map, x: m.spot.x + dx, y: m.spot.y + dy }) === ACRO_BUMPY) {
    if (b && ++m.bikeCount >= HOP_FRAMES) { m.acroState = ACRO_HOPPING; bikeStill(m); }
    return;
  }
  // COLLISION_WHEELIE_HOP aside, it is a wall: PlayerWheelieInPlace, but never off a rock.
  if (under !== ACRO_BUMPY) m.action = { kind: 'bump', t: 0, len: 8, speed: 0, dir, pose: POSE_PEDAL };
}

/** AcroBikeTransition_WheelieHoppingMoving. */
function acroHopGo(m: Mover, dir: number, under: number, step: StepFn): void {
  if (!canFace(dir, under)) return hopOnSpot(m, m.moveDir, under);
  const to = step(m.spot, dir, RIDE_HOP);
  if (!to) return hopOnSpot(m, dir, under);
  face(m, dir);
  rideTo(m, to, dir, step, { kind: 'hop', len: 16, speed: 1, arc: ARC_LOW });
}

/** AcroBikeTransition_SideJump, or false if it would only be a turn. The bike keeps pointing
 *  the way it was (facingDirectionLocked), and it lands on the next cell. */
function acroSideJump(m: Mover, dir: number, step: StepFn): boolean {
  const to = step(m.spot, dir, RIDE_JUMP);
  if (!to || to.hop || to.warp || to.water) return false;
  rideTo(m, to, dir, step, { kind: 'hop', len: 16, speed: 1, arc: ARC_NORMAL });
  return true;
}

/** A frame with no action under way: CheckMovementInputAcroBike and the transition it picks.
 *
 *  Where it isn't Emerald, all for a phone's two thumbs: AcroBike_GetJumpDirection allows 6
 *  frames between B and the direction (JUMP_WINDOW), a press of B during a step still counts
 *  when the step ends, and on a rail, where the crosswise direction means nothing else, B
 *  held and that direction jumps at any time (Emerald: within the window, d-pad let go first). */
function acroHandle(m: Mover, input: number, b: boolean, step: StepFn): void {
  const newB = b && !m.acroB;
  m.acroB = b;
  const under = step.acroAt?.(m.spot) ?? 0;
  if (input && b && !canFace(input, under) && acroSideJump(m, input, step)) {
    bikeStill(m);
    m.bikeSpeed = 1;
    m.runningState = MOVING;
    m.acroState = ACRO_SIDE_JUMP;
    return;
  }
  acroInput(m, input, newB, b, under, step);
}

function acroInput(m: Mover, input: number, newB: boolean, b: boolean, under: number, step: StepFn): void {
  const dir = m.moveDir;
  switch (m.acroState) {
    case ACRO_TURNING: {
      const want = m.acroTurn;
      m.bikeCount += 1;
      if (m.bikeCount > 6) {
        m.runningState = TURN_DIRECTION;
        m.acroState = ACRO_NORMAL;
        bikeStill(m);
        return faceIf(m, want, under);
      }
      if (m.keyBtn === 2 && m.keyDir === want && m.dirT <= JUMP_WINDOW && m.btnT <= JUMP_WINDOW) {
        bikeStill(m);
        m.bikeSpeed = 1;
        if (want === OPPOSITE[dir]) {
          m.acroState = ACRO_TURN_JUMP;
          m.action = { kind: 'hop', t: 0, len: 16, speed: 0, dir: want, arc: ARC_NORMAL, spin: true };
          return;
        }
        m.runningState = MOVING;
        m.acroState = ACRO_SIDE_JUMP;
        if (!acroSideJump(m, want, step)) faceIf(m, want, under);
        return;
      }
      return face(m, dir);
    }
    case ACRO_WHEELIE:
      m.runningState = NOT_MOVING;
      if (b) m.bikeCount += 1;
      else {
        m.bikeCount = 0;
        if (under !== ACRO_BUMPY) {
          m.acroState = ACRO_NORMAL;
          bikeStill(m);
          return pop(m, POSE_END);
        }
      }
      if (m.bikeCount >= HOP_FRAMES) {
        m.acroState = ACRO_HOPPING;
        bikeStill(m);
        return hopOnSpot(m, dir, under);
      }
      if (input === dir) {
        m.runningState = MOVING;
        m.acroState = ACRO_WHEELIE_MOVING;
        bikeStill(m);
        return acroWheelieGo(m, input, under, b, step, POSE_PEDAL);
      }
      if (!input) return face(m, dir);
      m.runningState = TURN_DIRECTION;
      return faceIf(m, input, under);
    case ACRO_HOPPING:
      if (!b) {
        bikeStill(m);
        if (under === ACRO_BUMPY) {
          m.acroState = ACRO_WHEELIE;
          return acroInput(m, input, newB, b, under, step);
        }
        m.runningState = NOT_MOVING;
        m.acroState = ACRO_NORMAL;
        return pop(m, POSE_END);
      }
      if (!input) { m.runningState = NOT_MOVING; return hopOnSpot(m, dir, under); }
      if (input !== dir && m.runningState !== MOVING) { m.runningState = TURN_DIRECTION; return hopOnSpot(m, input, under); }
      m.runningState = MOVING;
      return acroHopGo(m, input, under, step);
    case ACRO_WHEELIE_MOVING:
      if (!b) {
        bikeStill(m);
        if (under === ACRO_BUMPY) {
          m.acroState = ACRO_WHEELIE;
          return acroInput(m, input, newB, b, under, step);
        }
        m.acroState = ACRO_NORMAL;
        if (!input) { m.runningState = NOT_MOVING; return pop(m, POSE_END); }
        if (input !== dir && m.runningState !== MOVING) { m.runningState = NOT_MOVING; return pop(m, POSE_END); }
        m.runningState = MOVING;
        return acroWheelieGo(m, input, under, b, step, POSE_END);
      }
      if (!input) {
        m.acroState = ACRO_WHEELIE;
        m.runningState = NOT_MOVING;
        bikeStill(m);
        return face(m, dir);
      }
      if (input !== dir && m.runningState !== MOVING) { m.runningState = NOT_MOVING; return faceIf(m, input, under); }
      m.runningState = MOVING;
      return acroWheelieGo(m, input, under, b, step, POSE_PEDAL);
    case ACRO_SIDE_JUMP:
    case ACRO_TURN_JUMP:
      m.acroState = ACRO_NORMAL;
      return acroInput(m, input, newB, b, under, step);
    default:
      m.bikeCount = 0;
      if (!input) {
        m.runningState = NOT_MOVING;
        if (!newB) return face(m, dir);
        m.acroState = ACRO_WHEELIE;
        return pop(m, POSE_POP);
      }
      if (input === dir && b && m.bikeSpeed === 0) {
        m.bikeSpeed = 1;
        m.acroState = ACRO_WHEELIE_MOVING;
        return acroWheelieGo(m, input, under, b, step, POSE_POP);
      }
      if (input !== dir && (m.runningState !== MOVING || !canFace(input, under))) {
        m.acroState = ACRO_TURNING;
        m.acroTurn = input;
        m.runningState = NOT_MOVING;
        return acroInput(m, input, newB, b, under, step);
      }
      m.runningState = MOVING;
      return acroMoving(m, input, under, step);
  }
}

const OPPOSITE = [0, DIR_NORTH, DIR_SOUTH, DIR_EAST, DIR_WEST];
/** The sheet's frames by facing, south, north, west and east: sAnim_BunnyHopBackWheel*'s
 *  first, the next being its second; sAnim_MovingWheelie*'s four; the plain face's. */
const WHEEL_BACK = [0, 9, 13, 17, 17];
const WHEEL_FACE = [0, 0, 1, 2, 2];
const WHEEL_PEDAL = [[], [21, 10, 22, 10], [23, 14, 24, 14], [25, 18, 26, 18], [25, 18, 26, 18]];

/** The ACRO BIKE sheet's frame where it is not the bike's plain ride, or null. Pure, like the
 *  rest: a wheelie is GetAcroWheelieDirectionAnimNum's and the pedalling, a hop on its back wheel. */
export function acroFrame(m: Mover): number | null {
  const a = m.action, f = m.facing;
  const pedal = (late: number) => WHEEL_PEDAL[f][(m.strides & 1) * 2 + late];
  if (!a) return m.acroState === ACRO_WHEELIE || m.acroState === ACRO_HOPPING || m.acroState === ACRO_WHEELIE_MOVING ? WHEEL_PEDAL[f][0] : null;
  if (a.pose === POSE_POP) return WHEEL_BACK[f] + (a.t >= 4 ? 1 : 0);
  if (a.pose === POSE_END) return a.t >= 4 ? WHEEL_FACE[f] : WHEEL_BACK[f];
  if (a.pose === POSE_PEDAL) return pedal(a.t / a.len >= 1 / 2 ? 1 : 0);
  if (a.kind === 'hop' && a.arc === ARC_LOW) return WHEEL_BACK[f] + (a.t >= 4 ? 1 : 0);
  return null;
}

/** A StepFn off the bots' World, corrected to the ROM: a ledge's collision bits are set,
 *  so its cell is a wall to anything but the hop it faces (World lets a trainer stand on
 *  one, which never mattered while export-world.py classed every ledge as a wall). */
export function stepFn(world: {
  step(s: Spot, d: SeamDir, surf?: boolean, cut?: number): Spot | null;
  cell(id: string, x: number, y: number): number;
  acroAt?(id: string, x: number, y: number): number;
  acroStep?(s: Spot, d: SeamDir): Spot | null;
  warpAt(id: string, x: number, y: number): { to: string; toX: number; toY: number; kind: string } | undefined;
  map(id: string): { outdoor: boolean } | undefined;
}, field: { surf: boolean; cut: number } = { surf: false, cut: 0 }): StepFn {
  const fn: StepFn = (from, dir, ride = 0) => {
    const kind = world.acroAt?.(from.map, from.x + DXY[dir][0], from.y + DXY[dir][1]);
    if (kind) {
      const onto = rideOnto(kind, dir, ride) ? world.acroStep?.(from, SEAM_OF[dir]) : null;
      return onto ? { to: onto, hop: false } : null;
    }
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
  // The Zone's rails want riding (Cam, 11-03); the MACH BIKE stays out of it, as it was.
  fn.acroCycling = (s) => s.map.startsWith('MAP_SAFARI_ZONE') && world.cell(s.map, s.x, s.y) !== CLASS_WATER;
  fn.acroAt = (s) => world.acroAt?.(s.map, s.x, s.y) ?? 0;
  return fn;
}
