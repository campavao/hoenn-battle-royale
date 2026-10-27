// Cuts the field's pictures out of the player's ROM off the main thread (HBR-66): a big
// map is a few million pixels to decode and a PNG to encode, a hitch mid-walk if it ran
// inline. Loaded from art/index.ts as
// `new Worker(new URL('./art.worker.ts', import.meta.url), { type: 'module' })`.
//
// Typed through a narrow local scope, as patch/bps.worker.ts is, for the same reason.

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

async function png(req: ArtRequest): Promise<Blob> {
  if (!art) throw new Error('no ROM yet');
  const pic = art.draw(req);
  const canvas = new OffscreenCanvas(pic.w, pic.h);
  const ctx = canvas.getContext('2d')!;
  const data = ctx.createImageData(pic.w, pic.h);
  new Uint32Array(data.data.buffer).set(pic.px);
  ctx.putImageData(data, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.t === 'rom') {
    art = new RomArt(msg.rom, (name) => msg.symbols[name]);
    return;
  }
  png(msg.req).then(
    (blob) => scope.postMessage({ id: msg.id, ok: true, png: blob }),
    (err: unknown) => scope.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
