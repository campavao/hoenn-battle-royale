// Test-only BPS encoder for bps.test.ts. Not part of the shell: the shell only ever
// applies patches CI built, never makes one. Deliberately dumb -- it only emits
// SourceRead/TargetRead runs (never SourceCopy/TargetCopy), so it always produces a
// correct, if unoptimized, patch for any pair of buffers. That's exactly what the
// round-trip tests need; the SourceCopy/TargetCopy path is exercised separately by a
// hand-built patch in bps.test.ts.

import { crc32 } from './bps';

function pushVarint(out: number[], value: number): void {
  let data = value;
  for (;;) {
    const x = data & 0x7f;
    data = Math.floor(data / 128);
    if (data === 0) {
      out.push(0x80 | x);
      break;
    }
    out.push(x);
    data -= 1;
  }
}

function pushU32LE(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushAction(out: number[], command: 0 | 1 | 2 | 3, length: number): void {
  pushVarint(out, (length - 1) * 4 + command);
}

export function encodeBps(source: Uint8Array, target: Uint8Array): Uint8Array {
  const out: number[] = [];
  out.push(0x42, 0x50, 0x53, 0x31); // "BPS1"
  pushVarint(out, source.length);
  pushVarint(out, target.length);
  pushVarint(out, 0); // no metadata

  let i = 0;
  while (i < target.length) {
    // Prefer a SourceRead run: bytes that already match the source at this same offset.
    let matchLen = 0;
    while (i + matchLen < target.length && i + matchLen < source.length && source[i + matchLen] === target[i + matchLen]) {
      matchLen++;
    }
    if (matchLen > 0) {
      pushAction(out, 0, matchLen);
      i += matchLen;
      continue;
    }

    // Otherwise a TargetRead run: literal bytes, up to the next SourceRead-able byte.
    let litLen = 0;
    while (i + litLen < target.length) {
      if (i + litLen < source.length && source[i + litLen] === target[i + litLen]) break;
      litLen++;
    }
    pushAction(out, 1, litLen);
    for (let k = 0; k < litLen; k++) out.push(target[i + k]);
    i += litLen;
  }

  const sourceCrc = crc32(source);
  const targetCrc = crc32(target);
  pushU32LE(out, sourceCrc);
  pushU32LE(out, targetCrc);
  const patchCrc = crc32(Uint8Array.from(out));
  pushU32LE(out, patchCrc);

  return Uint8Array.from(out);
}
