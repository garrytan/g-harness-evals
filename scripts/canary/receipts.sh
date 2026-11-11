#!/usr/bin/env bash
# The canary's receipts live on the orphan branch canary-receipts of garrytan/harness-evals: one directory per run id under
# runs/, history.jsonl (one line per product per run, plus one per quiet night), the monthly lease ledgers under leases/, and
# lock.json while a run is in flight. It is never merged, exported or opened as a pull request. Every write happens in a
# temporary clone (sparse, blobless) that is removed on exit, so no checkout of main is ever touched.
#
#   scripts/canary/receipts.sh state [--now <iso>]                       JSON from history.jsonl (scripts/canary/receipts.ts state)
#   scripts/canary/receipts.sh lock --run-id <id> [--fresh-hours 12]     push lock.json; exit 3 when another run holds a fresh lock
#   scripts/canary/receipts.sh unlock --run-id <id>                      remove this run's lock
#   scripts/canary/receipts.sh cat --path <path> --out <file>            copy one file from the branch tip; exit 1 when absent, 6 when the remote or fetch fails
#   scripts/canary/receipts.sh publish --run-id <id> --dir <run dir> --history <lines.jsonl> [--ledger <file> --ledger-name <name>]
#       strips proxy-capture bodies (a sha256 manifest stays), refuses capture-shaped bodies elsewhere and any token pattern
#       (exit 4), runs gstack-pregate sealed when it is installed (exit 4 on a finding), then commits runs/<id>/, the history
#       lines and the ledger, drops this run's lock and pushes. Exit 5 when runs/<id>/ already exists.
#
# The branch is created as an orphan when it is missing. Every command takes --remote <url> (default: CANARY_RECEIPTS_REMOTE,
# else https://github.com/garrytan/harness-evals.git). A push that loses a race is retried from a fresh clone, three times.
set -euo pipefail
# No auto gc or maintenance: git 2.55 detaches it after a fetch or push, and a detached run still writing into the temporary
# clone races the EXIT trap's rm -rf, which then fails the command (a read of the history came back INCOMPLETE).
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false GIT_CONFIG_KEY_1=gc.auto GIT_CONFIG_VALUE_1=0
here=$(cd "$(dirname "$0")" && pwd)
branch=${CANARY_RECEIPTS_BRANCH:-canary-receipts}
remote=${CANARY_RECEIPTS_REMOTE:-https://github.com/garrytan/harness-evals.git}
pregate_bin=${CANARY_PREGATE:-$HOME/.local/share/gstack/bin/gstack-pregate}
cmd=${1:-}; [ $# -gt 0 ] && shift
run_id="" dir="" history="" ledger="" ledger_name="" path="" out="" fresh_hours=12 now=""
while [ $# -gt 0 ]; do
  case $1 in
    --remote) remote=$2; shift 2 ;;
    --run-id) run_id=$2; shift 2 ;;
    --dir) dir=$2; shift 2 ;;
    --history) history=$2; shift 2 ;;
    --ledger) ledger=$2; shift 2 ;;
    --ledger-name) ledger_name=$2; shift 2 ;;
    --path) path=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --fresh-hours) fresh_hours=$2; shift 2 ;;
    --now) now=$2; shift 2 ;;
    *) echo "receipts: unknown argument $1" >&2; exit 2 ;;
  esac
