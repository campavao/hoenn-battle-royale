import { describe, expect, it } from 'vitest';
import { SKIN_GFX, frameTiles, glyphIds, inRect, measure, skinSheet } from './emerald';
import { SKINS } from '../match/career';
import ghostsSource from '../../../src/br/br_ghosts.c?raw';

describe("Emerald's font on the page (POK-320)", () => {
  it('maps characters to charmap bytes, an unknown one to a space', () => {
    expect(glyphIds('A')).toEqual([0xbb]);
    expect(glyphIds('0')).toEqual([0xa1]);
    expect(glyphIds(' ')).toEqual([0x00]);
    expect(glyphIds('POKéMON')[3], 'the é the ROM draws').toBe(0x1b);
    expect(glyphIds('❤')).toEqual([0x00]);
  });

  it("measures with the ROM's own widths", () => {
    // gFontNormalLatinGlyphWidths: a space is 3, a capital A is 6, a small i is narrower.
    expect(measure(' ')).toBe(3);
    expect(measure('A')).toBe(6);
    expect(measure('i')).toBeLessThan(measure('A'));
    expect(measure('CAM')).toBe(measure('C') + measure('A') + measure('M'));
  });
});

describe('the window frame', () => {
  it('tiles a box from the 3x3 frame: corners once, edges along, the middle inside', () => {
    const tiles = frameTiles(32, 24);
    expect(tiles).toHaveLength(4 * 3);
    expect(tiles[0]).toEqual({ dx: 0, dy: 0, tx: 0, ty: 0 });
    expect(tiles[3]).toEqual({ dx: 24, dy: 0, tx: 2, ty: 0 });
    expect(tiles[5]).toEqual({ dx: 8, dy: 8, tx: 1, ty: 1 });
    expect(tiles[11]).toEqual({ dx: 24, dy: 16, tx: 2, ty: 2 });
  });

  it('keeps the far edges on a box that is off the 8-px grid, with no gap before them', () => {
    const tiles = frameTiles(32, 124);
    const bottom = tiles.filter((t) => t.ty === 2);
    expect(bottom.every((t) => t.dy === 116)).toBe(true);
    const lastMiddle = Math.max(...tiles.filter((t) => t.ty === 1).map((t) => t.dy));
    expect(lastMiddle + 8).toBeGreaterThanOrEqual(116);
  });

  it('a box is at least two tiles each way', () => {
    expect(frameTiles(8, 8)).toHaveLength(4);
  });
});

describe('the wardrobe', () => {
  it("is the ROM's sSkinGraphics, one sheet per skin, as many as career.ts names", () => {
    expect(SKIN_GFX).toHaveLength(SKINS.length);
    const body = ghostsSource.match(/sSkinGraphics\[\]\s*=\s*\{([^}]*)\}/)![1];
    expect(body.match(/OBJ_EVENT_GFX_\w+/g)).toHaveLength(SKIN_GFX.length);
    for (let i = 0; i < SKINS.length; i++) {
      const sheet = skinSheet(i);
      expect(sheet, SKINS[i]).not.toBeNull();
      expect(sheet!.w).toBe(16);
      expect(sheet!.h).toBe(32);
    }
    expect(skinSheet(99)!.gfx, 'a skin the ROM does not know is BRENDAN, the way Spawn clamps').toBe(SKIN_GFX[0]);
  });
});

describe('a tap', () => {
  it('lands in a rectangle or not', () => {
    const r = { x: 10, y: 10, w: 20, h: 8 };
    expect(inRect(r, 10, 10)).toBe(true);
    expect(inRect(r, 29, 17)).toBe(true);
    expect(inRect(r, 30, 10)).toBe(false);
    expect(inRect(r, 9, 12)).toBe(false);
  });
});

