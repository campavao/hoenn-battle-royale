import { describe, expect, it } from 'vitest';
import { SKIN_GFX, frameTiles, glyphIds, inRect, measure, messageBoxTiles, skinSheet } from './emerald';
import { SKINS, WARDROBE } from '../match/career';
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

  it('lays the main menu out as tiles: one across, then two to a line (HBR-30)', async () => {
    const { layoutTiles } = await import('./screens');
    const six = layoutTiles(68, 6);
    expect(six[0]).toEqual({ x: 0, y: 68, w: 240, h: 44 });
    expect(six[1]).toEqual({ x: 0, y: 116, w: 118, h: 62 });
    expect(six[2]).toEqual({ x: 122, y: 116, w: 118, h: 62 });
    // An odd one out goes across.
    expect(six[5]).toEqual({ x: 0, y: 248, w: 240, h: 62 });
    // Eight (WATCH and the daily too) come lower to fit what is left of the screen.
    const room = 320 - 68 - 22;
    const eight = layoutTiles(68, 8, room);
    const last = eight[7];
    expect(last.y + last.h).toBeLessThanOrEqual(68 + room);
    expect(last.h).toBeLessThan(62);
  });

  it('puts every main menu tile, its picture and the NEW on the screen (HBR-30)', async () => {
    const { menuScreen } = await import('./screens');
    const { fakeCanvas } = await import('./fakecanvas');
    const { FEEDBACK_ROW, HOWTO_ROW, playRows, rewatchRow } = await import('../match/lobby');
    const rows = [rewatchRow('ABCD'), ...playRows('up', { daily: true } as never), HOWTO_ROW, FEEDBACK_ROW].map((r) => ({
      label: r.label,
      id: r.id,
      art: r.art,
      badge: r.id === 'lobby-howto',
      onPress: () => undefined,
    }));
    const fake = fakeCanvas();
    const painted = menuScreen(() => ({ title: 'HOENN BATTLE ROYALE', rows, note: '', tiles: true, trainer: { name: 'CAM', skin: 0, record: '', onPress: () => undefined } })).paint(fake.canvas, 320);
    for (const r of rows) {
      const w = painted.widgets.find((x) => x.id === r.id)!;
      expect(w.text, r.id).toBe(r.label);
      expect(w.rect.y + w.rect.h, `${r.id} is on the screen`).toBeLessThanOrEqual(320);
    }
    expect(rows.filter((r) => r.art).length, 'everything but WATCH has a picture').toBe(rows.length - 1);
    // Seven and a note line: the low half tiles still say every word (#110's review).
    const seven = rows.slice(1);
    for (const h of [300, 310, 316, 320, 330]) {
      const low = fakeCanvas();
      menuScreen(() => ({ title: 'HOENN BATTLE ROYALE', rows: seven, note: 'The relay is down.', tiles: true, trainer: { name: 'CAM', skin: 0, record: '', onPress: () => undefined } })).paint(low.canvas, h);
      for (const r of seven) expect(low.texts.map((t) => t.text), `${r.label} uncut at ${h}`).toContain(r.label);
    }
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

  it("puts each room control's picture beside its words, and every word still fits (POK-345)", async () => {
    const { optionLayout, optionRect, visualWidth } = await import('./screens');
    const { FOG_STEPS, MAX_STEPS, SAFARI_STEPS, TEXT_SPEEDS, fillLabel, levelOf, safariLabel, textSpeedLabel } = await import('../match/room');
    // paintOptions' text run, in either column.
    for (const col of [0, 1]) {
      const cell = optionRect(0, col);
      const x = cell.x + 8;
      const w = cell.w - 10;
      // Every label a host control can show, at its widest, from the room's own ladders.
      const room: [string, Parameters<typeof optionLayout>[1]][] = [
        ...MAX_STEPS.map((max): [string, Parameters<typeof optionLayout>[1]] => [fillLabel({ fillOn: true, fill: max - 1 }), { kind: 'toggle', on: true }]),
        [fillLabel({ fillOn: false, fill: 0 }), { kind: 'toggle', on: false }],
        ...TEXT_SPEEDS.map((t): [string, Parameters<typeof optionLayout>[1]] => [`TEXT ${textSpeedLabel(t.value)}`, { kind: 'level', ...levelOf(TEXT_SPEEDS.map((s) => s.value), t.value) }]),
        ['ANIM OFF', { kind: 'toggle', on: false }],
        ...FOG_STEPS.map((secs): [string, Parameters<typeof optionLayout>[1]] => [`FOG ${secs}s`, { kind: 'level', ...levelOf(FOG_STEPS, secs), clock: true }]),
        ...SAFARI_STEPS.map((secs): [string, Parameters<typeof optionLayout>[1]] => [safariLabel(secs), { kind: 'level', ...levelOf(SAFARI_STEPS, secs, true), clock: true }]),
      ];
      for (const [label, visual] of room) {
        const lay = optionLayout(label, visual, x, w);
        expect(lay.text, `${label} is not cut`).toBe(label);
        expect(lay.textX + measure(label), `${label} stops short of its picture`).toBeLessThanOrEqual((lay.visualX ?? 0) - 4);
        expect((lay.visualX ?? 0) + visualWidth(visual!), `${label}'s picture stays in its cell`).toBe(x + w);
      }
      // A timer's clock goes in front of its words.
      expect(optionLayout('FOG 120s', { kind: 'level', at: 4, of: 5, clock: true }, x, w).clockX).toBe(x);
      // MAX has no picture (Cam's 2026-10-19 play-test), and its words still fit.
      for (const max of MAX_STEPS) expect(optionLayout(`MAX ${max}`, undefined, x, w).text).toBe(`MAX ${max}`);
      // And a control without one is drawn as it always was.
      expect(optionLayout('LISTED', undefined, x, w)).toEqual({ clockX: null, textX: x, text: 'LISTED', visualX: null });
    }
  });

  it('keeps START and LEAVE off the host options at any MAX, on any height (POK-375)', async () => {
    const { roomScreen } = await import('./screens');
    const { fakeCanvas } = await import('./fakecanvas');
    const options = ['max', 'fill', 'door', 'text', 'anim', 'fog', 'safari'].map((id) => ({ id: `room-${id}`, label: id.toUpperCase(), onPress: () => undefined }));
    const seat = (i: number) => ({ seat: i, name: `P${i}`, skin: 0, isMe: i === 0, spectating: false, alive: true });
    const model = (max: number, people: number) => ({
      status: 'Room ABCDEF', note: 'START: 30 trainers', seats: Array.from({ length: people }, (_, i) => seat(i)), max, fill: max - people,
      isHost: true, started: false, canStart: true, startLabel: 'START', countdown: null, options, card: null,
      onStart: () => undefined, onLeave: () => undefined, onSeat: () => undefined, onKick: () => undefined, onCloseCard: () => undefined,
    });
    for (const h of [320, 360, 400, 480]) {
      for (const max of [2, 8, 12, 16, 20, 30]) {
        for (const people of [1, Math.min(max, 16)]) {
          const painted = roomScreen(() => model(max, people)).paint(fakeCanvas().canvas, h);
          const start = painted.widgets.find((w) => w.id === 'room-start')!;
          const lastOption = painted.widgets.filter((w) => w.id?.startsWith('room-') && w.id !== 'room-start' && w.id !== 'room-leave' && w.id !== 'room-code').at(-1)!;
          const at = `h ${h}, MAX ${max}, ${people} in the room`;
          expect(lastOption.id, at).toBe('room-safari');
          expect(start.rect.y, at).toBeGreaterThanOrEqual(lastOption.rect.y + lastOption.rect.h);
          expect(start.rect.y + start.rect.h, at).toBeLessThanOrEqual(h);
          // Everybody in the room is a cell, or counted in the +N one.
          const cells = painted.widgets.filter((w) => w.cls === 'roster-name').length;
          const more = painted.widgets.find((w) => / more$/.test(w.text));
          expect(cells + (more ? Number(more.text.split(' ')[0]) : 0), at).toBe(people);
        }
      }
    }
    // A tall screen still seats sixteen in four rows: nobody is folded away for nothing.
    const tall = roomScreen(() => model(30, 16)).paint(fakeCanvas().canvas, 480);
    expect(tall.widgets.filter((w) => w.cls === 'roster-name')).toHaveLength(16);

    // A short one pages them: +N turns to the next page, round to the first, so the host
    // can open anybody's card (and KICK) in the room's own order.
    const short = roomScreen(() => model(30, 16));
    const names = () => short.paint(fakeCanvas().canvas, 320).widgets.filter((w) => w.cls === 'roster-name').map((w) => w.text);
    const turn = () => short.paint(fakeCanvas().canvas, 320).widgets.find((w) => w.cls === 'room-more')!.onPress!();
    const firstPage = names();
    expect(firstPage[0]).toBe('P0 (you)');
    const seen = [...firstPage];
    let pages = 1;
    for (turn(); names()[0] !== firstPage[0]; turn()) {
      seen.push(...names());
      pages++;
    }
    expect(pages).toBe(Math.ceil(16 / firstPage.length));
    expect(seen).toEqual(model(30, 16).seats.map((s) => (s.isMe ? `${s.name} (you)` : s.name)));
  });

  it('centres a row of buttons a tile apart, each a whole number of tiles wide', async () => {
    const { layoutButtons, buttonWidth } = await import('./screens');
    expect(buttonWidth('START') % 8).toBe(0);
    const [wear, back] = layoutButtons(100, ['WEAR', 'BACK']);
    expect(wear.y).toBe(100);
    expect(back.x).toBe(wear.x + wear.w + 8);
    expect(wear.x).toBe(240 - (back.x + back.w));
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
  const model = (over: Partial<import('./profile').CardFace> = {}) => ({
    face: { name: 'CAM', skin: 0, wins: 3, played: 7, best: 1, ...over },
    rows: [{ label: 'SEND PLAY COUNT', detail: 'ON', id: 'trainer-stats', onPress: () => {} }],
    note: '',
    onName: () => {},
    onSkin: () => {},
    onBack: () => {},
  });

  it("draws Emerald's card with its fields where MONEY, POKéDEX and TIME go", async () => {
    const { trainerScreen } = await import('./profile');
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
    // No IDNo. (POK-418): every trainer's was 00000.
    expect(texts.some((d) => d.text.startsWith('IDNo.'))).toBe(false);
    const best = model({ best: undefined });
    const fresh = fakeCanvas();
    trainerScreen(() => best).paint(fresh.canvas, 320);
    expect(fresh.texts.some((d) => d.text === '---'), 'no BEST until a match is finished').toBe(true);
  });

  it('wears its stars’ colour and a girl’s background, a badge per win, and the skin’s portrait', async () => {
    const { trainerScreen, CARD_H } = await import('./profile');
    const { fakeCanvas } = await import('./fakecanvas');
    const paint = (face: Partial<import('./profile').CardFace>) => {
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
    const { trainerScreen } = await import('./profile');
    const { fakeCanvas } = await import('./fakecanvas');
    const { canvas, texts, frames } = fakeCanvas(new Set(['trainer-card.png']));
    const painted = trainerScreen(() => model()).paint(canvas, 320);
    expect(frames[0], 'a plain window where the card would be').toEqual({ x: 0, y: 0, w: 240, h: 160 });
    expect(texts.some((d) => d.text === 'NAME: CAM')).toBe(true);
    expect(painted.widgets.filter((w) => w.onPress && w.parent === 'trainer-rows').slice(0, 2).map((w) => w.id)).toEqual(['trainer-name', 'trainer-skin']);
  });

  it('opens your name and the wardrobe from the card, first in the rows, and fits BACK on a 320 screen', async () => {
    const { trainerScreen } = await import('./profile');
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

describe('MY LOOK (POK-337)', () => {
  const LINES = ['FOUND YOU.', 'STILL STANDING.', 'GOOD FIGHT.', 'AGAIN?'];
  const model = (over: Record<string, unknown> = {}) => ({
    wins: 0,
    worn: 0,
    browsing: 0,
    lines: LINES,
    picked: { intro: 0, win: 1, lose: 3 },
    onBrowse: () => {},
    onLine: () => {},
    onBack: () => {},
    ...over,
  });

  it("is Emerald's dialogue box tile for tile: two corners each end of the top, one-tile sides, the bottom flipped", () => {
    const tiles = messageBoxTiles(30, 6);
    expect(tiles).toHaveLength(180);
    const at = (c: number, r: number) => tiles.find((t) => t.c === c && t.r === r)!;
    expect([0, 1, 2, 28, 29].map((c) => at(c, 0).t)).toEqual([1, 3, 4, 5, 6]);
    expect([0, 1, 28, 29].map((c) => at(c, 2).t)).toEqual([7, 9, 9, 10]);
    expect(at(1, 5)).toEqual({ c: 1, r: 5, t: 3, flip: true });
    expect(at(1, 0).flip).toBe(false);
  });

  it('turns the strip round the wardrobe, the one you are on in the middle', async () => {
    const { lookStrip, stepSkin } = await import('./profile');
    expect(stepSkin(0, 1)).toBe(1);
    expect(stepSkin(1, 1), 'past the retired rivals').toBe(4);
    expect(stepSkin(0, -1)).toBe(WARDROBE[WARDROBE.length - 1]);
    expect(stepSkin(WARDROBE[WARDROBE.length - 1], 1)).toBe(0);
    expect(lookStrip(0)).toEqual([WARDROBE[WARDROBE.length - 2], WARDROBE[WARDROBE.length - 1], 0, 1, 4]);
  });

  it("says a skin's price, or that it is yours", async () => {
    const { lookNote } = await import('./profile');
    expect(lookNote(0, 0, 0)).toBe('your sprite');
    expect(lookNote(4, 0, 0)).toBe('LOCKED -- 1 win');
    expect(lookNote(6, 2, 0)).toBe('LOCKED -- 4 wins');
  });

  it('draws the big picture, the strip and three dialogue boxes, and fits BACK on a 320 screen', async () => {
    const { lookScreen } = await import('./profile');
    const { fakeCanvas } = await import('./fakecanvas');
    const { canvas, texts, pictures, boxes, sprites, arrows } = fakeCanvas();
    const painted = lookScreen(() => model({ browsing: 4, worn: 1 })).paint(canvas, 320);
    expect(pictures.find((p) => p.name === 'trainer-pics.png'), 'the browsed skin, large').toMatchObject({ sx: 4 * 64, x: 16, y: 10 });
    expect(boxes).toEqual([0, 1, 2].map((i) => ({ x: 0, y: 142 + i * 48, w: 240, h: 48 })));
    expect(texts.filter((t) => t.y > 142 && t.y < 286).map((t) => t.text)).toEqual(['WALKING UP', 'FOUND YOU.', 'WHEN YOU WIN', 'STILL STANDING.', 'WHEN YOU LOSE', 'AGAIN?']);
    expect(texts.find((t) => t.text === 'LOCKED -- 1 win')).toBeDefined();
    // Each box shows it turns both ways: an arrow at each edge, on the line's row.
    for (const i of [0, 1, 2]) {
      expect(arrows).toContainEqual({ x: 9, y: 142 + i * 48 + 25, left: true });
      expect(arrows).toContainEqual({ x: 226, y: 142 + i * 48 + 25, left: false });
    }
    // Five sprites: BRENDAN, MAY, HIKER (lit, and faded: locked), and the two after it.
    expect(sprites).toHaveLength(5);
    expect(sprites[2].alpha).toBe(0.3);
    expect(sprites[1].alpha).toBe(1);
    expect(texts.find((t) => t.text === 'wearing MAY'), 'what you still wear').toBeDefined();
    const strip = painted.widgets.filter((w) => w.parent === 'look-sprites');
    expect(strip.map((w) => w.text)).toEqual(['BRENDAN', 'MAY (worn)', 'HIKER LOCKED', `${SKINS[5]} LOCKED`, `${SKINS[6]} LOCKED`]);
    expect(strip.filter((w) => w.cursor !== null).map((w) => w.id)).toEqual(['look-sprite']);
    const back = painted.widgets.find((w) => w.id === 'look-back')!;
    expect(back.rect.y).toBeGreaterThanOrEqual(142 + 3 * 48);
    expect(back.rect.y + back.rect.h).toBeLessThanOrEqual(320);
  });

  it('turns a line with a press, its arrows, or left and right on its row, round the pool', async () => {
    const { lookScreen } = await import('./profile');
    const { fakeCanvas } = await import('./fakecanvas');
    const said: string[] = [];
    const screen = lookScreen(() => model({ onLine: (slot: string, i: number) => said.push(`${slot}${i}`) }));
    const w = screen.paint(fakeCanvas().canvas, 320).widgets;
    const by = (id: string) => w.find((x) => x.id === id)!;
    by('look-intro').onPress!();
    by('look-intro-prev').onPress!();
    by('look-lose-next').onPress!();
    expect(screen.key!('right', by('look-win'))).toBe(true);
    expect(screen.key!('left', by('look-win'))).toBe(true);
    expect(screen.key!('down', by('look-win')), 'up and down are the cursor’s').toBe(false);
    expect(screen.key!('left', by('look-back')), 'nothing to turn on BACK').toBe(false);
    expect(said).toEqual(['intro1', 'intro3', 'lose0', 'win2', 'win0']);
  });

  it('turns the strip with its arrows, a press on a sprite, or left and right on it', async () => {
    const { lookScreen } = await import('./profile');
    const { fakeCanvas } = await import('./fakecanvas');
    const went: number[] = [];
    const screen = lookScreen(() => model({ onBrowse: (s: number) => went.push(s) }));
    const w = screen.paint(fakeCanvas().canvas, 320).widgets;
    w.find((x) => x.id === 'look-next')!.onPress!();
    w.find((x) => x.id === 'look-prev')!.onPress!();
    w.find((x) => x.text === 'HIKER LOCKED')!.onPress!();
    screen.key!('right', w.find((x) => x.id === 'look-sprite')!);
    expect(went).toEqual([1, WARDROBE[WARDROBE.length - 1], 4, 1]);
  });
});
