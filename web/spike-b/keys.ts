// The keyboard on the field: which key is which button, and the part of it the desktop's
// key legend draws (ui/keys.ts, as /classic/ draws its own). The legend is read from the
// map, so the two cannot drift (keys.test.ts).
import type { GbaKey } from '../src/emu';

export const KEYMAP: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', x: 'b', X: 'b', z: 'a', Z: 'a', Shift: 'select', Enter: 'a', ' ': 'a',
  // Caps Lock on (or Shift held): the same keys, as the live game's take them.
  W: 'up', S: 'down', A: 'left', D: 'right',
};

/** START is the menu here (M, main.ts openMenu), not a key of the map. */
export const MENU_KEY = 'm';

/** Marks this moment for the play-test's replay (main.ts markHere). Its cap is the legend's
 *  one that is no GBA button. */
export const MARK_KEY = 'k';

/** What the legend shows on each button: the arrows and WASD, Z and X, SHIFT, and M for
 *  START. Enter and Space press A too, but a cap holds one key's worth. */
export function legendMap(): Record<string, GbaKey> {
  const shown = ['ArrowUp', 'w', 'ArrowLeft', 'a', 'ArrowRight', 'd', 'ArrowDown', 's', 'z', 'x', 'Shift'];
  const out: Record<string, GbaKey> = {};
  for (const k of shown) out[k] = KEYMAP[k] as GbaKey;
  out[MENU_KEY] = 'start';
  return out;
}
