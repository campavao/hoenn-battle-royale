// The results, drawn (POK-320): what they say, and when the champion gets to see them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndGrace } from '../match/grace';
import { ParadeHold, ReplayHold, fameOf, resultsScreen, resultsView, type ResultsModel } from './results';
import { fakeCanvas } from './fakecanvas';

const nameOf = (seat: number) => (seat === 2 ? 'MAY' : `P${seat}`);

describe('what the results say', () => {
  it('says where you came, how long you lasted, who won and the seed, in one line and in rows', () => {
    const v = resultsView({ ended: true, winner: 2, placement: 3, survived: 192 }, 8, 1, nameOf, 7);
    expect(v.headline).toBe('3rd of 8');
    expect(v.line).toBe('3rd of 8 · survived 3:12 · MAY won · seed 7');
    expect(v.rows).toEqual([
      { label: 'Survived', value: '3:12' },
      { label: 'Winner', value: 'MAY' },
      { label: 'Seed', value: '7' },
    ]);
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
    expect(fame).toEqual({ title: 'The champion: MAY', mons: ['MUDKIP Lv12', 'POOCHYENA Lv9'] });
    expect(fameOf(1, 1, party, nameOf, () => '')?.title).toBe('Your team');
    expect(fameOf(2, 1, undefined, nameOf, () => ''), "a bot's never does").toBeNull();
    expect(fameOf(undefined, 1, party, nameOf, () => '')).toBeNull();
  });

  it('keeps the ids the page always had, for a test and a screen reader', () => {
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 2, survived: 30 }, 8, 1, nameOf, 7),
      career: '1 played · 0 won · best 2nd',
      fame: { title: 'The champion: MAY', mons: ['MUDKIP Lv12'] },
      record: [{ label: 'RINGS', value: '2' }],
      again: { label: 'PLAY AGAIN', id: 'play-again', onPress: vi.fn() },
    };
    const painted = resultsScreen(() => model).paint(fakeCanvas().canvas, 320);
    const byId = (id: string) => painted.widgets.find((w) => w.id === id);
    expect(painted.containers).toContainEqual({ id: 'results-panel', cls: 'results' });
    expect(byId('results-line')?.text).toMatch(/seed 7$/);
    expect(byId('results-career')?.text).toBe('1 played · 0 won · best 2nd');
    expect(byId('results-fame')?.text).toContain('MUDKIP Lv12');
    expect(byId('results-record')?.text).toContain('RINGS 2');
    byId('play-again')!.onPress!();
    expect(model.again!.onPress).toHaveBeenCalled();
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(320);
  });

  // 2026-10-07 play-test: "there is no menu button after a game, meaning there is no way to
  // exit without modifying the url".
  it('has MAIN MENU beside PLAY AGAIN, side by side and both on the screen', () => {
    const menu = vi.fn();
    const model: ResultsModel = {
      view: resultsView({ ended: true, winner: 2, placement: 2, survived: 30 }, 8, 1, nameOf),
      career: '1 played · 0 won · best 2nd',
      fame: null,
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

  it("holds only the champion's own results, only until the parade, and nothing on a build that cannot say", () => {
    let over = false;
    let now = 0;
    const hold = new ParadeHold({ done: () => over, graceMs: 1_000, giveUpMs: 55_000, onParaded: () => {}, now: () => now });
    expect(hold.holds(1, 1), 'our own win waits for our parade').toBe(true);
    expect(hold.holds(2, 1), "somebody else's win is read at once").toBe(false);
    expect(hold.holds(undefined, 1), 'so is a draw').toBe(false);
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
