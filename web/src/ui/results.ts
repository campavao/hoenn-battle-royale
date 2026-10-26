// The results, drawn (POK-320): where you came, how long you lasted, who won and with
// what, and what you did in it -- the Hall of Fame
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
  /** The same team as Hall of Fame cards (Cam's 10-20 play-test, #14: "the champion's
   *  team like the hall of fame cards, and tap one for its summary"). */
  cards: FameCard[];
}

/** One of the champion's team, as its card and its summary say it. */
export interface FameCard {
  species: number;
  shiny: boolean;
  /** Its nickname, or its species' name. */
  name: string;
  /** The species, under a nickname; undefined without one. */
  kind?: string;
  level: number;
  hp: number;
  maxHp: number;
  moves: string[];
}

/** What fameOf reads of a team row: PackedMon's, all but the species and level optional
 *  for a team that came without them. */
export interface FameMon {
  species: number;
  nickname?: string;
  level: number;
  hp?: number;
  maxHp?: number;
  shiny?: boolean;
  moves?: readonly { id: number }[];
}

/** The champion's team (POK-243's half of the parade), or null when it never arrived --
 *  a bot's never does, since a bot has no ROM to send one. */
export function fameOf(
  winner: number | undefined,
  seat: number,
  party: readonly FameMon[] | undefined,
  nameOf: (seat: number) => string,
  speciesName: (species: number) => string,
  moveName: (id: number) => string | undefined = () => undefined,
): Fame | null {
  if (winner === undefined || !party) return null;
  const team = party.filter((m) => m.species > 0);
  if (team.length === 0) return null;
  const cards = team.map((m): FameCard => {
    const kind = speciesName(m.species);
    return {
      species: m.species,
      shiny: m.shiny === true,
      name: m.nickname || kind,
      kind: m.nickname && m.nickname !== kind ? kind : undefined,
      level: m.level,
      hp: m.hp ?? 0,
      maxHp: m.maxHp ?? 0,
      moves: (m.moves ?? []).filter((mv) => mv.id > 0).map((mv) => moveName(mv.id) ?? `MOVE ${mv.id}`),
    };
  });
  return { title: winner === seat ? 'Your team' : `The champion: ${nameOf(winner)}`, mons: cards.map((c) => `${c.name} Lv${c.level}`), cards };
}

/** A card: the picture, and the name under it, three to a row in one window, as the
 *  Hall of Fame's own row of them. */
const CARD_W = 74;
const CARD_H = 78;
const PIC = 64;

/** The picture of one of the team (tools/br/export-mon-pics.py). */
function monPic(card: FameCard): string {
  return `/mon-pics/${card.species}${card.shiny ? 's' : ''}.png`;
}

/** The window the cards take: two rows for a full team. */
function cardsHeight(count: number): number {
  return Math.ceil(count / 3) * CARD_H + 16;
}

/** The cards, from `y`; the widgets are the taps that open a summary. */
function paintCards(c: EmeraldCanvas, y: number, cards: readonly FameCard[], open: (i: number) => void): { bottom: number; widgets: Widget[] } {
  const widgets: Widget[] = [];
  c.drawFrame({ x: 0, y, w: W, h: cardsHeight(cards.length) });
  cards.forEach((card, i) => {
    const r = { x: 8 + (i % 3) * CARD_W, y: y + 8 + Math.floor(i / 3) * CARD_H, w: CARD_W, h: CARD_H };
    c.drawUiPicture(monPic(card), 0, 0, PIC, PIC, r.x + Math.floor((r.w - PIC) / 2), r.y);
    const name = fitText(card.name, r.w - 4);
    c.drawText(name, r.x + Math.floor((r.w - measure(name)) / 2), r.y + PIC, card.shiny ? TEXT_BLUE : TEXT_DARK);
    widgets.push({ rect: r, text: `${card.name} Lv${card.level}`, id: `fame-card-${i}`, onPress: () => open(i), cursor: { x: r.x, y: r.y + PIC } });
  });
  return { bottom: y + cardsHeight(cards.length), widgets };
}

/** One card, opened: its picture, its level and HP, and its moves -- what Emerald's own
 *  summary leads with. */
