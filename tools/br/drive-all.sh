#!/usr/bin/env bash
# Every driver against one ROM, the way CI runs them:
#
#     tools/br/drive-all.sh [rom]     # the ROM goes to drive.sh as-is (see its rule)
#     tools/br/drive-all.sh --lint    # only says how each driver is checked; runs nothing
#
# The harness exits 0 when no expect failed, which includes a driver with no expect at
# all: six drivers printed `ok` in CI while asserting nothing (POK-330 #37). So every
# driver says how it is checked, and one that says nothing fails:
#
#   expect/expectge/expectle/expectne lines   the harness asserts them
#   # checked-by: <script>    the run's output goes to <script> (python, repo-relative),
#                             which must exit 0 -- for checks too big for an expect line
#   # capture-only: <why>     frames and dumps for a person to read; it still has to run
#                             clean (no harness failure, no stuck netlink)
#
# Logs land in $DRIVE_LOGS (default ${TMPDIR:-/tmp}/br-drivers), one per driver.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

LINT=0
if [[ "${1:-}" == "--lint" ]]; then LINT=1; shift; fi
ROM="${1:-}"
LOGS="${DRIVE_LOGS:-${TMPDIR:-/tmp}/br-drivers}"
mkdir -p "$LOGS"

# How a driver is checked: "expect", "checked-by <script>", "capture-only" or "hollow".
how() {
  local checker
  checker="$(sed -nE 's/^#[[:space:]]*checked-by:[[:space:]]*([^[:space:]]+).*/\1/p' "$1" | head -1)"
  if [[ -n "$checker" ]]; then echo "checked-by $checker"
  elif grep -qE '^[[:space:]]*expect(ge|le|ne)?[[:space:]]' "$1"; then echo "expect"
  elif grep -qE '^#[[:space:]]*capture-only:' "$1"; then echo "capture-only"
  else echo "hollow"
  fi
}

pass=0
fail=0
for d in "$HERE"/drivers/*.txt; do
  n="$(basename "$d" .txt)"
  kind="$(how "$d")"
  if [[ "$kind" == "hollow" ]]; then
    echo "FAIL $n: asserts nothing -- give it expect lines, '# checked-by: <script>' or '# capture-only: <why>'"
    fail=$((fail + 1))
    continue
  fi
  if [[ "$kind" == checked-by* && ! -f "$ROOT/${kind#checked-by }" ]]; then
    echo "FAIL $n: its checker ${kind#checked-by } does not exist"
    fail=$((fail + 1))
    continue
  fi
  if [[ "$LINT" -eq 1 ]]; then
    echo "ok   $n ($kind)"
    pass=$((pass + 1))
    continue
  fi

  log="$LOGS/$n.log"
  ok=1
  bash "$HERE/drive.sh" "$n" ${ROM:+"$ROM"} > "$log" 2>&1 || ok=0
  if [[ "$ok" -eq 1 && "$kind" == checked-by* ]]; then
    python3 "$ROOT/${kind#checked-by }" < "$log" > "$log.check" 2>&1 || ok=0
    cat "$log.check" >> "$log"
  fi
  label=""
  [[ "$kind" == "expect" ]] || label=" ($kind)"
  if [[ "$ok" -eq 1 ]]; then
    echo "ok   $n$label"
    pass=$((pass + 1))
  else
    echo "FAIL $n$label"
    tail -20 "$log"
    fail=$((fail + 1))
  fi
done

echo "$((pass + fail)) drivers: $pass ok, $fail failed"
[[ "$fail" -eq 0 ]]