describe('the drawn screens (POK-320)', () => {
  it('lays a list out one row per line inside its frame', async () => {
    const { layoutRows, ROW_H } = await import('./screens');
    const lay = layoutRows(24, 5);
    expect(lay.frame).toEqual({ x: 0, y: 24, w: 240, h: 5 * ROW_H + 16 });
    expect(lay.rows[0]).toEqual({ x: 8, y: 32, w: 224, h: ROW_H });
    expect(lay.rows[4].y).toBe(32 + 4 * ROW_H);
  });

  it("seats Kanto's 2x4, and a bigger MAX in more rows", async () => {
    const { layoutSeats, SEAT_W, SEAT_H } = await import('./screens');
    const eight = layoutSeats(24, 8);
    expect(eight.cells).toHaveLength(8);
    expect(eight.cells[0]).toEqual({ x: 8, y: 32, w: SEAT_W, h: SEAT_H });
    expect(eight.cells[3].x).toBe(8 + 3 * SEAT_W);
    expect(eight.cells[4]).toEqual({ x: 8, y: 32 + SEAT_H, w: SEAT_W, h: SEAT_H });
    expect(eight.frame.h).toBe(2 * SEAT_H + 16);
    expect(layoutSeats(24, 12).frame.h).toBe(3 * SEAT_H + 16);
    // Four across fill the 240 exactly with a tile each side.
    expect(4 * SEAT_W + 16).toBe(240);
  });

  it('centres a row of buttons a tile apart, each a whole number of tiles wide', async () => {
    const { layoutButtons, buttonWidth } = await import('./screens');
    expect(buttonWidth('START') % 8).toBe(0);
    const [wear, back] = layoutButtons(100, ['WEAR', 'BACK']);
    expect(wear.y).toBe(100);
    expect(back.x).toBe(wear.x + wear.w + 8);
    expect(wear.x).toBe(240 - (back.x + back.w));
  });

  it('pages MY VOICE to the screen, and opens on the page your line is on', async () => {
    const { linePageSize, linePageOf } = await import('./screens');
    // 320 is the shortest screen anybody draws for: fourteen lines and the buttons.
    expect(linePageSize(320)).toBe(14);
    expect(linePageSize(100)).toBe(4);
    expect(linePageOf(0, 14)).toBe(0);
    expect(linePageOf(13, 14)).toBe(0);
    expect(linePageOf(14, 14)).toBe(1);
  });

  it("says what the wardrobe's line says: yours, wearable, or the price", async () => {
    const { wardrobeNote } = await import('./screens');
    expect(wardrobeNote(0, 0, 0)).toBe('your sprite');
    expect(wardrobeNote(1, 0, 0)).toBe('press WEAR');
    expect(wardrobeNote(4, 0, 0)).toBe('LOCKED -- 1 win');
    expect(wardrobeNote(6, 2, 0)).toBe('LOCKED -- 4 wins');
    expect(wardrobeNote(6, 4, 0)).toBe('press WEAR');
  });

  it('shows the stage at whole pixels once it can afford two, and at the phone’s own fit below', async () => {
    const { stageScale } = await import('./stage');
    expect(stageScale(1200, 800)).toBe(2);
    expect(stageScale(1200, 1000)).toBe(3);
    expect(stageScale(375, 812)).toBeCloseTo(375 / 240);
    expect(stageScale(200, 300)).toBe(1);
  });

  it('cuts a long line to fit, with an ellipsis the font has', async () => {
    const { fitText, measure } = await import('./emerald');
    const long = 'A LINE THAT IS FAR TOO LONG FOR THE ROW IT IS ON';
    const cut = fitText(long, 100);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(100);
    expect(fitText('SHORT', 100)).toBe('SHORT');
  });
});

