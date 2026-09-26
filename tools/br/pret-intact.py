#!/usr/bin/env python3
"""Every upstream file is pret's, line for line, once its BR blocks are taken out.

    python3 tools/br/pret-intact.py [--ref SHA] [file ...]

check-guards.py sees names: a Br*/BR_* reference outside `#if BR`. This sees lines. For
each file that exists at the pret commit we fork from (tools/br/BASELINE_COMMIT, or
--ref) and differs from it on disk, it keeps what a `make BR=0` preprocessor would keep
of our guards -- drops every `#if BR` / `.if BR` branch and the guard lines themselves,
keeps the `#else` (pret's lines under a hook) and every other conditional as written --
and fails unless what is left is pret's file byte for byte. A reformatted pret line, a
trailing comma, a blank line added next to a hook: each compiles the same and slips
past both the lint and `make BR=0`, and each is one more line a pret merge conflicts on.

A pret file that is not source (Makefile, ld_script.ld, ...) has no guard syntax to
check; it must be listed in NOT_SOURCE with why it differs, and a new one fails until
it is. A deleted pret file always fails.

Needs git and the pret commit's objects: CI's shallow checkout fetches it first
(`git fetch --depth=1 origin "$(cat tools/br/BASELINE_COMMIT)"`).
"""
import difflib
import importlib.util
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))

_spec = importlib.util.spec_from_file_location('check_guards', os.path.join(HERE, 'check-guards.py'))
guards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guards)

# pret files that are not C or assembler, so there is no `#if BR` to put a change under.
# Each is ours to differ, for the reason given.
NOT_SOURCE = {
    '.gitignore': "our build outputs and tooling (web/, relay/, tools/br/)",
    'Makefile': "BR ?= 1, -DBR/--defsym BR, and `make BR=0` into build/pret (make's own ifeq)",
    'README.md': "the fork's readme; pret's is kept as README.pokeemerald.md",
    'ld_script.ld': "src/br's ewram_data/.bss/.rodata sections (not preprocessed; the globs "
                    "match nothing in a BR=0 build)",
}


def git(*args):
    return subprocess.run(('git', '-C', ROOT) + args, check=True, capture_output=True).stdout


def changed(ref, only):
    """(status, path) for every pret file that differs on disk from `ref`."""
    out = git('diff', '--no-renames', '--name-status', '-z', ref, '--', *only).decode('utf-8')
    fields = out.split('\0')
    pairs = []
    for i in range(0, len(fields) - 1, 2):
        pairs.append((fields[i], fields[i + 1]))
    return pairs


def same_but_eol(ref, rel):
    """A Windows checkout's CRLF, seen by a git that does not convert (MSYS2's), is not
    a change. The sources are eol=lf (.gitattributes), so this only meets the rest."""
    ours = open(os.path.join(ROOT, rel), 'rb').read().replace(b'\r\n', b'\n')
    pret = git('cat-file', 'blob', '%s:%s' % (ref, rel)).replace(b'\r\n', b'\n')
    return ours == pret


def pret_view(text, is_c):
    """(line number, line) for each line a `make BR=0` preprocessor would see as pret's."""
    directive = guards.C_DIRECTIVE if is_c else guards.ASM_DIRECTIVE
    stack = []  # per open conditional: 'br', 'pret' or None, as check-guards.condition
    kept = []
    problems = []
    for n, line in enumerate(text.splitlines(True), 1):
        m = directive.match(line)
        if m:
            kind = m.group(1).lower()
            if kind.startswith('if') and kind not in ('if', 'ifdef', 'ifndef'):
                kind = 'if'
            outer_ours = 'br' in stack
            if kind in ('if', 'ifdef', 'ifndef'):
                state, _ = guards.condition(kind, m.group(2))
                stack.append(state)
                if state is None and not outer_ours:
                    kept.append((n, line))
                continue
            if not stack:
                if not outer_ours:
                    kept.append((n, line))
                continue
            was = stack[-1]
            if kind in ('elif', 'elseif'):
                state, _ = guards.condition(kind, m.group(2))
                if (was is None) != (state is None):
                    problems.append((n, 'a BR branch inside one of pret\'s conditionals: '
                                        'nest an `#if BR` in it instead'))
                stack[-1] = state
            elif kind == 'else':
                stack[-1] = {'br': 'pret', 'pret': 'br'}.get(was)
            elif kind == 'endif':
                stack.pop()
            if was is None and not ('br' in stack):
                kept.append((n, line))
            continue
        if 'br' not in stack:
            kept.append((n, line))
    return kept, problems


def check(ref, rel):
    ours = open(os.path.join(ROOT, rel), 'rb').read().decode('latin-1')
    pret = git('cat-file', 'blob', '%s:%s' % (ref, rel)).decode('latin-1')
    kept, problems = pret_view(ours, rel.endswith(guards.C_EXT))
    mine = [line for _, line in kept]
    theirs = pret.splitlines(True)
    if mine == theirs:
        return problems
    where = [n for n, _ in kept]
    sm = difflib.SequenceMatcher(None, theirs, mine, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            continue
        # A line number in our file: the first changed line, or the one the deletion
        # sits before.
        n = where[j1] if j1 < len(where) else (where[-1] + 1 if where else 1)
        lines = ['-' + l for l in theirs[i1:i2]] + ['+' + l for l in mine[j1:j2]]
        problems.append((n, 'differs from pret outside a BR guard:\n' +
                         ''.join('    ' + l.rstrip('\r\n') + '\n' for l in lines).rstrip('\n')))
    return problems


def main(argv):
    ref = None
    files = []
    args = argv[1:]
    while args:
        a = args.pop(0)
        if a == '--ref':
            ref = args.pop(0)
        else:
            files.append(a)
    if ref is None:
        ref = open(os.path.join(HERE, 'BASELINE_COMMIT')).read().strip()
    # `-t`, not `-e <ref>^{commit}`: an MSYS2 git started from a native python expands
    # the braces in its arguments, and then no commit is ever found.
    try:
        if git('cat-file', '-t', ref).strip() != b'commit':
            raise subprocess.CalledProcessError(1, 'git cat-file')
    except subprocess.CalledProcessError:
        print('pret-intact: no commit %s here; fetch it first: git fetch --depth=1 origin %s'
              % (ref, ref))
        return 2

    bad = 0
    checked = 0
    for status, rel in changed(ref, files):
        if status == 'A' or rel.startswith(guards.OWNED):
            continue  # ours outright
        if status == 'D':
            print('%s: deleted; pret\'s files stay (guard the build out instead)' % rel)
            bad += 1
            continue
        if not rel.endswith(guards.C_EXT + guards.ASM_EXT):
            if rel not in NOT_SOURCE and not same_but_eol(ref, rel):
                print('%s: a pret file with no guard syntax differs; list it in NOT_SOURCE '
                      '(tools/br/pret-intact.py) with why, or restore it' % rel)
                bad += 1
            continue
        checked += 1
        for n, why in check(ref, rel):
            print('%s:%d: %s' % (rel, n, why))
            bad += 1
    if bad:
        print('\n%d place(s) where a pret file is not pret\'s outside `#if BR` / `.if BR`. '
              'Put the change inside the guard, or restore pret\'s line (docs/C-STYLE.md).'
              % bad)
        return 1
    print('pret-intact: %d changed pret source files, each pret\'s own outside its BR guards '
          '(against %s)' % (checked, ref[:9]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
