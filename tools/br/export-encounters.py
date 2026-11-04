#!/usr/bin/env python3
"""Per-map wild tables and the level-up evolutions, for the bot dealer (POK-237).

A bot that dropped on Route 119 should be carrying Route 119's mons. The ROM already
has the tables -- `src/data/wild_encounters.json` is what `CreateWildMon` reads -- and
the page has no way to see them, so this flattens them into one small file the bot
dealer can index by map.

Only the land tables. A bot walks; the water, fishing and rock-smash tables belong to
things it cannot do yet, and folding them in would put Tentacool in a forest.

Also the level-up evolutions out of `src/data/pokemon/evolution.h`, so a bot's team
grows with the rung the way a player's does. Only EVO_LEVEL: a stone or a trade is
something a trainer chose to do, and a bot has neither the stone nor the friend.

And the maps with a fishing table, for spike B's rod (web/spike-b/fish.ts): a cast where
there is none is never a bite (Fishing_CheckForBite's DoesCurrentMapHaveFishingMons).

And what a bot's step on a marked spot needs to meet what a trainer's meets (Cam, 11-04): each
map's tables slot by slot, every species' catch rate, and the numbers br_zone.c's stand-ins and
any-first-stage draw go by.

Writes web/src/data/encounters.json:
  { "maps": { "MAP_ROUTE101": [277, 288, 290], ... },   species ids, commonest first
    "fish": ["MAP_ROUTE102", ...],                      maps with a fishing table
    "evolve": { "277": [16, 278], ... },                species -> [level, into]
    "names": { "277": "TREECKO", ... },                 species -> the ROM's name
    "slots": { "MAP_ROUTE101": { "land": [...12] } },   the tables, slot by slot (and "water", 5)
    "catch": { "277": 45, ... },                        species -> catch rate
    "stats": { "277": [310, 7, 7], ... },               br_zone.c's Wild(): stat total, two types
    "zone": [1, 4, ...] }                               ...and of those, what nothing evolves into

The names are every species with one (src/data/text/species_names.h), not just the
ones a bot is dealt: a bot's mon grows into its evolution, and a mon a player drops
can be anything, and the page names both on the results screen and the ticker.

Species names come from include/constants/species.h, so a rename upstream is a build
error here rather than a silently empty table.
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def rp(*parts):
    return os.path.join(ROOT, *parts)


def load_species_ids():
    ids = {}
    with open(rp("include", "constants", "species.h"), encoding="utf-8") as f:
        for line in f:
            m = re.match(r"\s*#define\s+(SPECIES_[A-Z0-9_]+)\s+(\d+)", line)
            if m:
                ids[m.group(1)] = int(m.group(2))
    return ids


def load_level_evolutions(ids):
    """species id -> [level, into]. Every EVO_LEVEL* form, which includes the
    personality-branched ones (Wurmple's two, Nincada's) -- those are still things that
    happen to a mon for walking around long enough. A stone or a trade is not: that is
    something a trainer chose to do, and a bot has neither the stone nor the friend.
    The first row wins, so a branch is a coin flip we call once."""
    out = {}
    name_re = re.compile(r"\[(SPECIES_[A-Z0-9_]+)\]")
    evo_re = re.compile(r"EVO_LEVEL[A-Z_]*\s*,\s*(\d+)\s*,\s*(SPECIES_[A-Z0-9_]+)")
    path = rp("src", "data", "pokemon", "evolution.h")
    # One species a line in this table, which is what makes a line-at-a-time read
    # honest here rather than lazy.
    for line in open(path, encoding="utf-8"):
        name = name_re.search(line)
        evo = evo_re.search(line)
        if not name or not evo:
            continue
        if name.group(1) not in ids or evo.group(2) not in ids:
            continue
        out.setdefault(ids[name.group(1)], [int(evo.group(1)), ids[evo.group(2)]])
    return out

def load_species_names(ids):
    """species id -> its name as the ROM spells it. The "?" rows are the unused slots
    between Celebi and Treecko and the Unown forms' placeholders: not names."""
    by_name = {}
    name_re = re.compile(r'\[(SPECIES_[A-Z0-9_]+)\]\s*=\s*_\("([^"]*)"\)')
    for line in open(rp("src", "data", "text", "species_names.h"), encoding="utf-8"):
        m = name_re.search(line)
        if m and m.group(1) in ids and m.group(1) != "SPECIES_NONE" and m.group(2).strip("?"):
            by_name[ids[m.group(1)]] = m.group(2)
    return by_name


