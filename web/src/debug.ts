// The DEBUG screen's flags: every test switch the page reads off the hash, as rows that
// set them, so a test run is a few presses rather than a hand-edited URL. The hash stays
// the truth (a pasted `#fast&seed=7` works as it always has); this only writes it.
//
// Pure functions over the hash string, like hash.ts, so the cycle can be pinned without a
// browser. app.ts reads and writes `location` around them.

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
  /** Read once as the page starts (wireFps), so a press reloads to apply it. The rest
   *  are read when a match starts, which is after this menu. */
  reload?: boolean;
  /** Read only by a dev server's page (import.meta.env.DEV): each one rigs a match, and
   *  devsurface.test.ts holds a build to reading none of them. */
  dev: boolean;
}

export const DEBUG_FLAGS: readonly DebugFlag[] = [
  { key: 'perf', label: 'PERF METERS', choices: [null, ''], reload: true, dev: false },
  { key: 'fast', label: 'FAST PACE', choices: [null, ''], dev: true },
  { key: 'safari', label: 'SAFARI TIME', choices: [null, '25', '60', '120'], off: 'ROOM', secs: true, dev: true },
  { key: 'fog', label: 'FOG PHASE', choices: [null, '15', '30', '60'], off: 'ROOM', secs: true, dev: true },
  { key: 'seed', label: 'FIXED SEED', choices: [null, '1', '7', '42'], dev: true },
  { key: 'nobots', label: 'NO BOTS', choices: [null, ''], dev: true },
  { key: 'noauto', label: 'HOLD ROOM OPEN', choices: [null, ''], dev: true },
  { key: 'testmon', label: 'TEST PARTY', choices: [null, ''], dev: true },
  { key: 'away', label: 'AWAY TIMEOUT', choices: [null, '10', '30'], off: '2 MIN', secs: true, dev: true },
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
  // `a&b`, as hash.ts writes a door: a bare key is a bare key.
  return params.toString().replace(/=(?=&|$)/g, '');
}

/** What the row says on its right for `value`. */
export function flagDetail(flag: DebugFlag, value: string | null): string {
  if (value === null) return flag.off ?? 'OFF';
  if (value === '') return 'ON';
  return flag.secs ? `${value}s` : value;
}
