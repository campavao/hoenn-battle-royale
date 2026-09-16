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

Writes web/src/data/encounters.json:
  { "maps": { "MAP_ROUTE101": [277, 288, 290], ... },   species ids, commonest first
    "evolve": { "277": [16, 278], ... } }               species -> [level, into]

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

def main():
    ids = load_species_ids()
    with open(rp("src", "data", "wild_encounters.json"), encoding="utf-8") as f:
        groups = json.load(f)["wild_encounter_groups"]

    out = {}
    unknown = set()
    for group in groups:
        # The Pyramid and Pike headers have no `map` -- they are the Frontier's own
        # rotating tables, not a place a bot can stand.
        if group.get("label") != "gWildMonHeaders":
            continue
        for entry in group.get("encounters", []):
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

    path = rp("web", "src", "data", "encounters.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"maps": flat, "evolve": {str(k): v for k, v in sorted(evolve.items())}},
                  f, separators=(",", ":"))

    print(json.dumps({
        "maps": len(flat),
        "species": len({s for row in flat.values() for s in row}),
        "evolutions": len(evolve),
        "bytes": os.path.getsize(path),
        "unknownSpecies": sorted(unknown),
    }, indent=2))
    return 1 if unknown else 0


if __name__ == "__main__":
    sys.exit(main())