def load_species_info(ids):
    """species id -> (base stat total, type names, catch rate), off species_info.h, for what a
    marked spot rolls (web/spike-b/shared/wild.ts): a catch's odds and br_zone.c's stand-ins.
    The placeholder rows are a macro with no stats of their own, and do not match."""
    text = open(rp("src", "data", "pokemon", "species_info.h"), encoding="utf-8").read()
    row = re.compile(
        r"\[(SPECIES_[A-Z0-9_]+)\]\s*=\s*\{\s*"
        r"\.baseHP\s*=\s*(\d+),\s*\.baseAttack\s*=\s*(\d+),\s*\.baseDefense\s*=\s*(\d+),\s*"
        r"\.baseSpeed\s*=\s*(\d+),\s*\.baseSpAttack\s*=\s*(\d+),\s*\.baseSpDefense\s*=\s*(\d+),\s*"
        r"\.types\s*=\s*\{\s*(TYPE_\w+)\s*,\s*(TYPE_\w+)\s*\},\s*\.catchRate\s*=\s*(\d+)"
    )
    out = {}
    for m in row.finditer(text):
        if m.group(1) in ids:
            out[ids[m.group(1)]] = (sum(int(m.group(i)) for i in range(2, 8)), (m.group(8), m.group(9)), int(m.group(10)))
    return out


def load_not_wild(ids):
    """br_zone.c's sNotWild: what no route or Zone ever rolls."""
    text = open(rp("src", "br", "br_zone.c"), encoding="utf-8").read()
    body = re.search(r"sNotWild\[\]\s*=\s*\{(.*?)\};", text, re.S).group(1)
    return {ids[name] for name in re.findall(r"SPECIES_[A-Z0-9_]+", body)}


def load_evolved(ids):
    """Everything anything evolves into, by any means (br_zone.c's MarkEvolved)."""
    text = open(rp("src", "data", "pokemon", "evolution.h"), encoding="utf-8").read()
    return {ids[name] for name in re.findall(r"\{EVO_\w+,\s*\w+,\s*(SPECIES_[A-Z0-9_]+)\}", text) if name in ids}


def main():
    ids = load_species_ids()
    with open(rp("src", "data", "wild_encounters.json"), encoding="utf-8") as f:
        groups = json.load(f)["wild_encounter_groups"]

    out = {}
    fish = set()
    unknown = set()
    # Slot by slot, for a roll at Emerald's odds (br_wild.c's LandSlot and WaterSlot); `maps` above
    # is the bot dealer's, with the slots folded.
    slots = {}
    for group in groups:
        # The Pyramid and Pike headers have no `map` -- they are the Frontier's own
        # rotating tables, not a place a bot can stand.
        if group.get("label") != "gWildMonHeaders":
            continue
        for entry in group.get("encounters", []):
            if entry.get("fishing_mons") and "map" in entry:
                fish.add(entry["map"])
            if "map" in entry and entry["map"] not in slots:
                row = {}
                for field, key in (("land_mons", "land"), ("water_mons", "water")):
                    mons = entry.get(field, {}).get("mons", [])
                    if mons:
                        row[key] = [ids[m["species"]] for m in mons if m["species"] in ids]
                if row:
                    slots[entry["map"]] = row
            land = entry.get("land_mons")
            if not land or "map" not in entry:
                continue
            # Slot order in the table IS the rarity order, and a species appears in
            # several slots when it is common -- so counting keeps that weighting
            # without carrying the ROM's own slot-chance table over as well.
            seen = {}
            for slot in land.get("mons", []):
                name = slot["species"]
                if name not in ids:
                    unknown.add(name)
                    continue
                seen[ids[name]] = seen.get(ids[name], 0) + 1
            if seen:
                out.setdefault(entry["map"], {})
                for species, n in seen.items():
                    out[entry["map"]][species] = out[entry["map"]].get(species, 0) + n

    flat = {
        map_id: [s for s, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
        for map_id, counts in sorted(out.items())
    }

    evolve = load_level_evolutions(ids)
    names = load_species_names(ids)
    info = load_species_info(ids)
    not_wild = load_not_wild(ids)
    evolved = load_evolved(ids)
    # br_zone.c's Wild(): every species with stats, but the ones it names.
    wild = sorted(s for s in info if s not in not_wild)
    type_names = sorted({t for _, types, _ in info.values() for t in types})
    stats = {str(s): [info[s][0], type_names.index(info[s][1][0]), type_names.index(info[s][1][1])] for s in wild}

    path = rp("web", "src", "data", "encounters.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"maps": flat, "fish": sorted(fish), "evolve": {str(k): v for k, v in sorted(evolve.items())},
                   "names": {str(k): v for k, v in sorted(names.items())},
                   "slots": {k: slots[k] for k in sorted(slots)},
                   "catch": {str(s): info[s][2] for s in sorted(info)},
                   "stats": stats,
                   "zone": [s for s in wild if s not in evolved]},
                  f, separators=(",", ":"))

    print(json.dumps({
        "maps": len(flat),
        "fish": len(fish),
        "species": len({s for row in flat.values() for s in row}),
        "evolutions": len(evolve),
        "names": len(names),
        "bytes": os.path.getsize(path),
        "unknownSpecies": sorted(unknown),
    }, indent=2))
    return 1 if unknown else 0


if __name__ == "__main__":
    sys.exit(main())
