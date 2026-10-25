#!/usr/bin/env bash
# Would the docker-e2e job in .github/workflows/ci.yml run for this checkout? Exit 0 when it would, 1 when the workflow
# would skip it, 2 on a usage error. Prints one line saying why.
#
#   scripts/ubicloud/docker-applies.sh [BASE] [HEAD]
#
# A workflow without a path filter runs docker-e2e on every pull request. A workflow with the `changes` job (#50) names
# the paths that trigger it in one line, `git diff --name-only "$BASE" "$GITHUB_SHA" -- <paths>`; this script reads that
# line from the checkout's own workflow file and runs the same diff between BASE (the argument, HE_BASE_SHA, or the merge
# base with origin/main) and HEAD. HE_DOCKER=always or HE_DOCKER=never overrides the answer.
set -euo pipefail
cd "$(dirname "$0")/../.."
wf=.github/workflows/ci.yml
base=${1:-${HE_BASE_SHA:-}}
head=${2:-HEAD}
case "${HE_DOCKER:-auto}" in
  always) echo "docker-e2e: forced on (HE_DOCKER=always)"; exit 0 ;;
  never) echo "docker-e2e: forced off (HE_DOCKER=never)"; exit 1 ;;
  auto) ;;
  *) echo "docker-applies: HE_DOCKER must be auto, always or never" >&2; exit 2 ;;
esac
[ -f "$wf" ] || { echo "docker-e2e: no $wf in this checkout"; exit 1; }
grep -q '^  docker-e2e:' "$wf" || { echo "docker-e2e: no such job in $wf"; exit 1; }
paths=$(sed -n 's/.*git diff --name-only "\$BASE" "\$GITHUB_SHA" -- \(.*\))$/\1/p' "$wf" | head -1)
if [ -z "$paths" ]; then echo "docker-e2e: the workflow runs it on every pull request"; exit 0; fi
[ -n "$base" ] || base=$(git merge-base origin/main "$head" 2>/dev/null || true)
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then echo "docker-e2e: no base commit; the workflow would run it"; exit 0; fi
changed=$(eval "git diff --name-only \"$base\" \"$head\" -- $paths")
if [ -n "$changed" ]; then printf 'docker-e2e: runs; paths changed since %s:\n%s\n' "${base:0:12}" "$changed"; exit 0; fi
echo "docker-e2e: skipped; no gbrain path changed since ${base:0:12}"
exit 1
