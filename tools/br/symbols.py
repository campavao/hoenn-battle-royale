#!/usr/bin/env python3
"""Emit br-symbols.json from a pokeemerald link map.

    python3 tools/br/symbols.py pokeemerald.map [pokeemerald.gba] > br-symbols.json

Output is a flat object of name -> "0x%08X" for every symbol whose name starts with
`gBr` followed by a capital (`gBrMailbox`, not `gBreathPuff`) plus the engine symbols the shell and the harness read (save block pointers, the
party, the object event table, battle state). The shell never hard-codes an address:
the agbcc and modern builds lay RAM out differently, and every patch moves things.

Plus one entry that is not an address: "romSha1", the sha1 of the ROM the map was
linked for (the map's own name with .gba, unless one is given). The shell fetches the
table by that sha1 and checks the stamp (POK-330 #23): a table from another build puts
every EWRAM write at the wrong address. The harness's scanner skips it -- its value has
no "0x" in it.
"""
import hashlib
import json
import os
import re
import sys

ENGINE_SYMBOLS = [
    "gSaveBlock1Ptr", "gSaveBlock2Ptr", "gPlayerParty", "gPlayerPartyCount", "gEnemyParty",
    # The opponent's balls beside a trainer battle (web/src/ui/sides.ts, #18).
    "gEnemyPartyCount",
    "gMain", "gObjectEvents", "gPlayerAvatar", "gSprites", "gTasks",
    # The field camera's pixel scroll (Y, then X at +2): spike B's walk traces (web/spike-b/fixtures).
    "gTotalCameraPixelOffsetY",
    # ...and its marked spots, dealt the way br_patch.c deals them: which maps have a land
    # or a water table, and the rustle's palette (web/spike-b/romart.ts).
    "gWildMonHeaders", "gSpritePalette_GeneralFieldEffect1",
    "gBattleTypeFlags", "gBattleWeather", "gBattleEnvironment", "gBattleOutcome", "gBattleMainFunc", "gBattlerControllerFuncs",
    "gLinkPlayers", "gBlockRecvBuffer", "gBlockSendBuffer", "gWirelessCommType",
    "gRngValue", "gSaveBlock1", "gSaveBlock2", "gNumSafariBalls",
    "gBattleCommunication", "gBattleControllerExecFlags", "gBattlersCount", "gBattleBufferA", "gBattleBufferB", "gBattleMons",
    "gBattlerByTurnOrder", "gCurrentTurnActionNumber", "gBagPockets",
    # The turn counter at +0x13 (battleTurnCounter): the turn checks (POK-376).
    "gBattleResults",
    "gActionSelectionCursor", "gMoveSelectionCursor",
    # Which battler is the local player: 1 on the challenged side of a link battle
    # (web/src/touch.ts localBattler).
    "gBattlerPositions",
    "gAnimScriptActive", "gAnimVisualTaskCount", "gAnimSoundTaskCount", "gAnimScriptCallback", "gBattleSpritesDataPtr", "gBattleAnimAttacker", "gBattleAnimTarget", "gBattleScripting", "gBattlescriptCurrInstr", "gCurrentMove",
    # The battle script's waitmessage/pause counter: the trimmed waits (battle-waits.txt, HBR-39).
    "gPauseCounterBattle",
    # Scratch a driver can build a wire message in before mailsend pushes it.
    "gDecompressionBuffer", "gBrZone",
    # The party screen as a move is taught (tm-teach-full.txt), and the way back it keeps
    # while it only lists the party: a lift asks nothing on opening (learn-auto.txt).
    "gPartyMenu", "CB2_ReturnToFieldWithOpenMenu",
    # The field camera and the palette fade: the page draws the map past the picture
    # in lockstep with the ROM's own scroll (POK-317, web/src/field.ts).
    "gFieldCamera", "gPaletteFade",
    # ...and the people on it: where a sprite is on screen (POK-318).
    "gSpriteCoordOffsetX", "gSpriteCoordOffsetY",
    # ...and the ones past the object box, drawn standing from the ROM's own tables: a
    # graphics id's standing frame, and the way a map person starts out facing
    # (POK-318, web/src/field-ghosts.ts).
    "gObjectEventGraphicsInfoPointers", "gInitialMovementTypeFacingDirections",
    # ...and the fog over it, drawn past the picture at the ROM's own scroll (POK-318).
    "gWeather",
    # The overworld's main callback: the page shows the picture past the LCD only while
    # gMain.callback2 is this (POK-319, web/src/field.ts).
    "CB2_Overworld",
    # A drop's POKeMON screen (br_swap.h) and the PC box it reads the drop from: spike B
    # opens it on its own hidden ROM for a fallen trainer's team (HBR-82).
    "CB2_BrSwap", "gPokemonStoragePtr",
    # ...and the map grid and layout the core draws the whole window from, which the
    # ROM names in gBrWorld (world-grid.txt), and the table of every map, which the core
    # walks for the neighbours past the grid's edge.
    "gBackupMapLayout", "gMapHeader", "gMapGroups",
    # ...and the battle's: the phone's stick and A/B stand down while it runs and no
    # battle script waits on a press (web/src/ui/battlemenu.ts battleWantsNoPad).
    "BattleMainCB2",
    # Where the battle's bg0 is scrolled: a screen down for the action menu, two for the
    # moves, the top (the message box) with gBrHud.noBattleBox (battle-box-off.txt).
    "gBattle_BG0_Y",
    # What every netlink VBlank's RfuVSync reads (include/br/br_netlink.h, netlink-loop.txt).
    "gRfuLinkStatus",
    # The battle's message box, as the last line was expanded into it (pvp-items.txt).
    "gDisplayedStringBattle",
    # The start menu's input handler is gMenuCallback while the menu takes keys: the
    # page's PARTY and MAP buttons wait for it before they walk the cursor (br_menu.h).
    "gMenuCallback",
    # The phone's battle menu reads what a move is out of the ROM's own tables
    # (web/src/battle/movebook.ts): its stats, name, description, type name, and how
    # well each type lands on each.
    "gBattleMoves", "gMoveNames", "gMoveDescriptionPointers", "gTypeNames", "gTypeEffectiveness",
    # The fog map's prompt, "FOG: <place>", is built here (br_map.c, ring-map.txt).
    "gStringVar4",
    # What a bot's AI was handed out of its bag, and what it chose to do with its turn
    # (bot-bag.txt, bot-bag-empty.txt).
    "gBattleResources", "gChosenActionByBattler",
    # The room's ANIM OFF in a link battle: HITMARKER_NO_ANIMATIONS (pace-link.txt).
    "gHitMarker",
    # Which sprite each battler is: the opponent's trainer picture is the bot's own skin
    # (bot-pic.txt), read off that sprite's affineParam.
    "gBattlerSpriteIds",
    # event_data.c's EWRAM, in declaration order: sSpecialFlags is static and sits 0x24
    # past this, so a flag set off the end of it can be found (objects-no-template.txt).
    "gSpecialVar_0x8000",
    # The window table: the harness's `watch windows` reads each live window's template
    # and pixel buffer out of it (hud-vram.txt, POK-329).
    "gWindows",
    # ...and the field's three tilemap buffers, which VRAM's BG1..3 maps must match
    # wherever BrField_InitRingBgs put them (hud-vram.py, POK-329).
    "gOverworldTilemapBuffer_Bg1", "gOverworldTilemapBuffer_Bg2", "gOverworldTilemapBuffer_Bg3",
    # The per-line scroll a battle transition's HBlank writes into BG1..3VOFS, which is 9
    # bits on the ring's 512-row BGs (shuffle-vofs.txt, POK-329).
    "gScanlineEffectRegBuffers",
    # The phone's bag (web/src/ui/bagsheet.ts): which pocket the ROM's BAG opens on, and
    # what each item is -- its name, description, pocket and whether a battle can use it.
    "gBagPosition", "gItems",
    # The party screen: a tap on a POKeMON walks its cursor (gPartyMenu.slotId) there and
    # presses A, while the choose-a-POKeMON task is the one running (web/src/touch.ts).
    "gPartyMenu", "Task_HandleChooseMonInput",
    # The towns' tileset animations (tileset_anims.c), which the core plays on a joined
    # map drawn from its own decoded tileset (web/src/field-extra.ts TILE_ANIMS): each
    # animated secondary tileset and its frame tables.
    "gTileset_Rustboro", "gTileset_Dewford", "gTileset_Slateport", "gTileset_Mauville",
    "gTileset_Lavaridge", "gTileset_EverGrande", "gTileset_Pacifidlog", "gTileset_Sootopolis",
    "gTileset_BattleFrontierOutsideWest", "gTileset_BattleFrontierOutsideEast",
    "gTilesetAnims_Rustboro_WindyWater",
    "gTilesetAnims_Rustboro_Fountain", "gTilesetAnims_Dewford_Flag", "gTilesetAnims_Slateport_Balloons",
    "gTilesetAnims_Mauville_Flower1", "gTilesetAnims_Mauville_Flower2",
    "gTilesetAnims_Mauville_Flower1_B", "gTilesetAnims_Mauville_Flower2_B",
    "gTilesetAnims_Lavaridge_Steam", "gTilesetAnims_Lavaridge_Cave_Lava",
    "gTilesetAnims_EverGrande_Flowers",
    "gTilesetAnims_Pacifidlog_LogBridges", "gTilesetAnims_Pacifidlog_WaterCurrents",
    "gTilesetAnims_Sootopolis_StormyWater",
    "gTilesetAnims_BattleFrontierOutsideWest_Flag", "gTilesetAnims_BattleFrontierOutsideEast_Flag",
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


def rom_sha1(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


def main():
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    syms = parse(sys.argv[1])
    missing = [s for s in ENGINE_SYMBOLS if s not in syms]
    if missing:
        print("warning: not in map: " + " ".join(missing), file=sys.stderr)
    out = {k: "0x%08X" % v for k, v in sorted(syms.items())}
    rom = sys.argv[2] if len(sys.argv) == 3 else os.path.splitext(sys.argv[1])[0] + ".gba"
    if os.path.isfile(rom):
        out["romSha1"] = rom_sha1(rom)
    else:
        print("warning: no %s: br-symbols.json carries no romSha1" % rom, file=sys.stderr)
    json.dump(out, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
