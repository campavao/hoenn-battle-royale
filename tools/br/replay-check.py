#!/usr/bin/env python3
"""Replay a fight one ROM fought on another, and check they agree turn by turn (HBR-63).

    bash tools/br/drive.sh spectate-replay-wild | python3 tools/br/replay-check.py

A spectator's replay is built from the fight's BSTART (seed, flags, both parties) and
its TURNs (every battler's choices), and each TURN carries the fighter's sum of every
battler's species and HP as the last turn ended (BR_SPECTATE_CHECK). The replay sums its
own and counts a drift when they differ -- and ends the watch there, which a watcher
sees as the fight vanishing and coming back from the top on the next peek.

The fighter driver runs a real fight with `drain gBrMailbox log`, so its log holds every
message the ROM sent, whole (`outmsg <type> <len> <hex>`). This builds a second driver
out of the BSTART (18) and TURNs (19) in it, the way the page hands them to a watcher's
ROM, runs it on the same ROM, and asks the watcher's gBrJank: at least one check
(+10), and no drift (+12).

Exits 1 when they disagree or the watcher's run fails, 2 when the fight sent nothing
to check (no BSTART, or no TURN carrying a sum).
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BSTART, TURN = 18, 19
CHECK_RUN = "C0 03"
# A spectator's boot: spectate-check.txt's, seat 0 on Littleroot.
BOOT = ["wait 30", "pokebytes gBrMailbox+0x2018 81 00 00 09 05 00 08 00 BD BB C7 FF", "wait 400"]
# Long enough for the replay to play every turn handed to it with its animations on.
PLAY_FRAMES = 6000


def messages(log):
    out = []
    for line in log:
        f = line.split()
        if len(f) < 3 or f[0] != "outmsg":
            continue
        kind, n = int(f[1]), int(f[2])
        if kind in (BSTART, TURN):
            out.append((kind, f[3:3 + n]))
    return out


def watcher(msgs):
    lines = list(BOOT)
    for kind, data in msgs:
        lines.append("pokebytes gDecompressionBuffer " + " ".join(data))
        lines.append("mailsend gBrMailbox %d gDecompressionBuffer %d" % (kind, len(data)))
        lines.append("wait 10")
    lines.append("wait %d" % PLAY_FRAMES)
    lines.append("expectge u16 gBrJank+10 1")
    lines.append("expect u16 gBrJank+12 0")
    lines.append("say replay agreed with the fight")
    return "\n".join(lines) + "\n"


def main():
    msgs = messages(sys.stdin)
    starts = [m for m in msgs if m[0] == BSTART]
    sums = [m for m in msgs if m[0] == TURN and CHECK_RUN in " ".join(m[1])]
    if len(starts) != 1 or not sums:
        print("replay-check: the fight sent %d BSTART and %d TURN with a sum -- nothing to check" % (len(starts), len(sums)))
        return 2
    print("replay-check: %d messages, %d turn sums" % (len(msgs), len(sums)))
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "replay-watcher.txt")
        with open(path, "w") as f:
            f.write(watcher(msgs))
        cmd = ["bash", os.path.join(HERE, "drive.sh"), path]
        if os.environ.get("ROM"):
            cmd.append(os.environ["ROM"])
        run = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    tail = [l for l in run.stdout.splitlines() if l.startswith(("expect", "line ", "replay", "PASS", "FAIL"))]
    print("\n".join(tail))
    if run.returncode != 0:
        print("replay-check: the watcher's replay disagreed with the fight (gBrJank+12 is drifts)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