describe('the trainer card (POK-335)', () => {
  const model = (over: Partial<import('./screens').CardFace> = {}) => ({
    face: { name: 'CAM', skin: 0, wins: 3, played: 7, best: 1, ...over },
    rows: [{ label: 'SEND PLAY COUNT', detail: 'ON', id: 'trainer-stats', onPress: () => {} }],
    note: '',
    onName: () => {},
    onSkin: () => {},
    onBack: () => {},
  });

  it("draws Emerald's card with its fields where MONEY, POKéDEX and TIME go", async () => {
    const { trainerScreen } = await import('./screens');
    const { fakeCanvas } = await import('./fakecanvas');
    const { measure } = await import('./emerald');
    const { canvas, texts } = fakeCanvas();
    trainerScreen(() => model()).paint(canvas, 320);
    const at = (t: string) => texts.find((d) => d.text === t);
    expect(at('NAME: CAM')).toMatchObject({ x: 24, y: 41 });
    for (const [label, value, y] of [['WINS', '3', 65], ['PLAYED', '7', 81], ['BEST', '1st', 97]] as const) {
      expect(at(label)).toMatchObject({ x: 24, y });
      expect(at(value), `${value} right-aligned to the card's value column`).toMatchObject({ x: 136 - measure(value), y });
    }
    expect(texts.find((d) => d.text.startsWith('IDNo.'))?.y).toBe(17);
    const best = model({ best: undefined });
    const fresh = fakeCanvas();
    trainerScreen(() => best).paint(fresh.canvas, 320);
    expect(fresh.texts.some((d) => d.text === '---'), 'no BEST until a match is finished').toBe(true);
  });

  it('wears its stars’ colour and a girl’s background, a badge per win, and the skin’s portrait', async () => {
    const { trainerScreen, CARD_H } = await import('./screens');
    const { fakeCanvas } = await import('./fakecanvas');
    const paint = (face: Partial<import('./screens').CardFace>) => {
      const { canvas, pictures } = fakeCanvas();
      trainerScreen(() => model(face)).paint(canvas, 320);
      return pictures;
    };
    const may = paint({ skin: 1, wins: 8 });
    expect(may.find((p) => p.name === 'trainer-card.png')?.sy, 'two stars, the girl’s row').toBe((2 * 2 + 1) * CARD_H);
    expect(may.filter((p) => p.name === 'card-badges.png' && p.sx < 128)).toHaveLength(8);
    expect(may.filter((p) => p.name === 'card-badges.png' && p.sx === 128)).toHaveLength(2);
    expect(may.find((p) => p.name === 'trainer-pics.png')).toMatchObject({ sx: 64, x: 160, y: 40 });
    expect(paint({ skin: 13, wins: 30 }).find((p) => p.name === 'trainer-card.png')?.sy, 'POKEFAN LADY, gold').toBe((4 * 2 + 1) * CARD_H);
    expect(may.filter((p) => p.name === 'card-badges.png' && p.sx < 128).map((p) => [p.x, p.y]), 'in the slots, three tiles apart').toEqual(
      Array.from({ length: 8 }, (_, i) => [32 + i * 24, 120]),
    );
    const fresh = paint({ wins: 0 });
    expect(fresh.find((p) => p.name === 'trainer-card.png')?.sy, 'green, no stars').toBe(0);
    expect(fresh.filter((p) => p.name === 'card-badges.png')).toHaveLength(0);
  });

  it('still draws its words, and still opens your name and the wardrobe, when its art never comes', async () => {
    const { trainerScreen } = await import('./screens');
    const { fakeCanvas } = await import('./fakecanvas');
    const { canvas, texts, frames } = fakeCanvas(new Set(['trainer-card.png']));
    const painted = trainerScreen(() => model()).paint(canvas, 320);
    expect(frames[0], 'a plain window where the card would be').toEqual({ x: 0, y: 0, w: 240, h: 160 });
    expect(texts.some((d) => d.text === 'NAME: CAM')).toBe(true);
    expect(painted.widgets.filter((w) => w.onPress && w.parent === 'trainer-rows').slice(0, 2).map((w) => w.id)).toEqual(['trainer-name', 'trainer-skin']);
  });

  it('opens your name and the wardrobe from the card, first in the rows, and fits BACK on a 320 screen', async () => {
    const { trainerScreen } = await import('./screens');
    const { fakeCanvas } = await import('./fakecanvas');
    const pressed: string[] = [];
    const m = { ...model(), onName: () => pressed.push('name'), onSkin: () => pressed.push('skin') };
    // The rows app.ts puts under the card, so a row added to the profile fails this.
    const { profileRows } = await import('../match/lobby');
    const rows = profileRows({ name: 'CAM', skin: 'BRENDAN' })
      .filter((r) => r.action.kind !== 'name' && r.action.kind !== 'skin')
      .map((r) => ({ label: r.label, detail: r.detail, id: r.id, onPress: () => {} }));
    const painted = trainerScreen(() => ({ ...m, rows, note: 'Saved to a file.' })).paint(fakeCanvas().canvas, 320);
    const inRows = painted.widgets.filter((w) => w.parent === 'trainer-rows');
    expect(inRows.slice(0, 2).map((w) => w.id)).toEqual(['trainer-name', 'trainer-skin']);
    expect(inRows[0].text).toContain('your name');
    expect(inRows[1].text).toBe('BRENDAN your sprite');
    inRows[0].onPress!();
    inRows[1].onPress!();
    expect(pressed).toEqual(['name', 'skin']);
    const note = painted.widgets.find((w) => w.id === 'trainer-note')!;
    const back = painted.widgets.find((w) => w.id === 'trainer-back')!;
    expect(back.rect.y, 'BACK under the note, not over it').toBeGreaterThanOrEqual(note.rect.y + note.rect.h);
    expect(back.rect.y + back.rect.h).toBeLessThanOrEqual(320);
  });
});

