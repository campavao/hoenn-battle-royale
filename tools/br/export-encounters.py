#!/usr/bin/env python3
"""Per-map wild tables, so a bot's team comes from where it actually is (POK-237).

A bot that dropped on Route 119 should be carrying Route 119's mons. The ROM already
has the tables -- `src/data/wild_encounters.json` is what `CreateWildMon` reads -- and
the page has no way to see them, so this flattens them into one small file the bot
dealer can index by map.

Only the land tables. A bot walks; the water, fishing and rock-smash tables belong to
things it cannot do yet, and folding them in would put Tentacool in a forest.

Writes web/src/data/encounters.json:
  { "MAP_ROUTE101": [277, 288, 290], ... }   species ids, most common first

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

    path = rp("web", "src", "data", "encounters.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(flat, f, separators=(",", ":"))

    print(json.dumps({
        "maps": len(flat),
        "species": len({s for row in flat.values() for s in row}),
        "bytes": os.path.getsize(path),
        "unknownSpecies": sorted(unknown),
    }, indent=2))
    return 1 if unknown else 0


if __name__ == "__main__":
    sys.exit(main())
