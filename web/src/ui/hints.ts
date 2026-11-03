// Which input the on-screen key hints name (Cam, 11-02, on a controller: "it says Q and E
// right now... it should not say that"). The page tells this module what the last input was:
// a key of the keyboard, or a pad (and which); the windows and the dock ask it what to write
// on their keycaps. Without a word from a pad, the keyboard's own names stand.
import type { GbaKey } from '../emu';

type Family = 'xbox' | 'playstation' | 'nintendo' | 'generic';

/** The Gamepad API's standard layout, a button's index to the name printed on it. A pad this
 *  does not know (no recognised id) is named in the GBA's own words, as the remap wizard has it. */
const NAMES: Record<Exclude<Family, 'generic'>, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU'],
  playstation: ['X', 'O', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS'],
  nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '-', '+'],
};

/** A pad's make, from the id the browser gives it. Xbox is asked first: Chrome calls a
 *  PlayStation pad "Wireless Controller" and an Xbox one "Xbox Wireless Controller". */
export function padFamily(id: string): Family {
  if (/xbox|045e|xinput/i.test(id)) return 'xbox';
  if (/054c|playstation|dualshock|dualsense|sony|wireless controller/i.test(id)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-?con|switch/i.test(id)) return 'nintendo';
  return 'generic';
}

/** What a pad calls the button that does `key` (a GbaKey, or 'l' / 'r') under `map` (button
 *  index to key): the lowest-numbered button mapped to it. */
export function padButtonName(id: string, map: Readonly<Record<number, string>>, key: string): string {
  const family = padFamily(id);
  if (family === 'generic') return key.toUpperCase();
  const at = Object.entries(map)
    .filter(([, k]) => k === key)
    .map(([i]) => Number(i))
    .sort((a, b) => a - b)[0];
  return (at !== undefined ? NAMES[family][at] : undefined) ?? key.toUpperCase();
}

interface PadInput {
  id: string;
  map: Readonly<Record<number, string>>;
}

let pad: PadInput | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  // The field's keyboard legend (index.html #keys) goes with the keyboard.
  if (typeof document !== 'undefined') document.body?.classList.toggle('pad-input', pad !== null);
  for (const f of listeners) f();
}

/** A key of the keyboard went down: its names. */
export function inputKeyboard(): void {
  if (!pad) return;
  pad = null;
  changed();
}

/** A pad did something: `id` is its Gamepad id, `map` the buttons the game reads it by. */
export function inputPad(id: string, map: Readonly<Record<number, string>>): void {
  const same = pad && pad.id === id && pad.map === map;
  pad = { id, map };
  if (!same) changed();
}

/** Called when the names change, to draw them anew. */
export function onHintsChange(f: () => void): void {
  listeners.add(f);
}

/** Whether a pad was the last input. */
export function padIsLast(): boolean {
  return pad !== null;
}

/** The cap for `key` (a GbaKey or 'l' / 'r'): the pad's button name when a pad was last, else
 *  `keyboard`, the keyboard's. */
export function hintFor(key: GbaKey, keyboard: string): string {
  return pad ? padButtonName(pad.id, pad.map, key) : keyboard;
}

/** The battle windows' legend: the keyboard's rows as given, or a pad's. */
export function legendRows(keyboard: [string, string][]): [string, string][] {
  if (!pad) return keyboard;
  const n = (k: GbaKey) => padButtonName(pad!.id, pad!.map, k);
  return [['D-PAD', 'move'], [n('a'), 'choose'], [n('b'), 'back'], [n('l'), 'PARTY'], [n('r'), 'BAG'], [n('select'), 'details']];
}
