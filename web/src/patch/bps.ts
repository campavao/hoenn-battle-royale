// BPS patch decoder (POK-213). byuu's format: a source ROM plus a diff against a
// target ROM, self-checked with three CRC32s so a wrong ROM or a corrupted patch
// fails loudly instead of booting garbage.
//
// Spec: magic "BPS1"; then a run of variable-length integers ("varints") for the
// source size, target size and metadata size/bytes; then a stream of actions built
// the same way, until 12 bytes short of the end of the file; then the footer, three
// little-endian CRC32s (source, target, patch-minus-its-own-last-4-bytes).
//
// Varint shape: 7 bits of payload per byte, low bits first. Bit 7 clear means "more
// bytes follow"; bit 7 set means "this is the last byte of this number", and each
// non-final byte adds an extra `shift` on top of its payload (byuu's trick to give
// every byte count a distinct encoding, not just a plain base-128 varint):
//
//   data = 0; shift = 1
//   loop: byte = next(); data += (byte & 0x7f) * shift
//         if byte & 0x80: break
//         shift <<= 7; data += shift

export class BpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BpsError';
  }
}

// ---- CRC32 (the zlib/PNG polynomial, table-based) --------------------------------

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- varint reader ----------------------------------------------------------------

/** Mutable cursor into a byte array; passed by reference so readers can advance it. */
export interface Cursor {
  pos: number;
}

export function readVarint(bytes: Uint8Array, cursor: Cursor): number {
  let data = 0;
  let shift = 1;
  for (;;) {
    if (cursor.pos >= bytes.length) throw new BpsError('BPS patch ends mid-number');
    const x = bytes[cursor.pos++];
    data += (x & 0x7f) * shift;
    if (x & 0x80) break;
    shift *= 128;
    data += shift;
  }
  return data;
}

/** Signed varint used for the relative-offset operands of SourceCopy/TargetCopy. */
export function readSignedVarint(bytes: Uint8Array, cursor: Cursor): number {
  const data = readVarint(bytes, cursor);
  const magnitude = Math.floor(data / 2);
  return data & 1 ? -magnitude : magnitude;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

const MAGIC = 'BPS1';
const FOOTER_SIZE = 12; // source crc32, target crc32, patch crc32 -- 4 bytes each

// ---- decode -------------------------------------------------------------------------

export function applyBps(source: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch.length < MAGIC.length + FOOTER_SIZE) {
    throw new BpsError(`BPS patch too short: ${patch.length} bytes`);
  }

  const magic = String.fromCharCode(patch[0], patch[1], patch[2], patch[3]);
  if (magic !== MAGIC) {
    throw new BpsError(`bad BPS magic: expected "${MAGIC}", got "${magic}"`);
  }

  // Check the patch's own integrity before trusting anything it says, including the
  // sizes below -- a flipped bit anywhere should fail here, not as a weird OOB error.
  const patchCrcExpected = readU32LE(patch, patch.length - 4);
  const patchCrcActual = crc32(patch.subarray(0, patch.length - 4));
  if (patchCrcActual !== patchCrcExpected) {
    throw new BpsError(
      `patch CRC32 mismatch: expected 0x${patchCrcExpected.toString(16)}, got 0x${patchCrcActual.toString(16)} -- the patch file is corrupted`,
    );
  }

  const cursor: Cursor = { pos: MAGIC.length };
  const sourceSize = readVarint(patch, cursor);
  const targetSize = readVarint(patch, cursor);
  const metadataSize = readVarint(patch, cursor);
  cursor.pos += metadataSize; // metadata is free-form text; the shell has no use for it

  const sourceCrcExpected = readU32LE(patch, patch.length - 12);
  const sourceCrcActual = crc32(source);
  if (sourceCrcActual !== sourceCrcExpected) {
    throw new BpsError(
      `source CRC32 mismatch: expected 0x${sourceCrcExpected.toString(16)}, got 0x${sourceCrcActual.toString(16)} -- this patch is not for this ROM`,
    );
  }
  if (source.length !== sourceSize) {
    throw new BpsError(`source size mismatch: patch expects ${sourceSize} bytes, got ${source.length}`);
  }

  const target = new Uint8Array(targetSize);
  let outputOffset = 0;
  let sourceRelativeOffset = 0;
  let targetRelativeOffset = 0;

  const actionsEnd = patch.length - FOOTER_SIZE;
  while (cursor.pos < actionsEnd) {
    const data = readVarint(patch, cursor);
    const command = data & 3;
    const length = Math.floor(data / 4) + 1;

    if (outputOffset + length > targetSize) {
      throw new BpsError(`BPS action overruns target at offset ${outputOffset} (+${length} > ${targetSize})`);
    }

    switch (command) {
      case 0: {
        // SourceRead: copy `length` bytes from source at the current output offset.
        if (outputOffset + length > source.length) {
          throw new BpsError(`SourceRead at ${outputOffset} reads past the end of the source`);
        }
        target.set(source.subarray(outputOffset, outputOffset + length), outputOffset);
        outputOffset += length;
        break;
      }
      case 1: {
        // TargetRead: the next `length` bytes in the patch stream are literal output.
        if (cursor.pos + length > patch.length) {
          throw new BpsError('TargetRead runs past the end of the patch');
        }
        target.set(patch.subarray(cursor.pos, cursor.pos + length), outputOffset);
        cursor.pos += length;
        outputOffset += length;
        break;
      }
      case 2: {
        // SourceCopy: a signed offset moves a cursor into source, then `length` bytes
        // are copied from there, advancing that cursor for the next SourceCopy.
        sourceRelativeOffset += readSignedVarint(patch, cursor);
        if (sourceRelativeOffset < 0 || sourceRelativeOffset + length > source.length) {
          throw new BpsError(`SourceCopy offset ${sourceRelativeOffset} is out of range for the source`);
        }
        target.set(source.subarray(sourceRelativeOffset, sourceRelativeOffset + length), outputOffset);
        sourceRelativeOffset += length;
        outputOffset += length;
        break;
      }
      case 3: {
        // TargetCopy: same idea but the cursor moves into the *output* so far, copied
        // byte-by-byte because the read and write regions may overlap (RLE-style runs).
        targetRelativeOffset += readSignedVarint(patch, cursor);
        if (targetRelativeOffset < 0) {
          throw new BpsError(`TargetCopy offset ${targetRelativeOffset} is negative`);
        }
        for (let i = 0; i < length; i++) {
          if (targetRelativeOffset >= targetSize) {
            throw new BpsError(`TargetCopy offset ${targetRelativeOffset} is out of range for the target`);
          }
          target[outputOffset + i] = target[targetRelativeOffset++];
        }
        outputOffset += length;
        break;
      }
      default:
        // command is data & 3, so this is unreachable, but keep TypeScript honest.
        throw new BpsError(`unknown BPS command ${command}`);
    }
  }

  if (outputOffset !== targetSize) {
    throw new BpsError(`BPS patch produced ${outputOffset} bytes, expected ${targetSize}`);
  }

  const targetCrcExpected = readU32LE(patch, patch.length - 8);
  const targetCrcActual = crc32(target);
  if (targetCrcActual !== targetCrcExpected) {
    throw new BpsError(
      `target CRC32 mismatch: expected 0x${targetCrcExpected.toString(16)}, got 0x${targetCrcActual.toString(16)} -- the patch produced unexpected output`,
    );
  }

  return target;
}
