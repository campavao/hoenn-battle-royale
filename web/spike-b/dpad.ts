// The live game's D-pad (app.ts wireDpad): one cross on one surface, the touch's angle
// from its middle picking one direction or a diagonal's two, nothing near the middle.
// Cam prefers it to four separate keys (2026-10-29), and a thumb can roll round it.

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Within this share of the half-width of the middle, a touch is no direction. */
export const DEAD_ZONE = 0.35;

const OCTANTS: Record<number, Dir[]> = {
  [-180]: ['left'], 180: ['left'], [-135]: ['up', 'left'], [-90]: ['up'], [-45]: ['up', 'right'],
  0: ['right'], 45: ['down', 'right'], 90: ['down'], 135: ['down', 'left'],
};

/** The directions held at (dx, dy), each -1..1 from the middle, y down. */
export function dpadKeys(dx: number, dy: number): Dir[] {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return [];
  return OCTANTS[Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 45) * 45];
}

/** Presses and lets go of what a finger on `el` holds as it moves; `active` while held. */
export function wireDpad(el: HTMLElement, down: (k: Dir) => void, up: (k: Dir) => void): void {
  let active: Dir[] = [];
  const set = (next: Dir[]) => {
    for (const k of active) if (!next.includes(k)) up(k);
    for (const k of next) if (!active.includes(k)) down(k);
    active = next;
    el.classList.toggle('active', next.length > 0);
  };
  const at = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    set(dpadKeys((e.clientX - (r.left + r.width / 2)) / (r.width / 2), (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    at(e);
  });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) at(e); });
  el.addEventListener('pointerup', () => set([]));
  el.addEventListener('pointercancel', () => set([]));
  el.addEventListener('lostpointercapture', () => set([]));
}
