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

/** What pollPads needs of the page: the window's pad events, and navigator.getGamepads(). */
export interface PadWatch {
  win: EventTarget;
  pads: () => readonly (Gamepad | null)[];
}

/** Runs `poll` every 16 ms while at least one pad is connected, and not at all otherwise
 *  (POK-247). It used to run from load to unload -- sixty wakeups a second on a phone
 *  that has never seen a pad. A browser shows a page a pad once somebody presses it,
 *  and says so with gamepadconnected; a pad the page can already see is polled from the
 *  start. The last one going gets one more poll, which lets go of whatever it held.
 *  `note` and `gone` hear the events as before. Returns a stop. */
export function pollPads(poll: () => void, note: (e: GamepadEvent) => void, gone: (e: GamepadEvent) => void, on: PadWatch): () => void {
  const present = new Set<number>();
  for (const pad of on.pads()) if (pad) present.add(pad.index);
  let timer: ReturnType<typeof setInterval> | null = null;
  const settle = () => {
    if (present.size > 0 && timer === null) timer = setInterval(poll, 16);
    if (present.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      poll();
    }
  };
  const connected = (e: Event) => {
    present.add((e as GamepadEvent).gamepad.index);
    note(e as GamepadEvent);
    settle();
  };
  const disconnected = (e: Event) => {
    present.delete((e as GamepadEvent).gamepad.index);
    gone(e as GamepadEvent);
    settle();
  };
  on.win.addEventListener('gamepadconnected', connected);
  on.win.addEventListener('gamepaddisconnected', disconnected);
  settle();
  return () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    on.win.removeEventListener('gamepadconnected', connected);
    on.win.removeEventListener('gamepaddisconnected', disconnected);
  };
}
