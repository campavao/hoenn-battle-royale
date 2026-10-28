// Bots all over Hoenn, so a spectator sees the whole map playing out. A bot's thumb on
// the pad: wander a few tiles, stop, look around. Its keys go through the same Room as
// everybody's, so it turns, runs and bumps by the ROM's rules. Only the host thinks for
// a bot; everybody else just gets its keys.

import { decodeGrid, type Spot, type WorldMap } from '../../src/bots/world';
import { KEY_B, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, type Actor, type Room } from './room';

// The wardrobe (br_ghosts.c sSkinGraphics, career.ts SKINS): a bot wears a skin so the
// trainer you walk up to is the trainer the ROM puts in the battle.
export const SKIN_GFX = [0, 89, 100, 105, 55, 45, 31, 32, 42, 43, 21, 22, 25, 18, 35, 47];
export const SKIN_NAME = ['BRENDAN', 'MAY', 'BRENDAN', 'MAY', 'HIKER', 'BEAUTY', 'CAMPER', 'PICNIC', 'SWIMMER', 'SWIMMER', 'EXPERT', 'EXPERT', 'POKEFAN', 'POKEFAN', 'JOEY', 'LASS'];
export const botSkin = (n: number) => 4 + (n % 12);

export interface Brain { rng: number; wait: number; dir: number; left: number; walk: boolean }

const KEY_OF: Record<number, number> = { 1: KEY_DOWN, 2: KEY_UP, 3: KEY_LEFT, 4: KEY_RIGHT };

function rand(b: Brain): number {
  let x = b.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  b.rng = x >>> 0;
  return b.rng / 4294967296;
}

export function botKeys(room: Room, a: Actor, b: Brain): number {
  if (a.m.action) return b.left > 0 ? KEY_OF[b.dir] | (b.walk ? KEY_B : 0) : 0;
  if (b.wait > 0) { b.wait -= 1; return 0; }
  if (b.left <= 0) {
    b.dir = 1 + Math.floor(rand(b) * 4);
    b.left = 1 + Math.floor(rand(b) * 6);
    b.walk = rand(b) < 0.4;
  }
  if (!room.stepFor(a)(a.m.spot, b.dir)) { b.left = 0; b.wait = 10 + Math.floor(rand(b) * 30); return 0; }
  b.left -= 1;
  if (b.left === 0) b.wait = Math.floor(rand(b) * 90);
  return KEY_OF[b.dir] | (b.walk ? KEY_B : 0);
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
    out.push({ name: SKIN_NAME[skin], skin, spot, facing, brain: { rng: (n * 2654435761) >>> 0 || 1, wait: Math.floor(r() * 60), dir: 1, left: 0, walk: false } });
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
