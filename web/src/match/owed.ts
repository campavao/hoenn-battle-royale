// The team a winner owes the ground (POK-387).
//
// A link fight's loser does not drop its team: the winner's ROM does, round its own feet,
// and asks which one to take (br_loot.c's spoils). The loser's ROM drops only the bag
// (BrLoot_TeamTaken). The winner's ROM puts the team down once it is back on the field,
// a second or two after the fight -- and a winner whose tab closed in that second never
// did, so the beaten team left the match with nobody.
//
// So the loser's page keeps count. Its own ROM losing a link fight and then dropping a bag
// with no team is a team owed by whoever it was fighting. Any spill that puts down a ball
// under our keys pays it. If the winner goes out of the match while not in the room -- the
// host's word that a seat which left is gone (POK-271) -- the debt is ours to settle, and
// this says so once. A winner still in the room is still running its ROM, which drops the
// team itself whatever happens to it next.
import { pageCell, romCell, toPage, toRom } from '../bots/space';
import type { World } from '../bots/world';
import type { MapRef, Msg, SpillMsg } from '../net/wire';
import { spillCells, type Loot } from './loot';

/** A loser's keys: its seat in the high byte, a party slot in the low (br_loot.c's
 *  BR_LOOT_KEY_OWN). The bag's is 0xFF. */
export const isTeamKey = (key: number, seat: number): boolean => key >> 8 === seat && (key & 0xff) < 6;

export interface OwedDeps {
  mySeat(): number | null;
  /** Who our ROM's link fight is with (Bridge.opponent): the winner, when it lost. */
  opponent(): number | null;
  /** The seat is in the relay's room now. */
  inRoom(seat: number): boolean;
}

export class OwedTeam {
  /** Our ROM said it lost a link fight to this seat, and has not dropped since. */
  private lostTo: number | null = null;
  /** Our ROM's drop left the team out for this seat to put down. */
  private owedBy: number | null = null;
  /** Our team is on the ground, by anybody's hand: nothing is owed for the rest of the
   *  match. A loss is the end of a trainer, so this happens once. */
  private placed = false;

  constructor(private readonly deps: OwedDeps) {}

  /** Every message the page books, with whether our own ROM said it. Answers the seat
   *  whose debt is ours to settle now, at most once a match. */
  note(msg: Msg, fromRom: boolean): number | null {
    const me = this.deps.mySeat();
    if (me === null) return null;
    if (msg.t === 'start') {
      this.lostTo = this.owedBy = null;
      this.placed = false;
      return null;
    }
    if (this.placed) return null;
    if (fromRom && msg.t === 'result' && msg.seat === me && msg.outcome === 'lose') {
      this.lostTo = this.deps.opponent();
      return null;
    }
    if (msg.t === 'spill') {
      if (msg.mons.some((m) => isTeamKey(m.key, me))) {
        this.placed = true;
        this.owedBy = null;
      } else if (fromRom && msg.seat === me && this.lostTo !== null) {
        // The whiteout's drop (BrMatch_Out): the bag, and the team left to the winner. A
        // TM put back on the ground is a bag of ours too, and is not this.
        this.owedBy = this.lostTo;
        this.lostTo = null;
      }
      return null;
    }
    if (msg.t === 'out' && this.owedBy !== null && msg.seat === this.owedBy && !this.deps.inRoom(msg.seat)) {
      const winner = this.owedBy;
      this.owedBy = null;
      this.placed = true;
      return winner;
    }
    return null;
  }
}

/** `struct Pokemon` (include/pokemon.h): 100 bytes, the level unencrypted at 0x54. */
export const MON_SIZE = 100;
const MON_LEVEL = 0x54;
const BOX_PERSONALITY = 0x00;
const BOX_OT_ID = 0x04;
const BOX_SECURE = 0x20;
/** Where the Growth substruct (which starts with the species) sits among the four
 *  12-byte ones, by personality % 24: GetSubstruct's SUBSTRUCT_CASE table, first column. */
const GROWTH_AT = [0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3, 1, 1, 2, 3, 2, 3];

/** gPlayerParty's first `count` mons as their species and level: what a spill carries.
 *  The species is in the encrypted part, XORed word by word with personality ^ otId. */
export function readTeam(party: Uint8Array, count: number): { species: number; level: number }[] {
  const view = new DataView(party.buffer, party.byteOffset, party.byteLength);
  const out: { species: number; level: number }[] = [];
  for (let i = 0; i < Math.min(count, 6) && (i + 1) * MON_SIZE <= party.byteLength; i++) {
    const at = i * MON_SIZE;
    const personality = view.getUint32(at + BOX_PERSONALITY, true);
    const key = (personality ^ view.getUint32(at + BOX_OT_ID, true)) >>> 0;
    const growth = GROWTH_AT[personality % 24];
    const species = ((view.getUint32(at + BOX_SECURE + growth * 12, true) ^ key) >>> 0) & 0xffff;
    if (species === 0) break;
    out.push({ species, level: party[at + MON_LEVEL] });
  }
  return out;
}

/** Our team as the spill the winner would have sent: our keys, round where we stand, off
 *  any cell a piece already lies on (our bag among them) -- the ring the ROM's own spill
 *  walks. Null with nothing to drop, or a map the world does not have. */
export function teamSpill(
  me: number,
  team: { species: number; level: number }[],
  at: { map: MapRef; x: number; y: number },
  world: World,
  mapId: string | undefined,
  loot: Loot,
): SpillMsg | null {
  if (team.length === 0 || mapId === undefined) return null;
  const from = toPage(romCell(at.x, at.y));
  const taken = (x: number, y: number) => loot.at(at.map, toRom(pageCell(x, y))) !== undefined;
  const cells = spillCells(world, mapId, from.x, from.y, team.length, taken);
  return {
    t: 'spill',
    seat: me,
    map: at.map,
    mons: cells.map((cell, i) => {
      const rom = toRom(pageCell(cell.x, cell.y));
      return { key: (me << 8) | i, x: rom.x, y: rom.y, species: team[i].species, level: team[i].level };
    }),
  };
}
