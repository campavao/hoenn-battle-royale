// The keyboard's GBA, drawn small and half see-through on a desktop match's field (the
// speed-up redesign's desktop controls overlay, notes/speedup-ideas.md). A computer has no
// pad on the glass (index.html, POK-253), so nothing over the game said Z is A or that L
// and R are on A and S. Each button carries the key that presses it, read from the
// keyboard map itself so the two cannot drift, and lights while the core holds it --
// whoever pressed it, a pad included -- so a player can see the press land.
//
// It goes past the picture, never on it: the picture's bottom-right is the battle's
// FIGHT/BAG/POKeMON/RUN and the text box's end. placeLegend finds the field's room beside
// or under the picture (field.ts's layout), as the GBA's shape where that fits and as one
// row where only a strip does, and hides it where there is none. The docked sheet beside
// the game lists the same keys there (app.ts KEY_LINES), unless a gamepad is connected,
// when it shows the pad's buttons instead.

import { KEY_BIT, type GbaKey } from '../emu';
import type { FieldLayout } from '../field';

/** What the legend needs of the emulator. */
export interface HeldKeys {
  onFrame(listener: () => void): () => void;
  /** The held keys, as a KEY_BIT mask. */
  keys(): number;
}

/** A GBA's buttons where a GBA has them, as grid areas in index.html's #keys. */
const LAYOUT: readonly GbaKey[] = ['l', 'r', 'up', 'left', 'right', 'down', 'b', 'a', 'select', 'start'];

const ARROWS: ReadonlySet<GbaKey> = new Set<GbaKey>(['up', 'down', 'left', 'right']);

/** A keyboard key (a KeyboardEvent.key, as KEYBOARD_MAP is keyed) as its cap reads. */
export function capLabel(key: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[key]) return arrows[key];
  if (key === ' ') return 'SPACE';
  return key.toUpperCase();
}

export type LegendMode = 'pad' | 'row';

/** Where the legend goes in a box of boxW x boxH laid out as `lay`: the GBA's shape (pad)
 *  in the room right of, left of or under the picture, else one row under or over it,
 *  else nowhere (null). x, y are the legend's top-left in the box, `gap` in from the
 *  picture's edge and the box's. */
export function placeLegend(
  lay: FieldLayout,
  boxW: number,
  boxH: number,
  sizes: Record<LegendMode, { w: number; h: number }>,
  gap = 10,
): { mode: LegendMode; x: number; y: number } | null {
  if (!(lay.scale > 0)) return null;
  const x0 = lay.lcdCol * lay.scale;
  const y0 = lay.lcdRow * lay.scale;
  const x1 = x0 + 240 * lay.scale;
  const y1 = y0 + 160 * lay.scale;
  const fits = (s: { w: number; h: number }, w: number, h: number) => s.w + 2 * gap <= w && s.h + 2 * gap <= h;
  const pad = sizes.pad;
  const row = sizes.row;
  if (fits(pad, boxW - x1, boxH)) return { mode: 'pad', x: boxW - gap - pad.w, y: boxH - gap - pad.h };
  if (fits(pad, x0, boxH)) return { mode: 'pad', x: gap, y: boxH - gap - pad.h };
  if (fits(pad, boxW, boxH - y1)) return { mode: 'pad', x: boxW - gap - pad.w, y: boxH - gap - pad.h };
  const centred = (boxW - row.w) / 2;
  if (fits(row, boxW, boxH - y1)) return { mode: 'row', x: centred, y: boxH - gap - row.h };
  if (fits(row, boxW, y0)) return { mode: 'row', x: centred, y: gap };
  return null;
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

  constructor(private readonly root: HTMLElement, emu: HeldKeys, map: Record<string, GbaKey>, doc: Pick<Document, 'createElement'> = document) {
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
      if (!ARROWS.has(key)) {
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

  /** Puts the legend where `lay` leaves room in a boxW x boxH box (placeLegend), or hides
   *  it. Each shape is measured as it is drawn, so the CSS is the one place sizes live. */
  place(lay: FieldLayout, boxW: number, boxH: number): void {
    const root = this.root;
    const measure = (mode: LegendMode) => {
      root.dataset.mode = mode;
      return { w: root.offsetWidth, h: root.offsetHeight };
    };
    root.hidden = false;
    root.style.left = '0px';
    root.style.top = '0px';
    const sizes = { pad: measure('pad'), row: measure('row') };
    // Out of a match the legend isn't drawn and measures 0: placing it then would stick.
    if (!sizes.pad.w) return;
    const at = placeLegend(lay, boxW, boxH, sizes);
    if (!at) {
      root.hidden = true;
      return;
    }
    root.dataset.mode = at.mode;
    root.style.left = `${Math.round(at.x)}px`;
    root.style.top = `${Math.round(at.y)}px`;
  }

  dispose(): void {
    this.off();
  }
}
