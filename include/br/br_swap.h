#ifndef GUARD_BR_SWAP_H
#define GUARD_BR_SWAP_H

// A drop's screen (Cam, 2026-10-27: "It almost looked like one of those inventory screens
// in a game like Skyrim where you could see your inventory on the left, and the lootable
// one on the right and transfer between em"). The TRADE menu's own look, offline: our
// party on the left, the drop on the right titled BAG. A picks mons on either side, and
// START (or A on the MOVE button) moves every picked one across at once, so a full party
// trades one for one with no question asked. No levels. B lets go of the picks, then
// closes the screen.
//
// The drop's side is the PC's first box, slots 0..5, which br_loot.c filled and settles
// once the field is back (SettleBoxes): what this screen changes is only who is where.
// Nothing is held anywhere but the party and the box, so a battle that starts from here
// loses nothing.
void CB2_BrSwap(void);
// The screen is up now (br_netlink.c settles it before a battle starts from it).
bool8 BrSwap_Up(void);
// The heap is the next battle's (BrHeapReset): a battle from the screen leaves it.
void BrSwap_HeapReset(void);
// The box was settled under the screen: no more moves, B still closes it.
void BrSwap_Settled(void);

#endif // GUARD_BR_SWAP_H
