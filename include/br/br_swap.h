#ifndef GUARD_BR_SWAP_H
#define GUARD_BR_SWAP_H

// A drop's screen (Cam, 2026-10-27: "It almost looked like one of those inventory screens
// in a game like Skyrim where you could see your inventory on the left, and the lootable
// one on the right and transfer between em"). The TRADE menu's own look, offline: our
// party on the left, the drop on the right, A moves the mon under the cursor across, and
// with our party full, A on a drop's mon then A on one of ours swaps the two. B is done.
//
// The drop's side is the PC's first box, slots 0..5, which br_loot.c filled and settles
// once the field is back (SettleBoxes): what this screen changes is only who is where.
// Nothing is held anywhere but the party and the box, so a battle that starts from here
// loses nothing.
void CB2_BrSwap(void);

#endif // GUARD_BR_SWAP_H
