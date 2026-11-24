#!/usr/bin/env bash
# The test selection step of ci.yml's checks and public-export jobs, on a pull request: writes <dir>/selection.txt
# ("all", or the test files to run, one per line), says why, and appends selected=true or selected=false to
# $GITHUB_OUTPUT. The base commit's copy of scripts/ci/select-tests.ts decides, with bun reading no bunfig.toml,
# tsconfig.json or .env from the head, from the map on this repository's ci-test-map branch. The base is the merge commit's
# first parent (the base branch tip GitHub merged into) and the head is the merge commit itself, so the list names files in
# the tree the tests run in. Anything but a clean list means the full run: the full-tests label (FULL_LABEL=true), a pull
# request whose own branch is ci-test-map (HEAD_REF), a HEAD that is not a merge commit, [full tests] in the head commit's
# message, a base with no selector (or, for --profile export, one that predates the profile), no map branch, or an error.
# Any other arguments mean the full run, so a mistyped profile never selects with the wrong rules.
# Usage: bash scripts/ci/select-step.sh <dir> [--profile export]
set -uo pipefail
d=$1
profile=()
args=ok
if [ "$#" -eq 3 ] && [ "$2" = --profile ] && [ "$3" = export ]; then profile=(--profile export); elif [ "$#" -ne 1 ]; then args=bad; fi
mkdir -p "$d" && : > "$d/bunfig.toml" && echo '{}' > "$d/tsconfig.json"
echo all > "$d/selection.txt"
base=$(git rev-parse --verify -q HEAD^1 || true)
head=$(git rev-parse --verify -q HEAD^2 || true)
if [ "$args" = bad ]; then
  echo "full run: select-step.sh takes <dir> and optionally --profile export, not: ${*:2}"
elif [ "${FULL_LABEL:-}" = true ]; then
  echo "full run: the full-tests label"
elif [ "${HEAD_REF:-}" = ci-test-map ]; then
  echo "full run: the pull request's own branch is ci-test-map"
elif [ -z "$base" ] || [ -z "$head" ]; then
  echo "full run: HEAD is not the pull request's merge commit"
elif git log -1 --format=%B "$head" | grep -qiF '[full tests]'; then
  echo "full run: [full tests] in the head commit's message"
elif ! git show "$base:scripts/ci/select-tests.ts" > "$d/select-tests.ts" 2>/dev/null; then
  echo "full run: the base has no scripts/ci/select-tests.ts"
elif [ "${#profile[@]}" -gt 0 ] && ! grep -q EXPORT_FULL_RUN "$d/select-tests.ts"; then
  echo "full run: the base's scripts/ci/select-tests.ts has no export profile"
elif ! git fetch -q --no-tags origin +refs/heads/ci-test-map:refs/ci-test-map/map 2>/dev/null; then
  echo "full run: this repository has no ci-test-map branch"
else
  bun --no-env-file --config="$d/bunfig.toml" --tsconfig-override="$d/tsconfig.json" "$d/select-tests.ts" --base "$base" --head HEAD --map-rev refs/ci-test-map/map "${profile[@]}" > "$d/selection.txt" || echo all > "$d/selection.txt"
fi
if [ "$(head -n1 "$d/selection.txt")" = all ] || ! grep -q . "$d/selection.txt"; then
  echo all > "$d/selection.txt"
  echo "selected=false" >> "$GITHUB_OUTPUT"
else
  echo "selected=true" >> "$GITHUB_OUTPUT"
  if [ "${#profile[@]}" -gt 0 ]; then gate="the export tree's full suite runs on the push to main, and nothing runs it before merge"; else gate="ubicloud/checks runs the full suite before merge"; fi
  { echo "Test selection${profile[1]:+ (${profile[1]})}: $(grep -c . "$d/selection.txt") test file(s); $gate."; sed 's/^/- /' "$d/selection.txt"; } >> "$GITHUB_STEP_SUMMARY"
fi
