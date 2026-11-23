#!/usr/bin/env bash
# internal-task: one install canary run, end to end. Takes the drive lock, picks the gbrain releases nobody has tested yet
# (canary.ts select), runs them on one Ubicloud VM (vm.sh through ubi-runner.sh; keyless, scripted model), publishes the
# results to the folder gbrain's release checks read (canary.ts publish), takes down this run's VM if it is still up, and
# drops the lock.
#
#   bash scripts/install-canary/run.sh [--dest DIR] [--candidate TAG] [--tag TAG]... [--max N] [--harness h1,h2] [--local]
#
#   --candidate  gbrain's next stable candidate: always tested, first
#   --tag        test only these tags (a re-run by hand); the stable channel job is left out
#   --harness    run only these harnesses (a by-hand check; its lines say promotable false)
#   --local      run the jobs on this machine's Docker instead of a VM (needs the images' build context and Docker)
#
# A one-off request can also be left as <dest>/request.args: run.sh arguments, one request per line (only --candidate, --tag,
# --max, --harness and --dest). Each run claims the file by renaming it to request.args.<run id> and runs its first line. Once it
# has published it puts the other lines back; if it stops before then, it puts every line back at the front.
# A request written while a run is going waits for the next run. gbrain's release owner writes the next stable candidate there;
# a --dest in it sends that run's results to another folder (used for test runs).
#
# When the results go to the default folder (the one gbrain reads) and the run is not a --harness subset, it posts the
# gbrain/install-canary commit status on each tested release's commit: pending as each job starts, then success or failure after
# publish (canary.ts status). A status that does not land prints a CANARY_STATUS line; the published results stand.
#
# Prints the published lines, latest.json's line, and a CANARY_NOTIFY_BEGIN/END block naming what gbrain's maintainers must hear about.
# Exit 0 when the run published (whatever the verdicts), 4 locked, 5 GitHub or ls-remote failed, 6 the drive write failed,
# 7 published but a commit status did not land.
set -uo pipefail
cd "$(dirname "$0")/../.."
default_dest="<private drive>/handoffs/gbrain-install-canary"
dest=$default_dest
local_run=
sel=()
harness=
while [ $# -gt 0 ]; do
  case $1 in
    --dest) dest=$2; shift 2 ;;
    --candidate|--tag|--max) sel+=("$1" "$2"); shift 2 ;;
    --harness) harness=$2; shift 2 ;;
    --local) local_run=1; shift ;;
    *) echo "run.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
export PATH="$HOME/.bun/bin:$PATH" UBI_OWNER=installcanary
c=scripts/install-canary/canary.ts
run_id=$(date -u +%Y%m%dT%H%M%SZ)-$$
work=$HOME/.capy/work/install-canary/$run_id
mkdir -p "$work"
echo "[canary] run $run_id, work dir $work"
request=$dest/request.args
claimed=
# requeue FILE: put FILE's lines back at the front of request.args, ahead of any request written since.
requeue() {
  if [ -e "$request" ]; then { cat "$1"; [ -z "$(tail -c 1 "$1")" ] || echo; cat "$request"; } > "$request.tmp.$run_id" && mv "$request.tmp.$run_id" "$request" && rm -f "$1"
  else mv "$1" "$request"; fi
}
if [ -f "$request" ] && mv "$request" "$request.$run_id" 2>/dev/null; then
  claimed=$request.$run_id
  read -r -a req < <(grep -m1 . "$claimed") || true
  echo "[canary] request.args: ${req[*]}"
  rsel=() rdest=$dest rharness=$harness ok=1 i=0
  while [ $i -lt ${#req[@]} ]; do
    case ${req[$i]} in
      --candidate|--tag|--max) rsel+=("${req[$i]}" "${req[$((i + 1))]:-}"); i=$((i + 2)) ;;
      --dest) rdest=${req[$((i + 1))]:-$dest}; i=$((i + 2)) ;;
      --harness) rharness=${req[$((i + 1))]:-}; i=$((i + 2)) ;;
      *) echo "run.sh: request.args has $(printf %q "${req[$i]}"), which it does not take; leaving the file in place" >&2; ok=; break ;;
    esac
  done
  if [ -n "$ok" ]; then sel+=(${rsel[@]+"${rsel[@]}"}); dest=$rdest; harness=$rharness
  else requeue "$claimed"; claimed=; fi
