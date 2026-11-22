// What stands for whom on a picture of the world drawn small: the field zoomed far out, the
// minimap and the MAP (Cam, 11-21, spectating on a phone: "other trainers show as small white
// or blue boxes", and a legendary that drops is "a Royale Ball icon" on the map). Every picture
// here is cut from the player's own ROM; this only says which, and where.

/** A person's head on their sheet: 16 rows from 23 above the frame's foot (hair from row 10
 *  of a 32-row frame, chin at 22), as the minimap draws it (main.ts miniFrame). */
export const HEAD_H = 16;
export function headRows(frameH: number): { sy: number; sh: number } {
  return { sy: Math.max(0, frameH - 23), sh: HEAD_H };
}

/** The badge behind a trainer's head far out: red for mine, gold for one in a battle, none
 *  for the rest (the old dots' colours for those two; the head says who the rest are). */
export const FAR_MINE = '#ff3b3b';
export const FAR_BATTLING = '#ffd34d';
export function farBadge(a: { id: number; battling: boolean }, me: number): string | null {
  return a.id === me ? FAR_MINE : a.battling ? FAR_BATTLING : null;
}

/** The order the heads go down in: mine last, on top. */
export function farOrder<T extends { id: number }>(all: readonly T[], me: number): T[] {
  return [...all.filter((a) => a.id !== me), ...all.filter((a) => a.id === me)];
}

/** An event's mark on the MAP: its legendary's own icon (gMonIconTable), a story's POKeMON's
 *  (`mon`: MEW, DEOXYS, BELDUM...), or for a story of items only the ball it always had. */
export function markIcon(e: { species: number; mon?: number }): number | null {
  return e.species > 0 ? e.species : e.mon && e.mon > 0 ? e.mon : null;
}

/** The events whose mark is a POKeMON still on the map: a legendary or a story's POKeMON,
 *  not caught or taken (the minimap draws these). */
export function liveMarks<E extends { key: number; species: number; mon?: number }>(events: readonly E[], spills: { has(key: number): boolean }, picked: { has(key: number): boolean }): E[] {
  return events.filter((e) => markIcon(e) !== null && spills.has(e.key) && !picked.has(e.key));
}

/** The events whose legendary is on the map now: dropped, not caught, not gone with the
 *  bag it stands in (ringmap.ts plots' `taken`, turned round). */
export function liveLegends<E extends { key: number; species: number }>(events: readonly E[], spills: { has(key: number): boolean }, picked: { has(key: number): boolean }): E[] {
  return events.filter((e) => e.species > 0 && spills.has(e.key) && !picked.has(e.key));
}

/** The opaque box of an RGBA picture `w` wide, or null for one with nothing in it: a
 *  party icon's 32 x 32 is mostly air, and the MAP's marks want only the POKeMON. */
export function opaqueBox(data: ArrayLike<number>, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[(y * w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const trims = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** `img` cut down to its opaque box (opaqueBox), once. */
export function trimmed(img: HTMLCanvasElement): HTMLCanvasElement {
  let out = trims.get(img);
  if (out) return out;
  const d = img.getContext('2d')!.getImageData(0, 0, img.width, img.height);
  const box = opaqueBox(d.data, img.width, img.height) ?? { x: 0, y: 0, w: img.width, h: img.height };
  out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d')!.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  trims.set(img, out);
  return out;
}
