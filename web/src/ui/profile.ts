// The trainer's own screens (POK-335, POK-337, POK-416): the TRAINER CARD, MY LOOK and MY
// STATS, and the DEBUG switches the card's DEBUG MENU puts on the main menu. A chunk of
// their own, fetched soon after boot (app.ts's lazyScreen), the way the results are
// (POK-407): main.js has a budget, and these are only ever a press away.
import { DEBUG_FLAGS, cycleFlag, flagDetail, toggleDebugMenu } from '../debug';
import type { devPace } from '../hash';
import { CARD_BADGES, SKINS, SKIN_UNLOCK_WINS, WARDROBE, cardBadges, cardStars, ordinal, skinUnlocked, type CareerTotals } from '../match/career';
import { favourite, type TallyNames } from '../match/tally';
import type { RecordLine } from '../match/record';
import { type Rect, TEXT_BLUE, TEXT_DARK, TEXT_GRAY, TEXT_RED, TEXT_WHITE, type EmeraldCanvas, measure, skinSheet } from './emerald';
import { ROW_H, W, menuScreen, paintButtons, paintNote, paintRows, type CardLine, type RowSpec } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

// ---- the trainer card ---------------------------------------------------------------------

/** Emerald's TRAINER CARD, as src/trainer_card.c draws its front: 240x160, with every
 *  place below in its pixels (the text window's own x/y plus its one-tile margin). */
export const CARD_W = 240;
export const CARD_H = 160;
const CARD_VALUE_RIGHT = 136; // the MONEY / POKéDEX / TIME values' right edge
const CARD_FIELDS_Y = [65, 81, 97];
const CARD_PIC = { x: 160, y: 40, w: 64, h: 64 };

export interface CardFace {
  name: string;
  skin: number;
  wins: number;
  played: number;
  /** The best placing, 1 = first; undefined until a match has been finished. */
  best?: number;
}

/** The card's three fields where Emerald's MONEY, POKéDEX and TIME go. */
export function cardFields(face: CardFace): CardLine[] {
  return [
    { label: 'WINS', value: String(face.wins) },
    { label: 'PLAYED', value: String(face.played) },
    { label: 'BEST', value: face.best === undefined ? '---' : ordinal(face.best) },
  ];
}

/** Which of trainer-card.png's rows a card wears: its star count's colour, a girl's
 *  background for an odd skin (career.ts: even is male, odd is female). */
export function cardRow(face: CardFace): number {
  return cardStars(face.wins) * 2 + (face.skin % 2);
}

/** The card itself at `y`: the art, the stars and badges the wins have earned, the
 *  portrait, the name and the three fields. NAME and the portrait are pressable -- your
 *  name, and MY LOOK -- in `parent`, before anything else in it. */
