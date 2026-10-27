// The game's pictures, from the player's ROM (HBR-66, HBR-67). The page has always asked
// for them by path -- /field-maps/<MAP_ID>[.cover|.border].png, /field-sprites/<gfx>.png,
// /mon-pics/<species>[s].png, /trainer-pics/<pic>.png -- and still does; those paths are
// now keys, not files: the site ships none of them, and art.worker.ts cuts each out of
// the ROM when it is asked for. Anything else (/ui/...) is still a file, and goes
// straight through. The rest is a chunk of its own (client.ts), out of main.js.

const ART = /^\/(field-maps|field-sprites|mon-pics|trainer-pics)\//;
let client: Promise<typeof import('./client')> | null = null;
const load = () => (client ??= import('./client'));

/** Hands the ROM this tab runs, and its symbols, to the worker. Once per page. */
export function useRomArt(rom: Uint8Array, symbols: Map<string, number>): void {
  void load().then((c) => c.useRomArt(rom, symbols));
}

/** There is no ROM to cut from (an unpatched one): every picture fails. */
export function noRomArt(why: string): void {
  void load().then((c) => c.noRomArt(why));
}

/** An object URL of `path`'s picture, for the e2e (dev only); never revoked. */
export async function artUrl(path: string): Promise<string> {
  return URL.createObjectURL(await (await load()).artPng(path));
}

interface Picture {
  src: string;
  addEventListener(type: 'load' | 'error', listener: () => void): void;
}

/** `img.src = path`, for every picture the page draws: the ROM's art arrives when it is
 *  cut, and one the ROM cannot give fails the way a missing file did. */
export function setPictureSrc(img: Picture, path: string): void {
  if (!ART.test(path)) {
    img.src = path;
    return;
  }
  load().then((c) => c.artPng(path)).then(
    (png) => {
      // The element holds the picture once it has it; the URL is only the way in.
      const url = URL.createObjectURL(png);
      let done = false;
      const free = () => {
        if (!done) URL.revokeObjectURL(url);
        done = true;
      };
      img.addEventListener('load', free);
      img.addEventListener('error', free);
      img.src = url;
    },
    (err: unknown) => {
      console.warn('[art]', path, err instanceof Error ? err.message : err);
      img.src = 'data:,';
    },
  );
}
