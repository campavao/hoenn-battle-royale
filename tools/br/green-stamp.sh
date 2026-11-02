#!/usr/bin/env bash
# Has this tree already passed?  Prints "<artifact id> <run id>", or nothing.
#
#     tools/br/green-stamp.sh checks <tree sha>    # guards, wasm, web, relay, the whole e2e
#     tools/br/green-stamp.sh rom <tree sha>       # the ROM built and every driver on it
#
# ci.yml's `green` job uploads a stamp only once those jobs have passed, and names it after
# the git tree it tested, not the commit: a squash merge makes a new commit from the tree a
# pull request's run already tested when the base has not moved since. A tree also holds
# ci.yml, so a stamp was earned under the workflow that reads it. A fork's pull request can
# upload an artifact of any name, so only this repository's own branches count. Artifacts
# expire (14 days, the `green` job), and an API error prints nothing too: either way the
# caller runs the suite.
set -uo pipefail

KIND="${1:?usage: green-stamp.sh checks|rom <tree sha>}"
TREE="${2:?usage: green-stamp.sh checks|rom <tree sha>}"
REPO="${GITHUB_REPOSITORY:-campavao/hoenn-battle-royale}"

out="$(gh api "repos/$REPO/actions/artifacts?name=green-$KIND-$TREE&per_page=20" --jq '
  [.artifacts[]
    | select(.expired == false
             and .workflow_run.head_repository_id == .workflow_run.repository_id)]
  | sort_by(.created_at) | last // empty
  | "\(.id) \(.workflow_run.id)"' 2>/dev/null)" || out=
# gh prints an API error's body on stdout: only the answer's shape counts as a stamp.
if [[ "$out" =~ ^[0-9]+\ [0-9]+$ ]]; then echo "$out"; fi