done
case $run_id in *[!A-Za-z0-9._-]*) echo "receipts: a run id is [A-Za-z0-9._-] only" >&2; exit 2 ;; esac
now=${now:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
work=$(mktemp -d "${TMPDIR:-/tmp}/canary-receipts.XXXXXX")
trap 'rm -rf "$work"' EXIT
w="$work/w"
base=""
g() { git -C "$w" "$@"; }
say() { echo "receipts: $*" >&2; }

# A sparse, blobless clone of the branch tip in $w (history.jsonl, lock.json and leases/ checked out), or a new orphan.
checkout() {
  rm -rf "$w"
  git init -q "$w"
  g remote add origin "$remote"
  local heads
  heads=$(g ls-remote --heads origin "$branch") || { say "cannot reach the receipts remote"; exit 1; }
  if [ -z "$heads" ]; then
    g checkout -q --orphan "$branch"
    printf '# canary-receipts\n\nReceipts of the regression canary (scripts/canary/run.sh, docs/canary.md). Orphan branch: never merged, exported or opened as a pull request.\n' > "$w/README.md"
    : > "$w/history.jsonl"
    g add README.md history.jsonl
    g commit -q -m "Start the canary receipts branch"
    base=""
    return
  fi
  g fetch -q --depth 1 --filter=blob:none origin "+refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null || g fetch -q --depth 1 origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  g sparse-checkout set --no-cone /README.md /history.jsonl /lock.json /leases/ >/dev/null 2>&1
  g checkout -q -B "$branch" "origin/$branch"
  base="origin/$branch"
}

push() { g push -q origin "HEAD:refs/heads/$branch" 2>/dev/null; }

case $cmd in
  state)
    if [ -z "$(git ls-remote --heads "$remote" "$branch")" ]; then : > "$work/h"; else
      git init -q "$w"; g fetch -q --depth 1 "$remote" "+refs/heads/$branch:refs/remotes/origin/$branch"
      g show "origin/$branch:history.jsonl" > "$work/h" 2>/dev/null || : > "$work/h"
    fi
    bun "$here/receipts.ts" state --history "$work/h" --now "$now" ;;
  cat)
    [ -n "$path" ] && [ -n "$out" ] || { say "cat needs --path and --out"; exit 2; }
    heads=$(git ls-remote --heads "$remote" "$branch") || { say "cannot reach the receipts remote"; exit 6; }
    [ -n "$heads" ] || exit 1
    git init -q "$w"; g fetch -q --depth 1 "$remote" "+refs/heads/$branch:refs/remotes/origin/$branch" || { say "cannot fetch $branch"; exit 6; }
    g cat-file -e "origin/$branch:$path" 2>/dev/null || exit 1
    g show "origin/$branch:$path" > "$out" || { say "cannot read $path"; exit 6; } ;;
  lock)
    [ -n "$run_id" ] || { say "lock needs --run-id"; exit 2; }
    for try in 1 2 3; do
      checkout
      bun "$here/receipts.ts" lock-check --lock "$w/lock.json" --run-id "$run_id" --fresh-hours "$fresh_hours" --now "$now" >/dev/null || exit 3
      printf '{"run_id": "%s", "at": "%s", "host": "%s"}\n' "$run_id" "$now" "$(hostname)" > "$w/lock.json"
      g add lock.json
      g commit -q -m "Lock canary run $run_id"
      push && { say "locked for $run_id"; exit 0; }
      say "lock push lost a race (try $try)"
    done
    exit 1 ;;
  unlock)
    [ -n "$run_id" ] || { say "unlock needs --run-id"; exit 2; }
    for try in 1 2 3; do
      checkout
      [ -f "$w/lock.json" ] && grep -q "\"run_id\": \"$run_id\"" "$w/lock.json" || exit 0
      g rm -q lock.json
      g commit -q -m "Unlock canary run $run_id"
      push && exit 0
    done
    exit 1 ;;
  publish)
    [ -n "$run_id" ] && [ -d "$dir" ] && [ -f "$history" ] || { say "publish needs --run-id, --dir <run dir> and --history <file>"; exit 2; }
    [ -z "$ledger" ] || [ -n "$ledger_name" ] || { say "--ledger needs --ledger-name"; exit 2; }
    mkdir -p "$work/in/runs/$run_id" "$work/in/extra"
    cp -R "$dir/." "$work/in/runs/$run_id/"
    cp "$history" "$work/in/extra/history.add"
    [ -z "$ledger" ] || cp "$ledger" "$work/in/extra/$ledger_name"
    bun "$here/receipts.ts" prepare --src "$work/in" --dst "$work/out" >/dev/null || { say "refused before push: see the lines above"; exit 4; }
    [ ! -f "$work/out/capture-manifest.json" ] || mv "$work/out/capture-manifest.json" "$work/out/runs/$run_id/capture-manifest.json"
    for try in 1 2 3; do
      checkout
      if [ -n "$base" ] && g cat-file -e "$base:runs/$run_id" 2>/dev/null; then say "runs/$run_id is already on $branch"; exit 5; fi
      mkdir -p "$w/runs"
      cp -R "$work/out/runs/$run_id" "$w/runs/"
      cat "$work/out/extra/history.add" >> "$w/history.jsonl"
      if [ -n "$ledger" ]; then mkdir -p "$w/leases"; cp "$work/out/extra/$ledger_name" "$w/leases/$ledger_name"; fi
      if [ -f "$w/lock.json" ] && grep -q "\"run_id\": \"$run_id\"" "$w/lock.json"; then g rm -q lock.json; fi
      g add --sparse -A
      g commit -q -m "Canary run $run_id"
      if [ -x "$pregate_bin" ]; then
        pbase=$branch
        g fetch -q --depth 1 --filter=blob:none origin "main:refs/remotes/origin/main" 2>/dev/null && pbase=main
        range=${base:+$base..}HEAD
        (cd "$w" && "$pregate_bin" sealed --range "$range" --base "$pbase") >&2 || { say "gstack-pregate sealed refused the push"; exit 4; }
      else
        say "gstack-pregate is not installed here; the sealed guard did not run (the token scan and capture strip did)"
      fi
      push && { say "published runs/$run_id"; exit 0; }
      say "publish push lost a race (try $try)"
    done
    exit 1 ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2 ;;
esac