fi
post_status=1
if [ -n "$harness" ]; then post_status=; echo "[canary] commit status: none posted (a --harness check is no verdict on the release)"
elif [ "$dest" != "$default_dest" ]; then post_status=; echo "[canary] commit status: none posted (results go to $dest, not the folder gbrain reads)"; fi
status_rc=0
watcher=
plan=.install-canary-plan-$run_id.json
locked=
cleanup() {
  [ -z "$watcher" ] || kill "$watcher" 2>/dev/null
  rm -f "$plan"
  [ -z "$locked" ] || bun $c unlock --dest "$dest" --run-id "$run_id" >/dev/null
  [ -z "$claimed" ] || [ ! -e "$claimed" ] || requeue "$claimed"
}
trap cleanup EXIT
bun $c lock --dest "$dest" --run-id "$run_id" --ttl-min 300 || exit 4
locked=1
bun $c select --dest "$dest" --out "$work/plan.json" ${sel[@]+"${sel[@]}"} || exit $?
[ -z "$harness" ] || python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); [j["args"].extend(["--harness", sys.argv[2]]) for j in p["jobs"]]; json.dump(p, open(sys.argv[1], "w"), indent=1)' "$work/plan.json" "$harness"
njobs=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["jobs"]))' "$work/plan.json")
bun $c lock --dest "$dest" --run-id "$run_id" --ttl-min $(( (njobs + 3) * 60 )) >/dev/null
vm_error=()
if [ "$njobs" -gt 0 ]; then
  cp "$work/plan.json" "$plan"
  if [ -n "$post_status" ]; then
    bun $c status --pending --plan "$work/plan.json" --run-id "$run_id" --watch "$work/vm.log" --stop "$work/status-watch.stop" >"$work/status-pending.log" 2>&1 &
    watcher=$!
  fi
  if [ -n "$local_run" ]; then
    CANARY_OUT=$work/out/canary-out bash scripts/install-canary/vm.sh "$plan" >"$work/vm.log" 2>&1
    rc=$?
  else
    UBI_TTL_HOURS=$(( njobs + 2 )) bash scripts/ubicloud/ubi-runner.sh run --setup scripts/ubicloud/bootstrap.sh \
      --pull "/home/ubi/canary-out:$work/out" -- bash scripts/install-canary/vm.sh "$plan" >"$work/vm.log" 2>&1
    rc=$?
  fi
  if [ -n "$watcher" ]; then
    touch "$work/status-watch.stop"
    wait "$watcher" || status_rc=7
    watcher=
    cat "$work/status-pending.log"
  fi
  grep -E '^\[vm\] job|^install canary|^CANARY_' "$work/vm.log" || true
  if grep -q '^CANARY_IMAGE_BUILD' "$work/vm.log"; then vm_error=(--vm-error CANARY_IMAGE_BUILD)
  elif [ "$rc" -ne 0 ] && [ ! -d "$work/out/canary-out" ]; then vm_error=(--vm-error CANARY_VM); echo "CANARY_VM: the VM run exited $rc with no results; log $work/vm.log"; fi
fi
bun $c publish --dest "$dest" --plan "$work/plan.json" --results "$work/out/canary-out" --run-id "$run_id" ${vm_error[@]+"${vm_error[@]}"} | tee "$work/publish.log"
prc=${PIPESTATUS[0]}
if [ "$prc" -ne 0 ] && grep -q '^status .* pending on ' "$work/status-pending.log" 2>/dev/null; then
  echo "CANARY_STATUS: publish failed, so these releases keep this run's pending status: $(sed -n 's/^status \([^ ]*\) pending on \([0-9a-f]*\) .*/\1 (\2)/p' "$work/status-pending.log" | paste -sd, -)"
  echo "fix: publish by hand, then repost with: bun $c status --dest $dest --run-id $run_id"
fi
if [ "$prc" -eq 0 ] && [ -n "$post_status" ]; then
  bun $c status --dest "$dest" --run-id "$run_id" | tee -a "$work/publish.log"
  [ "${PIPESTATUS[0]}" -eq 0 ] || status_rc=7
fi
if [ "$prc" -eq 0 ] && [ -n "$claimed" ]; then
  grep . "$claimed" | tail -n +2 > "$work/request.rest"
  if [ -s "$work/request.rest" ]; then requeue "$work/request.rest"; fi
  rm -f "$claimed"; claimed=
fi
if [ -z "$local_run" ] && [ -f "$work/vm.log" ]; then
  # Only this run's VMs: ubi-runner logs "ubi-runner: ready: <name> (<ip>)" for each one it brings up.
  up=$(bash scripts/ubicloud/ubi-runner.sh list --mine 2>/dev/null | awk '{print $2}')
  for name in $(sed -n 's/^ubi-runner: ready: \([^ ]*\).*/\1/p' "$work/vm.log" | sort -u); do
    grep -qx "$name" <<<"$up" || continue
    echo "CANARY_VM_LEFT: $name"
    bash scripts/ubicloud/ubi-runner.sh down "$name" >/dev/null 2>&1
  done
fi
[ "$prc" -ne 0 ] || prc=$status_rc
exit "$prc"
