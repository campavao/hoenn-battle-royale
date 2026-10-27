// HOW TO PLAY (POK-429, POK-430, HBR-66): Cam's nine panels, NEXT through them, BACK and SKIP,
// every word fits, and the pictures that move do.
import { describe, expect, it, vi } from 'vitest';
import { ART_H, EVOLVE_MS, FRAME_MS, HOWTO_KEY, PANELS, SHEET, confetti, evolveFrame, howToScreen, markHowToDue, takeHowToDue } from './howto';
import { measure, wrapText } from './emerald';
import { HOWTO_READ, HOWTO_READ_KEY, howToRead, markHowToRead } from './howto-due';
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
  const screenAt = (t = 0, skin = 0, onDone = vi.fn(), redraw?: () => void) =>
    howToScreen(() => ({ skin, onDone, redraw, now: () => t }));

  it("is Cam's nine sections, in his order", () => {
    expect(PANELS.map((p) => p.title)).toEqual([
      'Start in Safari',
      'Where we flying?',
      'Encounters',
      'Item pickups',
      'Weezing Fog',
      'Leveling up',
      'Battles',
      'Special events',
      'How to win',
    ]);
  });

  it('opens on the Safari with NEXT and SKIP, NEXT first so A alone clicks through', () => {
    const { painted, byId } = paint(screenAt());
    expect(byId('howto-heading')!.text).toBe('Start in Safari');
    expect(byId('howto-page')!.text).toBe('1/9');
    const buttons = painted.widgets.filter((w) => w.onPress).map((w) => w.id);
    expect(buttons).toEqual(['howto-next', 'howto-skip']);
  });

  it('pages forward and back, and ends on DONE', () => {
    const onDone = vi.fn();
    const screen = screenAt(0, 0, onDone);
    press(screen, 'howto-next');
    expect(paint(screen).byId('howto-heading')!.text).toBe('Where we flying?');
    press(screen, 'howto-back');
    expect(paint(screen).byId('howto-heading')!.text).toBe('Start in Safari');
    for (let i = 0; i < PANELS.length - 1; i++) press(screen, 'howto-next');
    const last = paint(screen);
    expect(last.byId('howto-heading')!.text).toBe('How to win');
    expect(last.painted.widgets.filter((w) => w.onPress).map((w) => w.id)).toEqual(['howto-done', 'howto-back']);
    press(screen, 'howto-done');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(paint(screen).byId('howto-page')!.text, 'opened again, it starts at the top').toBe('1/9');
  });

  it('leaves from any panel on SKIP or B', () => {
    const onDone = vi.fn();
    const screen = screenAt(0, 0, onDone);
    press(screen, 'howto-next');
    press(screen, 'howto-skip');
    press(screen, 'howto-next');
    screen.back!();
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(paint(screen).byId('howto-page')!.text, 'B starts it over too').toBe('1/9');
  });

  it('keeps the buttons in one place from panel to panel', () => {
    const screen = screenAt();
    const ys = new Set<number>();
    for (let i = 0; i < PANELS.length; i++) {
      ys.add(paint(screen).byId(i === PANELS.length - 1 ? 'howto-done' : 'howto-next')!.rect.y);
      if (i < PANELS.length - 1) press(screen, 'howto-next');
    }
    expect(ys.size).toBe(1);
  });

  it('fits every panel on the shortest screen: picture, words inside the frame, buttons', () => {
    const screen = screenAt();
    for (let i = 0; i < PANELS.length; i++) {
      const { painted, frames, texts, byId } = paint(screen, 320);
      const art = byId('howto-art')!;
      const frame = frames[0];
      expect(art.rect, PANELS[i].title).toMatchObject({ x: 0, w: W, h: ART_H });
      expect(art.rect.y, 'the stack fills the 320').toBeLessThanOrEqual(4);
      expect(frame.y, `${PANELS[i].title}: the words under the picture`).toBe(art.rect.y + ART_H);
      const buttons = painted.widgets.filter((w) => w.onPress);
      for (const b of buttons) expect(b.rect.y, `${PANELS[i].title}: buttons below the frame`).toBeGreaterThan(frame.y + frame.h);
      const count = byId('howto-page')!.rect;
      const heading = byId('howto-heading')!;
      expect(count.y, 'the count in the heading row').toBe(heading.rect.y);
      expect(count.x, 'clear of the heading').toBeGreaterThan(W / 2 + measure(heading.text) / 2);
      expect(count.x + count.w).toBeLessThanOrEqual(W - 8);
      for (const b of buttons) expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(320);
      const text = byId('howto-text')!;
      expect(text.rect.y + text.rect.h, `${PANELS[i].title}: words clear of the frame's foot`).toBeLessThanOrEqual(frame.y + frame.h - 8);
      for (const t of texts) expect(t.x + measure(t.text), `"${t.text}" runs off the right`).toBeLessThanOrEqual(W - 8);
      expect(wrapText(PANELS[i].text, W - 24).length, `${PANELS[i].title} is brief`).toBeLessThanOrEqual(6);
      if (i < PANELS.length - 1) press(screen, 'howto-next');
    }
  });

  it('sits in the middle of a tall screen', () => {
    const { byId } = paint(screenAt(), 520);
    const top = byId('howto-art')!.rect.y;
    const foot = byId('howto-next')!.rect;
    expect(top).toBeGreaterThan(0);
    expect(Math.abs(top - (520 - (foot.y + foot.h)))).toBeLessThanOrEqual(1);
  });

  it('draws each picture off the sheet, and the fog over the whole screen', () => {
    const screen = screenAt(0, 2);
    const rows: Record<string, number> = {};
    for (let i = 0; i < PANELS.length; i++) {
      const { pictures, byId } = paint(screen);
      const title = byId('howto-heading')!.text;
      rows[title] = pictures.filter((p) => p.name === SHEET)[0]?.sy;
      if (title === 'Weezing Fog') {
        const fog = pictures.filter((p) => p.name === '/field-sprites/fog.png');
        // Five tiles high down the 320 and four across the 240, then the picture's own.
        expect(fog.filter((p) => p.y === 0).length).toBeGreaterThanOrEqual(4);
        expect(Math.max(...fog.map((p) => p.y))).toBeGreaterThanOrEqual(256);
      }
      if (i < PANELS.length - 1) press(screen, 'howto-next');
    }
    // tools/br/export-howto.py's sheet: five pictures, twelve evolution frames, the three
    // mons in colour and in white, then the encounters and the pickups.
    expect(rows).toMatchObject({
      'Start in Safari': 0,
      'Where we flying?': ART_H,
      'Weezing Fog': ART_H * 2,
      Battles: ART_H * 3,
      'Special events': ART_H * 4,
      Encounters: 2678,
      'Item pickups': 2828,
    });
  });

  it('evolves CHARMANDER to CHARMELEON to CHARIZARD, flashing white between', () => {
    expect(evolveFrame(0)).toEqual({ mon: 0, white: false, flashing: false });
    const flash = Array.from({ length: 34 }, (_, i) => evolveFrame(1500 + i * 50));
    expect(flash.every((f) => f.white)).toBe(true);
    expect(new Set(flash.map((f) => f.mon))).toEqual(new Set([0, 1]));
    expect(evolveFrame(3300)).toEqual({ mon: 1, white: false, flashing: false });
    expect(evolveFrame(4000 + 3300)).toEqual({ mon: 2, white: false, flashing: false });
    expect(evolveFrame(EVOLVE_MS - 1).mon).toBe(2);
    expect(evolveFrame(EVOLVE_MS)).toEqual(evolveFrame(0));
  });

  it('asks to be drawn again only while something on it moves', () => {
    vi.useFakeTimers();
    try {
      const redraw = vi.fn();
      const screen = screenAt(0, 0, vi.fn(), redraw);
      paint(screen);
      vi.advanceTimersByTime(FRAME_MS * 2);
      expect(redraw, 'the Safari stands still').not.toHaveBeenCalled();
      while (paint(screen).byId('howto-heading')!.text !== 'Weezing Fog') press(screen, 'howto-next');
      paint(screen);
      vi.advanceTimersByTime(FRAME_MS);
      expect(redraw, 'the fog drifts, once a frame however often it is drawn').toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws confetti over the last panel, falling as time goes by', () => {
    const screen = screenAt(0, 4);
    for (let i = 0; i < PANELS.length - 1; i++) press(screen, 'howto-next');
    const { fills, sprites, byId } = paint(screen);
    expect(fills.length).toBeGreaterThan(40);
    // None on the words, the count or the buttons.
    const below = byId('howto-art')!.rect.y + ART_H;
    const bits = fills.filter((f) => f.r.w <= 3 && f.r.h <= 3);
    for (const f of bits) expect(f.r.y + f.r.h <= below || f.r.y >= 320 || f.r.x >= W || f.r.x + f.r.w <= 0, `${f.r.x},${f.r.y}`).toBe(true);
    expect(sprites).toHaveLength(1);
    const a = confetti(0, 0, W, 320);
    const b = confetti(1000, 0, W, 320);
    expect(a.map((p) => p.r.y)).not.toEqual(b.map((p) => p.r.y));
    for (const p of [...a, ...b]) expect(p.r.y).toBeLessThan(320);
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

describe("HOW TO PLAY's NEW on the menu (HBR-30)", () => {
  it('comes off once the last panel has been up, not before', () => {
    const onRead = vi.fn();
    const screen = howToScreen(() => ({ skin: 0, onDone: vi.fn(), onRead, now: () => 0 }));
    for (let i = 1; i < PANELS.length; i++) {
      paint(screen);
      expect(onRead, `panel ${i}`).not.toHaveBeenCalled();
      press(screen, 'howto-next');
    }
    paint(screen);
    expect(onRead).toHaveBeenCalled();
  });

  it('stays off a SKIP', () => {
    const onRead = vi.fn();
    const screen = howToScreen(() => ({ skin: 0, onDone: vi.fn(), onRead, now: () => 0 }));
    press(screen, 'howto-skip');
    paint(screen);
    expect(onRead).not.toHaveBeenCalled();
  });

  it('is remembered on the device, and kept up when storage refuses', () => {
    const store = memoryStore();
    expect(howToRead(store)).toBe(false);
    markHowToRead(store);
    expect(store.getItem(HOWTO_READ_KEY)).toBe(HOWTO_READ);
    expect(howToRead(store)).toBe(true);
    store.setItem(HOWTO_READ_KEY, '1');
    expect(howToRead(store), 'read before Encounters and Item pickups: NEW again').toBe(false);
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(() => markHowToRead(refusing)).not.toThrow();
    expect(howToRead(refusing)).toBe(false);
  });
});
