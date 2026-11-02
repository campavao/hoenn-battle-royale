// The name by the thing itself (Cam, 11-02: "a tooltip on hover near the item/bag/Pokemon"): a
// small Emerald window over whatever is in reach, or under a mouse, with a point down to it.
import { EmeraldCanvas, TEXT_DARK, measure } from '../src/ui/emerald';

const H = 24, POINT = 4, PAD = 10;

export class Tag {
  private readonly c: EmeraldCanvas;
  private text = '';
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
  show(text: string, x: number, y: number): void {
    if (text !== this.text) { this.text = text; this.el.dataset.text = text; this.paint(); }
    const w = this.el.getBoundingClientRect().width;
    const h = (H + POINT) * this.scale;
    const left = Math.max(4, Math.min(innerWidth - w - 4, x - w / 2));
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, y - h))}px)`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private paint(): void {
    if (!this.text) return;
    const w = Math.ceil((measure(this.text) + 2 * PAD) / 8) * 8;
    this.c.resize(w, H + POINT, this.scale);
    this.c.clearAll();
    this.c.drawFrame({ x: 0, y: 0, w, h: H });
    this.c.drawTextCentred(this.text, w / 2, 5, TEXT_DARK);
    for (let i = 0; i < POINT; i++) this.c.fillRect({ x: w / 2 - POINT + i, y: H - 1 + i, w: 2 * (POINT - i), h: 1 }, '#5a5a78');
  }
}
