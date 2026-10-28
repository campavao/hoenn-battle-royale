// Bots all over Hoenn, so a spectator sees the whole map playing out. A bot wanders the
// way Emerald's own townsfolk do (MovementType_WanderAround, event_object_movement.c):
// stand a while (sMovementDelaysMedium: 32, 64, 96 or 128 frames), pick a direction, and
// walk one tile that way at walking pace; a way that is shut, or a ledge, it only faces.
// The facing and the shut way are the Room's (Room.move), so every copy of the room
// agrees; the host only picks when and where, and everybody else just gets its keys.

import { decodeGrid, type Spot, type WorldMap } from '../../src/bots/world';
import { KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, type Actor, type Room } from './room';

// The wardrobe (br_ghosts.c sSkinGraphics, career.ts SKINS): a bot wears a skin so the
// trainer you walk up to is the trainer the ROM puts in the battle.
export const SKIN_GFX = [0, 89, 100, 105, 55, 45, 31, 32, 42, 43, 21, 22, 25, 18, 35, 47];
export const SKIN_NAME = ['BRENDAN', 'MAY', 'BRENDAN', 'MAY', 'HIKER', 'BEAUTY', 'CAMPER', 'PICNIC', 'SWIMMER', 'SWIMMER', 'EXPERT', 'EXPERT', 'POKEFAN', 'POKEFAN', 'JOEY', 'LASS'];
export const botSkin = (n: number) => 4 + (n % 12);

/** `wait`: frames left to stand; `dir`: the way it went last. */
export interface Brain { rng: number; wait: number; dir: number }

// B held: a match runs unless B is held (br_boot.c / field_player_avatar.c), and a
// townsperson walks.
const KEY_OF: Record<number, number> = { 1: KEY_DOWN | KEY_B, 2: KEY_UP | KEY_B, 3: KEY_LEFT | KEY_B, 4: KEY_RIGHT | KEY_B };

function rand(b: Brain): number {
  let x = b.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  b.rng = x >>> 0;
  return b.rng / 4294967296;
}

const DELAYS = [32, 64, 96, 128];

export function botKeys(_room: Room, a: Actor, b: Brain): number {
  // One frame of the key is one tile (or one turn to face a shut way): then let go.
  if (a.m.action) return 0;
  if (b.wait > 0) { b.wait -= 1; return 0; }
  b.dir = 1 + Math.floor(rand(b) * 4);
  b.wait = DELAYS[Math.floor(rand(b) * DELAYS.length)];
  return KEY_OF[b.dir];
}

/** `count` bots on open ground or grass across the room's maps, and three in Littleroot
 *  to walk up to and battle. */
export function botSpawns(room: Room, maps: readonly WorldMap[], count: number): { name: string; skin: number; spot: Spot; facing: number; brain: Brain }[] {
  let rng = 0x9e3779b9 ^ room.seed;
  const r = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const land = maps.filter((m) => room.maps.has(m.id) && !m.id.includes('SAFARI') && !m.id.includes('FRONTIER') && !m.id.includes('PROTOTYPE'));
  const grids = new Map(land.map((m) => [m.id, decodeGrid(m.grid, m.w * m.h)]));
  const out: { name: string; skin: number; spot: Spot; facing: number; brain: Brain }[] = [];
  const taken = new Set<string>();
  const add = (spot: Spot, facing: number, skin: number) => {
    taken.add(`${spot.map}:${spot.x}:${spot.y}`);
    const n = out.length + 1;
    out.push({ name: SKIN_NAME[skin], skin, spot, facing, brain: { rng: (n * 2654435761) >>> 0 || 1, wait: Math.floor(r() * 60), dir: 1 } });
  };
  for (const [x, y] of [[7, 12], [13, 13], [11, 16]]) add({ map: 'MAP_LITTLEROOT_TOWN', x, y }, 1, botSkin(out.length * 7 + 1));
  for (let tries = 0; out.length < count && tries < 50000; tries++) {
    const m = land[Math.floor(r() * land.length)];
    const x = Math.floor(r() * m.w), y = Math.floor(r() * m.h);
    const c = grids.get(m.id)![y * m.w + x];
    if ((c !== 0 && c !== 7) || taken.has(`${m.id}:${x}:${y}`)) continue;
    // Not on the new trainers' corner of Littleroot.
    if (m.id === 'MAP_LITTLEROOT_TOWN' && x >= 7 && x <= 13 && y >= 9 && y <= 13) continue;
    add({ map: m.id, x, y }, 1 + Math.floor(r() * 4), botSkin(Math.floor(r() * 12)));
  }
  return out;
}
