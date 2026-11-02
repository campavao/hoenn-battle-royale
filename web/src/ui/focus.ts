// Moving a focus round windows with the arrows or a pad: to the nearest one that way, by where
// they are on the screen, so a phone's layout and a desktop's need no table of their own.

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Box { x: number; y: number; w: number; h: number }

/** The box to go to from `at`, going `dir`: `at` itself when nothing lies that way. Nearest
 *  along the way, and being off to the side counts double against it. */
export function nextFocus(boxes: readonly Box[], at: number, dir: Dir): number {
  const from = boxes[at];
  if (!from) return boxes.length ? 0 : -1;
  const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
  let best = at, bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (i === at) return;
    const dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy;
    const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1) return;
    const score = along + 2 * across;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}
