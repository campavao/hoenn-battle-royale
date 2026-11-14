// Which frame of a trainer's sheet the field draws on foot: the walk, the run, a turn, standing.
// Pure, so poses.test.ts can walk a trainer with sim.ts and read every frame.

import { MOVING, type Mover } from './sim';

// sAnim_GoSouth/North/West/East, and the running sheet's (frames 9..17 of BrendanNormal).
export const GO = { 1: [3, 0, 4, 0], 2: [5, 1, 6, 1], 3: [7, 2, 8, 2], 4: [7, 2, 8, 2] } as Record<number, number[]>;
export const RUN = { 1: [12, 9, 13, 9], 2: [14, 10, 15, 10], 3: [16, 11, 17, 11], 4: [16, 11, 17, 11] } as Record<number, number[]>;
export const FACE = { 1: 0, 2: 1, 3: 2, 4: 2 } as Record<number, number>;

/** The frame one run step has ended on and the next has not begun yet (sim.ts ends a step's
 *  action on its last tick; the next is chosen as the following tick starts). The ROM never
 *  leaves sAnim_Run* there: the face anim comes only once the thumb lets go
 *  (PlayerNotOnBikeNotMoving), the next run step picks the anim up where it stood
 *  (SetStepAnimHandleAlternation). A trainer still MOVING and off the tile it stood on was
 *  stepping, not turning or bumping (both stay put). */
export function betweenRuns(m: Mover): boolean {
  return !m.action && !m.bike && m.run && m.runningState === MOVING &&
    (m.prev.map !== m.spot.map || m.prev.x !== m.spot.x || m.prev.y !== m.spot.y);
}

/** The walk anim's frame. A step plays half the anim, one foot (SetStepAnimHandleAlternation
 *  starts it at command 0 or 2 by turns): the stride frame then standing, 8+8 of a walk's 16
 *  frames, and sAnim_RunSouth's 5+3 of a run's 8. Playing the whole anim each step was
 *  twice Emerald's cadence. `runSheet`: the trainer's sheet has the running frames. */
export function footPose(m: Mover, runSheet: boolean): number {
  const act = m.action;
  const run = runSheet && !m.bike && m.run && act?.kind === 'step';
  if (act?.kind === 'step') {
    const late = act.t / act.len >= (run ? 5 / 8 : 1 / 2) ? 1 : 0;
    return (run ? RUN : GO)[m.facing][(m.strides & 1) * 2 + late];
  }
  // A turn is a walk in place, one foot like a step: sAnim_GoFastSouth's 4+4. A bump into
  // a wall plays the whole of sAnim_GoSouth over its 32 frames.
  if (act?.kind === 'turn') return GO[m.facing][(m.strides & 1) * 2 + (act.t / act.len >= 1 / 2 ? 1 : 0)];
  if (act && act.kind !== 'hop' && act.kind !== 'warp') return GO[m.facing][Math.min(3, Math.floor((act.t / act.len) * 4))];
  // Between two run steps: the run's own stand, not the walk's. The walk's upright frame for
  // that one frame in eight was the run's stutter (Cam, 11-14 recording, 0:23).
  if (runSheet && betweenRuns(m)) return RUN[m.facing][(m.strides & 1) * 2 + 1];
  return FACE[m.facing];
}
