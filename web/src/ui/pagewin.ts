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

/** CSS pixels per GBA pixel for a box of `w` x `h`. A phone's is the battle windows' scale, or
 *  what fits; a window with a mouse goes down a whole step from its windows, so that this is a
 *  box on the screen and not the screen. */
export function pageScale(w: number, h: number, base: number, touch: boolean, room: { w: number; h: number }): number {
  const fit = Math.min((room.w - 8) / w, (room.h - 16) / h);
  if (touch) return Math.min(base, fit);
  return Math.max(1, Math.min(Math.max(2, base - 1), Math.floor(fit)));
}
