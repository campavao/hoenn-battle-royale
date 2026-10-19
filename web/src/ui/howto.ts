// HOW TO PLAY (POK-429): a match in six panels, clicked through in a few seconds. Cam:
// "something a user can click thru quickly just to give them the broad strokes of how a
// game plays out". Offered once after a player's first ROM import, and a row on the menu.
import uiData from '../data/ui.json';
import { BOT_SKINS } from '../bots/roster';
import { TEXT_BLUE, TEXT_DARK, TEXT_GRAY, skinSheet, wrapText } from './emerald';
import { ROW_H, W, paintButtons, paintTitle, type ButtonSpec } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

const ITEM_MASTER_BALL = 1;
const ITEM_SAFARI_BALL = 5;
const ITEM_POTION = 13;
const ITEM_TM01 = 289;

/** What a panel's picture is made of: an item's bag icon, or a trainer standing. */
export type Piece = { item: number } | { trainer: 'you' | 'rival' };

export interface Panel {
  title: string;
  text: string;
  art: Piece[];
  /** The fog's veil drawn over the picture. */
  fog?: boolean;
}

export const PANELS: readonly Panel[] = [
  {
    title: 'The Safari Zone',
    text: 'Every match opens in the Safari Zone on a short clock. Catch what you can. Catch nothing and you are out.',
    art: [{ item: ITEM_SAFARI_BALL }, { trainer: 'you' }, { item: ITEM_SAFARI_BALL }],
  },
  {
    title: 'The drop',
    text: 'When the clock runs out, pick a spot on the map of Hoenn and land there. No EXP: levels rise on a clock for everyone at once.',
    art: [{ trainer: 'you' }],
  },
  {
    title: 'Loot',
    text: 'Red balls hold items, blue hold TMs, gold hold rare finds (look in houses). Events on your MAP hold legendaries. Lose to one and you are out.',
    art: [{ item: ITEM_POTION }, { item: ITEM_TM01 }, { item: ITEM_MASTER_BALL }],
  },
  {
    title: 'The fog',
    text: 'Fog closes in ring by ring, and your MAP shows where. Outside the ring your team loses HP until it faints, and Centers close.',
    art: [{ trainer: 'you' }],
    fog: true,
  },
  {
    title: 'Battles',
    text: 'Meet another trainer and you fight. Choose within 30 seconds, or against a player you forfeit. Only a POKé DOLL gets you away.',
    art: [{ trainer: 'you' }, { trainer: 'rival' }],
  },
  {
    title: 'Last one standing',
    text: 'If your whole team faints you are out, and your Pokémon drop for anyone to take. The last trainer standing wins.',
    art: [{ item: ITEM_MASTER_BALL }, { trainer: 'you' }, { item: ITEM_MASTER_BALL }],
  },
];

/** The text's width inside the frame, a tile in from each side. */
const TEXT_W = W - 24;
const ART_H = 36;
const ICON = uiData.itemIcons as { cell: number; cols: number };
const PIECE_GAP = 8;
const FOG_TILE = 64;
/** The frame's inside: its border is six pixels. */
const FOG_W = W - 12;

/** 'due' from a first import until the panels are shown, then '1' for good. In storage,
 *  not memory: a newcomer who came by an invite link meets the menu on a later load. */
export const HOWTO_KEY = 'hbr:howto';

/** A ROM was just imported by hand: somebody new, unless the panels were shown here. */
export function markHowToDue(store: Storage): void {
  try {
    if (store.getItem(HOWTO_KEY) !== '1') store.setItem(HOWTO_KEY, 'due');
  } catch {
    // Storage refused: nobody is offered the panels, and the menu row still has them.
  }
}

