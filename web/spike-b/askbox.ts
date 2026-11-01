// The page's questions as Emerald asks them (Cam, 10-30: "why are the dialog boxes
// non-standard? Things like the mart, bag"). Drawn on the picture's own grid, where the
// START menu is (startmenu.ts), from the decomp's window templates:
//
//   the question         sStandardTextBox_WindowTemplates  (2, 15) 27 x 4 tiles, framed
//   YES / NO             sYesNo_WindowTemplates           (21, 9)  5 x 4
//   any other choice     the same window's right edge, standing on the message box
//   the MART's money     shop.c WIN_MONEY                  (1, 1)  10 x 2
//   ...its shelf         WIN_ITEM_LIST                    (14, 2)  15 x 16, prices right
//   ...the item's words  WIN_ITEM_DESCRIPTION, in the message box over the field
//   ...how many          WIN_QUANTITY_PRICE               (18, 11) 10 x 2, and IN BAG (1, 11)
import { EmeraldCanvas, TEXT_DARK, TILE, measure, wrapText, type Rect } from '../src/ui/emerald';

const W = 240;
const H = 160;
const ROW = 16;
/** The message box, frame and all: tiles 1..29 by 14..19. */
const MSG: Rect = { x: TILE, y: 14 * TILE, w: 29 * TILE, h: 6 * TILE };
/** A choice window's right edge: the YES/NO's, tile 26 and its frame. */
const CHOICE_RIGHT = 27 * TILE;
/** Rows a long choice or the shelf shows at once before it scrolls. */
const CHOICE_ROWS = 6;
const SHELF_ROWS = 5;
const MONEY: Rect = { x: 0, y: 0, w: 12 * TILE, h: 4 * TILE };
/** WIN_ITEM_LIST's place, standing on the message box: five rows, then it scrolls. */
const SHELF: Rect = { x: 13 * TILE, y: TILE, w: 17 * TILE, h: 13 * TILE };
const IN_BAG: Rect = { x: 0, y: 10 * TILE, w: 14 * TILE, h: 4 * TILE };
const PRICE: Rect = { x: 17 * TILE, y: 10 * TILE, w: 12 * TILE, h: 4 * TILE };

export type AskView =
  | { kind: 'choice'; title: string; rows: string[]; pick: number }
  | { kind: 'shop'; money: number; rows: { name: string; price?: number }[]; pick: number; words: string[] }
  | { kind: 'count'; title: string; n: number; each: number; inBag: number; money: number };

/** The first row a window `shown` rows tall shows with `pick` in it, of `n`. */
export function scrollTop(pick: number, n: number, shown: number): number {
  return Math.max(0, Math.min(pick - shown + 1 > 0 ? pick - shown + 1 : 0, n - shown));
}

/** A choice window for these rows: the cursor's column, the widest row, the frame. */
export function choiceRect(rows: readonly string[]): Rect {
  const shown = Math.min(rows.length, CHOICE_ROWS);
  const inner = Math.ceil((16 + Math.max(...rows.map(measure), 24)) / TILE) * TILE;
  const w = inner + 2 * TILE;
  const h = shown * ROW + 2 * TILE;
  return { x: CHOICE_RIGHT - w, y: MSG.y - h, w, h };
}

export function money(n: number): string {
  return `¥${n}`;
}

export class AskBox {
  private c: EmeraldCanvas;
  private view: AskView | null = null;
  private s = 1;

  constructor(private readonly el: HTMLCanvasElement) {
    this.c = new EmeraldCanvas(el);
    this.c.onLoad = () => this.paint();
  }

  show(view: AskView, scale: number): void {
    this.view = view;
    this.s = Math.min(scale, innerWidth / W);
    this.paint();
  }

  hide(): void {
    this.view = null;
    this.el.hidden = true;
  }

  /** The row a tap at (clientX, clientY) is on (of the whole list), or -1. */
  rowFor(clientX: number, clientY: number): number {
    const v = this.view;
    if (!v || v.kind === 'count') return -1;
    const p = this.c.toPixel(clientX, clientY);
    const names = v.kind === 'choice' ? v.rows : v.rows.map((r) => r.name);
    const r = v.kind === 'choice' ? choiceRect(v.rows) : SHELF;
    const shown = v.kind === 'choice' ? CHOICE_ROWS : SHELF_ROWS;
    if (p.x < r.x || p.x >= r.x + r.w) return -1;
    const i = Math.floor((p.y - r.y - TILE) / ROW);
    if (i < 0 || i >= Math.min(shown, names.length)) return -1;
    return scrollTop(v.pick, names.length, shown) + i;
  }

