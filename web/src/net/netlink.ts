// gBrNetlink (include/br/br_netlink.h): the ROM's own word on the link battle it is in.
//
// The Bridge routes a fight's blocks by the challenge it last heard, which is a guess at
// what the ROM did with it: br_netlink.c's HandleChallenge ignores every challenge while a
// link is open, and a ROM on the field starts on the first of two that land together.
// The struct says which it took, from the frame it took it (POK-331 #5).
//
// It is also how the page ends a link battle that has gone quiet for good (POK-331 #3):
// not with a message of its own, but by handing the ROM's own hello watchdog the state it
// closes a fight in -- nothing heard, and silent long enough -- so the fight ends the way
// every other one the ROM gives up on does: B_OUTCOME_FORFEITED, the peer's ghost on
// BrEngage_NoAnswer's cooldown, the battle unwound through CB2_BrReturnFromBattle and its
// RESULT. netlink.test.ts holds these numbers, and that watchdog, to the C.
import type { RamAccess } from './mailbox';

export const NETLINK = {
  OFF_ACTIVE: 0,
  OFF_PEER_SEAT: 2,
  OFF_BLOCKS_RECV: 14,
  OFF_SILENT: 18,
  /** br_netlink.c's BR_NETLINK_HELLO: frames silent before the watchdog closes a link. */
  HELLO_FRAMES: 10 * 60,
} as const;

export interface LinkState {
  active: boolean;
  /** The seat the ROM is linked with; meaningless unless `active`. */
  peerSeat: number;
}

/** Reads the struct fresh: the Emulator remakes its RAM views every frame. */
export function readNetlink(ram: RamAccess, base: number): LinkState {
  return {
    active: ram.read(base + NETLINK.OFF_ACTIVE, 8) !== 0,
    peerSeat: ram.read(base + NETLINK.OFF_PEER_SEAT, 8),
  };
}

/** Has the ROM's next frame close its link as unanswered (TickWatchdog). A block that
 *  lands first puts blocksRecv back above zero, and the watchdog stands down again. */
export function closeAsSilent(ram: RamAccess, base: number): void {
  ram.write(base + NETLINK.OFF_BLOCKS_RECV, 0, 16);
  ram.write(base + NETLINK.OFF_SILENT, NETLINK.HELLO_FRAMES, 16);
}
