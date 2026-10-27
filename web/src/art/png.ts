// A picture as a PNG with its pixels stored, not deflated (HBR-66 review): a cut map is a
// million pixels or more, and the browser's own encoder (OffscreenCanvas.convertToBlob)
// spent longer squeezing it than the cut took, only for the page to inflate it again a
// moment later -- and before Safari 16.4 a worker has no OffscreenCanvas at all. Stored
// blocks are a copy and a checksum, and every browser decodes them.
import type { Picture } from './romart';

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Stored deflate blocks hold at most this many bytes each. */
const BLOCK = 0xffff;

export function encodePng(pic: Picture): Uint8Array<ArrayBuffer> {
  const row = 1 + pic.w * 4; // a filter byte (0, none), then RGBA
  const raw = row * pic.h;
  const blocks = Math.max(1, Math.ceil(raw / BLOCK));
  const zlen = 2 + raw + blocks * 5 + 4;
  const out = new Uint8Array(8 + 25 + 12 + zlen + 12);
  const dv = new DataView(out.buffer);
  let at = 0;
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  at = 8;
  const chunk = (type: string, len: number, fill: () => void) => {
    dv.setUint32(at, len);
    for (let i = 0; i < 4; i++) out[at + 4 + i] = type.charCodeAt(i);
    const body = at + 8;
    at = body;
    fill();
    dv.setUint32(at, crc32(out, body - 4, at));
    at += 4;
  };
  chunk('IHDR', 13, () => {
    dv.setUint32(at, pic.w);
    dv.setUint32(at + 4, pic.h);
    out.set([8, 6, 0, 0, 0], at + 8); // 8 bits a channel, RGBA, deflate, no filter, no interlace
    at += 13;
  });
  chunk('IDAT', zlen, () => {
    out[at++] = 0x78;
    out[at++] = 0x01;
    const px = new Uint8Array(pic.px.buffer, pic.px.byteOffset, pic.px.byteLength);
    let a = 1, b = 0;
    let left = raw;
    let y = 0, x = 0; // where in the scanlines the next byte comes from; x 0 is the filter byte
    for (let k = 0; k < blocks; k++) {
      const n = Math.min(BLOCK, left);
      left -= n;
      out[at++] = left === 0 ? 1 : 0;
      dv.setUint16(at, n, true);
      dv.setUint16(at + 2, ~n & 0xffff, true);
      at += 4;
      for (let i = 0; i < n; i++) {
        const v = x === 0 ? 0 : px[y * pic.w * 4 + x - 1];
        out[at++] = v;
        a = (a + v) % 65521;
        b = (b + a) % 65521;
        if (++x === row) {
          x = 0;
          y++;
        }
      }
    }
    dv.setUint32(at, ((b << 16) | a) >>> 0);
    at += 4;
  });
  chunk('IEND', 0, () => undefined);
  return out;
}
