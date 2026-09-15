// Verifies an imported file is the exact ROM our patch was built against (POK-213).
// Three checks, cheapest first, so a wrong file fails fast instead of hashing 16 MiB
// for nothing: size, then the cartridge's own game code, then the full sha1.

export const EMERALD_SHA1 = 'f3ae088181bf583e55daf962a92bb46f4f1d07b7';

const EMERALD_SIZE = 16 * 1024 * 1024; // 16 MiB, exactly -- no trimmed/padded dumps
const GAME_CODE_OFFSET = 0xac; // cartridge header, GBA-standard for every commercial ROM
const EMERALD_GAME_CODE = 'BPEE'; // Pokemon Emerald, all regions share this code

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface EmeraldCheck {
  ok: boolean;
  sha1: string;
  reason?: string;
}

function readGameCode(bytes: Uint8Array): string {
  return String.fromCharCode(
    bytes[GAME_CODE_OFFSET],
    bytes[GAME_CODE_OFFSET + 1],
    bytes[GAME_CODE_OFFSET + 2],
    bytes[GAME_CODE_OFFSET + 3],
  );
}

/** Checks a file the player picked against the Pokemon Emerald (U) baseline the
 * shipped patch was diffed from. `sha1` is always populated when it was computed,
 * even on a mismatch, so a caller can log or display it. */
export async function checkEmerald(bytes: Uint8Array): Promise<EmeraldCheck> {
  if (bytes.length !== EMERALD_SIZE) {
    return {
      ok: false,
      sha1: '',
      reason: `wrong size: ${bytes.length.toLocaleString()} bytes, expected ${EMERALD_SIZE.toLocaleString()} (16 MiB)`,
    };
  }

  const gameCode = readGameCode(bytes);
  if (gameCode !== EMERALD_GAME_CODE) {
    return {
      ok: false,
      sha1: '',
      reason: `wrong game code "${gameCode}", expected "${EMERALD_GAME_CODE}" (Pokemon Emerald)`,
    };
  }

  const sha1 = await sha1Hex(bytes);
  if (sha1 !== EMERALD_SHA1) {
    return {
      ok: false,
      sha1,
      reason: 'checksum does not match the Pokemon Emerald (U) baseline this patch was built for',
    };
  }

  return { ok: true, sha1 };
}
