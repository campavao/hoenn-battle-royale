#!/usr/bin/env bash
# Is the ROM this session will hand back built from the C it edited?
#
#     rom-fresh.sh mark    PostToolUse on Edit|Write|MultiEdit: note that this session
#                          touched ROM source (src/, include/, data/, asm/)
#     rom-fresh.sh check   Stop: if it did, and that source is newer than both ROMs (or
#                          there is no ROM), block the stop once and say what to run
#
# Play-test bugs came back "fixed" because the tab ran a ROM older than the fix. The
# hook's input is JSON on stdin; the mark lives in the temp dir, keyed by session, so
# nothing lands in the tree. Only C and asm count: map JSON and graphics edits are not
# checked.
set -u

input="$(cat)"
# stdin, not argv: Windows python mangles the backslashes in a JSON path passed as an arg.
PY="$(command -v python3 || command -v python)"
field() { printf '%s' "$input" | "$PY" -c "import json,sys;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
session="$(field "['session_id']")"
mark="${TMPDIR:-/tmp}/hbr-rom-dirty-${session:-unknown}"

case "${1:-}" in
  mark)
    path="$(field "['tool_input']['file_path']" | tr '\\' '/')"
    if [[ "$path" =~ /(src|include|data|asm)/.*\.(c|h|inc|s)$ ]]; then
      : > "$mark"
    fi
    exit 0
    ;;
  check)
    [[ -f "$mark" ]] || exit 0
    # Already blocked once this turn: let it stop rather than loop.
    [[ "$(field "['stop_hook_active']")" == "True" ]] && exit 0

    rom=""
    for r in "$ROOT/pokeemerald_modern.gba" "$ROOT/pokeemerald.gba"; do
      [[ -f "$r" && ( -z "$rom" || "$r" -nt "$rom" ) ]] && rom="$r"
    done
    if [[ -z "$rom" ]]; then
      stale="no ROM is built in $ROOT"
    else
      newer="$(cd "$ROOT" && find src include data asm \( -name '*.c' -o -name '*.h' -o -name '*.inc' -o -name '*.s' \) -newer "$rom" 2>/dev/null | head -5)"
      [[ -z "$newer" ]] && { rm -f "$mark"; exit 0; }
      stale="these are newer than $(basename "$rom"):
$newer"
    fi
    cat >&2 <<EOF
ROM source changed this session but the ROM was not rebuilt -- $stale
Rebuild (make modern for dev, CLAUDE.md), re-run the driver against the new ROM, and for
the shell re-run tools/br/dev-patch.sh. If you cannot build, say so plainly instead of
calling the fix done.
EOF
    exit 2
    ;;
esac
exit 0
