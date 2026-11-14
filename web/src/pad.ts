// A gamepad's sticks, learned rather than guessed (POK-321).
//
// The Gamepad API's "standard" layout puts the left stick on axes 0 (horizontal) and 1
// (vertical), and app.ts read every axis on the convention that even axes are
// horizontal and odd ones vertical. Cam's pad -- Firefox's `0000-0000-Wireless Gamepad
// (non-standard)` -- does not keep it: "up and down does left and right". Twice now.
// So the remap wizard learns the stick the way it learns buttons: push it UP, push it
// RIGHT, and whichever axis moved, in whichever direction, is the answer.

import type { GbaKey } from './emu';

/** Which axis a direction lives on, and which way is positive for it. */
export interface AxisSense {
  axis: number;
  /** +1 when the direction reads as a positive value on the axis, -1 when negative. */
  sign: 1 | -1;
}

/** A learned stick: the axis pushing UP moved, and the axis pushing RIGHT moved. */
export interface StickMap {
  up: AxisSense;
  right: AxisSense;
}

/** Half throw. A stick is not a D-pad and a resting one is never quite zero. */
export const STICK = 0.5;

/** The axis that has moved furthest from rest past the threshold, if any: what the
 *  wizard takes as "the stick, that way". The DirectInput hat (axis 9 on a ten-axis
 *  pad) is not a stick and is skipped. */
export function learnAxis(axes: readonly number[], rest: readonly number[]): AxisSense | null {
  let best: AxisSense | null = null;
  let bestAway = STICK;
  for (let i = 0; i < axes.length; i++) {
    if (i === 9 && axes.length >= 10) continue;
    const away = (axes[i] ?? 0) - (rest[i] ?? 0);
    if (Math.abs(away) <= bestAway) continue;
    bestAway = Math.abs(away);
    best = { axis: i, sign: away < 0 ? -1 : 1 };
  }
  return best;
}

/** Where the wizard is in learning the stick: which push it waits for, the UP it has,
 *  and whether it has seen the stick back at rest since the last push. */
export interface StickLearn {
  phase: 'up' | 'right' | 'done';
  up: AxisSense | null;
  atRest: boolean;
  result?: StickMap | null;
}

export function startStickLearn(): StickLearn {
  return { phase: 'up', up: null, atRest: false };
}

/** One poll of the wizard's stick step: the axis the stick is pushed along (null at rest),
 *  or `skip` for a button. A push counts only after the stick has been seen at rest: the
 *  UP that was just learned is still held when RIGHT is asked for, and taking it as the
 *  answer -- the same axis twice -- ended the wizard with no stick learned at all, leaving
 *  the pad on the guess that had it wrong (Cam's 2026-10-14 play-test, POK-350: "I've
 *  tried the remapping, it just doesn't work"). */
export function stickLearnStep(state: StickLearn, input: AxisSense | null | 'skip'): StickLearn {
  if (state.phase === 'done') return state;
  if (input === 'skip') return { ...state, phase: 'done', result: null };
  if (input === null) return state.atRest ? state : { ...state, atRest: true };
  if (!state.atRest) return state;
  if (state.phase === 'up') return { phase: 'right', up: input, atRest: false };
  if (state.up && input.axis === state.up.axis) return state;
  return { ...state, phase: 'done', result: state.up ? { up: state.up, right: input } : null };
}

/** The directions a learned stick is held in. Only its two axes count; the pad's other
 *  axes (triggers, a second stick) do nothing. */
export function stickKeys(axes: readonly number[], rest: readonly number[], stick: StickMap): GbaKey[] {
  const out: GbaKey[] = [];
  const along = (s: AxisSense) => ((axes[s.axis] ?? 0) - (rest[s.axis] ?? 0)) * s.sign;
  const v = along(stick.up);
  const h = along(stick.right);
  if (v > STICK) out.push('up');
  else if (v < -STICK) out.push('down');
  if (h > STICK) out.push('right');
  else if (h < -STICK) out.push('left');
  return out;
}

/** The guess, for a pad nobody has taught: even axes horizontal, odd vertical. */
export function guessedStickKeys(axes: readonly number[], rest: readonly number[]): { keys: GbaKey[]; moved: string[] } {
  const keys: GbaKey[] = [];
  const moved: string[] = [];
  for (let i = 0; i < axes.length; i++) {
    if (i === 9 && axes.length >= 10) continue;
    const away = (axes[i] ?? 0) - (rest[i] ?? 0);
    if (Math.abs(away) < STICK) continue;
    moved.push(`${i}${away < 0 ? '-' : '+'}`);
    if (i % 2 === 0) keys.push(away < 0 ? 'left' : 'right');
    else keys.push(away < 0 ? 'up' : 'down');
  }
  return { keys, moved };
}

/** Far enough from rest for the readout to name an axis: well under a push (STICK), so a
 *  stick whose driver only reports part of its throw still shows up as moving. */
export const READOUT_AXIS = 0.2;

export const STICK_KEY = 'hbr.padstick';

export function loadStickMap(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): StickMap | null {
  try {
    const raw = storage?.getItem(STICK_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StickMap;
    const ok = (a: AxisSense | undefined) => a && Number.isInteger(a.axis) && a.axis >= 0 && (a.sign === 1 || a.sign === -1);
    return ok(s.up) && ok(s.right) ? { up: s.up, right: s.right } : null;
  } catch {
    return null;
  }
}

/** What pollPads needs of the page: the window's pad events, navigator.getGamepads(), and
 *  whether the poll is the page's clock as well as the pad's (`always`). */
export interface PadWatch {
  win: EventTarget;
  pads: () => readonly (Gamepad | null)[];
  always: boolean;
}

