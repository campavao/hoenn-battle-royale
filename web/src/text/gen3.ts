// The Gen 3 (Emerald) text charmap, straight from `charmap.txt` at the repo root --
// the same table agbcc's `.string` directive uses to assemble ROM text, so a byte
// this module writes is a byte the ROM's font can already draw. Only the subset the
// wire actually needs to print -- letters, digits, space, and the punctuation a
// player name, a ticker line or a battle line uses -- is mapped; kana, the accented
// Latin letters, and multi-byte macros (PKMN, LV, POKEBLOCK) are out of scope.
//
// POK-217: this exists so `slots.ts` can put a string (a name, a ticker line) into a
// fixed-width mailbox payload without shipping UTF-16 into EWRAM. Strings on the wire
// are length-prefixed: [len: u8][bytes...].

export class Gen3TextError extends Error {}

// charmap.txt byte values (hex) for the subset this wire prints.
const GEN3_CHARMAP: ReadonlyMap<string, number> = new Map<string, number>([
  [' ', 0x00],
  ['&', 0x2d],
  ['+', 0x2e],
  ['=', 0x35],
  [';', 0x36],
  ['%', 0x5b],
  ['(', 0x5c],
  [')', 0x5d],
  ['<', 0x85],
  ['>', 0x86],
  ['0', 0xa1],
  ['1', 0xa2],
  ['2', 0xa3],
  ['3', 0xa4],
  ['4', 0xa5],
  ['5', 0xa6],
  ['6', 0xa7],
  ['7', 0xa8],
  ['8', 0xa9],
  ['9', 0xaa],
  ['!', 0xab],
  ['?', 0xac],
  ['.', 0xad],
  ['-', 0xae],
  [',', 0xb8],
  ['/', 0xba],
  ['A', 0xbb],
  ['B', 0xbc],
  ['C', 0xbd],
  ['D', 0xbe],
  ['E', 0xbf],
  ['F', 0xc0],
  ['G', 0xc1],
  ['H', 0xc2],
  ['I', 0xc3],
  ['J', 0xc4],
  ['K', 0xc5],
  ['L', 0xc6],
  ['M', 0xc7],
  ['N', 0xc8],
  ['O', 0xc9],
  ['P', 0xca],
  ['Q', 0xcb],
  ['R', 0xcc],
  ['S', 0xcd],
  ['T', 0xce],
  ['U', 0xcf],
  ['V', 0xd0],
  ['W', 0xd1],
  ['X', 0xd2],
  ['Y', 0xd3],
  ['Z', 0xd4],
  ['a', 0xd5],
  ['b', 0xd6],
  ['c', 0xd7],
  ['d', 0xd8],
  ['e', 0xd9],
  ['f', 0xda],
  ['g', 0xdb],
  ['h', 0xdc],
  ['i', 0xdd],
  ['j', 0xde],
  ['k', 0xdf],
  ['l', 0xe0],
  ['m', 0xe1],
  ['n', 0xe2],
  ['o', 0xe3],
  ['p', 0xe4],
  ['q', 0xe5],
  ['r', 0xe6],
  ['s', 0xe7],
  ['t', 0xe8],
  ['u', 0xe9],
  ['v', 0xea],
  ['w', 0xeb],
  ['x', 0xec],
  ['y', 0xed],
  ['z', 0xee],
  [':', 0xf0],
  ['$', 0xff],
]);

const GEN3_REVERSE: ReadonlyMap<number, string> = new Map(
  Array.from(GEN3_CHARMAP.entries(), ([ch, byte]) => [byte, ch] as const),
);

/** True if `ch` (a single character) has a byte in the wire's Gen 3 charmap subset. */
export function canEncodeGen3(ch: string): boolean {
  return GEN3_CHARMAP.has(ch);
}

/** Encodes `text` to Gen 3 charmap bytes. Throws Gen3TextError on the first character
 *  the map does not cover, rather than silently dropping or substituting it -- a
 *  ticker line that cannot be drawn should fail loudly on the page, not show up on
 *  someone's GBA missing a letter. `maxLen` truncates (in characters) before encoding. */
export function encodeGen3(text: string, maxLen = 255): Uint8Array {
  const chars = Array.from(text).slice(0, maxLen);
  const out = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) {
    const byte = GEN3_CHARMAP.get(chars[i]);
    if (byte === undefined) {
      throw new Gen3TextError(
        `cannot encode ${JSON.stringify(chars[i])} (U+${chars[i].codePointAt(0)!.toString(16).toUpperCase()}) in the Gen 3 charmap`,
      );
    }
    out[i] = byte;
  }
  return out;
}

/** Decodes Gen 3 charmap bytes back to a string. Throws on a byte outside the wire's
 *  subset -- a stray 0x00 padding byte included -- so a caller trims to the declared
 *  length before calling this rather than relying on decode to stop early. */
export function decodeGen3(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    const ch = GEN3_REVERSE.get(byte);
    if (ch === undefined) {
      throw new Gen3TextError(`byte 0x${byte.toString(16).padStart(2, '0')} is not in the Gen 3 charmap`);
    }
    out += ch;
  }
  return out;
}

/** [len: u8][bytes...] -- a length-prefixed Gen 3 string, the shape every name and
 *  ticker line takes inside a mailbox payload (slots.ts). `maxLen` bounds the
 *  character count so the prefix byte never has to represent more than 255. */
export function packGen3String(text: string, maxLen = 255): Uint8Array {
  const body = encodeGen3(text, Math.min(maxLen, 255));
  const out = new Uint8Array(body.length + 1);
  out[0] = body.length;
  out.set(body, 1);
  return out;
}

/** Reads a [len: u8][bytes...] string starting at `offset`. Returns the decoded text
 *  and the offset just past it, so callers can chain reads through a payload. */
export function unpackGen3String(bytes: Uint8Array, offset = 0): { text: string; nextOffset: number } {
  const len = bytes[offset];
  if (len === undefined) throw new Gen3TextError(`no length byte at offset ${offset}`);
  const start = offset + 1;
  const end = start + len;
  if (end > bytes.length) throw new Gen3TextError(`string of length ${len} at offset ${offset} runs past the payload`);
  return { text: decodeGen3(bytes.subarray(start, end)), nextOffset: end };
}
