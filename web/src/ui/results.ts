// The results, drawn (POK-320): where you came, how long you lasted, who won and with
// what, what the match did to your career, and what you did in it -- the Hall of Fame
// line and the record card, in Emerald's frame where they were a panel of HTML.
//
// The champion's come after their ROM's own Hall of Fame parade, not over it: the ticket
// asked for "the results as a continuation of the Hall of Fame rather than a panel under
// it", and the old panel opened the moment the `win` landed, covering the parade on a
// phone. ParadeHold is that wait.
//
// A watcher's come after the fight on their screen (POK-365): the last fight of a match
// is settled before its replay has played, and the results used to cut it off with
// "WINNER BRENDAN" before the watcher saw who won. ReplayHold is that wait.
//
// The words and the wait are plain functions and a class on a clock, so results.test.ts
// can pin them without a page. The waits are results-hold.ts: the page holds them from
// the start, and this file is fetched the first time results go up (POK-407).
import { ordinal } from '../match/career';
import type { RecordLine } from '../match/record';
import type { MatchResult } from '../match/results';
import { TEXT_BLUE, TEXT_DARK, fitText } from './emerald';
import { ROW_H, W, paintButtons, paintRows, paintTitle, type ButtonSpec } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

export { ParadeHold, ReplayHold } from './results-hold';

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
    rows.push({ label: 'Survived', value: clock(mine.survived) });
  }
  if (mine.winner !== undefined) {
    parts.push(mine.winner === seat ? 'you won' : `${nameOf(mine.winner)} won`);
    rows.push({ label: 'Winner', value: mine.winner === seat ? 'You' : nameOf(mine.winner) });
  } else {
    parts.push('a draw');
    rows.push({ label: 'Winner', value: 'Nobody' });
  }
  if (seed !== undefined) {
    parts.push(`seed ${seed}`);
    rows.push({ label: 'Seed', value: String(seed) });
  }
  const headline =
    mine.winner !== undefined && mine.winner === seat
      ? 'You won!'
      : mine.placement !== undefined
        ? `${ordinal(mine.placement)} of ${seats}`
        : mine.winner === undefined
          ? 'A draw'
          : 'Results';
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
  return { title: winner === seat ? 'Your team' : `The champion: ${nameOf(winner)}`, mons };
}

export interface ResultsModel {
  view: ResultsView;
  /** The career line the match produced, which recordMatch folds it into. */
  career: string;
  fame: Fame | null;
  record: RecordLine[];
  /** PLAY AGAIN in a room; solo's MAIN MENU (id `results-lobby`, as the e2e has it). */
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
