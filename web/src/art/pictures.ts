// The game's pictures, cut from the player's own ROM (DESIGN.md §2: patch only, nothing of
// Nintendo's served). Until 2026-11-14 the site shipped 1,555 PNGs under web/public --
// field-maps/, field-sprites/, mon-pics/, trainer-pics/, ui/ -- and the page still asks for
// them by those paths. The paths are keys now, not files: whoever has the ROM (spike B's
// boot, web/spike-b/romcuts.ts) hands this module a cutter, and each picture is cut from the
// ROM the first time it is asked for. web/e2e/art.spec.ts holds every cut to the hash of the
// file it replaced (art.sha1.json).
//
// Before the ROM is here (the import screen, the first boot) nothing can be cut: a picture is
// `undefined` -- still coming -- and whoever drew without it is told when the ROM arrives
// (onRomPictures), the way an <img> that loaded used to say so.

/** A cut, `null` for a path the ROM has no picture for, `undefined` for one it cannot cut yet
 *  (its data is still loading): asked again on the next change. */
export type Cutter = (path: string) => HTMLCanvasElement | null | undefined;

/** The paths that are the ROM's pictures. */
const ROM_PICTURE = /^\/(field-maps|field-sprites|mon-pics|trainer-pics|ui)\/[\w./-]+\.png$/;
/** Pictures bigger than this many pixels (a map's still, a piece of the menu's fill) are kept
 *  only while recently drawn, up to BIG_BUDGET of them: a phone tab holds about 600 MB of
 *  canvas before it is killed (hoenn-phone-memory). */
const BIG = 256 * 256;
const BIG_BUDGET = 8_000_000;

let cutter: Cutter | null = null;
const kept = new Map<string, HTMLCanvasElement | null>();
const big = new Map<string, HTMLCanvasElement>();
let bigPixels = 0;
const listeners = new Set<() => void>();
const urls = new Map<string, Promise<string | null>>();

export function isRomPicture(path: string): boolean {
  return ROM_PICTURE.test(path);
}

/** Hands over the cutter for the ROM this tab runs (or null to go back to none). */
export function useRomPictures(next: Cutter | null): void {
  cutter = next;
  kept.clear();
  big.clear();
  bigPixels = 0;
  urls.clear();
  romPicturesChanged();
}

/** Something a cut waited on has come (the fill's data): everyone draws again. */
export function romPicturesChanged(): void {
  for (const f of [...listeners]) f();
}

/** `f` whenever the pictures change (the ROM arrives); returns the way to stop. */
export function onRomPictures(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Whether a ROM's pictures can be had at all yet. */
export function haveRomPictures(): boolean {
  return cutter !== null;
}

/** The picture at `path`: a canvas, null when the ROM has none, undefined while there is no
 *  ROM yet (or what it needs is still loading). */
export function romPicture(path: string): HTMLCanvasElement | null | undefined {
  const had = kept.get(path) ?? big.get(path);
  if (had !== undefined) {
    if (big.has(path)) {
      // Most recently used last.
      big.delete(path);
      big.set(path, had as HTMLCanvasElement);
    }
    return had;
  }
  if (kept.has(path)) return null;
  if (!cutter) return undefined;
  let cut: HTMLCanvasElement | null | undefined;
  try {
    cut = cutter(path);
  } catch (err) {
    console.warn('[art]', path, err instanceof Error ? err.message : err);
    cut = null;
  }
  if (cut === undefined) return undefined;
  if (cut && cut.width * cut.height > BIG) {
    big.set(path, cut);
    bigPixels += cut.width * cut.height;
    for (const [k, v] of big) {
      if (bigPixels <= BIG_BUDGET || k === path) break;
      big.delete(k);
      bigPixels -= v.width * v.height;
    }
  } else kept.set(path, cut);
  return cut;
}

/** An object URL of `path`'s picture, for an <img> (the battle's side cards); null when the ROM
 *  has none. Waits for the ROM. Kept for the page's life: there are 93 trainer pictures. */
export function romPictureUrl(path: string): Promise<string | null> {
  let p = urls.get(path);
  if (p) return p;
  p = new Promise<string | null>((resolve) => {
    const tryNow = (): boolean => {
      const cv = romPicture(path);
      if (cv === undefined) return false;
      if (!cv) resolve(null);
      else cv.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null));
      return true;
    };
    if (tryNow()) return;
    const stop = onRomPictures(() => {
      if (tryNow()) stop();
    });
  });
  urls.set(path, p);
  return p;
}

/** `img.src = path` for a picture that is the ROM's: set once it is cut. */
export function setRomPictureSrc(img: HTMLImageElement, path: string): void {
  img.dataset.picture = path;
  void romPictureUrl(path).then((url) => {
    if (img.dataset.picture === path) img.src = url ?? '';
  });
}
