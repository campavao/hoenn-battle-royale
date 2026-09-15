#!/usr/bin/env bash
set -euo pipefail

ROM="${1:-pokeemerald.gba}"
EXPECTED="f3ae088181bf583e55daf962a92bb46f4f1d07b7"

if [ ! -f "$ROM" ]; then
	echo "MISMATCH got (missing) want ${EXPECTED}"
	exit 1
fi

GOT="$(sha1sum "$ROM" | awk '{print $1}')"

if [ "$GOT" = "$EXPECTED" ]; then
	echo "OK ${GOT}"
	exit 0
else
	echo "MISMATCH got ${GOT} want ${EXPECTED}"
	exit 1
fi
