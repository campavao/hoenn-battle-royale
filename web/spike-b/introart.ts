// The opening's bike ride (Emerald's intro, scene 2), cut from the player's own ROM for the
// loading screen (Cam 11-10: "in the intro of Pokemon Emerald there is this animation of May
// or Brendan riding a bike alongside some Pokemon").
//
// The site ships none of it, and not even where it is: the pieces are static arrays in
// pret's intro_credits_graphics.c and graphics.c, so no symbol names them, and the page
// may hold retail Emerald (before the patch), a patched build, or a dev build that lays
// them out elsewhere. Each is found by what it is -- an LZ77 stream of a known size whose
// bytes have a known CRC-32 -- and each palette by its CRC near the art it sits beside in
// the same file. Sizes and checksums are all the site knows (taken from retail with
// tools/br/gbagfx's rebuild of graphics/intro/scene_2 and the scene's own palettes).

/** CRC-32 (IEEE), the zip one. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array, from = 0, to = b.length): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An LZ77 stream: decompressed `size`, `len` bytes long, its bytes' CRC; `retail` is where
 *  retail Emerald (U) keeps it, tried first. */
interface Packed { size: number; len: number; crc: number; retail: number }
/** A 16-colour palette: its CRC, `delta` bytes from the packed art `near` in retail. */
interface Pal { near: PackedName; delta: number; crc: number }

const PACKED = {
  grass: { size: 0x2000, len: 1149, crc: 0xfcecaca3, retail: 0x85f0740 },
  grassMap: { size: 0x800, len: 313, crc: 0x9cdeb436, retail: 0x85f0bc0 },
  trees: { size: 0x2000, len: 1672, crc: 0x51f7e6d9, retail: 0x85f1824 },
  treesMap: { size: 0x1000, len: 769, crc: 0xf4461b56, retail: 0x85f1eac },
  treesSmall: { size: 0x400, len: 330, crc: 0x7bfeeb40, retail: 0x85f21d0 },
  brendan: { size: 0x2000, len: 1850, crc: 0xcb3a7323, retail: 0x8d87568 },
  may: { size: 0x2000, len: 2031, crc: 0xad6b7740, retail: 0x8d87ca4 },
  bicycle: { size: 0x1000, len: 1067, crc: 0x5ded47eb, retail: 0x85f4318 },
  torchic: { size: 0xc00, len: 1056, crc: 0xebd022cb, retail: 0x8d86130 },
  manectric: { size: 0x2000, len: 2777, crc: 0x2c74b38f, retail: 0x8d86550 },
  volbeat: { size: 0x400, len: 477, crc: 0xe52d4e27, retail: 0x8d85f50 },
} satisfies Record<string, Packed>;
type PackedName = keyof typeof PACKED;

const PALS = {
  grassPal: { near: 'grass', delta: -96, crc: 0x6e77fc0a },
  treesPal: { near: 'trees', delta: -64, crc: 0xfe7e62ba },
  treesSmallPal: { near: 'treesSmall', delta: -32, crc: 0xfe7e62ba },
  playerPal: { near: 'torchic', delta: -1152, crc: 0x7a0653c2 },
  torchicPal: { near: 'torchic', delta: -576, crc: 0x3379091f },
  manectricPal: { near: 'manectric', delta: -1600, crc: 0x0b0a212e },
  volbeatPal: { near: 'volbeat', delta: -128, crc: 0x8764ba89 },
} satisfies Record<string, Pal>;
type PalName = keyof typeof PALS;

const ROM = 0x08000000;
/** How far from its art a palette is looked for when it is not where retail has it. */
const PAL_REACH = 0x4000;

/** LZ77 (BIOS type 0x10) at `at`, `size` bytes out. */
export function unlz(rom: Uint8Array, at: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let p = at + 4, o = 0;
  while (o < size) {
    const flags = rom[p++];
    for (let b = 0; b < 8 && o < size; b++) {
      if (flags & (0x80 >> b)) {
        const n = (rom[p] >> 4) + 3, back = (((rom[p] & 0xf) << 8) | rom[p + 1]) + 1;
        p += 2;
        for (let i = 0; i < n && o < size; i++, o++) out[o] = out[o - back];
      } else out[o++] = rom[p++];
    }
  }
  return out;
}

