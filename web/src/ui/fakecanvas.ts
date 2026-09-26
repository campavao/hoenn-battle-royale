// A canvas for the screens' tests: every call a screen makes, recorded, and nothing
// drawn. Text is measured with the ROM's own widths, as the real one returns it.
import { type EmeraldCanvas, type Rect, type TextColor, measure } from './emerald';

export interface Drawn {
  text: string;
  x: number;
  y: number;
  color?: TextColor;
}

export function fakeCanvas(): { canvas: EmeraldCanvas; texts: Drawn[]; frames: Rect[]; fills: { r: Rect; color: string; alpha: number }[] } {
  const texts: Drawn[] = [];
  const frames: Rect[] = [];
  const fills: { r: Rect; color: string; alpha: number }[] = [];
  const canvas = {
    width: 240,
    height: 320,
    scale: 1,
    origin: 0,
    clear() {},
    clearAll() {},
    fillRect(r: Rect, color: string, alpha = 1) {
      fills.push({ r, color, alpha });
    },
    drawFrame(r: Rect) {
      frames.push(r);
    },
    drawText(text: string, x: number, y: number, color?: TextColor) {
      texts.push({ text, x, y, color });
      return measure(text);
    },
    drawTextCentred(text: string, cx: number, y: number, color?: TextColor) {
      texts.push({ text, x: Math.round(cx - measure(text) / 2), y, color });
    },
    drawSprite() {
      return true;
    },
    drawCursor() {},
  };
  return { canvas: canvas as unknown as EmeraldCanvas, texts, frames, fills };
}