export function paintTrainerCard(
  c: EmeraldCanvas,
  y: number,
  face: CardFace,
  parent: string,
  on: { onName: () => void; onSkin: () => void },
): Widget[] {
  // Nothing on the card before the card: text over the bare page, and the art popping in
  // under it, read as broken. The canvas paints again when it lands. If it never does, a
  // plain window takes its place: NAME and the portrait are the only ways to your name
  // and MY LOOK from here, so they are pressable either way (#48's review).
  const art = c.drawUiPicture('trainer-card.png', 0, cardRow(face) * CARD_H, CARD_W, CARD_H, 0, y);
  if (art === 'missing') c.drawFrame({ x: 0, y, w: CARD_W, h: CARD_H });
  const fields = cardFields(face);
  const badges = cardBadges(face.wins);
  if (art !== 'loading') {
    // DrawStarsAndBadgesOnCard: the stars from tile (15, 7), the badges from (4, 15) three
    // tiles apart. card-badges.png is the eight badges and then the star.
    const stars = cardStars(face.wins);
    for (let i = 0; i < stars; i++) c.drawUiPicture('card-badges.png', 128, 0, 8, 8, 120 + i * 8, y + 56);
    for (let i = 0; i < badges; i++) c.drawUiPicture('card-badges.png', i * 16, 0, 16, 16, 32 + i * 24, y + 120);
    c.drawUiPicture('trainer-pics.png', face.skin * CARD_PIC.w, 0, CARD_PIC.w, CARD_PIC.h, CARD_PIC.x, y + CARD_PIC.y);

    // No IDNo. (POK-418, Cam: "hide the player id since it's all 0s, for all places").
    c.drawText(`NAME: ${face.name}`, 24, y + 41, TEXT_DARK);
    fields.forEach((f, i) => {
      c.drawText(f.label, 24, y + CARD_FIELDS_Y[i], TEXT_DARK);
      c.drawText(f.value, CARD_VALUE_RIGHT - measure(f.value), y + CARD_FIELDS_Y[i], TEXT_DARK);
    });
  }

  const stats = `${fields.map((f) => `${f.label} ${f.value}`).join(' ')} BADGES ${badges}/${CARD_BADGES}`;
  return [
    {
      rect: { x: 16, y: y + 40, w: 120, h: ROW_H },
      text: `${face.name} your name`,
      id: 'trainer-name',
      parent,
      onPress: on.onName,
      // Left of the card's own row marker, which the cursor drawn over it turned into a box.
      cursor: { x: 12, y: y + 43 },
    },
    {
      rect: { x: CARD_PIC.x - 8, y: y + CARD_PIC.y, w: CARD_PIC.w + 16, h: CARD_PIC.h },
      text: `${SKINS[face.skin] ?? ''} your sprite`,
      id: 'trainer-skin',
      parent,
      onPress: on.onSkin,
      cursor: { x: CARD_PIC.x - 8, y: y + CARD_PIC.y + 28 },
    },
    { rect: { x: 16, y: y + 64, w: 120, h: 3 * ROW_H }, text: stats, id: 'trainer-record', cursor: null },
  ];
}

export interface TrainerModel {
  face: CardFace;
  /** The rows under the card: your lines and the settings. */
  rows: RowSpec[];
  note: string;
  onName(): void;
  onSkin(): void;
  onBack(): void;
}

/** TRAINER (POK-335): the card on top where the title would be -- it says TRAINER CARD
 *  itself -- the rows under it, the note, BACK. The card and the rows share
 *  #trainer-rows, the card's two first. */
export function trainerScreen(model: () => TrainerModel): DrawnScreen {
  return {
    back() {
      model().onBack();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets = paintTrainerCard(c, 0, m.face, 'trainer-rows', { onName: m.onName, onSkin: m.onSkin });
      let y = CARD_H + 2;
      const list = paintRows(c, y, m.rows, 'trainer-rows');
      widgets.push(...list.widgets);
      y = list.bottom;
      const noteRect = paintNote(c, m.note, y);
      widgets.push({ rect: noteRect, text: m.note, id: 'trainer-note', cursor: null });
      y += ROW_H;
      widgets.push(...paintButtons(c, Math.min(y, h - 28), [{ label: 'BACK', id: 'trainer-back', onPress: m.onBack }]));
      return { widgets, containers: [{ id: 'trainer-rows', tag: 'ul', cls: 'lobby-rows' }] };
    },
  };
}


// ---- MY LOOK: your sprite and your lines ------------------------------------------------

/** One screen for how you come across (Cam's 2026-10-14 play-test, POK-337): your battle
 *  picture large, the sprites in a strip you turn left and right, and your three lines,
 *  each in Emerald's own dialogue box, turned one at a time. Where the wardrobe was a
 *  grid and the lines a list, you meet them one by one: "I would rather people kind of
 *  discover them". */
export const LOOK_PIC_FRAME: Rect = { x: 8, y: 2, w: 80, h: 80 };
export const LOOK_STRIP: Rect = { x: 0, y: 84, w: W, h: 56 };
/** How many sprites the strip shows: the one you are on in the middle, two each side. */
export const LOOK_CELLS = 5;
export const LOOK_CELL = { w: 38, h: 40 };
/** Where the strip's first cell starts: the cells centred between its two arrows. */
const LOOK_CELLS_X = Math.floor((W - LOOK_CELLS * LOOK_CELL.w) / 2);
const LOOK_LIT = Math.floor(LOOK_CELLS / 2);
/** A dialogue box: Emerald's own two lines, the width of the screen. */
export const LOOK_BOX_H = 48;
export const LOOK_BOXES_Y = LOOK_STRIP.y + LOOK_STRIP.h + 2;