const isPacked = (rom: Uint8Array, at: number, k: Packed) =>
  at >= 0 && at + k.len <= rom.length && rom[at] === 0x10 && (rom[at + 1] | (rom[at + 2] << 8) | (rom[at + 3] << 16)) === k.size && crc32(rom, at, at + k.len) === k.crc;

/** Every packed piece's offset in `rom`: retail's place first, then a sweep of the word-aligned
 *  LZ77 headers of the right sizes. Missing ones are left out. */
export function findPacked(rom: Uint8Array): Partial<Record<PackedName, number>> {
  const found: Partial<Record<PackedName, number>> = {};
  const left: PackedName[] = [];
  for (const name of Object.keys(PACKED) as PackedName[]) {
    const k = PACKED[name];
    if (isPacked(rom, k.retail - ROM, k)) found[name] = k.retail - ROM;
    else left.push(name);
  }
  if (!left.length) return found;
  const sizes = new Set(left.map((n) => PACKED[n].size));
  for (let at = 0; at + 4 <= rom.length && left.length; at += 4) {
    if (rom[at] !== 0x10) continue;
    const size = rom[at + 1] | (rom[at + 2] << 8) | (rom[at + 3] << 16);
    if (!sizes.has(size)) continue;
    for (let i = 0; i < left.length; i++) {
      if (isPacked(rom, at, PACKED[left[i]])) { found[left[i]] = at; left.splice(i, 1); break; }
    }
  }
  return found;
}

/** A palette near its art: retail's distance first, then every half-word within reach. */
export function findPal(rom: Uint8Array, art: number, k: Pal): number | null {
  const at = art + k.delta;
  if (at >= 0 && at + 32 <= rom.length && crc32(rom, at, at + 32) === k.crc) return at;
  for (let p = Math.max(0, art - PAL_REACH); p < Math.min(rom.length - 32, art + PAL_REACH); p += 2) {
    if (crc32(rom, p, p + 32) === k.crc) return p;
  }
  return null;
}

/** BGR555 to an RGBA word (little-endian canvas order), as the GBA shows it. */
function rgba(c: number): number {
  const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  return (0xff << 24) | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2));
}

function palette(rom: Uint8Array, at: number): Uint32Array {
  const out = new Uint32Array(16);
  for (let i = 0; i < 16; i++) out[i] = rgba(rom[at + i * 2] | (rom[at + i * 2 + 1] << 8));
  return out;
}

/** The scene's pieces, unpacked: 4bpp tiles, tilemaps and palettes (16 RGBA words each). */
export interface IntroArt {
  grass: Uint8Array; grassMap: Uint8Array; trees: Uint8Array; treesMap: Uint8Array; treesSmall: Uint8Array;
  brendan: Uint8Array; may: Uint8Array; bicycle: Uint8Array; torchic: Uint8Array; manectric: Uint8Array; volbeat: Uint8Array;
  grassPal: Uint32Array; treesPal: Uint32Array; treesSmallPal: Uint32Array; playerPal: Uint32Array;
  torchicPal: Uint32Array; manectricPal: Uint32Array; volbeatPal: Uint32Array;
}

/** The bike ride out of `rom`, or null when any piece of it is not there (another game). */
export function introArt(rom: Uint8Array): IntroArt | null {
  const at = findPacked(rom);
  const art: Record<string, Uint8Array | Uint32Array> = {};
  for (const name of Object.keys(PACKED) as PackedName[]) {
    const p = at[name];
    if (p === undefined) return null;
    art[name] = unlz(rom, p, PACKED[name].size);
  }
  for (const name of Object.keys(PALS) as PalName[]) {
    const k = PALS[name];
    const p = findPal(rom, at[k.near]!, k);
    if (p === null) return null;
    art[name] = palette(rom, p);
  }
  return art as unknown as IntroArt;
}
