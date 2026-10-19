// HOW TO PLAY (POK-429): six panels, NEXT through them, BACK and SKIP, and every word fits.
import { describe, expect, it, vi } from 'vitest';
import { HOWTO_KEY, PANELS, howToScreen, markHowToDue, takeHowToDue } from './howto';
import { measure, wrapText } from './emerald';
import { W } from './screens';
import { fakeCanvas } from './fakecanvas';
import type { DrawnScreen } from './stage';

function paint(screen: DrawnScreen, h = 320) {
  const fake = fakeCanvas();
  const painted = screen.paint(fake.canvas, h);
  const byId = (id: string) => painted.widgets.find((w) => w.id === id);
  return { ...fake, painted, byId };
}

function press(screen: DrawnScreen, id: string): void {
  paint(screen).byId(id)!.onPress!();
}

describe('the HOW TO PLAY screen', () => {
  it('opens on the Safari Zone with NEXT and SKIP, NEXT first so A alone clicks through', () => {
    const screen = howToScreen(() => ({ skin: 0, onDone: vi.fn() }));
    const { painted, byId } = paint(screen);
    expect(byId('howto-heading')!.text).toBe('The Safari Zone');
    expect(byId('howto-page')!.text).toBe('1/6');
    const buttons = painted.widgets.filter((w) => w.onPress).map((w) => w.id);
    expect(buttons).toEqual(['howto-next', 'howto-skip']);
  });

  it('pages forward and back, and ends on DONE', () => {
    const onDone = vi.fn();
    const screen = howToScreen(() => ({ skin: 0, onDone }));
    press(screen, 'howto-next');
    expect(paint(screen).byId('howto-heading')!.text).toBe('The drop');
    press(screen, 'howto-back');
    expect(paint(screen).byId('howto-heading')!.text).toBe('The Safari Zone');
    for (let i = 0; i < 5; i++) press(screen, 'howto-next');
    const last = paint(screen);
    expect(last.byId('howto-heading')!.text).toBe('Last one standing');
    expect(last.painted.widgets.filter((w) => w.onPress).map((w) => w.id)).toEqual(['howto-done', 'howto-back']);
    press(screen, 'howto-done');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(paint(screen).byId('howto-page')!.text, 'opened again, it starts at the top').toBe('1/6');
  });

  it('leaves from any panel on SKIP or B', () => {
    const onDone = vi.fn();
    const screen = howToScreen(() => ({ skin: 0, onDone }));
    press(screen, 'howto-next');
    press(screen, 'howto-skip');
    press(screen, 'howto-next');
    screen.back!();
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(paint(screen).byId('howto-page')!.text, 'B starts it over too').toBe('1/6');
  });

  it('keeps the buttons in one place from panel to panel', () => {
    const screen = howToScreen(() => ({ skin: 0, onDone: vi.fn() }));
    const ys = new Set<number>();
    for (let i = 0; i < PANELS.length; i++) {
      ys.add(paint(screen).byId(i === PANELS.length - 1 ? 'howto-done' : 'howto-next')!.rect.y);
      if (i < PANELS.length - 1) press(screen, 'howto-next');
    }
    expect(ys.size).toBe(1);
  });

  it('fits every panel on the shortest screen, its words inside the frame', () => {
    const screen = howToScreen(() => ({ skin: 0, onDone: vi.fn() }));
    for (let i = 0; i < PANELS.length; i++) {
      const { painted, frames, texts } = paint(screen, 320);
      const buttons = painted.widgets.filter((w) => w.onPress);
      const frame = frames[0];
      for (const b of buttons) expect(b.rect.y, `${PANELS[i].title}: buttons below the frame`).toBeGreaterThan(frame.y + frame.h);
      for (const b of buttons) expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(320);
      const text = painted.widgets.find((w) => w.id === 'howto-text')!;
      expect(text.rect.y + text.rect.h, `${PANELS[i].title}: words clear of the frame's foot`).toBeLessThanOrEqual(frame.y + frame.h - 8);
      for (const t of texts) expect(t.x + measure(t.text), `"${t.text}" runs off the right`).toBeLessThanOrEqual(W - 8);
      expect(wrapText(PANELS[i].text, W - 24).length, `${PANELS[i].title} is brief`).toBeLessThanOrEqual(5);
      if (i < PANELS.length - 1) press(screen, 'howto-next');
    }
  });

  it('draws each panel its picture: a fog over the fog', () => {
    const screen = howToScreen(() => ({ skin: 2, onDone: vi.fn() }));
    const first = paint(screen);
    expect(first.pictures.map((p) => p.name)).toEqual(['items.png', 'items.png']);
    expect(first.sprites).toHaveLength(1);
    for (let i = 0; i < 3; i++) press(screen, 'howto-next');
    const fog = paint(screen);
    expect(fog.byId('howto-heading')!.text).toBe('The fog');
    expect(fog.fills).toHaveLength(18);
    expect(fog.fills.every((f) => f.r.x === 6 && f.r.w === W - 12)).toBe(true);
  });

  it('puts somebody else across from you in the battle', () => {
    const screen = howToScreen(() => ({ skin: 4, onDone: vi.fn() }));
    for (let i = 0; i < 4; i++) press(screen, 'howto-next');
    const { sprites } = paint(screen);
    expect(sprites).toHaveLength(2);
    expect(sprites[0].gfx).not.toBe(sprites[1].gfx);
  });
});

function memoryStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe('the panels after a first import', () => {
  it('are owed once, from the import to the first menu', () => {
    const store = memoryStore();
    expect(takeHowToDue(store), 'never imported: nothing owed').toBe(false);
    markHowToDue(store);
    expect(store.getItem(HOWTO_KEY)).toBe('due');
    expect(takeHowToDue(store)).toBe(true);
    expect(takeHowToDue(store), 'shown: not again').toBe(false);
  });

  it('are not owed again by a second import on a device that has seen them', () => {
    const store = memoryStore();
    markHowToDue(store);
    takeHowToDue(store);
    markHowToDue(store);
    expect(store.getItem(HOWTO_KEY)).toBe('1');
    expect(takeHowToDue(store)).toBe(false);
  });

  it('keep the page up when storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(() => markHowToDue(refusing)).not.toThrow();
    expect(takeHowToDue(refusing)).toBe(false);
  });
});