export type LineSlot = 'intro' | 'win' | 'lose';
export const LINE_SLOTS: readonly LineSlot[] = ['intro', 'win', 'lose'];
export const SLOT_TITLES: Record<LineSlot, string> = { intro: 'WALKING UP', win: 'WHEN YOU WIN', lose: 'WHEN YOU LOSE' };

/** The skin `by` places along the wardrobe from `skin`, round the ends. */
export function stepSkin(skin: number, by: number): number {
  const n = WARDROBE.length;
  const at = Math.max(0, WARDROBE.indexOf(skin));
  return WARDROBE[(((at + by) % n) + n) % n];
}

/** The strip's sprites, left to right, `skin` in the middle. */
export function lookStrip(skin: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOOK_CELLS; i++) out.push(stepSkin(skin, i - LOOK_LIT));
  return out;
}

/** What the line beside the picture says about a skin: yours, or its price. */
export function lookNote(skin: number, wins: number, worn: number): string {
  if (!skinUnlocked(skin, wins)) {
    const need = SKIN_UNLOCK_WINS[skin] ?? 0;
    return `LOCKED -- ${need} ${need === 1 ? 'win' : 'wins'}`;
  }
  return skin === worn ? 'your sprite' : '';
}

export interface LookModel {
  wins: number;
  /** What you wear. */
  worn: number;
  /** What the strip is on: what you wear, or a locked one you are looking at. */
  browsing: number;
  lines: readonly string[];
  /** Each slot's line, an index into `lines`. */
  picked: Record<LineSlot, number>;
  /** The strip moved to `skin`: wear it if it is yours to. */
  onBrowse(skin: number): void;
  onLine(slot: LineSlot, index: number): void;
  onBack(): void;
}

