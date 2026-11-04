// The name by the thing itself (Cam, 11-02: "a tooltip on hover near the item/bag/Pokemon"): a
// small Emerald window over whatever is in reach, or under a mouse, with a point down to it.
// A POKeMON on the ground has its icon beside its name (Cam, 11-03).
import { EmeraldCanvas, TEXT_DARK, measure } from '../src/ui/emerald';

const H = 24, POINT = 4, PAD = 10;
const ICON = 32, ICON_H = 38;

export class Tag {
  private readonly c: EmeraldCanvas;
  private text = '';
  private icon: HTMLCanvasElement | null = null;
  private scale = 1;

  constructor(private readonly el: HTMLCanvasElement) {
    this.c = new EmeraldCanvas(el);
    this.c.onLoad = () => this.paint();
  }

  setScale(s: number): void {
    if (s === this.scale) return;
    this.scale = s;
    this.paint();
  }

  /** `text` centred over (x, y), CSS pixels, kept on the window. */
  show(text: string, x: number, y: number, icon: HTMLCanvasElement | null = null): void {
    if (text !== this.text || icon !== this.icon) { this.text = text; this.icon = icon; this.el.dataset.text = text; this.paint(); }
    // Its size as painted: hidden, the element measures 0 wide, and the tag came up half its width
    // to the right of where it stays (Cam, 11-04: "Is this still zooming in from the right?").
    const w = this.c.width * this.scale;
    const h =((this.icon ? ICON_H : H) + POINT) * this.scale;
    const left = Math.max(4, Math.min(innerWidth - w - 4, x - w / 2));
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, y - h))}px)`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private paint(): void {
    if (!this.text) return;
    const icon = this.icon;
    const h = icon ? ICON_H : H;
    const w = Math.ceil((measure(this.text) + 2 * PAD + (icon ? ICON : 0)) / 8) * 8;
    this.c.resize(w, h + POINT, this.scale);
    this.c.clearAll();
    this.c.drawFrame({ x: 0, y: 0, w, h });
    // Its own size, whole pixels: a mon's icon is the box, an item's sheet cell is smaller.
    if (icon) this.c.drawImageTo(icon, 0, 0, icon.width, icon.height, 6 + (ICON - icon.width >> 1), 3 + (ICON - icon.height >> 1), icon.width, icon.height);
    this.c.drawTextCentred(this.text, icon ? (w + ICON + 6) / 2 : w / 2, Math.floor((h - 14) / 2), TEXT_DARK);
    for (let i = 0; i < POINT; i++) this.c.fillRect({ x: w / 2 - POINT + i, y: h - 1 + i, w: 2 * (POINT - i), h: 1 }, '#5a5a78');
  }
}
