import { describe, expect, it } from 'vitest';
import { KEY_BIT, type GbaKey } from '../emu';
import { layoutField } from '../field';
import { KeyLegend, capLabel, capsByKey, placeLegend } from './keys';

/** Just the element calls KeyLegend makes. */
class FakeEl {
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  touched = 0;
  private readonly classes = new Set<string>();
  classList = {
    toggle: (name: string, on: boolean) => {
      this.touched++;
      if (on) this.classes.add(name);
      else this.classes.delete(name);
    },
    contains: (name: string) => this.classes.has(name),
  };
  hidden = false;
  style: Record<string, string> = {};
  /** What layout would measure: 0 while the CSS draws nothing (out of a match). */
  offsetWidth = 0;
  offsetHeight = 0;
  constructor(readonly tag: string) {}
  append(...els: FakeEl[]) {
    this.children.push(...els);
  }
  replaceChildren() {
    this.children = [];
  }
}

const doc = { createElement: (tag: string) => new FakeEl(tag) } as unknown as Pick<Document, 'createElement'>;

const MAP: Record<string, GbaKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  z: 'a', x: 'b', Enter: 'start', Shift: 'select', a: 'l', s: 'r',
};

function fakeEmu() {
  const frames = new Set<() => void>();
  const emu = {
    held: 0,
    onFrame: (l: () => void) => {
      frames.add(l);
      return () => frames.delete(l);
    },
    keys: () => emu.held,
  };
  return { emu, frame: () => frames.forEach((l) => l()), listeners: () => frames.size };
}

const mask = (...keys: GbaKey[]) => keys.reduce((m, k) => m | (1 << KEY_BIT[k]), 0);

function build() {
  const root = new FakeEl('div');
  const gba = fakeEmu();
  const legend = new KeyLegend(root as unknown as HTMLElement, gba.emu, MAP, doc);
  const button = (key: GbaKey) => root.children.find((el) => el.dataset.key === key)!;
  return { root, gba, legend, button };
}

describe('the desktop key legend', () => {
  it('labels each button with the key that presses it', () => {
    const { root, button } = build();
    expect(root.children).toHaveLength(10);
    expect(button('a').children.map((c) => c.textContent)).toEqual(['Z', 'A']);
    expect(button('l').children.map((c) => c.textContent)).toEqual(['A', 'L']);
    expect(button('start').children.map((c) => c.textContent)).toEqual(['ENTER', 'START']);
    expect(button('up').children.map((c) => c.textContent)).toEqual(['↑']);
  });

  it('lights what the core holds, and lets it go', () => {
    const { gba, button } = build();
    gba.emu.held = mask('a', 'left');
    gba.frame();
    expect(button('a').classList.contains('on')).toBe(true);
    expect(button('left').classList.contains('on')).toBe(true);
    expect(button('b').classList.contains('on')).toBe(false);
    gba.emu.held = mask('left');
    gba.frame();
    expect(button('a').classList.contains('on')).toBe(false);
    expect(button('left').classList.contains('on')).toBe(true);
  });

  it('touches the page only when a key changes', () => {
    const { gba, button } = build();
    gba.emu.held = mask('b');
    for (let i = 0; i < 30; i++) gba.frame();
    expect(button('b').touched).toBe(1);
    expect(button('a').touched).toBe(0);
  });

  it('stops listening when disposed', () => {
    const { gba, legend } = build();
    expect(gba.listeners()).toBe(1);
    legend.dispose();
    expect(gba.listeners()).toBe(0);
  });

  it('reads caps the way they are printed', () => {
    expect(capLabel('ArrowRight')).toBe('→');
    expect(capLabel(' ')).toBe('SPACE');
    expect(capLabel('Shift')).toBe('SHIFT');
    expect(capsByKey({ z: 'a', k: 'a' }).get('a')).toEqual(['Z', 'K']);
  });

  // The review of #17: the box is #screen-wrap, the window less the docked sheet (480px
  // at 960x640 and up), and the legend goes where the picture is not.
  const SIZES = { pad: { w: 200, h: 138 }, row: { w: 440, h: 24 } };
  const at = (w: number, h: number) => placeLegend(layoutField(w, h), w, h, SIZES);

  it('sits in the room right of the picture', () => {
    // 2560x1080 less the sheet, at a phone's zoom (2): the picture is 480 wide in 2080.
    expect(at(2080, 1080)).toEqual({ mode: 'pad', x: 2080 - 210, y: 1080 - 148 });
    // 1280x720 less the sheet: 480x320 in 800x720, 160 either side and 200 under it.
    expect(at(800, 720)).toEqual({ mode: 'pad', x: 800 - 210, y: 720 - 148 });
  });

  it('is one row under the picture where only a strip is free', () => {
    // 700x400 at 1.667 (a phone-sized glass): the picture is 400x267 at (150, 67), 67 under it.
    expect(at(700, 400)).toEqual({ mode: 'row', x: 130, y: 400 - 34 });
    // A desktop's narrow window, 700x480 on a 1080-tall screen: 480x320 at (110, 80),
    // too little room beside it for the pad and 80 under it, room for the row.
    expect(placeLegend(layoutField(700, 480, 0, 1, 1080), 700, 480, SIZES)).toEqual({ mode: 'row', x: 130, y: 480 - 34 });
  });

  it('is nowhere when the picture fills the box', () => {
    // A box exactly the picture at its zoom has no field past it.
    expect(placeLegend(layoutField(360, 240), 360, 240, SIZES)).toBeNull();
  });

  it('never overlaps the picture, whatever the box', () => {
    for (const [w, h] of [[886, 650], [960, 780], [1440, 820], [2080, 1300], [1200, 900], [700, 400]]) {
      const lay = layoutField(w, h);
      const p = placeLegend(lay, w, h, SIZES);
      if (!p) continue;
      const s = SIZES[p.mode];
      const x0 = lay.lcdCol * lay.scale, y0 = lay.lcdRow * lay.scale;
      const x1 = x0 + 240 * lay.scale, y1 = y0 + 160 * lay.scale;
      const apart = p.x >= x1 || p.x + s.w <= x0 || p.y >= y1 || p.y + s.h <= y0;
      expect(apart, `${w}x${h}`).toBe(true);
      expect(p.x >= 0 && p.y >= 0 && p.x + s.w <= w && p.y + s.h <= h, `${w}x${h} inside`).toBe(true);
    }
  });

  it('keeps its place when it measures nothing, out of a match', () => {
    // Placed before body.in-match draws it, it would be pinned to the corner for good.
    const { root, legend } = build();
    legend.place(layoutField(2080, 1080), 2080, 1080);
    expect(root.style.left).toBe('0px'); // not 2070px, the corner a 0x0 legend fits
    root.offsetWidth = 200;
    root.offsetHeight = 138;
    legend.place(layoutField(2080, 1080), 2080, 1080);
    expect(root.style.left).toBe('1870px');
  });
});