describe('the page asks nothing with the browser (POK-320)', () => {
  // Every question outside the game is drawn now: the name, the code and the passcode on
  // the entry, the career's SAVE or LOAD on a notice. A prompt() or an alert() is a grey
  // box from another world in the middle of Emerald's.
  // The painter (painter.html, POK-314) is Cam's own tool for picking drop cells, never a
  // screen a player meets, so its one confirm() before throwing away a painting stays.
  const sources = import.meta.glob<string>(['../**/*.ts', '!../**/*.test.ts', '!../painter.ts'], { query: '?raw', import: 'default', eager: true });
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('finds the page', () => {
    expect(Object.keys(sources)).toContain('../app.ts');
  });

  it('calls no prompt(), confirm() or alert()', () => {
    const calls = Object.entries(sources).flatMap(([file, text]) =>
      [...code(text).matchAll(/(?<![\w.])(?:window\.)?(prompt|confirm|alert)\s*\(/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(calls).toEqual([]);
  });
});

describe('a notice', () => {
  it('breaks a sentence at its spaces to fit a line, and cuts a word too long for one', async () => {
    const { wrapText, measure } = await import('./emerald');
    const lines = wrapText('Pick your own POKEMON EMERALD ROM. It stays on this device.', 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(120);
    expect(lines.join(' ')).toBe('Pick your own POKEMON EMERALD ROM. It stays on this device.');
    const [cut] = wrapText('ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJ', 60);
    expect(measure(cut)).toBeLessThanOrEqual(60);
  });

  it('draws its title, its lines and its buttons, each where the mirror says', async () => {
    const { noticeScreen } = await import('./screens');
    const { fakeCanvas } = await import('./fakecanvas');
    const pressed: string[] = [];
    const screen = noticeScreen(() => ({
      title: 'MY CAREER',
      titleId: 'notice-title',
      lines: [{ text: 'Save it, or load one.', id: 'notice-line' }, { text: '' }],
      buttons: [
        { label: 'SAVE', id: 'career-save', onPress: () => pressed.push('save') },
        { label: 'BACK', onPress: () => pressed.push('back') },
      ],
      buttonsId: 'notice-buttons',
      footer: 'rom abc1234',
      onBack: () => pressed.push('b'),
    }));
    const { canvas, frames } = fakeCanvas();
    const painted = screen.paint(canvas, 320);
    const byId = (id: string) => painted.widgets.find((w) => w.id === id);
    expect(byId('notice-title')?.text).toBe('MY CAREER');
    expect(byId('notice-line')?.text).toBe('Save it, or load one.');
    expect(frames.length, 'one frame of lines, one per button').toBe(3);
    const back = painted.widgets.find((w) => w.text === 'BACK')!;
    expect(back.parent, 'in the container a test knows them by').toBe('notice-buttons');
    expect(painted.containers).toContainEqual({ id: 'notice-buttons' });
    back.onPress!();
    byId('career-save')!.onPress!();
    screen.back!();
    expect(pressed).toEqual(['back', 'save', 'b']);
    expect(painted.widgets.find((w) => w.cls === 'version')?.rect.y, 'the footer on the bottom line').toBe(320 - 16);
  });
});

describe("Emerald's fade over a cut (POK-320)", () => {
  it('fades when the stage covers the page or leaves it, not when the sheet opens or docks', async () => {
    const { fadesBetween } = await import('./stage');
    expect(fadesBetween('full', null), 'the room giving way to the match').toBe(true);
    expect(fadesBetween(null, 'full'), 'the match giving way to its results').toBe(true);
    expect(fadesBetween('dock', 'full'), 'a desktop match to its results').toBe(true);
    expect(fadesBetween('full', 'dock'), 'the room to a desktop match').toBe(true);
    expect(fadesBetween(null, 'overlay'), 'the sheet opening').toBe(false);
    expect(fadesBetween('overlay', null), 'the sheet closing').toBe(false);
    expect(fadesBetween('full', 'full'), 'one screen to the next').toBe(false);
    expect(fadesBetween(null, 'dock')).toBe(false);
  });
});
