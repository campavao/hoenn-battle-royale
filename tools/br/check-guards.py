#!/usr/bin/env python3
"""Every BR touch in an upstream file sits under a BR guard (docs/C-STYLE.md).

    python3 tools/br/check-guards.py [file ...]

Reads pret's own sources -- src/ and include/ outside br/, data/ and asm/ -- and fails
on any reference to our code outside `#if BR` (C) or `.if BR` (assembler): a Br*/gBr*
name, a BR_* one, or a br/ include. It also fails a guard written some other way
(`#ifdef BR`, `#if defined(BR)`, `.ifdef BR`): the Makefile always defines BR, so those
are on even in a `make BR=0` build. Code under the #else of `#if BR` is pret's and
must not reach for ours either.

No toolchain, a couple of seconds: CI runs it before anything is built. Pret itself
never matches the patterns except pokedex_area_glow.h's GLOW_*_BR_* corners (bottom
right), which are skipped by name. ld_script.ld is not preprocessed; its src/br globs
match nothing in a build without src/br.
"""
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

# Ours outright: nothing in them is pret's.
OWNED = ('src/br/', 'include/br/', 'data/scripts/br.inc')
C_EXT = ('.c', '.h')
ASM_EXT = ('.s', '.inc')

REF = re.compile(r'\w*Br[A-Z]\w*|\w*BR_\w*|\bbr/[\w./]*|\bbr\.inc\b')
PRET_NAMES = re.compile(r'^GLOW_')

C_DIRECTIVE = re.compile(r'^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)')
ASM_DIRECTIVE = re.compile(r'^\s*\.(if\w*|elseif|else|endif)\b(.*)', re.I)
BR_TOKEN = re.compile(r'\bBR\b')


def sources():
    for top in ('src', 'include', 'data', 'asm'):
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, top)):
            dirnames.sort()
            for name in sorted(filenames):
                if name.endswith(C_EXT + ASM_EXT):
                    rel = os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, '/')
                    if not rel.startswith(OWNED):
                        yield rel


def condition(kind, expr):
    """What a directive's branch means for BR: 'br' (ours), 'pret' (BR off) or None."""
    expr = expr.split('//')[0].split('/*')[0].split('@')[0].strip()
    if not BR_TOKEN.search(expr):
        return None, None
    if kind in ('if', 'elif', 'elseif') and re.fullmatch(r'BR(\s*(&&|\|\|).*)?', expr):
        return 'br', None
    if kind in ('if', 'elif', 'elseif') and re.fullmatch(r'!\s*BR', expr):
        return 'pret', None
    bad = 'write the guard as `#if BR` / `.if BR` (BR is always defined, 0 or 1)'
    return ('pret' if kind == 'ifndef' else 'br'), bad


def check(rel):
    problems = []
    is_c = rel.endswith(C_EXT)
    directive = C_DIRECTIVE if is_c else ASM_DIRECTIVE
    stack = []  # one entry per open conditional: 'br', 'pret' or None
    with open(os.path.join(ROOT, rel), encoding='latin-1') as f:
        for n, line in enumerate(f, 1):
            text = line
            m = directive.match(text)
            if m:
                kind = m.group(1).lower()
                if kind.startswith('if') and kind not in ('if', 'ifdef', 'ifndef'):
                    kind = 'if'  # .ifb/.ifc/.ifeq/... never name BR
                if kind in ('if', 'ifdef', 'ifndef'):
                    state, bad = condition(kind, m.group(2))
                    if bad:
                        problems.append((n, bad, line))
                    stack.append(state)
                elif kind in ('elif', 'elseif'):
                    if stack:
                        state, bad = condition(kind, m.group(2))
                        if bad:
                            problems.append((n, bad, line))
                        stack[-1] = state
                elif kind == 'else':
                    if stack:
                        stack[-1] = {'br': 'pret', 'pret': 'br'}.get(stack[-1])
                elif kind == 'endif':
                    if stack:
                        stack.pop()
                continue
            # Comments count: a BR comment in pret's code is a BR edit all the same.
            refs = [r for r in REF.findall(text) if not PRET_NAMES.match(r)]
            if not refs:
                continue
            inner = next((s for s in reversed(stack) if s is not None), None)
            if inner == 'br':
                continue
            where = "under #else, which is pret's" if inner == 'pret' else 'outside a BR guard'
            problems.append((n, '%s %s' % (', '.join(sorted(set(refs))), where), line))
    return problems


def main(argv):
    files = argv[1:] or list(sources())
    bad = 0
    for rel in files:
        for n, why, line in check(rel):
            print('%s:%d: %s\n    %s' % (rel, n, why, line.rstrip()))
            bad += 1
    if bad:
        print('\n%d unguarded BR line(s). Every touch to an upstream file is `#if BR` (C) or '
              '`.if BR` (assembler), with pret\'s own lines kept under #else (docs/C-STYLE.md).' % bad)
        return 1
    print('guards: %d upstream files, every BR reference under #if BR / .if BR' % len(files))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
