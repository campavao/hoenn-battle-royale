// The move each machine teaches, TM01..TM50 then HM01..HM08 (include/constants/tms_hms.h's
// FOREACH_TMHM, party_menu.c's sTMHMMoves). Classic names a machine by its move in a match
// (item.c GetItemName, br_moves.c SayKept: "THUNDERBOLT went in the BAG."); tmhm.test.ts
// reads the header and pins this.
export const TMHM_MOVES: readonly number[] = [
  264, 337, 352, 347, 46, 92, 258, 339, 331, 237,
  241, 269, 58, 59, 63, 113, 182, 240, 202, 219,
  218, 76, 231, 85, 87, 89, 216, 91, 94, 247,
  280, 104, 115, 351, 53, 188, 201, 126, 317, 332,
  259, 263, 290, 156, 213, 168, 211, 285, 289, 315,
  15, 19, 57, 70, 148, 249, 127, 291,
];
