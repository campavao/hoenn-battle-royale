// A window of the page's over everything else: a small box in the middle of the screen, the rest
// dimmed, as the battle's windows are small (Cam, 11-03, of the ROM's SUMMARY: "Make this smaller
// so it doesn't take up the whole screen, like the battle screen"). The keys and a pad are its
// while it is up, and whatever it stands over keeps running.

export interface PageWindow {
  /** A key of the keyboard or a pad: up, down, left, right, a, b, l, r, select. */
  key(k: string): void;
}

const stack: PageWindow[] = [];
let root: HTMLElement | null = null;

/** The one element they all go in. */
export function pageRoot(doc: Document = document): HTMLElement {
  if (!root) {
    root = doc.createElement('div');
    root.id = 'page-win';
    root.hidden = true;
    doc.body.appendChild(root);
  }
  return root;
}

export const pageWin = {
  get up(): boolean {
    return stack.length > 0;
  },
  key(k: string): void {
    stack[stack.length - 1]?.key(k);
  },
  open(w: PageWindow): void {
    if (!stack.includes(w)) stack.push(w);
    pageRoot().hidden = false;
  },
  close(w: PageWindow): void {
    const at = stack.indexOf(w);
    if (at >= 0) stack.splice(at, 1);
    if (!stack.length) pageRoot().hidden = true;
  },
};

/** A hold has just opened something under the finger: the click its lift may yet make is nobody's.
 *  A phone hit-tests it where it lands, on whatever window came up there. */
export function eatLiftClick(): void {
  const eat = (ev: Event) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
  addEventListener('click', eat, true);
  const done = () => {
    removeEventListener('pointerup', done, true);
    removeEventListener('pointercancel', done, true);
    setTimeout(() => removeEventListener('click', eat, true), 80);
  };
  addEventListener('pointerup', done, true);
  addEventListener('pointercancel', done, true);
}

let insets: HTMLElement | null = null;
/** The screen a window may stand on, CSS pixels: less the notch and the home bar, on a phone that
 *  has them. */
export function glass(doc: Document = document): { w: number; h: number } {
  if (!insets) {
    insets = doc.createElement('div');
    insets.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    doc.body.appendChild(insets);
  }
  const c = getComputedStyle(insets);
  const px = (v: string) => parseFloat(v) || 0;
  return { w: innerWidth - px(c.paddingLeft) - px(c.paddingRight), h: innerHeight - px(c.paddingTop) - px(c.paddingBottom) };
}

/** The most a phone's windows grow: a tablet's aren't a wall. */
export const TOUCH_MAX_SCALE = 3;

/** CSS pixels per GBA pixel for a box of `w` x `h`. A phone's is all the glass there is (Cam, 11-04:
 *  "on mobile the menus like the map and everything else should take up the full screen"); a window
 *  with a mouse goes down a whole step from its windows, so that this is a box on the screen and
 *  not the screen. */
export function pageScale(w: number, h: number, base: number, touch: boolean, room: { w: number; h: number }): number {
  const fit = Math.min((room.w - 8) / w, (room.h - 16) / h);
  if (touch) return Math.min(TOUCH_MAX_SCALE, fit);
  return Math.max(1, Math.min(Math.max(2, base - 1), Math.floor(fit)));
}
