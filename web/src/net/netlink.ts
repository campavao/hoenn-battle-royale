// gBrNetlink (include/br/br_netlink.h): the ROM's own word on the link battle it is in.
//
// The Bridge routes a fight's blocks by the challenge it last heard, which is a guess at
// what the ROM did with it: br_netlink.c's HandleChallenge ignores every challenge while a
// link is open, and a ROM on the field starts on the first of two that land together.
// The struct says which it took, from the frame it took it (POK-331 #5). netlink.test.ts
// holds these numbers to the C.
import type { RamAccess } from './mailbox';

export const NETLINK = {
  OFF_ACTIVE: 0,
  OFF_PEER_SEAT: 2,
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

