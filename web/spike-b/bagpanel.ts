// A dropped bag's windows (Cam's sketches, 11-01): whose it is over the map, POKéMON and BAG side
// by side, and the bag's items with TAKE ALL. Drawn in Emerald's windows with their icons, for a
// thumb, a mouse, the keys or a pad.
import { Win, drawFitted, drawIcon, drawItemFitted } from '../src/ui/phonehud';
import { EmeraldCanvas, TEXT_BLUE, TEXT_DARK, TEXT_WHITE, fitText, measure, type TextColor } from '../src/ui/emerald';
import { nextFocus, type Dir } from '../src/ui/focus';

const CELL_W = 112, CELL_H = 80, GAP = 8, MENU_W = 2 * CELL_W + GAP, BACK_H = 32, ROW_H = 24, TAKE_H = 40, TITLE_H = 18;
const ITEM_POKE_BALL = 4;

export interface BagPanelDeps {
  who: string;
  /** What is in it: nothing to choose between when there is only one. */
  mons: boolean;
  items: { id: number; n: number; name: string }[];
  money: number;
  bag(): CanvasImageSource | null;
  /** The party icon of the first of its team. */
  icon(): CanvasImageSource | null;
  /** 'mons', 'items', or '' to leave it lying. */
  done(c: string): void;
  scale: number;
}

function drawArrow(c: EmeraldCanvas, cx: number, cy: number): void {
  for (let i = 0; i < 5; i++) c.fillRect({ x: Math.round(cx) - 2 + i, y: Math.round(cy) - i, w: 1, h: 2 * i + 1 }, '#e60808');
}

export class BagPanel {
  private focused: HTMLElement | null = null;
  private showFocus: boolean;
  private screen: 'choose' | 'items';

  constructor(private readonly el: HTMLElement, private readonly deps: BagPanelDeps, focusFirst: boolean) {
    this.showFocus = focusFirst;
    const things = deps.items.length > 0 || deps.money > 0;
    this.screen = deps.mons && things ? 'choose' : 'items';
    el.hidden = false;
    this.draw();
  }

  private button(parent: HTMLElement, w: number, h: number, label: string, paint: (c: EmeraldCanvas, redo: () => void) => void, press: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bm-btn';
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    const win = new Win(b, w, h, (c, redo) => { c.drawFrame({ x: 0, y: 0, w, h }); paint(c, redo); });
    win.size(w, h, this.deps.scale);
    win.show(label);
    b.addEventListener('click', press);
    return b;
  }

  private title(text: string): void {
    const t = document.createElement('div');
    t.className = 'bag-title';
    this.el.appendChild(t);
    const w = Math.ceil((measure(text) + 16) / 8) * 8;
    const win = new Win(t, w, TITLE_H, (c) => {
      c.fillRect({ x: 0, y: 0, w, h: TITLE_H }, 'rgba(16,20,24,0.55)');
      c.drawTextCentred(text, w / 2, 1, TEXT_WHITE);
    });
    win.size(w, TITLE_H, this.deps.scale);
    win.show(text);
  }

  private backButton(press: () => void): void {
    this.button(this.el, MENU_W, BACK_H, 'Back', (c) => {
      drawArrow(c, MENU_W / 2 - 24, BACK_H / 2);
      c.drawTextCentred('BACK', MENU_W / 2, 9, TEXT_DARK);
    }, press);
  }

  private draw(): void {
    this.el.replaceChildren();
    const d = this.deps;
    if (this.screen === 'choose') {
      this.title(`${d.who}'s BAG`);
      const row = document.createElement('div');
      row.className = 'bag-row';
      this.el.appendChild(row);
      this.button(row, CELL_W, CELL_H, 'POKéMON', (c) => {
        const icon = d.icon();
        if (icon) c.drawImageTo(icon, 0, 0, 32, 32, CELL_W / 2 - 16, 12, 32, 32);
        c.drawTextCentred('POKéMON', CELL_W / 2, 52, TEXT_DARK);
      }, () => d.done('mons'));
      this.button(row, CELL_W, CELL_H, 'BAG', (c) => {
        const bag = d.bag();
        if (bag) drawFitted(c, 'bag', bag, 0, 0, 64, 64, CELL_W / 2, 28, 28);
        c.drawTextCentred('BAG', CELL_W / 2, 52, TEXT_DARK);
      }, () => { this.screen = 'items'; this.draw(); });
      this.backButton(() => d.done(''));
    } else {
      this.title(`${d.who}'s ITEMS`);
      const list = document.createElement('div');
      this.el.appendChild(list);
      const rows = d.items.length + (d.money ? 1 : 0);
      const h = 16 + Math.max(1, rows) * ROW_H;
      const win = new Win(list, MENU_W, h, (c, redo) => {
        c.drawFrame({ x: 0, y: 0, w: MENU_W, h });
        d.items.forEach((s, i) => {
          const y = 8 + i * ROW_H;
          drawIcon(c, s.id, 16, y, redo);
          const count = `×${s.n}`;
          c.drawText(count, MENU_W - 10 - measure(count), y + 5, TEXT_DARK);
          c.drawText(fitText(s.name, MENU_W - 60 - measure(count)), 44, y + 5, TEXT_DARK);
        });
        if (d.money) c.drawText(`¥${d.money}`, 44, 8 + d.items.length * ROW_H + 5, TEXT_DARK);
      });
      win.size(MENU_W, h, d.scale);
      win.show('list');
      this.takeAll();
      this.backButton(() => { if (d.mons) { this.screen = 'choose'; this.draw(); } else d.done(''); });
    }
    this.focused = this.targets()[0] ?? null;
    this.paintFocus();
  }

  private takeAll(): void {
    this.button(this.el, MENU_W, TAKE_H, 'Take all', (c, redo) => {
      const word = 'TAKE ALL';
      const left = (MENU_W - measure(word) - 22) / 2;
      drawItemFitted(c, ITEM_POKE_BALL, left + 8, TAKE_H / 2, 16, redo);
      const color: TextColor = TEXT_BLUE;
      c.drawText(word, left + 22, 13, color);
    }, () => this.deps.done('items'));
  }

  private targets(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>('button')];
  }

  private paintFocus(): void {
    for (const b of this.el.querySelectorAll('.bm-focus')) b.classList.remove('bm-focus');
    if (this.showFocus) this.focused?.classList.add('bm-focus');
  }

  key(k: string): void {
    if (!this.showFocus) { this.showFocus = true; this.paintFocus(); if (k !== 'a' && k !== 'b') return; }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      const list = this.targets();
      const boxes = list.map((b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      this.focused = list[nextFocus(boxes, this.focused ? list.indexOf(this.focused) : -1, k as Dir)] ?? null;
      this.paintFocus();
    } else if (k === 'a') this.focused?.click();
    else if (k === 'b') {
      if (this.screen === 'items' && this.deps.mons) { this.screen = 'choose'; this.draw(); }
      else this.deps.done('');
    }
  }

  close(): void {
    this.el.hidden = true;
    this.el.replaceChildren();
  }
}
