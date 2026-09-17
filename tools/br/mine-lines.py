#!/usr/bin/env python3
"""MY VOICE's word list, mined from Emerald's own NPC text (POK-283).

Cam: "these should be a big list of essentially any NPC text in the game, so that you
can use them however you want. But it's not like free text or anything."

So the pool is the game's, not ours. What survives the sieve below is every COMPLETE
one-line sentence a person in Hoenn says that the ticker can actually draw:

  * one `.string` on its own, not a line out of the middle of a speech -- a continuation
    reads as a fragment ("and brother!", "in my way!") once it is on its own;
  * inside the Gen 3 charmap subset `web/src/text/gen3.ts` encodes, which has no
    apostrophe, so anything with one is out;
  * 10 to 26 characters, because the ticker draws 40 and a name and a colon go in front;
  * a sentence: starts with a capital, ends with . ! or ?, and has a space in it;
  * not the Frontier's stat blurbs, the contest jargon, or a scripted battle line.

    python tools/br/mine-lines.py > web/src/data/lines.json
"""
import glob
import io
import json
import re

BS = chr(92)
OK = set(" &+=;%()<>0123456789!?.-,/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
BAN = re.compile(
    r"(CONTEST|RIBBON|POKEBLOCK|BERRY|APPEAL|finalist|appealing|RANK|LINK|RECORD"
    r"|MIXING|TRADE|EGG|DAY CARE|BATTLE TENT|FRONTIER|TRAINER HILL|SECRET BASE"
    r"|Mystery|Emphasizes|Neglects| used |Please come back|The door)",
    re.I,
)


def mined():
    out = set()
    for path in sorted(glob.glob("data/text/*.inc") + glob.glob("data/maps/*/scripts.inc")):
        continuing = False
        for line in io.open(path, encoding="utf-8", errors="ignore"):
            stripped = line.strip()
            match = re.match(r'\.string\s+"(.*)"\s*$', stripped)
            if not match:
                if stripped and not stripped.startswith("@"):
                    continuing = False
                continue
            raw = match.group(1)
            first = not continuing
            continuing = not raw.endswith("$")
            if not first or "{" in raw or not raw.endswith("$"):
                continue
            text = raw[:-1].strip()
            if BS in text or not (10 <= len(text) <= 26):
                continue
            if ":" in text or " " not in text or text[-1] not in ".!?":
                continue
            if not text[0].isupper() or not re.search(r"[a-z]", text):
                continue
            if any(ch not in OK for ch in text) or BAN.search(text):
                continue
            out.add(text)
    return sorted(out)


if __name__ == "__main__":
    print(json.dumps(mined(), indent=0))
