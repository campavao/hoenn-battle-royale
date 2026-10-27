// Cuts the game's pictures out of the player's ROM off the main thread (HBR-66): a big
// map is over a million pixels to decode, a hitch mid-walk if it ran inline. Loaded from
// art/client.ts as `new Worker(new URL('./art.worker.ts', import.meta.url), { type: 'module' })`.
//
// Typed through a narrow local scope, as patch/bps.worker.ts is, for the same reason.

import { encodePng } from './png';
import { RomArt, type ArtRequest } from './romart';

export type ArtWorkerRequest =
  | { t: 'rom'; rom: Uint8Array; symbols: Record<string, number> }
  | { t: 'draw'; id: number; req: ArtRequest };

export type ArtWorkerResponse = { id: number; ok: true; png: Blob } | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((event: { data: ArtWorkerRequest }) => void) | null;
  postMessage(message: ArtWorkerResponse): void;
}

const scope = self as unknown as WorkerScope;
let art: RomArt | null = null;

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.t === 'rom') {
    art = new RomArt(msg.rom, (name) => msg.symbols[name]);
    return;
  }
  try {
    if (!art) throw new Error('no ROM yet');
    scope.postMessage({ id: msg.id, ok: true, png: new Blob([encodePng(art.draw(msg.req))], { type: 'image/png' }) });
  } catch (err) {
    scope.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