export function lookScreen(model: () => LookModel): DrawnScreen {
  const browse = (by: number) => {
    const m = model();
    m.onBrowse(stepSkin(m.browsing, by));
  };
  const turn = (slot: LineSlot, by: number) => {
    const m = model();
    const n = m.lines.length;
    m.onLine(slot, (((m.picked[slot] + by) % n) + n) % n);
  };
  return {
    back() {
      model().onBack();
    },
    key(k, on) {
      // Left and right turn the row the cursor is on; up and down go between the rows.
      if (k !== 'left' && k !== 'right') return false;
      const by = k === 'left' ? -1 : 1;
      if (on?.id === 'look-sprite') browse(by);
      else {
        const slot = LINE_SLOTS.find((s) => on?.id === `look-${s}`);
        if (!slot) return false;
        turn(slot, by);
      }
      return true;
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const open = skinUnlocked(m.browsing, m.wins);

      // The battle picture, in a window, the way the card frames it. Looking only.
      c.drawFrame(LOOK_PIC_FRAME);
      c.drawUiPicture('trainer-pics.png', m.browsing * CARD_PIC.w, 0, CARD_PIC.w, CARD_PIC.h, LOOK_PIC_FRAME.x + 8, LOOK_PIC_FRAME.y + 8);
      const right = LOOK_PIC_FRAME.x + LOOK_PIC_FRAME.w;
      const mid = Math.round((right + W) / 2);
      c.drawTextCentred('MY LOOK', mid, 10, TEXT_WHITE);
      const name = SKINS[m.browsing] ?? '';
      c.drawTextCentred(name, mid, 34, TEXT_WHITE);
      widgets.push({ rect: { x: right, y: 34, w: W - right, h: ROW_H }, text: name, id: 'look-name', cursor: null });
      const note = lookNote(m.browsing, m.wins, m.worn);
      if (note) c.drawTextCentred(note, mid, 50, open ? TEXT_WHITE : TEXT_RED);
      widgets.push({ rect: { x: right, y: 50, w: W - right, h: ROW_H }, text: note, id: 'look-note', cursor: null });
      // A locked one is only looked at: say what you still wear (#50's review).
      const wearing = m.browsing === m.worn ? '' : `wearing ${SKINS[m.worn] ?? ''}`;
      if (wearing) c.drawTextCentred(wearing, mid, 66, TEXT_WHITE);
      widgets.push({ rect: { x: right, y: 66, w: W - right, h: ROW_H }, text: wearing, id: 'look-wearing', cursor: null });

      // The strip: the one you are on in the middle, lit; a locked one faded.
      c.drawFrame(LOOK_STRIP);
      const cy = LOOK_STRIP.y + 8;
      const arrowY = cy + Math.floor(LOOK_CELL.h / 2) - 5;
      c.drawCursor(LOOK_STRIP.x + 10, arrowY, TEXT_DARK, true);
      c.drawCursor(LOOK_STRIP.x + LOOK_STRIP.w - 14, arrowY);
      widgets.push(
        { rect: { x: 0, y: cy, w: 24, h: LOOK_CELL.h }, text: 'previous sprite', id: 'look-prev', onPress: () => browse(-1), cursor: null },
        { rect: { x: W - 24, y: cy, w: 24, h: LOOK_CELL.h }, text: 'next sprite', id: 'look-next', onPress: () => browse(1), cursor: null },
      );
      lookStrip(m.browsing).forEach((skin, slot) => {
        const cell = { x: LOOK_CELLS_X + slot * LOOK_CELL.w, y: cy, w: LOOK_CELL.w, h: LOOK_CELL.h };
        const mine = skinUnlocked(skin, m.wins);
        if (slot === LOOK_LIT) c.fillRect({ x: cell.x + 2, y: cell.y, w: cell.w - 4, h: cell.h }, TEXT_BLUE.shadow);
        const sheet = skinSheet(skin);
        if (sheet) c.drawSprite(sheet.gfx, cell.x + Math.floor((cell.w - sheet.w) / 2), cell.y + Math.floor((cell.h - sheet.h) / 2), mine ? 1 : 0.3);
        widgets.push({
          rect: cell,
          text: `${SKINS[skin]}${mine ? '' : ' LOCKED'}${skin === m.worn ? ' (worn)' : ''}`,
          id: slot === LOOK_LIT ? 'look-sprite' : undefined,
          cls: 'skin',
          parent: 'look-sprites',
          onPress: () => m.onBrowse(skin),
          // Only the lit one takes the cursor: left and right move the strip under it.
          cursor: slot === LOOK_LIT ? { x: cell.x + 3, y: cell.y + 14 } : null,
        });
      });

      // The three lines, each said in a dialogue box: what it is for, then the line.
      LINE_SLOTS.forEach((slot, i) => {
        const y = LOOK_BOXES_Y + i * LOOK_BOX_H;
        c.drawMessageBox({ x: 0, y, w: W, h: LOOK_BOX_H });
        const line = m.lines[m.picked[slot]] ?? '';
        c.drawText(SLOT_TITLES[slot], 16, y + 9, TEXT_BLUE);
        c.drawText(line, 16, y + 25, TEXT_DARK);
        // Both ways round, the strip's arrows: a tap on either edge turns the line.
        c.drawCursor(9, y + 25, TEXT_GRAY, true);
        c.drawCursor(W - 14, y + 25, TEXT_GRAY);
        widgets.push(
          { rect: { x: 0, y, w: 24, h: LOOK_BOX_H }, text: `${SLOT_TITLES[slot]} back`, id: `look-${slot}-prev`, onPress: () => turn(slot, -1), cursor: null },
          {
            rect: { x: 24, y, w: W - 48, h: LOOK_BOX_H },
            text: `${SLOT_TITLES[slot]}: ${line}`,
            id: `look-${slot}`,
            onPress: () => turn(slot, 1),
            cursor: { x: 8, y: y + 9 },
          },
          { rect: { x: W - 24, y, w: 24, h: LOOK_BOX_H }, text: `${SLOT_TITLES[slot]} next`, id: `look-${slot}-next`, onPress: () => turn(slot, 1), cursor: null },
        );
      });

      const y = LOOK_BOXES_Y + LINE_SLOTS.length * LOOK_BOX_H + 2;
      widgets.push(...paintButtons(c, Math.min(y, h - 28), [{ label: 'BACK', id: 'look-back', onPress: m.onBack }]));
      return { widgets, containers: [{ id: 'look-sprites', tag: 'ul', cls: 'look-sprites' }] };
    },
  };
}

