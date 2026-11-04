#!/usr/bin/env bash
# Sourced by merge-pass.sh, pr-watch.sh and pr-check.sh: the checks each lane script makes before it reads, checks out
# or merges a pull request (internal-task, before any public copy of this repository exists).
#
# lane_repo_ok NAME REPO OVERRIDE: the lane runs on garrytan/harness-evals only (GitHub compares names without case),
# whatever the checkout's origin says, so a clone of a public copy or a fork never checks or merges its own pull
# requests. OVERRIDE=1 (the script's --allow-other-repo) aims it elsewhere on purpose, as the tests do. Otherwise it
# names the repo on stderr and returns 1.
#
# lane_allow_load: reads the author allowlist into lane_allow. The file is HE_AUTHORS_ALLOW, or authors.allow beside
# this file: one GitHub login per line, blank lines and # comments ignored. A missing or unreadable file, one with no
# login, or a line that is not a GitHub login returns 1, and the caller stops instead of trusting every author.
#
# lane_refusal CROSS AUTHOR: prints why a pull request is refused, or nothing when it may go on. CROSS is GitHub's
# isCrossRepository and AUTHOR the author's login. A head in another repository (a fork) is refused, and so is a pull
# request whose metadata did not come back (CROSS not exactly false, or no author), or whose author is not allowlisted.
lane_repo=garrytan/harness-evals
lane_allow_file=${HE_AUTHORS_ALLOW:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/authors.allow}
lane_allow=()

lane_repo_ok() {
  { [ "$3" = 1 ] || [ "${2,,}" = "$lane_repo" ]; } && return 0
  echo "$1: refusing repo '$2': the lane runs only on $lane_repo (pass --allow-other-repo to aim it elsewhere)" >&2
  return 1
}

lane_allow_load() {
  local lines line
  lane_allow=()
  lines=$(grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' -- "$lane_allow_file" 2>/dev/null) || return 1
  while read -r line; do
    line=${line%$'\r'}
    [[ "$line" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || return 1
    lane_allow+=("${line,,}")
  done <<<"$lines"
  [ ${#lane_allow[@]} -gt 0 ]
}

lane_refusal() {
  local a
  case ${1:-} in
    false) ;;
    true) echo "the head is in another repository (a fork)"; return 0 ;;
    *) echo "could not read whether the head is in another repository"; return 0 ;;
  esac
  [ -n "${2:-}" ] || { echo "could not read the author"; return 0; }
  for a in "${lane_allow[@]}"; do [ "$a" != "${2,,}" ] || return 0; done
  echo "author $2 is not on the lane allowlist"
}
