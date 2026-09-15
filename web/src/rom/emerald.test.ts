import { describe, expect, it } from 'vitest';
import { checkEmerald, EMERALD_SHA1, sha1Hex } from './emerald';

const EMERALD_SIZE = 16 * 1024 * 1024;
const GAME_CODE_OFFSET = 0xac;

/** A 16 MiB buffer with a real, correct game code but arbitrary content -- big enough
 * to exercise the actual sha1 pipeline (per the ticket: "sha1 of a 16 MiB buffer is
 * fine to compute in a test") while still being nothing like the real ROM. */
function fakeEmeraldSizedRom(): Uint8Array {
  const bytes = new Uint8Array(EMERALD_SIZE);
  const code = 'BPEE';
  for (let i = 0; i < code.length; i++) bytes[GAME_CODE_OFFSET + i] = code.charCodeAt(i);
  return bytes;
}

describe('checkEmerald', () => {
  it('rejects the wrong size before touching sha1', async () => {
    const result = await checkEmerald(new Uint8Array(1024));
    expect(result.ok).toBe(false);
    expect(result.sha1).toBe('');
    expect(result.reason).toMatch(/wrong size/);
  });

  it('rejects a right-sized file with the wrong game code', async () => {
    const bytes = new Uint8Array(EMERALD_SIZE); // zero-filled: game code is "\0\0\0\0"
    const result = await checkEmerald(bytes);
    expect(result.ok).toBe(false);
    expect(result.sha1).toBe('');
    expect(result.reason).toMatch(/wrong game code/);
  });

  it('rejects a right-sized, right-game-code file whose checksum does not match, and still reports its sha1', async () => {
    const bytes = fakeEmeraldSizedRom();
    const expectedSha1 = await sha1Hex(bytes);
    expect(expectedSha1).not.toBe(EMERALD_SHA1);

    const result = await checkEmerald(bytes);
    expect(result.ok).toBe(false);
    expect(result.sha1).toBe(expectedSha1);
    expect(result.reason).toMatch(/checksum/);
  });
});
