// What a player actually has when we ask for their ROM (Cam, 11-21: "improve conversion to
// people playing the game"). A bare .gba is the rarer case: most copies sit in a .zip, some in
// a .gz, and the picker on a phone hands over whatever was tapped. This takes the .gba out of
// a zip or gzip, says plainly what to do with a .7z or .rar, and turns a failed check into a
// sentence a player can act on instead of a byte count or a game code.
import type { EmeraldCheck } from './emerald';

const GBA_SIZE = 16 * 1024 * 1024;

export type Unpacked = { ok: true; bytes: Uint8Array; from?: string } | { ok: false; reason: string };

const starts = (b: Uint8Array, ...sig: number[]) => sig.every((v, i) => b[i] === v);
const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

async function inflate(data: Uint8Array, format: 'deflate-raw' | 'gzip'): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipEntry { name: string; method: number; size: number; packed: number; local: number }

/** The central directory's entries: names, sizes and where each one's data is. */
export function zipEntries(b: Uint8Array): ZipEntry[] {
  // The end record is in the last 64 KiB + 22 bytes (its comment is at most 65535).
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) return [];
  const count = u16(b, end + 10);
  let at = u32(b, end + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && u32(b, at) === 0x02014b50; n++) {
    const nameLen = u16(b, at + 28), extraLen = u16(b, at + 30), commentLen = u16(b, at + 32);
    out.push({
      name: new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLen)),
      method: u16(b, at + 10),
      packed: u32(b, at + 20),
      size: u32(b, at + 24),
      local: u32(b, at + 42),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The ROM inside `bytes`, or why there is none. A bare file comes back as it is. */
export async function unpackRom(bytes: Uint8Array): Promise<Unpacked> {
  if (starts(bytes, 0x50, 0x4b, 0x03, 0x04)) {
    const entries = zipEntries(bytes).filter((e) => !e.name.endsWith('/'));
    // The .gba of the right size; else any file of that size; else the only one there.
    const pick =
      entries.find((e) => /\.gba$/i.test(e.name) && e.size === GBA_SIZE) ??
      entries.find((e) => e.size === GBA_SIZE) ??
      (entries.length === 1 ? entries[0] : undefined);
    if (!pick) {
      return { ok: false, reason: entries.length ? 'That zip has no 16 MiB .gba file in it.' : "That zip didn't open. Unzip it and pick the .gba inside." };
    }
    if (pick.method !== 0 && pick.method !== 8) return { ok: false, reason: "That zip is packed in a way the browser can't open. Unzip it and pick the .gba inside." };
    const local = pick.local;
    if (u32(bytes, local) !== 0x04034b50) return { ok: false, reason: "That zip didn't open. Unzip it and pick the .gba inside." };
    const data = bytes.subarray(local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28));
    try {
      const out = pick.method === 0 ? data.slice(0, pick.size) : await inflate(data.subarray(0, pick.packed), 'deflate-raw');
      return { ok: true, bytes: out, from: pick.name };
    } catch {
      return { ok: false, reason: "That zip didn't open. Unzip it and pick the .gba inside." };
    }
  }
  if (starts(bytes, 0x1f, 0x8b)) {
    try {
      return { ok: true, bytes: await inflate(bytes, 'gzip') };
    } catch {
      return { ok: false, reason: "That .gz didn't open. Unpack it and pick the .gba inside." };
    }
  }
  if (starts(bytes, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return { ok: false, reason: "That's a .7z archive, which a browser can't open. Unpack it and pick the .gba inside." };
  if (starts(bytes, 0x52, 0x61, 0x72, 0x21)) return { ok: false, reason: "That's a .rar archive, which a browser can't open. Unpack it and pick the .gba inside." };
  return { ok: true, bytes };
}

/** Other games' cartridge codes, for a player who picked the wrong one. */
const OTHER_GAMES: Record<string, string> = {
  AXVE: 'Pokemon Ruby', AXPE: 'Pokemon Sapphire', BPRE: 'Pokemon FireRed', BPGE: 'Pokemon LeafGreen',
  BPED: 'the German Emerald', BPEF: 'the French Emerald', BPEI: 'the Italian Emerald', BPES: 'the Spanish Emerald', BPEJ: 'the Japanese Emerald',
};

/** Which way a failed check failed, for the count of the way in (spike-b/seen.ts). */
export function romProblem(bytes: Uint8Array, check: EmeraldCheck): 'size' | 'game' | 'changed' | null {
  if (check.ok) return null;
  if (bytes.length !== GBA_SIZE) return 'size';
  return String.fromCharCode(...bytes.subarray(0xac, 0xb0)) !== 'BPEE' ? 'game' : 'changed';
}

/** A failed check said so a player knows what to do next. */
export function explainRom(bytes: Uint8Array, check: EmeraldCheck): string {
  if (check.ok) return '';
  if (bytes.length !== GBA_SIZE) {
    if (bytes.length < 1024) return "That file is empty or isn't a ROM. Pick the 16 MiB Pokemon Emerald .gba.";
    return `That file is ${(bytes.length / 1024 / 1024).toFixed(1)} MiB; the Emerald ROM is exactly 16 MiB. Pick the original .gba.`;
  }
  const code = String.fromCharCode(...bytes.subarray(0xac, 0xb0));
  if (code !== 'BPEE') {
    const name = OTHER_GAMES[code];
    if (name?.startsWith('the ')) return `That's ${name}. This plays on the US/English Pokemon Emerald.`;
    return name ? `That's ${name}. This plays on Pokemon Emerald (US).` : "That isn't Pokemon Emerald. Pick the US Pokemon Emerald .gba.";
  }
  return "That's Emerald, but a changed copy (a ROM hack, or patched or saved over). This needs the original, unmodified US Emerald.";
}
