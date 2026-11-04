// Who stands in which slot of the ROM's party screen, in a battle. The screen shows the battle's
// order, the one out first; gPlayerParty stays in the field's, but while that screen is up
// (party_menu.c UpdatePartyToBattleOrder).
//
// gBattlePartyCurrentOrder is not that order, except while the screen is up. PlayerHandleChooseItem
// and PlayerHandleChoosePokemon load it from gBattleStruct->battlerPartyOrders as they open, and
// between them it is whatever SwitchPartyOrder last left there: the switch of either side's, so the
// foe's after the foe sends out its next. Read at the moves it put the wrong mon on a row, and the
// row's slot then went to the ROM, whose order was right (Cam, 11-04: MAX REVIVE on ALAKAZAM revived
// AZUMARILL).
//
// A link battle's slave runs no battle engine, so its battlerPartyOrders stay as the battle began.
// There the current order is the true one instead: only its own party menu and the master's word as
// that menu opens write it.
import { localBattler } from '../src/touch';

/** struct BattleStruct's battlerPartyOrders (include/battle.h): 3 bytes a battler. */
export const BATTLE_STRUCT_PARTY_ORDERS = 96;
const ORDER_BYTES = 3;
const BATTLE_TYPE_LINK = 1 << 1;
const BATTLE_TYPE_IS_MASTER = 1 << 2;

export interface OrderRead {
  read(addr: number, bits: 8 | 16 | 32): number;
}

/** Six slots of the party screen, each the index in gPlayerParty's field order of the mon on it
 *  (party_menu.c GetPartyIdFromBattleSlot's packing). In order, off a battle. */
export function battleOrder(emu: OrderRead, sym: (name: string) => number | undefined): number[] {
  const flagsAt = sym('gBattleTypeFlags');
  const flags = flagsAt === undefined ? 0 : emu.read(flagsAt, 32);
  let at: number | undefined;
  if ((flags & BATTLE_TYPE_LINK) && !(flags & BATTLE_TYPE_IS_MASTER)) at = sym('gBattlePartyCurrentOrder');
  else {
    const ptr = sym('gBattleStruct');
    const struct = ptr === undefined ? 0 : emu.read(ptr, 32);
    if (struct) at = struct + BATTLE_STRUCT_PARTY_ORDERS + localBattler(emu, sym('gBattlerPositions')) * ORDER_BYTES;
  }
  if (at === undefined) return [0, 1, 2, 3, 4, 5];
  const out: number[] = [];
  for (let slot = 0; slot < 6; slot++) {
    const b = emu.read(at + (slot >> 1), 8);
    out.push(slot & 1 ? b & 0xf : b >> 4);
  }
  return out;
}

/** My mon out now: its index in gPlayerParty's field order. */
export function leadIndex(emu: OrderRead, sym: (name: string) => number | undefined): number {
  const out = sym('gBattlerPartyIndexes');
  return out === undefined ? 0 : emu.read(out + 2 * localBattler(emu, sym('gBattlerPositions')), 16);
}