  private paint(): void {
    const v = this.view;
    if (!v) return;
    const c = this.c;
    c.resize(W, H, this.s);
    c.clearAll();
    if (v.kind === 'choice') {
      this.message(v.title);
      const r = choiceRect(v.rows);
      this.list(r, v.rows.map((name) => ({ name })), v.pick, CHOICE_ROWS);
    } else if (v.kind === 'shop') {
      this.moneyBox(v.money);
      this.list(SHELF, v.rows, v.pick, SHELF_ROWS);
      // WIN_ITEM_DESCRIPTION is a frameless 14 tiles under the shop's own backdrop; over
      // the field its words read in the message box, the bag's lines run together.
      this.message(v.words.join(' '));
    } else {
      this.moneyBox(v.money);
      this.message(v.title);
      c.drawFrame(IN_BAG);
      c.drawText(`IN BAG: ${v.inBag}`, IN_BAG.x + 2 * TILE, IN_BAG.y + TILE, TEXT_DARK);
      c.drawFrame(PRICE);
      // The roller: the count between its arrows, the total right-aligned.
      const total = money(v.n * v.each);
      c.drawText(`×${String(v.n).padStart(2, '0')}`, PRICE.x + TILE + 4, PRICE.y + TILE, TEXT_DARK);
      c.drawText(total, PRICE.x + PRICE.w - TILE - measure(total), PRICE.y + TILE, TEXT_DARK);
      this.arrow(PRICE.x + TILE + 8, PRICE.y - 1, true);
      this.arrow(PRICE.x + TILE + 8, PRICE.y + PRICE.h - 7, false);
    }
    // The picture's place: the middle of the screen, as the field draws it.
    this.el.style.left = `${Math.round(innerWidth / 2 - (W / 2) * this.s)}px`;
    this.el.style.top = `${Math.round(innerHeight / 2 - (H / 2) * this.s)}px`;
    this.el.hidden = false;
  }

  private message(text: string): void {
    this.c.drawMessageBox(MSG);
    // A '\n' is the script's own line break, as in the message box (msgbox.ts boxLines).
    this.el.dataset.text = text;
    text.split('\n').flatMap((p) => wrapText(p, MSG.w - 4 * TILE)).slice(0, 2).forEach((l, i) => this.c.drawText(l, MSG.x + 2 * TILE, MSG.y + TILE + 2 + i * ROW, TEXT_DARK));
  }

  private moneyBox(n: number): void {
    const c = this.c;
    c.drawFrame(MONEY);
    c.drawText('MONEY', MONEY.x + TILE + 2, MONEY.y + TILE, TEXT_DARK);
    const m = money(n);
    c.drawText(m, MONEY.x + MONEY.w - TILE - 2 - measure(m), MONEY.y + TILE, TEXT_DARK);
  }

  /** A framed list: the cursor before the picked row, a price right-aligned where a row
   *  has one, and the scroll arrows when it runs past the window. */
  private list(r: Rect, rows: { name: string; price?: number }[], pick: number, shown: number): void {
    const c = this.c;
    c.drawFrame(r);
    const top = scrollTop(pick, rows.length, shown);
    rows.slice(top, top + shown).forEach((row, i) => {
      const y = r.y + TILE + i * ROW;
      if (top + i === pick) c.drawCursor(r.x + TILE, y + 1);
      c.drawText(row.name, r.x + 2 * TILE, y, TEXT_DARK);
      if (row.price !== undefined) {
        const p = money(row.price);
        c.drawText(p, r.x + r.w - TILE - 2 - measure(p), y, TEXT_DARK);
      }
    });
    const mid = r.x + r.w / 2 - 3;
    if (top > 0) this.arrow(mid, r.y - 2, true);
    if (top + shown < rows.length) this.arrow(mid, r.y + r.h - 6, false);
  }

  /** The red scroll arrow, up or down. */
  private arrow(x: number, y: number, up: boolean): void {
    for (let i = 0; i < 4; i++) this.c.fillRect({ x: x + i, y: y + (up ? 3 - i : i), w: 7 - 2 * i, h: 1 }, '#e03018');
  }
}
