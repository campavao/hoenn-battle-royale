#!/usr/bin/env python3
"""Spike B's houses and floors, from br_balls.c's sRooms (the live match's table, made by
floors.py): web/spike-b/data/rooms.json, one row a room -- [map, cacheX, cacheY, house,
cache, personX, personY, trader]. `house` is a row before BR_HOUSES (a cache there is
gold one time in three, a floor's one in eight, and one house in eight has somebody
home); `trader` a floor with somebody who trades. room.test.ts checks it still matches.

And web/spike-b/data/table-balls.json, [map, x, y]: the rest of a notable building's balls, each
on a table of its own (Cam's 10-19 play-test, POK-438: "Instead of on the ground, this could sit
on the desk. This place can have three, because it's more notable"). br_balls.c's sTableBalls, and
where Cam's painting moved a room's first ball off the table floors.py had it on, that table too:
the BIKE SHOP's counter. Three balls at most, the cache's counted; houses stay at one."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))


def rooms():
    src = (ROOT / 'src/br/br_balls.c').read_text()
    houses = int(re.search(r'#define BR_HOUSES (\d+)', src).group(1))
    body = src[src.index('static const struct BrRoom sRooms[] ='):]
    body = body[:body.index('};')]
    rows = re.findall(r'\{ (MAP_\w+), (\d+), (\d+), (\d+), (\d+), (TRUE|FALSE), (\w+) \}', body)
    return [[m, int(cx), int(cy), i < houses, cache == 'TRUE', int(px), int(py), t != 'BR_NO_TRADER']
            for i, (m, cx, cy, px, py, cache, t) in enumerate(rows)]


def table_balls():
    import floors as F

    table = rooms()
    src = (ROOT / 'src/br/br_balls.c').read_text()
    body = src[src.index('static const struct BrTableBall sTableBalls[] ='):]
    body = body[:body.index('};')]
    balls = {}
    for r, x, y in re.findall(r'\{ (\d+), (\d+), (\d+) \}', body):
        balls.setdefault(table[int(r)][0], []).append((int(x), int(y)))
    floors = F.census()
    for m, cx, cy, house, cache, *_ in table:
        if house or not cache or m not in floors or not floors[m][1].furnished:
            continue
        got = balls.setdefault(m, [])
        for comp, _ in floors[m][1].tables():
            if len(got) + 1 >= F.NOTABLE_BALLS:
                break
            if not any(c in comp for c in [(cx, cy), *got]):
                ball = floors[m][1].on_tables(99)
                cell = next((c for c, _ in ball if c in comp), None)
                if cell:
                    got.append(cell)
    return [[m, x, y] for m in sorted(balls) for x, y in balls[m]]


def write(out, value):
    text = json.dumps(value, separators=(',', ':')) + '\n'
    if '--check' in sys.argv:
        if out.read_text() != text:
            sys.exit(f'{out.name} is stale: run tools/br/spike-rooms.py')
        return
    out.write_text(text)
    print(f'wrote {out} ({len(value)} rows)')


if __name__ == '__main__':
    write(ROOT / 'web/spike-b/data/rooms.json', rooms())
    write(ROOT / 'web/spike-b/data/table-balls.json', table_balls())