function paintSummary(c: EmeraldCanvas, y: number, card: FameCard): { bottom: number; widgets: Widget[] } {
  const top = y;
  const box = { x: 0, y, w: W, h: PIC + 16 };
  c.drawFrame(box);
  c.drawUiPicture(monPic(card), 0, 0, PIC, PIC, box.x + 8, box.y + 8);
  const tx = box.x + PIC + 16;
  const lines = [card.kind ?? '', `Lv${card.level}`, card.maxHp > 0 ? `HP ${card.hp}/${card.maxHp}` : '', card.shiny ? 'Shiny' : ''].filter(Boolean);
  lines.forEach((l, i) => c.drawText(fitText(l, box.x + box.w - tx - 8), tx, box.y + 8 + i * ROW_H, i === 0 && card.kind ? TEXT_BLUE : TEXT_DARK));
  y = box.y + box.h + 4;
  const moves = paintRows(c, y, (card.moves.length > 0 ? card.moves : ['-']).map((mv) => ({ label: mv })));
  const text = [card.name, ...lines, ...card.moves].join(' · ');
  return { bottom: moves.bottom, widgets: [{ rect: { x: 0, y: top, w: W, h: moves.bottom - top }, text, id: 'fame-summary', cls: 'results-fame', cursor: null }] };
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
  fame: Fame | null;
  /** Everybody's place, best first. */
  standings: Standing[];
  /** Ours: the room's counts and our ROM's. */
  record: RecordLine[];
  /** The champion's, when it is somebody else (Cam's 10-20 play-test, #12): what the room
   *  saw of them, and what their ROM counted once their page has said it (TallyMsg). */
  champion?: { name: string; lines: RecordLine[] };
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
export type ResultsPage = 'match' | 'champion' | 'stats';

/** The standings, one to a row (Cam's 10-26 play-test: three columns cut every name to
 *  four letters). As many as the screen has rows for; past that the list scrolls --
 *  the wheel or a finger over it, or the D-pad -- from `top`, the first row shown. */
interface StandingsView {
  rows: number;
  top: number;
  shown: Standing[];
}

function standingsView(standings: readonly Standing[], free: number, top: number): StandingsView {
  const rows = Math.min(standings.length, Math.max(1, free));
  const at = Math.max(0, Math.min(top, standings.length - rows));
  return { rows, top: at, shown: standings.slice(at, at + rows) };
}

/** Where the list starts the first time it is shown: from the top, unless that leaves
 *  our own place under the window, in which case it is the last row in it. */
function firstTop(standings: readonly Standing[], rows: number): number {
  const me = standings.findIndex((s) => s.me);
  return me < rows ? 0 : me - rows + 1;
}

/** Rows the standings have on the first page: what is left under the title, the record
 *  and the buttons. */
function standingsFree(m: ResultsModel, h: number): number {
  const framed = (rows: number) => layoutRows(0, rows).frame.h + 4;
  const rest = 28 + (m.record.length > 0 ? framed(recordRows(m.record).length) : 0) + 28;
  return Math.floor((h - rest - 20) / ROW_H) - (m.view.survived === undefined ? 0 : 1);
}

/** The arrows' column at the right of a row, when there is more above or below. */
const ARROW_W = 8;

function paintStandings(c: EmeraldCanvas, y: number, survived: string | undefined, view: StandingsView, total: number): number {
  const lay = layoutRows(y, (survived === undefined ? 0 : 1) + view.rows);
  c.drawFrame(lay.frame);
  let row = 0;
  if (survived !== undefined) {
    const r = lay.rows[row++];
    c.drawText('Survived', r.x + 8, r.y, TEXT_DARK);
    c.drawText(survived, r.x + r.w - measure(survived), r.y, TEXT_DARK);
  }
  const more = total > view.rows;
  view.shown.forEach((s, i) => {
    const r = lay.rows[row + i];
    const x0 = r.x + 8;
    const x1 = r.x + r.w - (more ? ARROW_W : 0);
    const color = s.me ? TEXT_BLUE : TEXT_DARK;
    c.drawText(s.place, x0, r.y, color);
    c.drawText(fitText(s.name, x1 - x0 - PLACE_W), x0 + PLACE_W, r.y, color);
  });
  if (more) {
    const first = lay.rows[row];
    const last = lay.rows[row + view.rows - 1];
    if (view.top > 0) c.drawText('↑', first.x + first.w - ARROW_W + 1, first.y, TEXT_DARK);
    if (view.top + view.rows < total) c.drawText('↓', last.x + last.w - ARROW_W + 1, last.y, TEXT_DARK);
  }
  return lay.frame.y + lay.frame.h;
}

/** How far down the first page ends: the title, the standings and the record, each a
 *  frame and a gap. No career line (HBR-51): "16 played" read as wins. */
function matchBottom(m: ResultsModel, h: number): number {
  const framed = (rows: number) => layoutRows(0, rows).frame.h + 4;
  const standings = (m.view.survived === undefined ? 0 : 1) + standingsView(m.standings, standingsFree(m, h), 0).rows;
  return 28 + framed(standings) + (m.record.length > 0 ? framed(recordRows(m.record).length) : 0);
}

/** The champion's stats' window, and the gap under it. */
function statsHeight(m: ResultsModel): number {
  return m.champion && m.champion.lines.length > 0 ? layoutRows(0, recordRows(m.champion.lines).length).frame.h + 4 : 0;
}

/** The champion's cards and stats are a page each when both will not fit over the
 *  buttons -- a full team of six and every count, on a 320-high screen. */
function statsApart(m: ResultsModel, h: number): boolean {
  return m.fame !== null && statsHeight(m) > 0 && 28 + cardsHeight(m.fame.cards.length) + 4 + statsHeight(m) > h - 28;
}

/** Where the buttons go while there are pages: under the longest, so they stay put as
 *  the pages turn. */
function buttonsAt(m: ResultsModel, h: number): number {
  const cards = m.fame ? cardsHeight(m.fame.cards.length) + 4 : 0;
  const champion = statsApart(m, h) ? 28 + Math.max(cards, statsHeight(m)) : 28 + cards + statsHeight(m);
  return Math.max(matchBottom(m, h), champion);
}

/** The place column: "28th" and a space. */
const PLACE_W = 32;

/** The results screen. The mirror keeps the ids the page always had: #results-panel,
 *  #results-line, #results-fame, #results-record, #play-again -- the
 *  first page holds all of them but the fame, which is the second's. */
export function resultsScreen(model: () => ResultsModel): DrawnScreen {
  let page: ResultsPage = 'match';
  /** The standings' first row shown; null until they are first drawn. */
  let listTop: number | null = null;
  /** How many rows they have now, and how many there are, for the D-pad. */
  let listRows = 0;
  let listTotal = 0;
  const scroll = (by: number): boolean => {
    if (listTop === null || listTotal <= listRows) return false;
    const next = Math.max(0, Math.min(listTop + by, listTotal - listRows));
    if (next === listTop) return false;
    listTop = next;
    return true;
  };
  /** The card a tap opened, on the champion's page. */
  let open: number | null = null;
  return {
    back() {
      open = null;
    },
    // Up and down move the standings when they run past their window: the buttons are a
    // row, so the two were doing nothing there.
    key(k) {
      if (page !== 'match' || (k !== 'up' && k !== 'down')) return false;
      scroll(k === 'up' ? -1 : 1);
      return listTotal > listRows;
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const second = m.fame !== null || m.champion !== undefined;
      const apart = statsApart(m, h);
      const pages: ResultsPage[] = !second ? ['match'] : apart ? ['match', 'champion', 'stats'] : ['match', 'champion'];
      if (!pages.includes(page)) page = 'match';
      const card = page === 'champion' && open !== null ? m.fame?.cards[open] : undefined;
      if (!card) open = null;
      // The champion's page is under their name, and a card under its own.
      const title = page === 'match' ? m.view.headline : card ? card.name : (m.fame?.title ?? `The champion: ${m.champion?.name ?? ''}`);
      let y = 6;
      paintTitle(c, fitText(title, W - 8), y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: title, cls: 'results-head', cursor: null });
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
        const free = standingsFree(m, h);
        if (listTop === null && m.standings.length > 0) listTop = firstTop(m.standings, Math.min(m.standings.length, Math.max(1, free)));
        const view = standingsView(m.standings, free, listTop ?? 0);
        if (listTop !== null) listTop = view.top;
        listRows = view.rows;
        listTotal = m.standings.length;
        const bottom = paintStandings(c, y, m.view.survived, view, m.standings.length);
        widgets.push({
          rect: { x: 0, y: 6, w: W, h: ROW_H },
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
          // The window takes the wheel and a finger's drag (Cam's 10-26 play-test).
          scroll: listTotal > listRows ? scroll : undefined,
        });
        y = bottom + 4;
        record('results-record', m.record);
      } else if (card) {
        // One of the team, opened.
        const sum = paintSummary(c, y, card);
        widgets.push(...sum.widgets);
        y = sum.bottom + 4;
      } else if (page === 'champion') {
        if (m.fame) {
          // The champion's team as Hall of Fame cards; a tap opens one. The mirror's
          // #results-fame says the whole team, over the title.
          widgets.push({ rect: { x: 0, y: 6, w: W, h: ROW_H }, text: `${m.fame.title}: ${m.fame.mons.join(', ')}`, id: 'results-fame', cls: 'results-fame', cursor: null });
          const cards = paintCards(c, y, m.fame.cards, (i) => {
            open = i;
          });
          widgets.push(...cards.widgets);
          y = cards.bottom + 4;
        }
        if (m.champion && !apart) record('results-champion', m.champion.lines);
      } else if (m.champion) {
        record('results-champion', m.champion.lines);
      }

      const buttons: ButtonSpec[] = [];
      if (card) {
        buttons.push({
          label: 'BACK',
          id: 'fame-back',
          onPress: () => {
            open = null;
          },
        });
        widgets.push(...paintButtons(c, Math.min(Math.max(y, buttonsAt(m, h)), h - 28), buttons));
        return { widgets, containers: [{ id: 'results-panel', cls: 'results' }] };
      }
      if (m.again) buttons.push({ label: m.again.label, id: m.again.id, disabled: m.again.disabled, onPress: m.again.onPress });
      if (m.menu) buttons.push({ label: 'MAIN MENU', id: 'results-menu', onPress: m.menu });
      if (second) {
        const other = pages[(pages.indexOf(page) + 1) % pages.length];
        buttons.push({
          label: other === 'match' ? 'RANKING' : other === 'champion' ? 'CHAMPION' : 'RECORDS',
          id: 'results-page',
          onPress: () => {
            page = other;
          },
        });
      }
      // Where the first page ends, on both: the buttons stay put as the pages turn.
      if (second) y = Math.max(y, buttonsAt(m, h));
      if (buttons.length) widgets.push(...paintButtons(c, Math.min(y, h - 28), buttons));
      return { widgets, containers: [{ id: 'results-panel', cls: 'results' }] };
    },
  };
}
