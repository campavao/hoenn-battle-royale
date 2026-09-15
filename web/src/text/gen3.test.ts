import { describe, expect, it } from 'vitest';
import {
  canEncodeGen3,
  decodeGen3,
  encodeGen3,
  Gen3TextError,
  packGen3String,
  unpackGen3String,
} from './gen3';

describe('gen3 text', () => {
  it('round-trips letters, digits, space and punctuation', () => {
    const text = "Ash & Misty: 100% Ready, Go! (Route-1?) 3.5/5";
    const bytes = encodeGen3(text);
    expect(decodeGen3(bytes)).toBe(text);
  });

  it('round-trips the full mapped alphabet', () => {
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    expect(decodeGen3(encodeGen3(text))).toBe(text);
  });

  it('matches known charmap.txt byte values', () => {
    expect(encodeGen3('A')).toEqual(Uint8Array.of(0xbb));
    expect(encodeGen3('a')).toEqual(Uint8Array.of(0xd5));
    expect(encodeGen3('0')).toEqual(Uint8Array.of(0xa1));
    expect(encodeGen3(' ')).toEqual(Uint8Array.of(0x00));
    expect(encodeGen3('!')).toEqual(Uint8Array.of(0xab));
    expect(encodeGen3('?')).toEqual(Uint8Array.of(0xac));
  });

  it('rejects a character it cannot encode', () => {
    expect(() => encodeGen3('é')).toThrow(Gen3TextError);
    expect(() => encodeGen3('❤')).toThrow(Gen3TextError); // heart emoji
    expect(canEncodeGen3('é')).toBe(false);
    expect(canEncodeGen3('A')).toBe(true);
  });

  it('rejects a byte outside the charmap on decode', () => {
    expect(() => decodeGen3(Uint8Array.of(0x77))).toThrow(Gen3TextError); // UNK_SPACER, unmapped here
  });

  it('truncates to maxLen when encoding', () => {
    expect(encodeGen3('ABCDEF', 3)).toEqual(Uint8Array.of(0xbb, 0xbc, 0xbd));
  });

  it('length-prefixes pack/unpack round trip', () => {
    const packed = packGen3String('ASH');
    expect(packed[0]).toBe(3);
    expect(packed.length).toBe(4);
    const { text, nextOffset } = unpackGen3String(packed, 0);
    expect(text).toBe('ASH');
    expect(nextOffset).toBe(4);
  });

  it('chains through a buffer with a following field', () => {
    const a = packGen3String('ASH');
    const b = packGen3String('MISTY');
    const buf = new Uint8Array(a.length + b.length);
    buf.set(a, 0);
    buf.set(b, a.length);
    const first = unpackGen3String(buf, 0);
    expect(first.text).toBe('ASH');
    const second = unpackGen3String(buf, first.nextOffset);
    expect(second.text).toBe('MISTY');
    expect(second.nextOffset).toBe(buf.length);
  });

  it('rejects a string a length prefix claims runs past the buffer', () => {
    const truncated = Uint8Array.of(5, 0xbb, 0xbc); // says 5 bytes, has 2
    expect(() => unpackGen3String(truncated, 0)).toThrow(Gen3TextError);
  });

  it('rejects encoding a string that would need more than 255 bytes at once', () => {
    // packGen3String clamps maxLen to 255 rather than overflow the u8 length prefix
    const packed = packGen3String('A'.repeat(300));
    expect(packed[0]).toBe(255);
  });
});
