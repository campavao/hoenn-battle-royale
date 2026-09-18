#!/usr/bin/env python3
"""Emit br-symbols.json from a pokeemerald link map.

    python3 tools/br/symbols.py pokeemerald.map > br-symbols.json

Output is a flat object of name -> "0x%08X" for every symbol whose name starts with
`gBr` followed by a capital (`gBrMailbox`, not `gBreathPuff`) plus the engine symbols the shell and the harness read (save block pointers, the
party, the object event table, battle state). The shell never hard-codes an address:
the agbcc and modern builds lay RAM out differently, and every patch moves things.
"""
import json
import re
import sys

ENGINE_SYMBOLS = [
    "gSaveBlock1Ptr", "gSaveBlock2Ptr", "gPlayerParty", "gPlayerPartyCount", "gEnemyParty",
    "gMain", "gObjectEvents", "gPlayerAvatar", "gSprites", "gTasks",
    "gBattleTypeFlags", "gBattleOutcome", "gBattleMainFunc", "gBattlerControllerFuncs",
    "gLinkPlayers", "gBlockRecvBuffer", "gBlockSendBuffer", "gWirelessCommType",
    "gRngValue", "gSaveBlock1", "gSaveBlock2", "gNumSafariBalls",
    "gBattleCommunication", "gBattleControllerExecFlags", "gBattlersCount", "gBattleBufferA", "gBattleBufferB", "gBattleMons",
    "gBattlerByTurnOrder", "gCurrentTurnActionNumber", "gBagPockets",
    "gActionSelectionCursor", "gMoveSelectionCursor",
    "gAnimScriptActive", "gAnimVisualTaskCount", "gAnimSoundTaskCount", "gAnimScriptCallback", "gBattleSpritesDataPtr", "gBattleAnimAttacker", "gBattleAnimTarget", "gBattleScripting", "gBattlescriptCurrInstr", "gCurrentMove",
    # Scratch a driver can build a wire message in before mailsend pushes it.
    "gDecompressionBuffer", "gBrZone",
    # The field camera and the palette fade: the page draws the map past the picture
    # in lockstep with the ROM's own scroll (POK-317, web/src/field.ts).
    "gFieldCamera", "gPaletteFade",
    # ...and the people on it: where a sprite is on screen (POK-318).
    "gSpriteCoordOffsetX", "gSpriteCoordOffsetY",
    # ...and the fog over it, drawn past the picture at the ROM's own scroll (POK-318).
    "gWeather",
    # The overworld's main callback: the page shows the picture past the LCD only while
    # gMain.callback2 is this (POK-319, web/src/field.ts).
    "CB2_Overworld",
]

# Map lines look like:  "                0x0203f000                gBrMailbox"
# The agbcc build takes RAM symbols from sym_*.ld, where the map shows them as "name = .".
LINE = re.compile(r"^\s+(0x[0-9a-fA-F]{8,16})\s+(\S+)(?:\s*=\s*\.)?\s*$")


def parse(path):
    out = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = LINE.match(line)
            if not m:
                continue
            addr, name = int(m.group(1), 16), m.group(2)
            if re.match(r"^gBr[A-Z]", name) or name in ENGINE_SYMBOLS:
                # Only RAM and ROM addresses; the map also lists section offsets.
                if 0x02000000 <= addr < 0x0A000000:
                    out.setdefault(name, addr)
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    syms = parse(sys.argv[1])
    missing = [s for s in ENGINE_SYMBOLS if s not in syms]
    if missing:
        print("warning: not in map: " + " ".join(missing), file=sys.stderr)
    json.dump({k: "0x%08X" % v for k, v in sorted(syms.items())}, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
