// A canvas for the screens' tests: every call a screen makes, recorded, and nothing
// drawn. Text is measured with the ROM's own widths, as the real one returns it.
import { type EmeraldCanvas, type Rect, type TextColor, measure } from './emerald';

export interface Drawn {
  text: string;
  x: number;
  y: number;
  color?: TextColor;
}

export interface DrawnPicture {
  name: string;
  sx: number;
  sy: number;
  x: number;
  y: number;
}

/** `missing`: pictures that failed to load, as a 404 would leave them. */
export function fakeCanvas(missing: ReadonlySet<string> = new Set()): {
  canvas: EmeraldCanvas;
  texts: Drawn[];
  frames: Rect[];
  fills: { r: Rect; color: string; alpha: number }[];
  pictures: DrawnPicture[];
  boxes: Rect[];
  sprites: { gfx: number; x: number; y: number; alpha: number }[];
  arrows: { x: number; y: number; left: boolean }[];
} {
  const texts: Drawn[] = [];
  const pictures: DrawnPicture[] = [];
  const frames: Rect[] = [];
  const fills: { r: Rect; color: string; alpha: number }[] = [];
  const boxes: Rect[] = [];
  const sprites: { gfx: number; x: number; y: number; alpha: number }[] = [];
  const arrows: { x: number; y: number; left: boolean }[] = [];
  const canvas = {
    width: 240,
    height: 320,
    scale: 1,
    origin: 0,
    clear() {},
    setFilter() {},
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
    drawMessageBox(r: Rect) {
      boxes.push(r);
    },
    drawSprite(gfx: number, x: number, y: number, alpha = 1) {
      sprites.push({ gfx, x, y, alpha });
      return true;
    },
    drawUiPicture(name: string, sx: number, sy: number, _w: number, _h: number, x: number, y: number) {
      pictures.push({ name, sx, sy, x, y });
      return missing.has(name) ? 'missing' : 'drawn';
    },
    drawCursor(x: number, y: number, _color?: TextColor, left = false) {
      arrows.push({ x, y, left });
    },
  };
  return { canvas: canvas as unknown as EmeraldCanvas, texts, frames, fills, pictures, boxes, sprites, arrows };
}
