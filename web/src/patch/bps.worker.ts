// Runs applyBps off the main thread (POK-213): a 16 MiB ROM diff is tens of
// milliseconds of pure byte-shuffling, long enough to jank the UI thread during the
// "patching" screen if it runs inline. Loaded from app.ts as
// `new Worker(new URL('./patch/bps.worker.ts', import.meta.url), { type: 'module' })`.
//
// Typed through a narrow local `WorkerScope` instead of `/// <reference lib="webworker">`:
// this file lives in the same tsconfig as the DOM-lib page code (Vite bundles both from
// one `src` tree), and the webworker lib's ambient `self`/`postMessage` declarations
// collide with the DOM lib's when both are in scope for one program.

import { applyBps, BpsError } from './bps';

export interface PatchWorkerRequest {
  source: Uint8Array;
  patch: Uint8Array;
}

export type PatchWorkerResponse = { ok: true; result: Uint8Array } | { ok: false; error: string };

interface WorkerScope {
  onmessage: ((event: { data: PatchWorkerRequest }) => void) | null;
  postMessage(message: PatchWorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { source, patch } = event.data;
  try {
    const result = applyBps(source, patch);
    scope.postMessage({ ok: true, result }, [result.buffer]);
  } catch (err) {
    const error = err instanceof BpsError ? err.message : `unexpected error applying patch: ${String(err)}`;
    scope.postMessage({ ok: false, error });
  }
};