/** MY STATS (POK-416): the career's lifetime totals, every count said -- a zero is an
 *  answer -- and the favourites once there are any. */
export function lifetimeLines(t: CareerTotals | undefined, names: TallyNames): RecordLine[] {
  const n = (k: keyof Omit<CareerTotals, 'mons' | 'moves'>) => String(t?.[k] ?? 0);
  const lines: RecordLine[] = [
    { label: 'BATTLES WON', value: n('won') },
    { label: 'CAUGHT', value: n('caught') },
    { label: 'STEPS WALKED', value: n('steps') },
    { label: 'ITEMS USED', value: n('items') },
    { label: 'TRAINERS BEATEN', value: n('trainers') },
    { label: 'DUELS WON', value: n('duelsWon') },
    { label: 'LOOT TAKEN', value: n('took') },
  ];
  const mon = t ? favourite(t.mons) : undefined;
  if (mon !== undefined) lines.push({ label: 'FAVORITE', value: names.species(mon), wide: true });
  const move = t ? favourite(t.moves) : undefined;
  const moveName = move === undefined ? undefined : names.move(move);
  if (moveName) lines.push({ label: 'TOP MOVE', value: moveName, wide: true });
  return lines;
}

export interface StatsModel {
  totals?: CareerTotals;
  names: TallyNames;
  onBack(): void;
}

/** MY STATS (POK-416): every match so far, off the career. */
export function statsScreen(model: () => StatsModel): DrawnScreen {
  return menuScreen(() => {
    const m = model();
    return {
      title: 'MY STATS',
      rows: lifetimeLines(m.totals, m.names).map((l): RowSpec => ({ label: l.label, detail: l.value })),
      rowsId: 'my-stats',
      note: '',
      buttons: [{ label: 'BACK', id: 'my-stats-back', onPress: m.onBack }],
      onBack: m.onBack,
    };
  });
}

// ---- DEBUG ----------------------------------------------------------------------------------

export { toggleDebugMenu };

/** DEBUG (Cam, 2026-10-27: "a main menu option rather than manually editing the url"):
 *  each row steps one hash flag, so the URL says what was picked and a link with it still
 *  works. Here rather than in app.ts for main.js's budget. `pace` is app.ts's paceOptions,
 *  the pace the page will run off the hash. */
export function debugScreen(pace: () => ReturnType<typeof devPace>, redraw: () => void, back: () => void): DrawnScreen {
  const reload = (hash: string) => {
    history.replaceState(null, '', `#${hash}`);
    location.reload();
  };
  return menuScreen(() => ({
    title: 'DEBUG',
    rows: [
      ...DEBUG_FLAGS.map((flag): RowSpec => ({
        label: flag.label,
        detail: flagDetail(flag, location.hash, pace()),
        id: `debug-${flag.key}`,
        onPress: () => {
          const hash = cycleFlag(location.hash, flag);
          if (flag.reload) return reload(hash);
          history.replaceState(null, '', `#${hash}`);
          redraw();
        },
      })),
      { label: 'CLEAR CACHE', detail: 'drops the flags', id: 'debug-fresh', onPress: () => reload('fresh') },
      { label: 'SPIKE B', detail: 'TS overworld', id: 'debug-spike-b', onPress: () => location.assign(`${import.meta.env.BASE_URL}spike-b/`) },
    ],
    rowsId: 'debug-rows',
    note: 'Each applies to the next match.',
    noteId: 'debug-note',
    buttons: [{ label: 'BACK', id: 'debug-back', onPress: back }],
    onBack: back,
  }));
}
