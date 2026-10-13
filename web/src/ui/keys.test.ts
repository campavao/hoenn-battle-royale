import { describe, expect, it } from 'vitest';
import { KEY_BIT, type GbaKey } from '../emu';
import { KeyLegend, capLabel, capsByKey } from './keys';

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
});
