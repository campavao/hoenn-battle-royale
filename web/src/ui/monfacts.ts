// What the cartridge says of a species, for the page's own windows: its types, base stats and
// abilities (gSpeciesInfo), an ability's words, a nature's name, and which moves it could learn
// again at a level (gLevelUpLearnsets, the rule of pokemon.c's GetMoveRelearnerMoves).
import { text, type Rom } from '../battle/movebook';

const ROM_BASE = 0x08000000;
/** struct SpeciesInfo: six base stats in the game's order, then the types; abilities at 0x16. */
const SPECIES_INFO = 0x1c;
const INFO_TYPES = 6;
const INFO_ABILITIES = 0x16;
const ABILITY_NAME = 13;
/** gLevelUpLearnsets' words: the move in the low 9 bits, the level over them. */
const LEARN_END = 0xffff;
const LEARN_MOVE = 0x1ff;
const LEARN_LEVEL_SHIFT = 9;
const MAX_LEVEL_UP_MOVES = 20;

export interface BaseStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
}

export interface SpeciesFacts {
  types: [number, number];
  base: BaseStats;
  /** Its abilities' ids: the second is 0 for a species with one. */
  abilities: [number, number];
}

function u8(rom: Rom, addr: number): number {
  return rom.bytes[addr - ROM_BASE] ?? 0;
}
function u16(rom: Rom, addr: number): number {
  return u8(rom, addr) | (u8(rom, addr + 1) << 8);
}
function u32(rom: Rom, addr: number): number {
  return (u16(rom, addr) | (u16(rom, addr + 2) << 16)) >>> 0;
}

export function speciesFacts(rom: Rom, species: number): SpeciesFacts | null {
  const info = rom.sym('gSpeciesInfo');
  if (info === undefined || species <= 0) return null;
  const at = info + species * SPECIES_INFO;
  return {
    types: [u8(rom, at + INFO_TYPES), u8(rom, at + INFO_TYPES + 1)],
    base: { hp: u8(rom, at), attack: u8(rom, at + 1), defense: u8(rom, at + 2), speed: u8(rom, at + 3), spAttack: u8(rom, at + 4), spDefense: u8(rom, at + 5) },
    abilities: [u8(rom, at + INFO_ABILITIES), u8(rom, at + INFO_ABILITIES + 1)],
  };
}

export function abilityName(rom: Rom, id: number): string {
  const names = rom.sym('gAbilityNames');
  return names === undefined || !id ? '' : text(rom, names + id * ABILITY_NAME, ABILITY_NAME);
}

export function abilityDesc(rom: Rom, id: number): string {
  const table = rom.sym('gAbilityDescriptionPointers');
  if (table === undefined || !id) return '';
  const at = u32(rom, table + id * 4);
  return at >= ROM_BASE ? text(rom, at, 60) : '';
}

/** A nature's name; the party's is its personality mod 25 (pokemon.c GetNatureFromPersonality). */
export function natureName(rom: Rom, nature: number): string {
  const table = rom.sym('gNatureNamePointers');
  if (table === undefined) return '';
  const at = u32(rom, table + nature * 4);
  return at >= ROM_BASE ? text(rom, at, 12) : '';
}

/** What it could learn again at `level`: its learnset up to there, in the set's order, less what
 *  it knows and any repeat (pokemon.c GetMoveRelearnerMoves). */
export function relearnable(rom: Rom, species: number, level: number, known: readonly number[]): number[] {
  const sets = rom.sym('gLevelUpLearnsets');
  if (sets === undefined || species <= 0) return [];
  const at = u32(rom, sets + species * 4);
  if (at < ROM_BASE) return [];
  const out: number[] = [];
  for (let i = 0; i < MAX_LEVEL_UP_MOVES; i++) {
    const w = u16(rom, at + i * 2);
    if (w === LEARN_END) break;
    const move = w & LEARN_MOVE;
    if (w >> LEARN_LEVEL_SHIFT <= level && !known.includes(move) && !out.includes(move)) out.push(move);
  }
  return out;
}

/** Whether its learnset teaches `move` at or under `level` (br_moves.c's LearnsByNow): a move that
 *  is not came off a machine, and a machine forgotten goes back in the bag. */
export function learnsByNow(rom: Rom, species: number, level: number, move: number): boolean {
  const sets = rom.sym('gLevelUpLearnsets');
  if (sets === undefined || species <= 0) return false;
  const at = u32(rom, sets + species * 4);
  if (at < ROM_BASE) return false;
  for (let i = 0; ; i++) {
    const w = u16(rom, at + i * 2);
    if (w === LEARN_END) return false;
    if ((w & LEARN_MOVE) === move && w >> LEARN_LEVEL_SHIFT <= level) return true;
  }
}

/** struct Pokemon's status word as the screens write it; empty for none. A sleep is its low three
 *  bits, then poison, burn, freeze, paralysis, bad poison (include/constants/battle.h). */
export function statusWord(hp: number, status: number): string {
  if (hp === 0) return 'FNT';
  if (status & 7) return 'SLP';
  if (status & (1 << 3) || status & (1 << 7)) return 'PSN';
  if (status & (1 << 4)) return 'BRN';
  if (status & (1 << 5)) return 'FRZ';
  if (status & (1 << 6)) return 'PAR';
  return '';
}
