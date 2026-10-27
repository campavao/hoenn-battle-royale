// The art's own chunk (art/index.ts loads it on first use): which picture a path names,
// and the worker that cuts it out of the ROM.
import sprites from '../data/sprites.json';
import { HOENN, loadHoenn } from '../bots/hoenn';
import type { ArtWorkerRequest, ArtWorkerResponse } from './art.worker';
import type { ArtRequest, Mark } from './romart';

/** The SURF blob's key among the sheets, past every object gfx id (export-sprites.py). */
const SURF_BLOB_GFX = 1000;
const MARKS: Record<string, Mark> = { 'patch-tall-grass': 'tall-grass', 'patch-water': 'water', 'patch-shadow': 'shadow' };
const SHEETS = sprites as Record<string, { frames: number }>;
/** SPECIES_UNOWN_QMARK, NUM_SPECIES + 27: the last picture, Unown's last letter. */
const LAST_SPECIES = 439;
/** TRAINER_PIC_RS_MAY: the last of gTrainerFrontPicTable. */
const LAST_TRAINER_PIC = 92;
const PATH = /^\/(field-maps|field-sprites|mon-pics|trainer-pics)\/([\w-]+?)(\.cover|\.border)?\.png$/;

/** What `path` asks the ROM for; null for a path that is not the field's art, or names
 *  nothing in it. `mapRef` finds a MAP_ id's group and number. */
export function artRequest(path: string, mapRef: (id: string) => { group: number; num: number } | undefined): ArtRequest | null {
  const m = PATH.exec(path);
  if (!m) return null;
  const [, dir, name, layer] = m;
  if (dir === 'field-maps') {
    const ref = mapRef(name);
    return ref ? { t: 'map', group: ref.group, num: ref.num, layer: layer === '.cover' ? 'cover' : layer === '.border' ? 'border' : 'ground' } : null;
  }
  if (layer) return null;
  if (dir === 'mon-pics') {
    const n = /^(\d+)(s?)$/.exec(name);
    const species = n ? Number(n[1]) : 0;
    return species >= 1 && species <= LAST_SPECIES ? { t: 'mon', species, shiny: n![2] === 's' } : null;
  }
  if (dir === 'trainer-pics') {
    const pic = /^\d+$/.test(name) ? Number(name) : -1;
    return pic >= 0 && pic <= LAST_TRAINER_PIC ? { t: 'trainer', pic } : null;
  }
  if (name === 'fog') return { t: 'fog' };
  if (MARKS[name]) return { t: 'mark', mark: MARKS[name] };
  if (name === String(SURF_BLOB_GFX)) return { t: 'surf' };
  const sheet = SHEETS[name];
  return sheet ? { t: 'sheet', gfx: Number(name), frames: sheet.frames } : null;
}

let started: ((worker: Worker) => void) | null = null;
let refused: (err: Error) => void;
const worker = new Promise<Worker>((ok, no) => {
  started = ok;
  refused = no;
});
worker.catch(() => undefined); // each artUrl reports it
const waiting = new Map<number, { ok: (png: Blob) => void; no: (err: Error) => void }>();
let nextId = 0;
let dead: Error | null = null;

/** Hands the ROM this tab runs, and its symbols, to the worker. Once per page. */
export function useRomArt(rom: Uint8Array, symbols: Map<string, number>): void {
  if (!started) return;
  const w = new Worker(new URL('./art.worker.ts', import.meta.url), { type: 'module' });
  // A worker that died answers nothing again: everything waiting fails, as a 404 did.
  w.onerror = (event) => {
    dead = new Error(`art worker: ${event.message || 'crashed'}`);
    console.warn('[art]', dead.message);
    for (const wait of waiting.values()) wait.no(dead);
    waiting.clear();
    w.terminate();
  };
  w.onmessage = (event: MessageEvent<ArtWorkerResponse>) => {
    const r = event.data;
    const wait = waiting.get(r.id);
    waiting.delete(r.id);
    if (r.ok) wait?.ok(r.png);
    else wait?.no(new Error(r.error));
  };
  const msg: ArtWorkerRequest = { t: 'rom', rom, symbols: Object.fromEntries(symbols) };
  w.postMessage(msg); // a copy: the emulator keeps running on `rom`
  started(w);
  started = null;
}

/** There is no ROM to cut from (an unpatched one): every picture fails. */
export function noRomArt(why: string): void {
  started = null;
  refused(new Error(why));
}

/** `path`'s picture, cut from the ROM, as a PNG; rejects for a path it has not. Each call
 *  cuts it afresh: the worker keeps only the tilesets, and whoever asked keeps the
 *  picture, as an image element keeps a file it loaded. */
export async function artPng(path: string): Promise<Blob> {
  const [w] = await Promise.all([worker, loadHoenn()]);
  if (dead) throw dead;
  const req = artRequest(path, (id) => HOENN.byId.get(id));
  if (!req) throw new Error(`no art for ${path}`);
  const id = nextId++;
  const msg: ArtWorkerRequest = { t: 'draw', id, req };
  w.postMessage(msg);
  return new Promise<Blob>((ok, no) => waiting.set(id, { ok, no }));
}
