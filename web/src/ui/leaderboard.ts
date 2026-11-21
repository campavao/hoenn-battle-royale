// The LEADERBOARD screen (#397's suggestion; Cam, 11-20: "put their sprite next to their
// name", "it's bland"). The top three stand on a podium in the sprites they last played in, as
// the room's seats stand (screens.ts paintPerson); everybody after them is a row with their
// sprite, place, name and rating. You are blue wherever you are, and kept in the last row when
// you are further down than the screen reaches.
import { type BoardEntry, type BoardView, listed } from '../match/leaderboard';
import { TEXT_BLUE, TEXT_DARK, type EmeraldCanvas, fitText, measure, skinSheet } from './emerald';
import { ROW_H, W, paintButtons, paintNote, paintTitle } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

export interface LeaderboardModel {
  view: BoardView;
  onBack(): void;
}

/** The podium's frame, and its steps: second, first, third, left to right. */
const PODIUM_H = 120;
const STEP_W = 60;
const STEPS = [
  { at: 1, cx: 52, h: 26, color: '#c0c8d0', edge: '#8890a0' },
  { at: 0, cx: 120, h: 36, color: '#e8c050', edge: '#b08828' },
  { at: 2, cx: 188, h: 18, color: '#d09058', edge: '#985830' },
] as const;
/** Where the steps stand, from the frame's top: their names and ratings go under it. */
const BASE = 74;
/** A row past the podium: the person in a sprite, not its whole 32-pixel frame (Cam, 11-20:
 *  "too much white space"). */
const LIST_ROW_H = 26;
/** A sprite's person stands on the bottom of its 32-pixel frame, a pixel up. */
const FEET = 1;

const said = (e: BoardEntry) => `${e.place}. ${e.name} ${e.rating}${e.mine ? ' (you)' : ''}`;

function sprite(c: EmeraldCanvas, skin: number, cx: number, feet: number): void {
  const sheet = skinSheet(skin);
  if (sheet) c.drawSprite(sheet.gfx, Math.round(cx - sheet.w / 2), feet - 32 + FEET);
}

function paintPodium(c: EmeraldCanvas, y: number, top: readonly BoardEntry[], widgets: Widget[]): number {
  const frame = { x: 0, y, w: W, h: PODIUM_H };
  c.drawFrame(frame);
  const base = y + BASE;
  for (const s of STEPS) {
    const step = { x: s.cx - STEP_W / 2, y: base - s.h, w: STEP_W, h: s.h };
    c.fillRect(step, s.edge);
    c.fillRect({ x: step.x + 1, y: step.y + 1, w: step.w - 2, h: step.h - 1 }, s.color);
    const e = top[s.at];
    const place = String(s.at + 1);
    // On the step's face, under whoever stands on it.
    c.drawText(place, s.cx - Math.floor(measure(place) / 2), step.y + s.h - ROW_H - 1, TEXT_DARK);
    if (!e) continue;
    sprite(c, e.skin, s.cx, step.y);
    const color = e.mine ? TEXT_BLUE : TEXT_DARK;
    const name = fitText(e.name, STEP_W + 8);
    c.drawText(name, s.cx - Math.floor(measure(name) / 2), base + 4, color);
    const rating = String(e.rating);
    c.drawText(rating, s.cx - Math.floor(measure(rating) / 2), base + 4 + ROW_H, color);
    widgets.push({ rect: { x: step.x, y: y + 8, w: STEP_W, h: PODIUM_H - 16 }, text: said(e), parent: 'leaderboard-rows', cursor: null });
  }
  return y + PODIUM_H;
}

function paintList(c: EmeraldCanvas, y: number, rows: number, rest: readonly BoardEntry[], widgets: Widget[]): number {
  const { shown, gap } = listed(rest, rows);
  if (!shown.length) return y;
  const frame = { x: 0, y, w: W, h: shown.length * LIST_ROW_H + 12 };
  c.drawFrame(frame);
  shown.forEach((e, i) => {
    const ry = y + 6 + i * LIST_ROW_H;
    // The row before you, when rows are skipped to reach you: a line of dots says so.
    if (gap && i === shown.length - 1) c.fillRect({ x: 12, y: ry - 1, w: W - 24, h: 1 }, '#b8b8c0');
    const color = e.mine ? TEXT_BLUE : TEXT_DARK;
    const ty = ry + Math.floor((LIST_ROW_H - ROW_H) / 2);
    // The person (the lower three quarters of the sprite's frame) centred on the words.
    sprite(c, e.skin, 22, ty + 19);
    const place = `${e.place}.`;
    c.drawText(place, 38, ty, color);
    const rating = String(e.rating);
    const rx = W - 12 - measure(rating);
    c.drawText(fitText(e.name, rx - 66 - 6), 66, ty, color);
    c.drawText(rating, rx, ty, color);
    widgets.push({ rect: { x: 8, y: ry, w: W - 16, h: LIST_ROW_H }, text: said(e), parent: 'leaderboard-rows', cursor: null });
  });
  return frame.y + frame.h;
}

export function leaderboardScreen(model: () => LeaderboardModel): DrawnScreen {
  return {
    back() {
      model().onBack();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      let y = 4;
      paintTitle(c, 'LEADERBOARD', y);
      y += 20;
      const { entries, note } = m.view;
      if (entries.length) {
        y = paintPodium(c, y, entries.slice(0, 3), widgets) + 4;
        // Under the podium, as many rows as leave the note two lines and BACK.
        const room = h - y - 12 - (2 * ROW_H + 6) - 28;
        y = paintList(c, y, Math.floor(room / LIST_ROW_H), entries.slice(3), widgets) + 4;
      }
      const lines = Math.min(2, Math.max(1, Math.ceil(measure(note) / (W - 16))));
      widgets.push({ rect: paintNote(c, note, y, undefined, lines), text: note, id: 'leaderboard-note', cursor: null });
      y += lines * ROW_H + 6;
      widgets.push(...paintButtons(c, Math.min(y, h - 28), [{ label: 'BACK', id: 'leaderboard-back', onPress: m.onBack }]));
      return { widgets, containers: [{ id: 'leaderboard-rows', tag: 'ul', cls: 'leaderboard-rows' }] };
    },
  };
}
