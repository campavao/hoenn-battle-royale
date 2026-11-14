#!/usr/bin/env python3
"""The hash of every picture the site used to ship, for web/e2e/art.spec.ts.

    python tools/br/art-hashes.py [dir, build/br-art by default] > web/e2e/art.sha1.json

Until 2026-11-14 web/public carried 1,555 Nintendo-derived PNGs (field-maps/, field-sprites/,
mon-pics/, trainer-pics/, ui/). The page now cuts each one from the player's own ROM
(web/spike-b/romcuts.ts) under the same path, and art.spec.ts holds every cut to the hash
written here from the old file. `dir` is where the PNGs are: web/public while they were
there, build/br-art (the exporters' output, gitignored) since.

A hash is the SHA-1 of little-endian u16s: width, height, then each pixel row by row as the
GBA can show it -- 0 where clear, else 0x8000 | r5 | g5 << 5 | b5 << 10 (each channel's top
five bits). The font is a mask, not a picture (its red is the glyph's colour index, 1..3), so
its pixels are 0x8000 | that index. The page hashes its cut the same way.

One picture's hash is the page's own, not a file's: ui/howto-sheet.png (HOW TO PLAY, once
web/src/ui/howto-sheet.png). Its Safari Zone panel is an 8 x 8 average of map pixels, and the
file averaged pret's 8-bit .pal colours, which the ROM does not keep: 15,947 of that panel's
36,000 pixels came out one 5-bit step off. Every other panel was identical when it was taken
over (2026-11-14). This script keeps whatever art.sha1.json already says for it (PAGE_CUTS);
after changing it on purpose, take the page's hash with HBR_ART_GOT (art.spec.ts).

Left out: field-sprites/patch-*.png (the encounter marks, drawn in their files' own colours,
which nothing has read since /classic/ went; spike B cuts its marks from gBrPatch* itself).
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DIRS = ("field-maps", "field-sprites", "mon-pics", "trainer-pics", "ui")
SKIP = ("/field-sprites/patch-",)
FONT = "/ui/font-normal.png"
PAGE_CUTS = ("/ui/howto-sheet.png",)
HASHES = ROOT / "web/e2e/art.sha1.json"


def digest(path: Path, key: str) -> str:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    words = [w, h]
    for r, g, b, a in im.getdata():
        if not a:
            words.append(0)
        elif key == FONT:
            words.append(0x8000 | r)
        else:
            words.append(0x8000 | (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10))
    return f"{w}x{h} " + hashlib.sha1(struct.pack(f"<{len(words)}H", *words)).hexdigest()


def main() -> None:
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build/br-art"
    out = {}
    for d in DIRS:
        for p in sorted((base / d).rglob("*.png")):
            key = "/" + p.relative_to(base).as_posix()
            if key.startswith(SKIP):
                continue
            out[key] = digest(p, key)
    kept = json.loads(HASHES.read_text()) if HASHES.exists() else {}
    for key in PAGE_CUTS:
        if key in kept:
            out[key] = kept[key]
    json.dump(dict(sorted(out.items())), sys.stdout, indent=1)
    print()
    print(f"{len(out)} pictures", file=sys.stderr)


if __name__ == "__main__":
    main()
