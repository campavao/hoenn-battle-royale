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
import type { TallyNames } from '../match/tally';
import type { TallyMsg } from '../net/wire';
import type { MatchResult } from '../match/results';
import { TEXT_BLUE, TEXT_DARK, type EmeraldCanvas, fitText, measure } from './emerald';
import { ROW_H, W, layoutRows, paintButtons, paintRows, paintTitle, type ButtonSpec } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

export { ParadeHold, ReplayHold } from './results-hold';

export interface ResultsView {
  /** The big line: YOU WON!, 3RD OF 8, or A DRAW. */
  headline: string;
  /** Everything in one line, as the page always said it -- what #results-line reads. The
   *  seed is last: it is the question anybody asks about a round afterwards (POK-248).
   *  It is the mirror's alone: on the screen it was a number nobody reads (Cam's 10-20
   *  play-test, #13). */
  line: string;
  /** How long you lasted, over the standings. */
  survived?: string;
}

function clock(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** What the results say about `seat`'s match. Not who won: the champion's page says it
 *  under their team, and a row saying it again was the 10-20 play-test's "Winner DRAKE"
 *  over "The champion: DRAKE". */
export function resultsView(mine: MatchResult, seats: number, seat: number, nameOf: (seat: number) => string, seed?: number): ResultsView {
  const parts: string[] = [];
  if (mine.placement !== undefined) parts.push(`${ordinal(mine.placement)} of ${seats}`);
  if (mine.survived !== undefined) parts.push(`survived ${clock(mine.survived)}`);
  if (mine.winner !== undefined) parts.push(mine.winner === seat ? 'you won' : `${nameOf(mine.winner)} won`);
  else parts.push('a draw');
  if (seed !== undefined) parts.push(`seed ${seed}`);
  const headline =
    mine.winner !== undefined && mine.winner === seat
      ? 'You won!'
      : mine.placement !== undefined
        ? `${ordinal(mine.placement)} of ${seats}`
        : mine.winner === undefined
          ? 'A draw'
          : 'Results';
  return { headline, line: parts.join(' · '), survived: mine.survived === undefined ? undefined : clock(mine.survived) };
}

/** One trainer's place, for the standings. */
export interface Standing {
  place: string;
  name: string;
  me: boolean;
}

/** Everybody's place (Cam's 10-20 play-test, #15: "see what place Matt came in"). */
export function standingsOf(placed: readonly { seat: number; placement: number }[], seat: number, nameOf: (seat: number) => string): Standing[] {
  return placed.map((p) => ({ place: ordinal(p.placement), name: nameOf(p.seat), me: p.seat === seat }));
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

/** The match's own lines, for the results under the Hall of Fame. Every count is said,
 *  zero too -- "0 caught" is an answer to the question Cam asked -- and a favourite only
 *  once there is one. Ours or the champion's, in the shape the room hears it (tallyMsg). */
export function tallyLines(t: Omit<TallyMsg, 't' | 'seat'>, names: TallyNames): RecordLine[] {
  const lines: RecordLine[] = [
    { label: 'WON', value: String(t.won) },
    { label: 'CAUGHT', value: String(t.caught) },
    { label: 'STEPS', value: String(t.steps) },
    { label: 'ITEMS', value: String(t.items) },
  ];
  if (t.mon !== undefined) lines.push({ label: 'FAVORITE', value: names.species(t.mon), wide: true });
  const moveName = t.move === undefined ? undefined : names.move(t.move);
  if (moveName) lines.push({ label: 'TOP MOVE', value: moveName, wide: true });
  return lines;
}

/** One row of the record's table: a count in each half, or a name across the whole row. */
export interface RecordRow {
  left: { label: string; value: string };
  right?: { label: string; value: string };
  wide?: boolean;
}

/** The record as a table (Cam's 10-19 play-test, #29: "it's gotta be an easier-to-read
 *  table... sometimes it's talking across the aisle"). Two columns of counts, each count's
 *  value at the right edge of its own column, then each name on a row of its own. */
export function recordRows(lines: readonly RecordLine[]): RecordRow[] {
  const rows: RecordRow[] = [];
  const counts = lines.filter((l) => !l.wide);
  const half = Math.ceil(counts.length / 2);
  // Down the left column, then the right, the way a table reads.
  for (let i = 0; i < half; i++) {
    const l = counts[i];
    const r = counts[i + half];
    rows.push({ left: { label: l.label, value: l.value }, right: r && { label: r.label, value: r.value } });
  }
  for (const l of lines) if (l.wide) rows.push({ left: { label: l.label, value: l.value }, wide: true });
  return rows;
}

/** The gap between the table's two columns. */
const COL_GAP = 16;

function paintRecord(c: EmeraldCanvas, y: number, rows: readonly RecordRow[]): number {
  const lay = layoutRows(y, rows.length);
  c.drawFrame(lay.frame);
  rows.forEach((row, i) => {
    const r = lay.rows[i];
    const x0 = r.x + 8;
    const x1 = r.x + r.w;
    const cells: [number, number, { label: string; value: string }][] = row.wide || !row.right
      ? [[x0, row.wide ? x1 : Math.floor((x0 + x1 - COL_GAP) / 2), row.left]]
      : [
          [x0, Math.floor((x0 + x1 - COL_GAP) / 2), row.left],
          [Math.floor((x0 + x1 + COL_GAP) / 2), x1, row.right],
        ];
    for (const [from, to, cell] of cells) {
      const labelW = c.drawText(fitText(cell.label, to - from), from, r.y, TEXT_DARK);
      const value = fitText(cell.value, Math.max(0, to - from - labelW - 6));
      if (value) c.drawText(value, to - measure(value), r.y, TEXT_DARK);
    }
  });
  return lay.frame.y + lay.frame.h;
}

export interface ResultsModel {
  view: ResultsView;
  /** The career line the match produced, which recordMatch folds it into. */
  career: string;
  fame: Fame | null;
  /** Everybody's place, best first. */
  standings: Standing[];
  /** Ours: the room's counts and our ROM's. */
  record: RecordLine[];
  /** The champion's, when it is somebody else (Cam's 10-20 play-test, #12): what the room
   *  saw of them, and what their ROM counted once their page has said it (TallyMsg). */
  champion?: RecordLine[];
  /** PLAY AGAIN in a room; solo's MAIN MENU (id `results-lobby`, as the e2e has it). */
  again: { label: string; id: string; disabled?: boolean; onPress(): void } | null;
  /** MAIN MENU, beside PLAY AGAIN: a room's results were the one screen with no way off
   *  it but the URL (2026-10-07 play-test). Solo's `again` already is the menu. */
  menu?: () => void;
}

/** The results' two pages: where everybody came and what you did, then the champion's
 *  team and what they did. One page held them all until the 10-20 play-test asked for
 *  everybody's place and the champion's stats too, which a 320-high screen has no room
 *  for under the rest. */
export type ResultsPage = 'match' | 'champion';

function paintStandings(c: EmeraldCanvas, y: number, survived: string | undefined, standings: readonly Standing[]): number {
  const half = Math.ceil(standings.length / 2);
  const lay = layoutRows(y, (survived === undefined ? 0 : 1) + half);
  c.drawFrame(lay.frame);
  let row = 0;
  if (survived !== undefined) {
    const r = lay.rows[row++];
    c.drawText('Survived', r.x + 8, r.y, TEXT_DARK);
    c.drawText(survived, r.x + r.w - measure(survived), r.y, TEXT_DARK);
  }
  // Down the left column, then the right, the way the record reads.
  for (let i = 0; i < half; i++, row++) {
    const r = lay.rows[row];
    const x0 = r.x + 8;
    const mid = Math.floor((x0 + r.x + r.w + COL_GAP) / 2);
    for (const [s, from, to] of [[standings[i], x0, mid - COL_GAP], [standings[i + half], mid, r.x + r.w]] as const) {
      if (!s) continue;
      const color = s.me ? TEXT_BLUE : TEXT_DARK;
      c.drawText(s.place, from, r.y, color);
      c.drawText(fitText(s.name, to - from - PLACE_W), from + PLACE_W, r.y, color);
    }
  }
  return lay.frame.y + lay.frame.h;
}

/** How far down the first page's footer ends: the title, the standings, the record and
 *  the career line, each a frame and a gap. */
function matchBottom(m: ResultsModel): number {
  const framed = (rows: number) => layoutRows(0, rows).frame.h + 4;
  const standings = (m.view.survived === undefined ? 0 : 1) + Math.ceil(m.standings.length / 2);
  return 28 + framed(standings) + (m.record.length > 0 ? framed(recordRows(m.record).length) : 0) + framed(1);
}

/** The place column: "8th" and a space. */
const PLACE_W = 28;

/** The results screen. The mirror keeps the ids the page always had: #results-panel,
 *  #results-line, #results-career, #results-fame, #results-record, #play-again -- the
 *  first page holds all of them but the fame, which is the second's. */
export function resultsScreen(model: () => ResultsModel): DrawnScreen {
  let page: ResultsPage = 'match';
  return {
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const second = m.fame !== null || m.champion !== undefined;
      if (!second) page = 'match';
      let y = 6;
      paintTitle(c, fitText(m.view.headline, W - 8), y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.view.headline, cls: 'results-head', cursor: null });
      y += 22;

      const record = (id: string, lines: readonly RecordLine[]) => {
        if (lines.length === 0) return;
        const top = y;
        // Two columns of counts, so the room's and the ROM's both fit (POK-416); a name
        // gets a row of its own.
        const bottom = paintRecord(c, y, recordRows(lines));
        widgets.push({ rect: { x: 0, y: top, w: W, h: bottom - top }, text: lines.map((l) => `${l.label} ${l.value}`).join(' · '), id, cls: 'results-record', cursor: null });
        y = bottom + 4;
      };

      if (page === 'match') {
        const top = y;
        const bottom = paintStandings(c, y, m.view.survived, m.standings);
        widgets.push({
          rect: { x: 0, y: top, w: W, h: bottom - top },
          text: m.view.line,
          id: 'results-line',
          cls: 'results-line',
          cursor: null,
        });
        widgets.push({
          rect: { x: 0, y: top, w: W, h: bottom - top },
          text: m.standings.map((s) => `${s.place} ${s.name}`).join(' · '),
          id: 'results-standings',
          cls: 'results-standings',
          cursor: null,
        });
        y = bottom + 4;
        record('results-record', m.record);
        // The footer: what the match did to the career.
        const foot = paintRows(c, y, [{ label: m.career || ' ', id: 'results-career', cls: 'results-career', color: TEXT_BLUE }]);
        widgets.push(...foot.widgets.map((w) => (w.id === 'results-career' ? { ...w, text: m.career } : w)));
        y = foot.bottom + 4;
      } else {
        if (m.fame) {
          // The champion's team, two to a row, under whose it is.
          const pairs: { label: string; detail?: string }[] = [];
          for (let i = 0; i < m.fame.mons.length; i += 2) pairs.push({ label: m.fame.mons[i], detail: m.fame.mons[i + 1] });
          const fameTop = y;
          const fame = paintRows(c, y, [{ label: m.fame.title, color: TEXT_BLUE }, ...pairs]);
          widgets.push({ rect: { x: 0, y: fameTop, w: W, h: fame.bottom - fameTop }, text: `${m.fame.title}: ${m.fame.mons.join(', ')}`, id: 'results-fame', cls: 'results-fame', cursor: null });
          y = fame.bottom + 4;
        }
        record('results-champion', m.champion ?? []);
      }

      const buttons: ButtonSpec[] = [];
      if (m.again) buttons.push({ label: m.again.label, id: m.again.id, disabled: m.again.disabled, onPress: m.again.onPress });
      if (m.menu) buttons.push({ label: 'MAIN MENU', id: 'results-menu', onPress: m.menu });
      if (second) {
        const other: ResultsPage = page === 'match' ? 'champion' : 'match';
        buttons.push({
          label: other === 'match' ? 'PLACES' : 'CHAMPION',
          id: 'results-page',
          onPress: () => {
            page = other;
          },
        });
      }
      // Where the first page ends, on both: the buttons stay put as the pages turn.
      if (second) y = Math.max(y, matchBottom(m));
      if (buttons.length) widgets.push(...paintButtons(c, Math.min(y, h - 28), buttons));
      return { widgets, containers: [{ id: 'results-panel', cls: 'results' }] };
    },
  };
}
