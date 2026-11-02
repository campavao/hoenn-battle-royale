// How close the player's own field sits (Cam, 11-02: "so the player can choose"): whole
// device pixels per GBA pixel, so tiles stay crisp, kept in this browser. Spectating has its
// own free zoom on top; this is what the camera comes back to.

export const ZOOM_KEY = 'hbr:zoom';

/** The most tiles a choice may show along the window's long side: about a 1080p desktop's
 *  view (60). Past it a player reads the whole map off the field. A window whose default is
 *  already wider keeps that default. */
const FARTHEST_TILES = 64;
const TILE = 16;

export interface ZoomRange { lo: number; hi: number }

/** Out to FARTHEST_TILES, in to the GBA's own 15 x 10 filling the window. `fit` is the
 *  window's default (main.ts fitZoom), always one of the choices. */
export function zoomRange(devW: number, devH: number, fit: number): ZoomRange {
  const far = Math.max(1, Math.ceil(Math.max(devW, devH) / (FARTHEST_TILES * TILE)));
  const gba = Math.floor(Math.min(devW / 15, devH / 10) / TILE);
  return { lo: Math.min(fit, far), hi: Math.max(fit, gba) };
}

/** A zoom inside the range. */
export function clampZoom(z: number, r: ZoomRange): number {
  return Math.min(r.hi, Math.max(r.lo, z));
}

/** A saved choice inside this window's range, or its default when there is none. */
export function pickedZoom(saved: number | null, fit: number, r: ZoomRange): number {
  return clampZoom(saved ?? fit, r);
}

/** The next choice round (a row that only has one press), closer until it wraps. */
export function nextZoom(z: number, r: ZoomRange): number {
  return z >= r.hi ? r.lo : z + 1;
}

/** Where a choice is on the scale, "3/5", 1 the farthest: a device's pixels mean nothing
 *  to a player. */
export function zoomLabel(z: number, r: ZoomRange): string {
  return `${z - r.lo + 1}/${r.hi - r.lo + 1}`;
}

/** Wheel notches to whole steps (a trackpad's small deltas add up): a positive delta is the
 *  wheel pulled back, farther out. Returns the steps and what is left over. */
export function wheelSteps(sum: number, delta: number, notch = 100): { steps: number; rest: number } {
  const total = sum + delta;
  const out = Math.trunc(total / notch);
  return { steps: out === 0 ? 0 : -out, rest: total - out * notch };
}

export function loadZoom(store: Pick<Storage, 'getItem'>): number | null {
  try {
    const n = Number(store.getItem(ZOOM_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

export function saveZoom(store: Pick<Storage, 'setItem'>, z: number): void {
  try { store.setItem(ZOOM_KEY, String(z)); } catch { /* a private window: this visit only */ }
}
