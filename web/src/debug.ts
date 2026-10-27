// The DEBUG screen's flags: every test switch the page reads off the hash, as rows that
// set them, so a test run is a few presses rather than a hand-edited URL. The hash stays
// the truth (a pasted `#fast&seed=7` works as it always has); this only writes it.
//
// Pure functions over the hash string, like hash.ts, so the cycle can be pinned without a
// browser. app.ts reads and writes `location` around them.
import { textOf, type devPace } from './hash';

/** One switch. `choices` are what the hash can say for it, in the order a press steps
 *  through them: `null` is the key absent, `''` a bare key (`#fast`), anything else its
 *  value (`#safari=60`). The first is always `null`, so a press past the last is off. */
export interface DebugFlag {
  key: string;
  label: string;
  choices: readonly (string | null)[];
  /** What `null` says on the right: OFF, or ROOM for a pace the room sets itself. */
  off?: string;
  /** Seconds, said with an `s`. */
  secs?: boolean;
  /** Which half of devPace this is: what it says comes from devPace itself, so `#fast`
   *  under it reads 25s rather than the ROOM it would say on its own. */
  pace?: 'safariSecs' | 'fogSecs';
  /** Read once as the page starts (wireFps), so a press reloads to apply it. The rest
   *  are read when a match starts, which is after this menu. */
  reload?: boolean;
}

export const DEBUG_FLAGS: readonly DebugFlag[] = [
  { key: 'perf', label: 'PERF METERS', choices: [null, ''], reload: true },
  { key: 'fast', label: 'FAST PACE', choices: [null, ''] },
  { key: 'safari', label: 'SAFARI TIME', choices: [null, '25', '60', '120'], off: 'ROOM', secs: true, pace: 'safariSecs' },
  { key: 'fog', label: 'FOG PHASE', choices: [null, '15', '30', '60'], off: 'ROOM', secs: true, pace: 'fogSecs' },
  { key: 'seed', label: 'FIXED SEED', choices: [null, '1', '7', '42'] },
  { key: 'nobots', label: 'NO BOTS', choices: [null, ''] },
  { key: 'noauto', label: 'HOLD ROOM OPEN', choices: [null, ''] },
  { key: 'testmon', label: 'TEST PARTY', choices: [null, ''] },
  { key: 'away', label: 'AWAY TIMEOUT', choices: [null, '10', '30'], off: '2 MIN', secs: true },
];

function paramsOf(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ''));
}

/** What the hash says for `flag`: `null` absent, `''` a bare key, or its value. */
export function flagValue(hash: string, flag: DebugFlag): string | null {
  return paramsOf(hash).get(flag.key);
}

/** The same hash with `flag` on its next choice and everything else left alone. A value
 *  typed by hand that is not one of the choices steps to off. No leading `#`. */
export function cycleFlag(hash: string, flag: DebugFlag): string {
  const params = paramsOf(hash);
  const next = flag.choices[(flag.choices.indexOf(params.get(flag.key)) + 1) % flag.choices.length];
  if (next === null) params.delete(flag.key);
  else params.set(flag.key, next);
  return textOf(params);
}

/** What the row says on its right for the hash. A pace row says the pace the page will
 *  run, devPace(hash) where the page reads it, so it cannot say ROOM while the match runs
 *  fast. Handed in rather than worked out here: a second caller of devPace costs main.js
 *  the copy the minifier had inlined, 330 bytes it does not have. */
export function flagDetail(flag: DebugFlag, hash: string, pace: ReturnType<typeof devPace>): string {
  if (flag.pace) {
    const secs = pace?.[flag.pace];
    return secs === undefined ? (flag.off ?? 'OFF') : `${secs}s`;
  }
  const value = flagValue(hash, flag);
  if (value === null) return flag.off ?? 'OFF';
  if (value === '') return 'ON';
  return flag.secs ? `${value}s` : value;
}

/** The trainer card's DEBUG MENU: whether the main menu has its DEBUG tile, off unless
 *  this browser turned it on. app.ts's debugMenuOn reads the same key. */
export const DEBUG_MENU_KEY = 'hbr-debug-menu';

export function toggleDebugMenu(store: Storage): void {
  try {
    if (store.getItem(DEBUG_MENU_KEY) === '1') store.removeItem(DEBUG_MENU_KEY);
    else store.setItem(DEBUG_MENU_KEY, '1');
  } catch {
    // A browser that keeps nothing keeps the default.
  }
}