/** True once, on the menu after a first import: the panels go up and are not owed again. */
export function takeHowToDue(store: Storage): boolean {
  try {
    if (store.getItem(HOWTO_KEY) !== 'due') return false;
    store.setItem(HOWTO_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export interface HowToModel {
  /** Your sprite; a bot's is across from you in the battle. */
  skin: number;
  onDone(): void;
}

export function howToScreen(model: () => HowToModel): DrawnScreen {
  let page = 0;
  const done = () => {
    page = 0;
    model().onDone();
  };
  return {
    back: done,
    paint(c, h): Painted {
      const m = model();
      const panel = PANELS[page];
      const last = page === PANELS.length - 1;
      const widgets: Widget[] = [];
      let y = 4;
      paintTitle(c, 'HOW TO PLAY', y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: 'HOW TO PLAY', id: 'howto-title', cursor: null });
      y += 20;

      const rows = wrapText(panel.text, TEXT_W);
      // As tall as the longest panel's, so NEXT stays under the thumb from panel to panel.
      const most = Math.max(...PANELS.map((p) => wrapText(p.text, TEXT_W).length));
      const frame = { x: 0, y, w: W, h: 8 + ART_H + 4 + ROW_H + 4 + most * ROW_H + 12 };
      c.drawFrame(frame);
      const skins = { you: m.skin, rival: BOT_SKINS.find((s) => s !== m.skin) ?? BOT_SKINS[0] };
      const widths = panel.art.map((p) => ('item' in p ? ICON.cell : (skinSheet(skins[p.trainer])?.w ?? 16)));
      let x = Math.floor((W - (widths.reduce((a, b) => a + b, 0) + PIECE_GAP * (widths.length - 1))) / 2);
      panel.art.forEach((p, i) => {
        if ('item' in p) {
          const n = ICON.cell;
          // An icon's art ends about three pixels above its cell's foot: on the trainer's feet.
          c.drawUiPicture('items.png', (p.item % ICON.cols) * n, Math.floor(p.item / ICON.cols) * n, n, n, x, y + 8 + ART_H - n + 2);
        } else {
          const sheet = skinSheet(skins[p.trainer]);
          if (sheet) c.drawSprite(sheet.gfx, x, y + 8 + ART_H - sheet.h);
        }
        x += widths[i] + PIECE_GAP;
      });
      // The ROM's own fog over the picture, the weather the ring's outside wears, blended
      // a little lighter than the GBA's 12/16 so the trainer under it still reads, edge to
      // edge inside the border.
      if (panel.fog) {
        for (let fx = 0; fx < FOG_W; fx += FOG_TILE) {
          c.drawUiPicture('/field-sprites/fog.png', 0, 0, Math.min(FOG_TILE, FOG_W - fx), ART_H, 6 + fx, y + 8, 0.6);
        }
      }
      let ty = y + 8 + ART_H + 4;
      c.drawTextCentred(panel.title, W / 2, ty, TEXT_BLUE);
      widgets.push({ rect: { x: 8, y: ty, w: W - 16, h: ROW_H }, text: panel.title, id: 'howto-heading', cursor: null });
      ty += ROW_H + 4;
      rows.forEach((row, i) => c.drawText(row, 12, ty + i * ROW_H, TEXT_DARK));
      widgets.push({ rect: { x: 8, y: ty, w: W - 16, h: rows.length * ROW_H }, text: panel.text, id: 'howto-text', cursor: null });
      y = frame.y + frame.h + 2;

      const count = `${page + 1}/${PANELS.length}`;
      c.drawTextCentred(count, W / 2, y, TEXT_GRAY);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: count, id: 'howto-page', cursor: null });
      y += ROW_H + 4;

      // NEXT first, and DONE first on the last panel: the cursor starts on the first
      // button, so A alone clicks through and out.
      const buttons: ButtonSpec[] = last
        ? [{ label: 'DONE', id: 'howto-done', onPress: done }]
        : [{ label: 'NEXT', id: 'howto-next', onPress: () => { page += 1; } }];
      if (page > 0) buttons.push({ label: 'BACK', id: 'howto-back', onPress: () => { page -= 1; } });
      if (!last) buttons.push({ label: 'SKIP', id: 'howto-skip', onPress: done });
      widgets.push(...paintButtons(c, Math.min(y, h - 28), buttons));
      return { widgets };
    },
  };
}
