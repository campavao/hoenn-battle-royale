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
#   expect/expectge/expectle/expectne/expectbits/expectmsg/expectsame lines   the harness asserts them
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
  elif grep -qE '^[[:space:]]*expect(ge|le|ne|bits|msg|same)?[[:space:]]' "$1"; then echo "expect"
  elif grep -qE '^#[[:space:]]*capture-only:' "$1"; then echo "capture-only"
  else echo "hollow"
  fi
}

# Drivers are independent (each boots its own core and writes only its own frames
# directory), so they run $DRIVE_JOBS at a time, one per core by default. One at a time
# they were 11 of the rom job's 14 minutes (2026-10-29). Results print in name order
# whatever order they finish in.
JOBS="${DRIVE_JOBS:-$(nproc 2>/dev/null || echo 1)}"

pass=0
fail=0
runnable=()
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
  runnable+=("$n")
done

# One driver: its log, and a .result holding "ok" or "fail". Always exits 0, so one red
# driver never stops the others.
drive_one() {
  local n="$1" kind log ok=1
  kind="$(how "$HERE/drivers/$n.txt")"
  log="$LOGS/$n.log"
  rm -f "$log.check"
  bash "$HERE/drive.sh" "$n" ${ROM:+"$ROM"} > "$log" 2>&1 || ok=0
  if [[ "$ok" -eq 1 && "$kind" == checked-by* ]]; then
    # ROM goes along for a checker that drives a second run (replay-check.py)
    ROM="$ROM" BR_DRIVER="$n" python3 "$ROOT/${kind#checked-by }" < "$log" > "$log.check" 2>&1 || ok=0
    cat "$log.check" >> "$log"
  fi
  if [[ "$ok" -eq 1 ]]; then echo ok > "$LOGS/$n.result"; else echo fail > "$LOGS/$n.result"; fi
}

if [[ "${#runnable[@]}" -gt 0 ]]; then
  for n in "${runnable[@]}"; do rm -f "$LOGS/$n.result"; done
  # The first on its own: drive.sh compiles the harness (and on Linux libmgba) on first
  # use, and two of them doing that at once would race on the same files.
  drive_one "${runnable[0]}"
  if [[ "${#runnable[@]}" -gt 1 ]]; then
    export -f drive_one how
    export HERE ROOT ROM LOGS
    # `|| true`: a driver xargs lost (killed, say) has no .result, and the summary below
    # counts it failed; set -e must not skip that summary.
    printf '%s\n' "${runnable[@]:1}" | xargs -P "$JOBS" -I{} bash -c 'drive_one "$1"' _ {} || true
  fi
fi

for n in "${runnable[@]}"; do
  kind="$(how "$HERE/drivers/$n.txt")"
  label=""
  [[ "$kind" == "expect" ]] || label=" ($kind)"
  if [[ "$(cat "$LOGS/$n.result" 2>/dev/null)" == ok ]]; then
    echo "ok   $n$label"
    pass=$((pass + 1))
  else
    echo "FAIL $n$label"
    tail -20 "$LOGS/$n.log"
    fail=$((fail + 1))
  fi
done

echo "$((pass + fail)) drivers: $pass ok, $fail failed"
[[ "$fail" -eq 0 ]]
