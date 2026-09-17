#!/usr/bin/env python3
# Usage: python tools/br/moveset-sim.py . [SPECIES ...]
#   no species: prints every species left with fewer than two attacks, or an EXPLOSION.
# Keep in step with MoveWorth/SetWorth/Teach in src/br/br_levels.c.
"""Offline mirror of br_levels.c's MoveWorth/SetWorth/Teach (POK-311), over every species
at level 75 from an empty set, on base stats. For eyeballing, not a test."""
import re, sys
root = sys.argv[1]
R = lambda p: open(root + '/' + p, encoding='utf-8').read()

moves = {}
for m in re.finditer(r'\[MOVE_(\w+)\] =\s*\{(.*?)\n    \},', R('src/data/battle_moves.h'), re.S):
    f = dict(re.findall(r'\.(\w+) = ([\w|]+),', m.group(2)))
    moves[m.group(1)] = dict(effect=f['effect'][7:], power=int(f['power']), type=f['type'][5:], acc=int(f['accuracy']))

species = {}
for m in re.finditer(r'\[SPECIES_(\w+)\] =\s*\{(.*?)\n    \},', R('src/data/pokemon/species_info.h'), re.S):
    b = m.group(2)
    g = lambda k: int(re.search(r'\.' + k + r'\s*= (\d+)', b).group(1))
    t = re.search(r'\.types = \{ TYPE_(\w+), TYPE_(\w+) ?\}', b)
    if t:
        species[m.group(1)] = dict(atk=g('baseAttack'), spa=g('baseSpAttack'), types=(t.group(1), t.group(2)))

sets = {}
for m in re.finditer(r'static const u16 s(\w+)LevelUpLearnset\[\] = \{(.*?)\};', R('src/data/pokemon/level_up_learnsets.h'), re.S):
    sets[m.group(1).upper()] = [(int(l), mv) for l, mv in re.findall(r'LEVEL_UP_MOVE\(\s*(\d+), MOVE_(\w+)\)', m.group(2))]

PHYS = {'NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL'}
GOOD = {'SLEEP', 'TOXIC', 'PARALYZE', 'WILL_O_WISP', 'CONFUSE', 'LEECH_SEED', 'RESTORE_HP', 'SOFTBOILED', 'MORNING_SUN',
        'SYNTHESIS', 'MOONLIGHT', 'ATTACK_UP_2', 'SPECIAL_ATTACK_UP_2', 'SPEED_UP_2', 'DRAGON_DANCE', 'CALM_MIND', 'BULK_UP'}
ODD = {'LEVEL_DAMAGE': 60, 'FRUSTRATION': 60, 'SUPER_FANG': 50, 'OHKO': 35, 'RETURN': 30, 'DRAGON_RAGE': 25, 'SONICBOOM': 15}
HALF = {'RECHARGE', 'RAZOR_WIND', 'SKY_ATTACK', 'SKULL_BASH', 'SOLAR_BEAM', 'SEMI_INVULNERABLE', 'FOCUS_PUNCH', 'FAKE_OUT'}

def worth(sp, name):
    m = moves[name]; acc = m['acc'] or 100
    if m['power'] == 0:
        s = 0 if m['effect'] in ('SPLASH', 'TELEPORT') else 50 if m['effect'] in GOOD else 20
        return s * acc // 100
    if m['power'] == 1: return ODD.get(m['effect'], 40)
    if m['effect'] == 'EXPLOSION': return 15
    w = m['power']; e = m['effect']
    if e == 'MULTI_HIT': w *= 3
    elif e in ('DOUBLE_HIT', 'TWINEEDLE'): w *= 2
    elif e == 'TRIPLE_KICK': w *= 4
    elif e in HALF: w //= 2
    elif e == 'FALSE_SWIPE': w //= 3
    elif e in ('DREAM_EATER', 'SNORE', 'SPIT_UP'): w //= 5
    elif e in ('OVERHEAT', 'SUPERPOWER'): w = w * 4 // 5
    w = w * acc // 100
    if m['type'] in sp['types']: w = w * 3 // 2
    mine = sp['atk'] if m['type'] in PHYS else sp['spa']
    return w * mine // max(sp['atk'], sp['spa'])

def echoes(a, b):
    if a['power'] == 0 or a['effect'] == 'EXPLOSION': return a['effect'] == b['effect']
    return b['power'] > 1 and b['effect'] != 'EXPLOSION' and a['type'] == b['type']

def set_worth(sp, ms):
    ws = [worth(sp, m) for m in ms]; total = 0; hitters = 0
    for i, n in enumerate(ms):
        a = moves[n]; w = ws[i]; above = 0; ech = 0
        if a['power'] != 0 and a['effect'] != 'EXPLOSION': hitters += 1
        for j, o in enumerate(ms):
            if j == i or not (ws[j] > ws[i] or (ws[j] == ws[i] and j < i)): continue
            b = moves[o]
            if a['power'] == 0 and b['power'] == 0: above += 1
            if echoes(a, b): ech += 1
        w = w * 2 // 5 if ech == 1 else w // 5 if ech >= 2 else w
        if above >= 2: w = w * 3 // 10
        total += w
    return total // 4 if hitters == 0 else total

def build(name, level=75):
    sp = species[name]; have = []
    for lv, mv in sets[name]:
        if lv > level or mv in have: continue
        if len(have) < 4: have.append(mv); continue
        best, bw = None, set_worth(sp, have)
        for i in range(4):
            t = have[:]; t[i] = mv; w = set_worth(sp, t)
            if w > bw: best, bw = i, w
        if best is not None: have[best] = mv
    return have

want = sys.argv[2:] or None
flag = 0
for name in sets:
    if name not in species: continue
    ms = build(name)
    hit = [m for m in ms if moves[m]['power'] and moves[m]['effect'] != 'EXPLOSION']
    boom = [m for m in ms if moves[m]['effect'] == 'EXPLOSION']
    if want:
        if name in want: print(name, ms)
    elif len(hit) < 2 or boom:
        flag += 1
        print(name, ms)
print('flagged', flag, 'of', len(sets))
