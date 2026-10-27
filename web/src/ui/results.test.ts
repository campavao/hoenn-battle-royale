// The results, drawn (POK-320): what they say, and when the champion gets to see them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndGrace } from '../match/grace';
import { ParadeHold, ReplayHold, fameOf, resultsScreen, resultsView, standingsOf, type ResultsModel } from './results';
import { fakeCanvas } from './fakecanvas';

const nameOf = (seat: number) => (seat === 2 ? 'MAY' : `P${seat}`);

describe('what the results say', () => {
  it('says where you came, how long you lasted, who won and the seed in one line, and only how long on the screen', () => {
    const v = resultsView({ ended: true, winner: 2, placement: 3, survived: 192 }, 8, 1, nameOf, 7);
    expect(v.headline).toBe('3rd of 8');
    expect(v.line).toBe('3rd of 8 · survived 3:12 · MAY won · seed 7');
    expect(v.survived).toBe('3:12');
    expect(Object.keys(v).sort(), 'no Winner row and no seed footer (10-20 play-test, #13)').toEqual(['headline', 'line', 'survived']);
  });

  it('crowns you, and calls a draw a draw', () => {
    expect(resultsView({ ended: true, winner: 1, placement: 1, survived: 60 }, 8, 1, nameOf).headline).toBe('You won!');
    const draw = resultsView({ ended: true, survived: 60 }, 8, 1, nameOf);
    expect(draw.headline).toBe('A draw');
    expect(draw.line).toBe('survived 1:00 · a draw');
  });

  it("names the champion's team, and says nothing of a team that never came", () => {
    const party = [
      { species: 258, nickname: 'MUDKIP', level: 12 },
      { species: 0, nickname: '', level: 0 },
      { species: 261, nickname: '', level: 9 },
    ];
    const fame = fameOf(2, 1, party, nameOf, () => 'POOCHYENA');
    expect(fame).toMatchObject({ title: 'The champion: MAY', mons: ['MUDKIP Lv12', 'POOCHYENA Lv9'] });
    expect(fame?.cards.map((c) => [c.species, c.name, c.kind])).toEqual([[258, 'MUDKIP', 'POOCHYENA'], [261, 'POOCHYENA', undefined]]);
    expect(fameOf(1, 1, party, nameOf, () => '')?.title).toBe('Your team');
    expect(fameOf(2, 1, undefined, nameOf, () => ''), "a bot's never does").toBeNull();
    expect(fameOf(undefined, 1, party, nameOf, () => '')).toBeNull();
  });

  it('keeps the ids the page always had, for a test and a screen reader', () => {
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 2, survived: 30 }, 8, 1, nameOf, 7),
      fame: { title: 'The champion: MAY', mons: ['MUDKIP Lv12'], cards: [] },
      standings: [],
      record: [{ label: 'RINGS', value: '2' }],
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
    };
    const screen = resultsScreen(() => model);
    let painted = screen.paint(fakeCanvas().canvas, 320);
    const byId = (id: string) => painted.widgets.find((w) => w.id === id);
    expect(painted.containers).toContainEqual({ id: 'results-panel', cls: 'results' });
    expect(byId('results-line')?.text).toMatch(/seed 7$/);
    // HBR-51: no career line ("1 played" read as wins).
    expect(byId('results-career')).toBeUndefined();
    expect(byId('results-record')?.text).toContain('RINGS 2');
    byId('play-again')!.onPress!();
    expect(model.again!.onPress).toHaveBeenCalled();
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
    // The team is the second page's.
    expect(byId('results-fame')).toBeUndefined();
    byId('results-page')!.onPress!();
    painted = screen.paint(fakeCanvas().canvas, 320);
    expect(byId('results-fame')?.text).toContain('MUDKIP Lv12');
    expect(byId('results-page')?.text).toBe('RANKING');
  });

  // Cam's 10-20 play-test, #12 and #15: "see what place Matt came in", and "how many
  // Pokemon did Drake catch, how many steps did Drake take".
  it("puts everybody's place on the first page and the champion's stats under their team on the second", () => {
    const standings = standingsOf(
      [{ seat: 2, placement: 1 }, { seat: 5, placement: 2 }, { seat: 1, placement: 3 }, { seat: 0, placement: 4 }, { seat: 3, placement: 5 }],
      1,
      nameOf,
    );
    expect(standings[2]).toEqual({ place: '3rd', name: 'P1', me: true });
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 3, survived: 30 }, 5, 1, nameOf),
      fame: fameOf(2, 1, [258, 327, 227, 327, 406].map((species) => ({ species, level: 100 })), nameOf, (sp) => ({ 258: 'MUDKIP', 327: 'SPINDA', 227: 'SKARMORY', 406: 'RAYQUAZA' })[sp] ?? '?'),
      standings,
      record: [{ label: 'RINGS', value: '2' }, { label: 'CAUGHT', value: '1' }, { label: 'STEPS', value: '748' }, { label: 'FAVORITE', value: 'MR. MIME', wide: true }],
      champion: { name: 'MAY', lines: [{ label: 'RINGS', value: '6' }, { label: 'CAUGHT', value: '4' }, { label: 'STEPS', value: '2100' }, { label: 'FAVORITE', value: 'FERALIGATR', wide: true }] },
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
      menu: vi.fn(),
    };
    const screen = resultsScreen(() => model);
    const { canvas, texts } = fakeCanvas();
    let painted = screen.paint(canvas, 320);
    const byId = (id: string) => painted.widgets.find((w) => w.id === id);
    expect(byId('results-standings')?.text).toBe('1st MAY · 2nd P5 · 3rd P1 · 4th P0 · 5th P3');
    expect(byId('results-champion')).toBeUndefined();
    expect(texts.map((t) => t.text)).not.toContain('Winner');
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
    const buttons = painted.widgets.filter((w) => w.onPress);
    expect(buttons.map((b) => b.text)).toEqual(['PLAY AGAIN', 'MAIN MENU', 'CHAMPION']);
    for (let i = 1; i < buttons.length; i++) expect(buttons[i].rect.x, 'no overlap').toBeGreaterThanOrEqual(buttons[i - 1].rect.x + buttons[i - 1].rect.w);
    expect(buttons[0].rect.x).toBeGreaterThanOrEqual(0);
    expect(buttons[2].rect.x + buttons[2].rect.w).toBeLessThanOrEqual(240);

    const placesAt = byId('results-page')!.rect;
    byId('results-page')!.onPress!();
    painted = screen.paint(fakeCanvas().canvas, 320);
    expect(byId('results-page')!.rect, 'the buttons stay put as the page turns').toEqual(placesAt);
    expect(byId('results-champion')?.text).toBe('RINGS 6 · CAUGHT 4 · STEPS 2100 · FAVORITE FERALIGATR');
    expect(byId('results-fame')?.text).toContain('RAYQUAZA Lv100');
    expect(byId('results-standings')).toBeUndefined();
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
  });

  // HBR-47: "the champion's team like the hall of fame cards, and tap one for its summary".
  it("draws a full team of six as cards, the champion's stats with them or after, and a tap opens one", () => {
    const party = [406, 160, 384, 282, 376, 395].map((species, i) => ({
      species,
      level: 50 + i,
      nickname: i === 0 ? 'RAY' : '',
      hp: 100,
      maxHp: 150,
      shiny: i === 1,
      moves: [{ id: 1 }, { id: 2 }, { id: 0 }],
    }));
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 3, survived: 30 }, 8, 1, nameOf),
      fame: fameOf(2, 1, party, nameOf, () => 'RAYQUAZA', (id) => ['', 'POUND', 'KARATE CHOP'][id]),
      standings: [],
      record: [],
      champion: {
        name: 'MAY',
        lines: [...Array.from({ length: 8 }, (_, i) => ({ label: `N${i}`, value: '1' })), { label: 'FAVORITE', value: 'FERALIGATR', wide: true }, { label: 'TOP MOVE', value: 'HYDRO PUMP', wide: true }],
      },
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
      menu: vi.fn(),
    };
    const screen = resultsScreen(() => model);
    screen.paint(fakeCanvas().canvas, 320).widgets.find((w) => w.id === 'results-page')!.onPress!();
    let fake = fakeCanvas();
    let painted = screen.paint(fake.canvas, 320);
    const byId = (id: string) => painted.widgets.find((w) => w.id === id);
    expect(fake.texts.some((t) => t.text === 'The champion: MAY'), 'the page is under their name').toBe(true);
    expect(fake.pictures.map((p) => p.name)).toEqual(['/mon-pics/406.png', '/mon-pics/160s.png', '/mon-pics/384.png', '/mon-pics/282.png', '/mon-pics/376.png', '/mon-pics/395.png']);
    const cards = painted.widgets.filter((w) => w.id?.startsWith('fame-card-'));
    expect(cards).toHaveLength(6);
    for (let i = 1; i < cards.length; i++) {
      const a = cards[i - 1].rect;
      const b = cards[i].rect;
      expect(a.x + a.w <= b.x || a.y + a.h <= b.y, 'cards do not overlap').toBe(true);
    }
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
    const buttonsAt = byId('results-page')!.rect.y;
    for (const f of fake.frames.filter((f) => f.y < buttonsAt)) expect(f.y + f.h, 'no frame under the buttons').toBeLessThanOrEqual(buttonsAt);
    // Six cards and every count do not both fit over the buttons at 320: RECORDS is a page.
    expect(byId('results-champion')).toBeUndefined();
    expect(byId('results-page')?.text).toBe('RECORDS');
    const pageAt = byId('results-page')!.rect;
    byId('results-page')!.onPress!();
    fake = fakeCanvas();
    painted = screen.paint(fake.canvas, 320);
    expect(byId('results-champion')?.text).toContain('TOP MOVE HYDRO PUMP');
    expect(byId('results-page')?.rect, 'the buttons stay put').toEqual(pageAt);
    expect(byId('results-page')?.text).toBe('RANKING');
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
    // A taller screen has room for both.
    painted = screen.paint(fakeCanvas().canvas, 480);
    expect(byId('results-page')?.text).toBe('CHAMPION');
    byId('results-page')!.onPress!();
    painted = screen.paint(fakeCanvas().canvas, 480);
    expect(byId('results-champion')?.text).toContain('TOP MOVE HYDRO PUMP');
    expect(painted.widgets.filter((w) => w.id?.startsWith('fame-card-'))).toHaveLength(6);
    painted = screen.paint(fakeCanvas().canvas, 320);

    cards[0].onPress!();
    fake = fakeCanvas();
    painted = screen.paint(fake.canvas, 320);
    expect(byId('fame-summary')?.text).toBe('RAY · RAYQUAZA · Lv50 · HP 100/150 · POUND · KARATE CHOP');
    expect(byId('results-page'), 'a card has only its way back').toBeUndefined();
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
    byId('fame-back')!.onPress!();
    painted = screen.paint(fakeCanvas().canvas, 320);
    expect(painted.widgets.filter((w) => w.id?.startsWith('fame-card-'))).toHaveLength(6);
  });

  it("a card holds any ten-letter name whole, and its summary's four moves stay over BACK", () => {
    const party = [{ species: 160, level: 100, nickname: 'WWWWWWWWWW', hp: 1, maxHp: 300, shiny: true, moves: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }];
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 3, survived: 30 }, 8, 1, nameOf),
      fame: fameOf(2, 1, party, nameOf, () => 'FERALIGATR', (id) => ['', 'HYDRO PUMP', 'SURF', 'STRENGTH', 'ICE BEAM'][id]),
      standings: [],
      record: [],
      champion: { name: 'MAY', lines: [{ label: 'WON', value: '3' }] },
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
      menu: vi.fn(),
    };
    const screen = resultsScreen(() => model);
    screen.paint(fakeCanvas().canvas, 320).widgets.find((w) => w.id === 'results-page')!.onPress!();
    let fake = fakeCanvas();
    let painted = screen.paint(fake.canvas, 320);
    expect(fake.texts.some((t) => t.text === 'WWWWWWWWWW'), 'the name, not cut').toBe(true);
    painted.widgets.find((w) => w.id === 'fame-card-0')!.onPress!();
    fake = fakeCanvas();
    painted = screen.paint(fake.canvas, 320);
    const summary = painted.widgets.find((w) => w.id === 'fame-summary')!.rect;
    const back = painted.widgets.find((w) => w.id === 'fame-back')!.rect;
    expect(summary.y + summary.h, 'the moves end over BACK').toBeLessThanOrEqual(back.y);
    for (const mv of ['HYDRO PUMP', 'SURF', 'STRENGTH', 'ICE BEAM']) expect(fake.texts.some((t) => t.text === mv), mv).toBe(true);
    // The lines beside the picture start past it: the picture is at x 8, 64 wide.
    const beside = fake.texts.filter((t) => ['Lv100', 'HP 1/300', 'Shiny'].includes(t.text));
    expect(beside).toHaveLength(3);
    for (const t of beside) expect(t.x, t.text).toBeGreaterThanOrEqual(8 + 64 + 4);
  });

  it('fits a full room of 32 on a 320-high screen, our own place always on it', () => {
    const standings = Array.from({ length: 32 }, (_, i) => ({ place: `${i + 1}th`, name: `TRAINER${i}`, me: i === 30 }));
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 31, survived: 30 }, 32, 1, nameOf),
      fame: null,
      standings,
      record: [...Array.from({ length: 8 }, (_, i) => ({ label: `N${i}`, value: '1' })), { label: 'FAVORITE', value: 'MR. MIME', wide: true }, { label: 'TOP MOVE', value: 'CONFUSION', wide: true }],
      champion: { name: 'MAY', lines: [{ label: 'RINGS', value: '6' }] },
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
      menu: vi.fn(),
    };
    const { canvas, texts, frames } = fakeCanvas();
    const painted = resultsScreen(() => model).paint(canvas, 320);
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
    const buttonsAt = painted.widgets.find((w) => w.id === 'results-page')!.rect.y;
    for (const f of frames.filter((f) => f.y < buttonsAt)) expect(f.y + f.h, 'no frame under the buttons').toBeLessThanOrEqual(buttonsAt);
    expect(texts.some((t) => t.text === '31th'), 'our own place').toBe(true);
  });

  // Cam's 10-26 play-test: "a single column rather than three columns", which cut every
  // name to four letters, "and make it scrollable".
  it('lists the standings one to a row, whole names, scrolled by the D-pad or by hand', () => {
    const names = ['MAY', 'CAM', 'PHOEBE', 'BIRCH', 'FLANNERY', 'ROXANNE', 'TABITHA', 'RILEY', 'SHELLY', 'WALLACE', 'NORMAN', 'LIZA', 'COURTNEY', 'WATTSON', 'LANETTE', 'SCOTT', 'WALLY', 'ARCHIE', 'CAMERON', 'DRAKE', 'BILL', 'TATE', 'STEVEN', 'WINONA', 'BRAWLY', 'MATT', 'DEVON'];
    const standings = names.map((name, i) => ({ place: `${i + 1}th`, name, me: name === 'CAM' }));
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 2, survived: 1398 }, 27, 1, nameOf),
      fame: null,
      standings,
      record: [{ label: 'RINGS', value: '2' }, { label: 'CAUGHT', value: '1' }],
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
      menu: vi.fn(),
    };
    const screen = resultsScreen(() => model);
    const paint = () => {
      const fake = fakeCanvas();
      return { painted: screen.paint(fake.canvas, 320), texts: fake.texts.map((t) => t.text), places: fake.texts.filter((t) => /^\d+th$/.test(t.text)) };
    };
    let { painted, texts, places } = paint();
    expect(new Set(places.map((p) => p.x)).size, 'one column').toBe(1);
    const rows = places.length;
    expect(rows).toBeGreaterThan(5);
    expect(rows).toBeLessThan(27);
    expect(texts.slice(texts.indexOf('1th'), texts.indexOf('1th') + 2)).toEqual(['1th', 'MAY']);
    for (const name of names.slice(0, rows)) expect(texts, name).toContain(name);
    expect(texts).toContain('↓');
    expect(texts).not.toContain('↑');
    const list = painted.widgets.find((w) => w.id === 'results-standings')!;
    expect(list.scroll).toBeDefined();
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);

    // Down a row: 2nd at the top, ↑ now too.
    expect(screen.key!('down', null)).toBe(true);
    ({ texts, places } = paint());
    expect(places[0].text).toBe('2th');
    expect(texts).toContain('↑');
    // A drag far past the end stops on the last row, DEVON, and the arrow down goes.
    expect(list.scroll!(100)).toBe(true);
    ({ painted, texts, places } = paint());
    expect(places[places.length - 1].text).toBe('27th');
    expect(texts).toContain('DEVON');
    expect(texts).not.toContain('↓');
    expect(painted.widgets.find((w) => w.id === 'results-standings')!.scroll!(1), 'no further').toBe(false);
    expect(screen.key!('up', null)).toBe(true);
    ({ places } = paint());
    expect(places[places.length - 1].text).toBe('26th');
  });

  it('keeps our own place in the window as others go out, until the player scrolls', () => {
    // Best first, so each trainer out after us is a row above ours (app.ts updates the
    // model while the screen is up).
    const model: ResultsModel = {
      view: resultsView({ ended: false, placement: 20, survived: 30 }, 27, 1, nameOf),
      fame: null,
      standings: [],
      record: [],
      again: null,
    };
    const screen = resultsScreen(() => model);
    const paint = () => {
      const { canvas, texts } = fakeCanvas();
      screen.paint(canvas, 320);
      return texts.map((t) => t.text);
    };
    const others = Array.from({ length: 26 }, (_, i) => ({ place: `${i + 1}th`, name: `T${i}`, me: false }));
    for (let above = 19; above <= 26; above++) {
      model.standings = [...others.slice(0, above), { place: `${above + 1}th`, name: 'ME', me: true }];
      expect(paint(), `with ${above} above`).toContain('ME');
    }
    // Scrolled to the top by hand, it stays there.
    for (let i = 0; i < 30; i++) screen.key!('up', null);
    model.standings = [...others, { place: '27th', name: 'ME', me: true }];
    const texts = paint();
    expect(texts).toContain('1th');
    expect(texts).not.toContain('ME');
  });

  it('starts the list where our own place is, when it is past the window', () => {
    const standings = Array.from({ length: 27 }, (_, i) => ({ place: `${i + 1}th`, name: `T${i}`, me: i === 25 }));
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 26, survived: 30 }, 27, 1, nameOf),
      fame: null,
      standings,
      record: [],
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
    };
    const { canvas, texts } = fakeCanvas();
    resultsScreen(() => model).paint(canvas, 320);
    expect(texts.map((t) => t.text)).toContain('26th');
  });

  it("names the champion over their stats when their team has not come", () => {
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 3, survived: 30 }, 8, 1, nameOf),
      fame: null,
      standings: [],
      record: [],
      champion: { name: 'MAY', lines: [{ label: 'RINGS', value: '6' }] },
      again: null,
    };
    const screen = resultsScreen(() => model);
    let painted = screen.paint(fakeCanvas().canvas, 320);
    painted.widgets.find((w) => w.id === 'results-page')!.onPress!();
    const { canvas, texts } = fakeCanvas();
    painted = screen.paint(canvas, 320);
    expect(texts.map((t) => t.text)).toContain('The champion: MAY');
  });

  it('has one page for a draw: nobody to show a team or stats of', () => {
    const model: ResultsModel = {
      view: resultsView({ ended: true, survived: 30 }, 4, 1, nameOf),
      fame: null,
      standings: [],
      record: [],
      again: null,
    };
    const painted = resultsScreen(() => model).paint(fakeCanvas().canvas, 320);
    expect(painted.widgets.find((w) => w.id === 'results-page')).toBeUndefined();
  });

  // 2026-10-07 play-test: "there is no menu button after a game, meaning there is no way to
  // exit without modifying the url".
  it('has MAIN MENU beside PLAY AGAIN, side by side and both on the screen', () => {
    const menu = vi.fn();
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 2, survived: 30 }, 8, 1, nameOf),
      fame: null,
      standings: [],
      record: [],
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
      menu,
    };
    const painted = resultsScreen(() => model).paint(fakeCanvas().canvas, 320);
    const again = painted.widgets.find((w) => w.id === 'play-again')!;
    const out = painted.widgets.find((w) => w.id === 'results-menu')!;
    expect(out.text).toBe('MAIN MENU');
    expect(out.rect.y, 'one row').toBe(again.rect.y);
    expect(out.rect.x, 'no overlap').toBeGreaterThanOrEqual(again.rect.x + again.rect.w);
    out.onPress!();
    expect(menu).toHaveBeenCalled();
    const without = resultsScreen(() => ({ ...model, menu: undefined })).paint(fakeCanvas().canvas, 320);
    expect(without.widgets.find((w) => w.id === 'results-menu'), "solo's own button is the menu").toBeUndefined();
  });
});

