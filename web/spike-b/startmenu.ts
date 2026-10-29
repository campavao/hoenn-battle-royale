// The START menu as Emerald draws it (start_menu.c), which the live match shows from its
// ROM (HBR-101): a window down the picture's right edge, a row a line, the cursor before
// the one picked, and in the Safari the ball stock in its own window top left. Drawn on
// the page at the field's scale, where the picture would be: the middle of the screen.
import { EmeraldCanvas, TEXT_DARK, type Rect } from '../src/ui/emerald';

/** sStandardStartMenuWindowTemplate: 7 tiles wide from tile 22, the frame a tile round it. */
export const MENU_X = 168;
export const ROW_H = 16;
/** sSafariBallsWindowTemplate: 9 x 4 tiles from (1, 1), framed. */
const STOCK: Rect = { x: 0, y: 0, w: 88, h: 48 };

/** The menu's frame for `rows` rows, in the picture's pixels. */
export function menuRect(rows: number): Rect {
  return { x: MENU_X, y: 0, w: 72, h: rows * ROW_H + 16 };
}

/** The row under a point `y` pixels down the picture, or -1 off the rows. */
export function rowAt(y: number, rows: number): number {
  const i = Math.floor((y - 8) / ROW_H);
  return i >= 0 && i < rows ? i : -1;
}

export class StartMenu {
  private menu: EmeraldCanvas;
  private stock: EmeraldCanvas;
  private shown: { rows: string[]; pick: number; balls: number | null } | null = null;
  private s = 1;

  constructor(private readonly menuEl: HTMLCanvasElement, private readonly stockEl: HTMLCanvasElement) {
    this.menu = new EmeraldCanvas(menuEl);
    this.stock = new EmeraldCanvas(stockEl);
    this.menu.onLoad = this.stock.onLoad = () => this.paint();
  }

  /** Up with `rows`, `pick` under the cursor; `balls` is the Safari's stock, or null. */
  show(rows: string[], pick: number, balls: number | null, scale: number): void {
    this.shown = { rows, pick, balls };
    this.s = scale;
    this.paint();
  }

  hide(): void {
    this.shown = null;
    this.menuEl.hidden = this.stockEl.hidden = true;
  }

  /** The row a tap at (clientX, clientY) is on, or -1. */
  rowFor(clientX: number, clientY: number): number {
    if (!this.shown) return -1;
    const p = this.menu.toPixel(clientX, clientY);
    return p.x < 0 || p.x >= this.menu.width ? -1 : rowAt(p.y, this.shown.rows.length);
  }

  private place(el: HTMLCanvasElement, x: number, y: number): void {
    el.style.left = `${Math.round(innerWidth / 2 + (x - 120) * this.s)}px`;
    el.style.top = `${Math.round(innerHeight / 2 + (y - 80) * this.s)}px`;
  }

  private paint(): void {
    const v = this.shown;
    if (!v) return;
    const r = menuRect(v.rows.length);
    const m = this.menu;
    m.resize(r.w, r.h, this.s);
    m.clearAll();
    m.drawFrame({ x: 0, y: 0, w: r.w, h: r.h });
    v.rows.forEach((label, i) => {
      const y = 8 + i * ROW_H;
      if (i === v.pick) m.drawCursor(8, y + 2);
      m.drawText(label, 16, y + 1, TEXT_DARK);
    });
    this.place(this.menuEl, r.x, r.y);
    this.menuEl.hidden = false;
    this.stockEl.hidden = v.balls === null;
    if (v.balls === null) return;
    const st = this.stock;
    st.resize(STOCK.w, STOCK.h, this.s);
    st.clearAll();
    st.drawFrame(STOCK);
    st.drawText('ROYALé BALLS', 8, 9, TEXT_DARK);
    st.drawText(`Stock: ${v.balls}`, 8, 25, TEXT_DARK);
    this.place(this.stockEl, STOCK.x, STOCK.y);
  }
}
