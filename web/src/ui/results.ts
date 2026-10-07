// The results, drawn (POK-320): where you came, how long you lasted, who won and with
// what, what the match did to your career, and what you did in it -- the Hall of Fame
// line and the record card, in Emerald's frame where they were a panel of HTML.
//
// The champion's come after their ROM's own Hall of Fame parade, not over it: the ticket
// asked for "the results as a continuation of the Hall of Fame rather than a panel under
// it", and the old panel opened the moment the `win` landed, covering the parade on a
// phone. ParadeHold is that wait.
//
// The words and the wait are plain functions and a class on a clock, so results.test.ts
// can pin them without a page.
import { ordinal } from '../match/career';
import type { RecordLine } from '../match/record';
import type { MatchResult } from '../match/results';
import { TEXT_BLUE, TEXT_DARK, fitText } from './emerald';
import { ROW_H, W, paintButtons, paintRows, paintTitle, type ButtonSpec } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

export interface ResultsView {
  /** The big line: YOU WON!, 3RD OF 8, or A DRAW. */
  headline: string;
  /** Everything in one line, as the page always said it -- what #results-line reads. The
   *  seed is last: it is the question anybody asks about a round afterwards (POK-248). */
  line: string;
  rows: { label: string; value: string }[];
}

function clock(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** What the results say about `seat`'s match. */
export function resultsView(mine: MatchResult, seats: number, seat: number, nameOf: (seat: number) => string, seed?: number): ResultsView {
  const parts: string[] = [];
  const rows: { label: string; value: string }[] = [];
  if (mine.placement !== undefined) parts.push(`${ordinal(mine.placement)} of ${seats}`);
  if (mine.survived !== undefined) {
    parts.push(`survived ${clock(mine.survived)}`);
    rows.push({ label: 'SURVIVED', value: clock(mine.survived) });
  }
  if (mine.winner !== undefined) {
    parts.push(mine.winner === seat ? 'you won' : `${nameOf(mine.winner)} won`);
    rows.push({ label: 'WINNER', value: mine.winner === seat ? 'YOU' : nameOf(mine.winner) });
  } else {
    parts.push('a draw');
    rows.push({ label: 'WINNER', value: 'NOBODY' });
  }
  if (seed !== undefined) {
    parts.push(`seed ${seed}`);
    rows.push({ label: 'SEED', value: String(seed) });
  }
  const headline =
    mine.winner !== undefined && mine.winner === seat
      ? 'YOU WON!'
      : mine.placement !== undefined
        ? `${ordinal(mine.placement).toUpperCase()} OF ${seats}`
        : mine.winner === undefined
          ? 'A DRAW'
          : 'RESULTS';
  return { headline, line: parts.join(' · '), rows };
}

export interface Fame {
  title: string;
  mons: string[];
}

/** The champion's team (POK-243's half of the parade), or null when it never arrived --
 *  a bot's never does, since a bot has no ROM to send one. */
export function fameOf(
  winner: number | undefined,
  seat: number,
  party: readonly { species: number; nickname?: string; level: number }[] | undefined,
  nameOf: (seat: number) => string,
  speciesName: (species: number) => string,
): Fame | null {
  if (winner === undefined || !party) return null;
  const mons = party.filter((m) => m.species > 0).map((m) => `${m.nickname || speciesName(m.species)} Lv${m.level}`);
  if (mons.length === 0) return null;
  return { title: winner === seat ? 'YOUR TEAM' : `THE CHAMPION: ${nameOf(winner)}`, mons };
}

/** The champion's results wait for their Hall of Fame (BR_PHASE_DONE), then stay up for
 *  the grace everybody else gets. EndGrace polls `finished` as its paradeDone, so the one
 *  poll does both: the first time the parade is seen over, the results are drawn
 *  (`onParaded`); the exit comes `graceMs` after that. A parade that never ends is given
 *  up on after `giveUpMs`, and the results go up anyway. */
export class ParadeHold {
  private seenAt: number | null = null;
  private waitingSince: number | null = null;

  constructor(
    private readonly opts: {
      /** The ROM's parade is over. Undefined when the build cannot say (no gBrMatch), and
       *  then nothing is held: the results go up at the `win`, as anybody's do. */
      done?(): boolean;
      graceMs: number;
      /** How long the parade is waited for, from the grace's first look: EndGrace's
       *  winMaxMs less a grace and two polls, so the results are read for the grace and
       *  the poll takes the exit just ahead of that deadline. The deadline takes it
       *  regardless, and a stuck parade used to hold the results past it: its champion
       *  never saw them at all (POK-320 review). */
      giveUpMs: number;
      onParaded(): void;
      now?(): number;
    },
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  /** The parade has been seen over: the results are the champion's to read. */
  get paraded(): boolean {
    return this.seenAt !== null;
  }

  /** Whether `seat`'s results wait: its own win, with the parade still to be seen over.
   *  The room and solo each asked this themselves, and nothing pinned either. */
  holds(winner: number | undefined, seat: number): boolean {
    return this.opts.done !== undefined && winner === seat && !this.paraded;
  }

  /** For EndGrace: the parade over, and the results read for the grace since. */
  finished = (): boolean => {
    const now = this.now();
    if (this.seenAt === null) {
      this.waitingSince ??= now;
      if (!this.opts.done?.() && now - this.waitingSince < this.opts.giveUpMs) return false;
      this.seenAt = now;
      this.opts.onParaded();
    }
    return now - this.seenAt >= this.opts.graceMs;
  };

  /** The next match's champion waits for the next parade. */
  reset(): void {
    this.seenAt = null;
    this.waitingSince = null;
  }
}

export interface ResultsModel {
  view: ResultsView;
  /** The career line the match produced, which recordMatch folds it into. */
  career: string;
  fame: Fame | null;
  record: RecordLine[];
  /** PLAY AGAIN in a room; solo's way back to the lobby. */
  again: { label: string; id: string; disabled?: boolean; onPress(): void } | null;
  /** MAIN MENU, beside PLAY AGAIN: a room's results were the one screen with no way off
   *  it but the URL (2026-10-07 play-test). Solo's `again` already is the menu. */
  menu?: () => void;
}

/** The results screen. The mirror keeps the ids the page always had: #results-panel,
 *  #results-line, #results-career, #results-fame, #results-record, #play-again. */
export function resultsScreen(model: () => ResultsModel): DrawnScreen {
  return {
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      let y = 6;
      paintTitle(c, fitText(m.view.headline, W - 8), y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.view.headline, cls: 'results-head', cursor: null });
      y += 22;

      // The match, and under it what it did to the career.
      const top = y;
      const match = paintRows(c, y, [
        ...m.view.rows.map((r) => ({ label: r.label, detail: r.value })),
        { label: m.career || ' ', id: 'results-career', cls: 'results-career', color: TEXT_BLUE },
      ]);
      widgets.push({ rect: { x: 0, y: top, w: W, h: match.bottom - top }, text: m.view.line, id: 'results-line', cls: 'results-line', cursor: null });
      widgets.push(...match.widgets.map((w) => (w.id === 'results-career' ? { ...w, text: m.career } : w)));
      y = match.bottom + 4;

      if (m.fame) {
        // The champion's team, two to a row, under whose it is.
        const pairs: { label: string; detail?: string }[] = [];
        for (let i = 0; i < m.fame.mons.length; i += 2) pairs.push({ label: m.fame.mons[i], detail: m.fame.mons[i + 1] });
        const fameTop = y;
        const fame = paintRows(c, y, [{ label: m.fame.title, color: TEXT_BLUE }, ...pairs]);
        widgets.push({ rect: { x: 0, y: fameTop, w: W, h: fame.bottom - fameTop }, text: `${m.fame.title}: ${m.fame.mons.join(', ')}`, id: 'results-fame', cls: 'results-fame', cursor: null });
        y = fame.bottom + 4;
      }

      if (m.record.length > 0) {
        const recTop = y;
        const rec = paintRows(c, y, m.record.map((l) => ({ label: l.label, detail: l.value, color: TEXT_DARK })));
        widgets.push({
          rect: { x: 0, y: recTop, w: W, h: rec.bottom - recTop },
          text: m.record.map((l) => `${l.label} ${l.value}`).join(' · '),
          id: 'results-record',
          cls: 'results-record',
          cursor: null,
        });
        y = rec.bottom + 4;
      }

      const buttons: ButtonSpec[] = [];
      if (m.again) buttons.push({ label: m.again.label, id: m.again.id, disabled: m.again.disabled, onPress: m.again.onPress });
      if (m.menu) buttons.push({ label: 'MAIN MENU', id: 'results-menu', onPress: m.menu });
      if (buttons.length) widgets.push(...paintButtons(c, Math.min(y, h - 28), buttons));
      return { widgets, containers: [{ id: 'results-panel', cls: 'results' }] };
    },
  };
}