describe("the champion's Hall of Fame comes first (POK-320)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('draws the results when the parade is over, and takes the exit a grace after that', () => {
    // The page's own wiring: EndGrace polls the hold as its paradeDone.
    let over = false;
    const drawn = vi.fn();
    const hold = new ParadeHold({ done: () => over, graceMs: 4_000, giveUpMs: 55_000, onParaded: drawn, now: () => Date.now() });
    const grace = new EndGrace({ graceMs: 4_000, winMaxMs: 60_000, pollMs: 500, paradeDone: hold.finished });
    const exit = vi.fn();
    grace.arm(exit, true);
    vi.advanceTimersByTime(20_000);
    expect(hold.paraded, 'the parade is still running').toBe(false);
    expect(drawn).not.toHaveBeenCalled();
    over = true;
    vi.advanceTimersByTime(500);
    expect(drawn, 'the results come the moment it ends').toHaveBeenCalledTimes(1);
    expect(hold.paraded).toBe(true);
    expect(exit, 'and stay up to be read').not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_500);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('the next match waits for the next parade', () => {
    let over = true;
    let now = 0;
    const hold = new ParadeHold({ done: () => over, graceMs: 1_000, giveUpMs: 55_000, onParaded: () => {}, now: () => now });
    expect(hold.finished()).toBe(false);
    now = 1_000;
    expect(hold.finished()).toBe(true);
    hold.reset();
    over = false;
    expect(hold.paraded).toBe(false);
    expect(hold.finished()).toBe(false);
  });

  it("a parade that never ends still shows its champion the results, for the grace, before the deadline's exit", () => {
    // POK-320 review: the results waited on BR_PHASE_DONE alone, and EndGrace's deadline
    // took the exit regardless -- a stuck parade's champion never saw a placement at all.
    const drawn = vi.fn();
    const giveUpMs = 60_000 - 4_000 - 2 * 500; // app.ts's: winMaxMs less a grace and two polls
    const hold = new ParadeHold({ done: () => false, graceMs: 4_000, giveUpMs, onParaded: drawn, now: () => Date.now() });
    const grace = new EndGrace({ graceMs: 4_000, winMaxMs: 60_000, pollMs: 500, paradeDone: hold.finished });
    const exit = vi.fn();
    grace.arm(exit, true);
    vi.advanceTimersByTime(55_000);
    expect(drawn, 'still waiting on the parade').not.toHaveBeenCalled();
    expect(hold.holds(1, 1)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(drawn, 'given up on: the results go up').toHaveBeenCalledTimes(1);
    expect(hold.holds(1, 1)).toBe(false);
    vi.advanceTimersByTime(3_500);
    expect(exit, 'and are read for the grace').not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(exit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(exit, 'one exit: the poll took it, and the deadline with it').toHaveBeenCalledTimes(1);
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('holds anybody\'s results until the parade, a draw not at all, and nothing on a build that cannot say', () => {
    let over = false;
    let now = 0;
    const hold = new ParadeHold({ done: () => over, graceMs: 1_000, giveUpMs: 55_000, onParaded: () => {}, now: () => now });
    expect(hold.holds(1, 1), 'our own win waits for our parade').toBe(true);
    expect(hold.holds(2, 1), "somebody else's win waits for theirs, in our ROM (POK-417)").toBe(true);
    expect(hold.holds(undefined, 1), 'a draw is read at once').toBe(false);
    over = true;
    now = 500;
    hold.finished();
    expect(hold.holds(1, 1), 'the parade is over').toBe(false);
    hold.reset();
    over = false;
    expect(hold.holds(1, 1), "the next match's champion waits for the next one").toBe(true);
    // No gBrMatch: the ROM cannot say when its parade is over, and nothing waits on it.
    const blind = new ParadeHold({ graceMs: 1_000, giveUpMs: 55_000, onParaded: () => {} });
    expect(blind.holds(1, 1)).toBe(false);
  });
});

describe('the record, a table (POK-416, 10-19 #29)', () => {
  it('runs the counts down two columns and gives a name a row of its own', async () => {
    const { recordRows } = await import('./results');
    expect(
      recordRows([
        { label: 'RINGS', value: '2' },
        { label: 'WON', value: '3' },
        { label: 'CAUGHT', value: '1' },
        { label: 'FAVORITE', value: 'TREECKO', wide: true },
      ]),
    ).toEqual([
      { left: { label: 'RINGS', value: '2' }, right: { label: 'CAUGHT', value: '1' } },
      { left: { label: 'WON', value: '3' }, right: undefined },
      { left: { label: 'FAVORITE', value: 'TREECKO' }, wide: true },
    ]);
  });

});

describe("everybody sees the champion's Hall of Fame (POK-417)", () => {
  it("gives somebody else's parade its start window to begin, and no longer", () => {
    let now = 0;
    let phase = 2;
    const drawn = vi.fn();
    const hold = new ParadeHold({
      done: () => phase === 5,
      started: () => phase >= 4,
      startMs: 15_000,
      graceMs: 1_000,
      giveUpMs: 55_000,
      onParaded: drawn,
      now: () => now,
    });
    expect(hold.holds(3, 1)).toBe(true);
    expect(hold.finished()).toBe(false);
    now = 14_000;
    expect(hold.finished(), 'still inside the window').toBe(false);
    now = 15_000;
    expect(hold.finished(), 'no parade came: the results go up').toBe(false);
    expect(drawn).toHaveBeenCalledTimes(1);
    now = 16_000;
    expect(hold.finished(), 'read for the grace, then out').toBe(true);
  });

  it('waits for a parade that has begun, past the window, until it is over', () => {
    let now = 0;
    let phase = 2;
    const drawn = vi.fn();
    const hold = new ParadeHold({ done: () => phase === 5, started: () => phase >= 4, startMs: 15_000, graceMs: 1_000, giveUpMs: 55_000, onParaded: drawn, now: () => now });
    hold.holds(3, 1);
    hold.finished();
    now = 5_000;
    phase = 4;
    hold.finished();
    now = 40_000;
    expect(hold.finished()).toBe(false);
    expect(drawn, 'the parade is on').not.toHaveBeenCalled();
    phase = 5;
    now = 41_000;
    hold.finished();
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it("does not count a replay against the window: the ROM's parade waits behind it", () => {
    let now = 0;
    let replaying = true;
    const drawn = vi.fn();
    const hold = new ParadeHold({ done: () => false, started: () => false, startMs: 15_000, paused: () => replaying, graceMs: 1_000, giveUpMs: 55_000, onParaded: drawn, now: () => now });
    hold.holds(3, 1);
    hold.finished();
    now = 30_000;
    hold.finished();
    expect(drawn, 'thirty seconds of replay is not the window').not.toHaveBeenCalled();
    replaying = false;
    now = 44_000;
    hold.finished();
    expect(drawn).not.toHaveBeenCalled();
    now = 46_000;
    hold.finished();
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('runs no give-up while a replay plays, up to its cap, and holds the exit meanwhile', () => {
    let now = 0;
    let replaying = true;
    const drawn = vi.fn();
    const hold = new ParadeHold({ done: () => false, started: () => false, startMs: 15_000, paused: () => replaying, pauseMaxMs: 150_000, graceMs: 1_000, giveUpMs: 55_000, onParaded: drawn, now: () => now });
    hold.holds(3, 1);
    for (now = 0; now <= 100_000; now += 500) hold.finished();
    expect(drawn, 'a hundred seconds of replay').not.toHaveBeenCalled();
    expect(hold.holding).toBe(true);
    replaying = false;
    for (; now <= 116_000; now += 500) hold.finished();
    expect(drawn, 'the window, after the replay').toHaveBeenCalledTimes(1);
    expect(hold.holding).toBe(false);
  });

  it('never gives our own parade the window: it waits until it is over or the deadline', () => {
    let now = 0;
    const drawn = vi.fn();
    const hold = new ParadeHold({ done: () => false, started: () => false, startMs: 15_000, graceMs: 1_000, giveUpMs: 55_000, onParaded: drawn, now: () => now });
    hold.holds(1, 1);
    hold.finished();
    now = 30_000;
    hold.finished();
    expect(drawn).not.toHaveBeenCalled();
  });
});

// POK-365: the last fight was settled before its replay had played, and the results cut
// to "WINNER BRENDAN" over it.
describe("a watcher's results wait for the fight on screen (POK-365)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds while the replay plays, and draws the moment it ends', () => {
    let replaying = true;
    const drawn = vi.fn();
    const hold = new ReplayHold({ replaying: () => replaying, watching: () => true, maxMs: 60_000, startMs: 2_000, pollMs: 500, onOver: drawn, now: () => Date.now() });
    expect(hold.holds()).toBe(true);
    expect(hold.waiting, 'the grace leaves the page be').toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(drawn).not.toHaveBeenCalled();
    replaying = false;
    vi.advanceTimersByTime(500);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(hold.waiting).toBe(false);
    replaying = true;
    expect(hold.holds(), 'a replay after the results are up does not take them down').toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('waits a moment for a replay that has not come on, and no longer', () => {
    const drawn = vi.fn();
    const hold = new ReplayHold({ replaying: () => false, watching: () => true, maxMs: 60_000, startMs: 2_000, pollMs: 500, onOver: drawn, now: () => Date.now() });
    expect(hold.holds(), 'the win can beat the bstart to the ROM').toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(hold.waiting).toBe(false);
  });

  it("holds nothing for a page that watches nobody: the champion, or the last fight's loser", () => {
    const drawn = vi.fn();
    const hold = new ReplayHold({ replaying: () => false, watching: () => false, maxMs: 60_000, startMs: 2_000, pollMs: 500, onOver: drawn });
    expect(hold.holds()).toBe(false);
    expect(hold.waiting).toBe(false);
    expect(drawn).not.toHaveBeenCalled();
  });

  it('holds for a replay that comes on after the win', () => {
    let replaying = false;
    const drawn = vi.fn();
    const hold = new ReplayHold({ replaying: () => replaying, watching: () => true, maxMs: 60_000, startMs: 2_000, pollMs: 500, onOver: drawn, now: () => Date.now() });
    expect(hold.holds()).toBe(true);
    vi.advanceTimersByTime(1_000);
    replaying = true;
    vi.advanceTimersByTime(10_000);
    expect(drawn, 'past startMs, the replay that came on holds it').not.toHaveBeenCalled();
    replaying = false;
    vi.advanceTimersByTime(500);
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('gives up on a replay that never ends', () => {
    const drawn = vi.fn();
    const hold = new ReplayHold({ replaying: () => true, watching: () => true, maxMs: 60_000, startMs: 2_000, pollMs: 500, onOver: drawn, now: () => Date.now() });
    expect(hold.holds()).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(drawn).toHaveBeenCalledTimes(1);
    expect(hold.holds()).toBe(false);
  });

  it('waits again for the next match once reset', () => {
    let replaying = true;
    const hold = new ReplayHold({ replaying: () => replaying, watching: () => true, maxMs: 60_000, startMs: 2_000, pollMs: 500, onOver: () => {} });
    expect(hold.holds()).toBe(true);
    replaying = false;
    expect(hold.holds()).toBe(false);
    hold.reset();
    replaying = true;
    expect(hold.holds()).toBe(true);
    hold.reset();
  });
});
