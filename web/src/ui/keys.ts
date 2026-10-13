// The keyboard's GBA, drawn small in the corner of a desktop match (Cam, 2026-10-13: "a
// small overlay underneath, maybe 50% opacity"). A computer has no pad on the glass
// (index.html, POK-253), so nothing on the page said Z is A or that L and R are on A and
// S. Each button carries the key that presses it, read from the keyboard map itself so the
// two cannot drift, and lights while the core holds it -- whoever pressed it, a pad
// included -- so a player can see the press land.

import { KEY_BIT, type GbaKey } from '../emu';

/** What the legend needs of the emulator. */
export interface Lit {
  onFrame(listener: () => void): () => void;
  /** The held keys, as a KEY_BIT mask. */
  keys(): number;
}

/** A GBA's buttons where a GBA has them, as grid areas in index.html's #keys. */
const LAYOUT: readonly GbaKey[] = ['l', 'r', 'up', 'left', 'right', 'down', 'b', 'a', 'select', 'start'];

/** A keyboard key as its cap reads. */
export function capLabel(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  if (code === ' ') return 'SPACE';
  return code.toUpperCase();
}

/** Each GBA key's caps, in the map's order. */
export function capsByKey(map: Record<string, GbaKey>): Map<GbaKey, string[]> {
  const caps = new Map<GbaKey, string[]>();
  for (const [code, key] of Object.entries(map)) {
    const list = caps.get(key) ?? [];
    list.push(capLabel(code));
    caps.set(key, list);
  }
  return caps;
}

export class KeyLegend {
  private readonly buttons = new Map<GbaKey, HTMLElement>();
  private lit = 0;
  private readonly off: () => void;

  constructor(root: HTMLElement, emu: Lit, map: Record<string, GbaKey>, doc: Pick<Document, 'createElement'> = document) {
    const caps = capsByKey(map);
    root.replaceChildren();
    for (const key of LAYOUT) {
      const cap = caps.get(key);
      if (!cap) continue;
      const el = doc.createElement('div');
      el.className = `k k-${key}`;
      el.dataset.key = key;
      const top = doc.createElement('b');
      top.textContent = cap.join(' ');
      el.append(top);
      // The arrows say which way they go; every other button says which button it is.
      if (!key.match(/^(up|down|left|right)$/)) {
        const name = doc.createElement('i');
        name.textContent = key.toUpperCase();
        el.append(name);
      }
      root.append(el);
      this.buttons.set(key, el);
    }
    this.off = emu.onFrame(() => this.show(emu.keys()));
  }

  /** Lights the held buttons; the page is only touched where a key changed. */
  show(mask: number): void {
    const changed = mask ^ this.lit;
    if (!changed) return;
    this.lit = mask;
    for (const [key, el] of this.buttons) {
      const bit = 1 << KEY_BIT[key];
      if (changed & bit) el.classList.toggle('on', (mask & bit) !== 0);
    }
  }

  dispose(): void {
    this.off();
  }
}
