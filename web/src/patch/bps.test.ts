import { describe, expect, it } from 'vitest';
import { applyBps, BpsError, crc32 } from './bps';
import { encodeBps } from './bps.testutil';

// Small deterministic PRNG (mulberry32) so "random" fixtures are reproducible.
function makeRng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(rng: () => number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(rng() * 256);
  return bytes;
}

/** target = source with a handful of random edits, so SourceRead/TargetRead both fire. */
function mutate(rng: () => number, source: Uint8Array, edits: number): Uint8Array {
  const target = Uint8Array.from(source);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(rng() * target.length);
    target[at] = Math.floor(rng() * 256);
  }
  return target;
}

describe('applyBps', () => {
  it('round-trips random inputs of varying sizes and edit patterns', () => {
    const rng = makeRng(1);
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [10, 0],
      [10, 40],
      [500, 30],
      [777, 10],
    ];
    for (const [size, edits] of cases) {
      const source = randomBytes(rng, size);
      const target = mutate(rng, source, edits);
      const patch = encodeBps(source, target);
      expect(applyBps(source, patch)).toEqual(target);
    }
  });

  it('round-trips a target unrelated in size and content to the source', () => {
    const rng = makeRng(2);
    const source = randomBytes(rng, 300);
    const target = randomBytes(rng, 900);
    const patch = encodeBps(source, target);
    expect(applyBps(source, patch)).toEqual(target);
  });

  it('rejects a wrong source', () => {
    const rng = makeRng(3);
    const source = randomBytes(rng, 200);
    const target = mutate(rng, source, 20);
    const patch = encodeBps(source, target);

    const wrongSource = randomBytes(makeRng(99), 200);
    expect(() => applyBps(wrongSource, patch)).toThrow(BpsError);
    expect(() => applyBps(wrongSource, patch)).toThrow(/source CRC32 mismatch/);
  });

  it('rejects a corrupted patch', () => {
    const rng = makeRng(4);
    const source = randomBytes(rng, 200);
    const target = mutate(rng, source, 20);
    const patch = encodeBps(source, target);

    const corrupted = Uint8Array.from(patch);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    expect(() => applyBps(source, corrupted)).toThrow(BpsError);
    expect(() => applyBps(source, corrupted)).toThrow(/patch CRC32 mismatch/);
  });

  it('rejects bad magic', () => {
    const rng = makeRng(5);
    const source = randomBytes(rng, 50);
    const target = mutate(rng, source, 5);
    const patch = encodeBps(source, target);

    const badMagic = Uint8Array.from(patch);
    badMagic[0] = 0x00;
    expect(() => applyBps(source, badMagic)).toThrow(BpsError);
    expect(() => applyBps(source, badMagic)).toThrow(/bad BPS magic/);
  });

  it('rejects a patch too short to even hold a footer', () => {
    expect(() => applyBps(new Uint8Array(0), new Uint8Array([0x42, 0x50, 0x53, 0x31]))).toThrow(BpsError);
  });

  it('applies a hand-built patch using SourceCopy and an overlapping TargetCopy', () => {
    // source = "ABCDEFGHIJ" (10 bytes).
    const source = Uint8Array.from('ABCDEFGHIJ'.split('').map((c) => c.charCodeAt(0)));

    // target = "FGHIJ" + "FGHIJ" + "XXXXXX" (16 bytes):
    //   - two SourceCopy actions both pointing at source[5..10) ("FGHIJ"), proving the
    //     relative offset can move forward then jump back to re-read the same span;
    //   - a 1-byte TargetRead of "X" followed by a 5-byte TargetCopy at offset -1, which
    //     must copy byte-by-byte since it reads positions it is still writing (overlap).
    const target = Uint8Array.from('FGHIJFGHIJXXXXXX'.split('').map((c) => c.charCodeAt(0)));

    const body: number[] = [];
    body.push(0x42, 0x50, 0x53, 0x31); // "BPS1"
    body.push(0x8a); // varint(10) = source size
    body.push(0x90); // varint(16) = target size
    body.push(0x80); // varint(0) = metadata size

    // Action 1: SourceCopy, length 5, offset +5 (0 -> 5).
    body.push(0x92); // data = (5-1)*4 + 2 = 18 -> varint(18) = 18|0x80
    body.push(0x8a); // signed varint(+5) = (5*2+0)|0x80 = 10|0x80

    // Action 2: SourceCopy, length 5, offset -5 (10 -> 5).
    body.push(0x92); // varint(18) again
    body.push(0x8b); // signed varint(-5) = (5*2+1)|0x80 = 11|0x80

    // Action 3: TargetRead, length 1, literal "X".
    body.push(0x81); // data = (1-1)*4 + 1 = 1 -> varint(1)
    body.push('X'.charCodeAt(0));

    // Action 4: TargetCopy, length 5, offset +10 (0 -> 10, i.e. the "X" just written).
    body.push(0x93); // data = (5-1)*4 + 3 = 19 -> varint(19)
    body.push(0x94); // signed varint(+10) = (10*2+0)|0x80 = 20|0x80

    const sourceCrc = crc32(source);
    const targetCrc = crc32(target);
    const pushU32LE = (out: number[], value: number) => out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    pushU32LE(body, sourceCrc);
    pushU32LE(body, targetCrc);
    const patchCrc = crc32(Uint8Array.from(body));
    pushU32LE(body, patchCrc);

    const patch = Uint8Array.from(body);
    expect(applyBps(source, patch)).toEqual(target);
  });
});
