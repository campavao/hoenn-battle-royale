// The field's pictures, from the player's ROM (HBR-66). The page has always asked for
// them by path -- /field-maps/<MAP_ID>[.cover|.border].png, /field-sprites/<gfx>.png --
// and still does; those paths are now keys, not files: the site ships none of them, and
// art.worker.ts cuts each out of the ROM the first time it is asked for. Anything else
// (/ui/..., /mon-pics/...) is still a file, and goes straight through.
import sprites from '../data/sprites.json';
import { HOENN, loadHoenn } from '../bots/hoenn';
import type { ArtWorkerRequest, ArtWorkerResponse } from './art.worker';
import type { ArtRequest, Mark } from './romart';

/** The SURF blob's key among the sheets, past every object gfx id (export-sprites.py). */
const SURF_BLOB_GFX = 1000;
const MARKS: Record<string, Mark> = { 'patch-tall-grass': 'tall-grass', 'patch-water': 'water', 'patch-shadow': 'shadow' };
const SHEETS = sprites as Record<string, { frames: number }>;
const PATH = /^\/field-(maps|sprites)\/([\w-]+?)(\.cover|\.border)?\.png$/;

/** What `path` asks the ROM for; null for a path that is not the field's art, or names
 *  nothing in it. `mapRef` finds a MAP_ id's group and number. */
export function artRequest(path: string, mapRef: (id: string) => { group: number; num: number } | undefined): ArtRequest | null {
  const m = PATH.exec(path);
  if (!m) return null;
  const [, dir, name, layer] = m;
  if (dir === 'maps') {
    const ref = mapRef(name);
    return ref ? { t: 'map', group: ref.group, num: ref.num, layer: layer === '.cover' ? 'cover' : layer === '.border' ? 'border' : 'ground' } : null;
  }
  if (layer) return null;
  if (name === 'fog') return { t: 'fog' };
  if (MARKS[name]) return { t: 'mark', mark: MARKS[name] };
  if (name === String(SURF_BLOB_GFX)) return { t: 'surf' };
  const sheet = SHEETS[name];
  return sheet ? { t: 'sheet', gfx: Number(name), frames: sheet.frames } : null;
}

let started: (worker: Worker) => void;
const worker = new Promise<Worker>((ok) => (started = ok));
const waiting = new Map<number, { ok: (url: string) => void; no: (err: Error) => void }>();
const urls = new Map<string, Promise<string>>();
let nextId = 0;

/** Hands the ROM this tab runs, and its symbols, to the worker. Once per page. */
export function useRomArt(rom: Uint8Array, symbols: Map<string, number>): void {
  const w = new Worker(new URL('./art.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (event: MessageEvent<ArtWorkerResponse>) => {
    const r = event.data;
    const wait = waiting.get(r.id);
    waiting.delete(r.id);
    if (r.ok) wait?.ok(URL.createObjectURL(r.png));
    else wait?.no(new Error(r.error));
  };
  const msg: ArtWorkerRequest = { t: 'rom', rom, symbols: Object.fromEntries(symbols) };
  w.postMessage(msg); // a copy: the emulator keeps running on `rom`
  started(w);
}

/** An object URL of `path`'s picture, cut from the ROM; rejects for a path it has not. */
export function artUrl(path: string): Promise<string> {
  let url = urls.get(path);
  if (!url) {
    url = Promise.all([worker, loadHoenn()]).then(([w]) => {
      const req = artRequest(path, (id) => HOENN.byId.get(id));
      if (!req) throw new Error(`no art for ${path}`);
      const id = nextId++;
      const msg: ArtWorkerRequest = { t: 'draw', id, req };
      w.postMessage(msg);
      return new Promise<string>((ok, no) => waiting.set(id, { ok, no }));
    });
    urls.set(path, url);
  }
  return url;
}

/** `img.src = path`, for every picture the page draws: the field's art arrives from the
 *  ROM when it is cut, and one the ROM cannot give fails the way a missing file did. */
export function setPictureSrc(img: { src: string }, path: string): void {
  if (!PATH.test(path)) {
    img.src = path;
    return;
  }
  artUrl(path).then(
    (url) => (img.src = url),
    () => (img.src = 'data:,'),
  );
}
