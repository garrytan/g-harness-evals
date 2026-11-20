#!/usr/bin/env bash
# Runs one shard of an MCP-at-scale run spec (scripts/mcp-at-scale/run.ts) on one Ubicloud VM, through
# scripts/ubicloud/ubi-runner.sh as it is (internal-task).
#
#   UBI_OWNER=<thread code> scripts/mcp-at-scale/run-shard-vm.sh --spec <spec.json> --name <shard> --dest <local dir>
#       [--phase 1|2 | --ttl-hours <n>] [--size standard-8] [--pull-seconds 1200] [--fake-upstream]
#
# 1. run.ts check, then run.ts bundle copies the spec and its set files (private ones too) into a fresh clone of this
#    checkout's HEAD, under .mcp-input/ (untracked there, so the runner ships it). The VM gets the clone, never this
#    working tree, so nothing done here mid-run changes what the VM runs; the checkout must be committed (clean).
# 2. ubi-runner.sh run, in the background, names its VM ubirun-<owner>-<epoch>-mcp<shard>-t<ttl>: the bootstrap setup,
#    then scripts/mcp-at-scale/vm-shard.sh <shard> on the VM, with --pass for exactly the provider keys the shard's proxy
#    needs (run.ts keys; none with --fake-upstream). run.ts there takes the keys out of its own environment and hands them
#    to the metering proxy only.
# 3. Every --pull-seconds the VM's ~/mcp-out/<shard> is pulled (skipping files a live trial still holds) and copied over
#    <dest>/latest; at the end the runner pulls it into <dest>/final and destroys the VM.
#    With --phase those directories live under <dest>/phase-N. Phase 2 writes a merged trials.jsonl at <dest>.
# 4. On every exit (done, failed, INT, TERM) this script stops the runner, runs ubi-runner.sh down on the VM (a no-op when
#    it is gone) and logs whether list --mine still names it. UBI_QUOTA_VCPUS defaults to 464, so the VM starts only while
#    the project has room. A VM ubi-runner retains after a failed final pull is left for recovery under its TTL.
# Exit: the runner's exit (vm-shard.sh passes run.ts's: 0 done, 4 stopped on the lease, 5 key scan hit, 6 undrained).
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
ubi=$repo/scripts/ubicloud/ubi-runner.sh
spec="" name="" dest="" ttl="" size=standard-8 pull_seconds=1200 fake=0 phase=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) spec=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --name) name=$2; shift 2 ;;
    --dest) mkdir -p "$2"; dest=$(cd "$2" && pwd); shift 2 ;;
    --ttl-hours) ttl=$2; shift 2 ;;
    --phase) phase=$2; shift 2 ;;
    --size) size=$2; shift 2 ;;
    --pull-seconds) pull_seconds=$2; shift 2 ;;
    --fake-upstream) fake=1; shift ;;
    *) echo "run-shard-vm: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$spec" ] && [ -n "$name" ] && [ -n "$dest" ] || { echo "usage: run-shard-vm.sh --spec <spec.json> --name <shard> --dest <dir> [--phase 1|2 | --ttl-hours <n>] [--size standard-8] [--pull-seconds 1200] [--fake-upstream]" >&2; exit 2; }
[[ -z "$phase" || "$phase" == 1 || "$phase" == 2 ]] || { echo "run-shard-vm: --phase takes 1 or 2" >&2; exit 2; }
runts() { (cd "$repo" && env -i PATH="$PATH" HOME="$HOME" TZ=UTC bun scripts/mcp-at-scale/run.ts "$@"); }
root=$dest
opts=(--spec "$spec" --name "$name")
phase_args=() mode_args=()
[ "$fake" -eq 0 ] || mode_args=(--fake-upstream)
[ -z "$phase" ] || phase_args=(--phase "$phase")
pinned_ttl=$(runts phase-ttl "${opts[@]}" "${phase_args[@]}" "${mode_args[@]}") || exit $?
if [ -n "$pinned_ttl" ]; then
  [ -z "$ttl" ] || [ "$ttl" = "$pinned_ttl" ] || { echo "run-shard-vm: phase $phase TTL is pinned at $pinned_ttl hours" >&2; exit 2; }
  ttl=$pinned_ttl
  exec 9>"$root/.phase-launch.lock"
  flock -n 9 || { echo "run-shard-vm: a phase is already running at $root" >&2; exit 2; }
  dest=$root/phase-$phase
  [ ! -e "$dest/vm-map.jsonl" ] && [ ! -e "$dest/final" ] || { echo "run-shard-vm: phase $phase already has a launch record; refusing to reset its lease" >&2; exit 2; }
  if [ "$phase" = 2 ]; then
    prior=$root/phase-1/final/$name
    runts phase-check "${opts[@]}" --phase 1 --out "$prior" "${mode_args[@]}"
  fi
fi
[[ "$ttl" =~ ^[1-9][0-9]{0,2}$ ]] || { echo "run-shard-vm: --ttl-hours is a whole number of hours, above the shard's wall time" >&2; exit 2; }
[ -n "${UBI_OWNER:-}" ] || { echo "run-shard-vm: set UBI_OWNER to your thread code" >&2; exit 2; }
[ -n "${UBICLOUD_API_KEY:+x}" ] || { echo "run-shard-vm: UBICLOUD_API_KEY is not set" >&2; exit 2; }
git -C "$repo" diff --quiet HEAD -- || { echo "run-shard-vm: the checkout has uncommitted changes; the VM runs HEAD, so commit first" >&2; exit 2; }
mkdir -p "$dest"
export UBI_TTL_HOURS=$ttl UBI_QUOTA_VCPUS=${UBI_QUOTA_VCPUS:-464}
log() { printf '%s run-shard-vm: %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$dest/wrapper.log" >&2; }
keys=""
[ "$fake" -eq 1 ] || keys=$(runts keys --spec "$spec" --name "$name")
pass=()
for k in $keys; do
  [ -n "${!k:+x}" ] || { echo "run-shard-vm: the shard's proxy needs $k and it is not set" >&2; exit 2; }
  pass+=(--pass "$k")
done

stage=$(mktemp -d "${TMPDIR:-/tmp}/mcp-stage.XXXXXX")/mcp-$name
git clone -q --no-hardlinks "$repo" "$stage"
git -C "$stage" checkout -q --detach "$(git -C "$repo" rev-parse HEAD)"
runts bundle --spec "$spec" --out "$stage/.mcp-input" >/dev/null
if [ "$phase" = 2 ]; then
  mkdir "$stage/.mcp-input/phase-1"
  cp -- "$prior"/{cleanup.json,run-identity.json,accounting.json,ledger.sqlite,ledger-summary.json,key-scan.json,trials.jsonl} "$stage/.mcp-input/phase-1/"
  phase_args+=(--prior-phase .mcp-input/phase-1)
fi
owner=$(printf '%s' "$UBI_OWNER" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
suffix=mcp${phase:+p$phase}$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-12)
vm=ubirun-$owner-$(date +%s)-$suffix-t$ttl
log "shard $name of $(basename "$spec") at $(git -C "$repo" rev-parse --short=12 HEAD) on $vm ($size, ttl ${ttl}h), keys passed: ${keys:-none}"
printf '{"vm": "%s", "shard": "%s", "owner": "%s", "commit": "%s", "started": "%s"}\n' "$vm" "$name" "$UBI_OWNER" "$(git -C "$repo" rev-parse HEAD)" "$(date -u +%FT%TZ)" >> "$dest/vm-map.jsonl"

left_file=$dest/ubi-left.log
: > "$left_file"
UBI_LEFT_FILE="$left_file" "$ubi" run -n "$vm" -s "$size" --src "$stage" --setup "$repo/scripts/ubicloud/bootstrap.sh" ${pass[@]+"${pass[@]}"} \
  --pull "mcp-out/$name:$dest/final" -- bash scripts/mcp-at-scale/vm-shard.sh "$name" "${mode_args[@]}" "${phase_args[@]}" >> "$dest/runner.log" 2>&1 &
runner=$!
finished=0
cleanup=unknown
teardown() {
  [ "$finished" -eq 0 ] || return 0
  finished=1
  if kill -0 "$runner" 2>/dev/null; then kill -TERM "$runner" 2>/dev/null || true; wait "$runner" 2>/dev/null || true; fi
  if awk -v vm="$vm" '$1=="UBICLOUD:" && $2=="left=1" && $4=="vm="vm && $5=="kept=1" { kept=1 } END { exit !kept }' "$left_file"; then
    cleanup=retained
    log "final pull failed; kept $vm under its TTL. Recover: $(printf '%q ' "$ubi" pull "$vm" "mcp-out/$name" "$dest/final"); destroy it only after recovery."
    rm -rf "$(dirname "$stage")"
    return
  fi
  "$ubi" down "$vm" >> "$dest/runner.log" 2>&1 || log "down $vm failed; check list --mine"
  if vms=$("$ubi" list --mine 2>/dev/null); then
    if grep -Fq -- "$vm" <<<"$vms"; then log "list --mine still names $vm"
    else cleanup=done; log "list --mine no longer names $vm"; fi
  else log "list --mine failed; cleanup not confirmed"; fi
  rm -rf "$(dirname "$stage")"
}
trap teardown EXIT
trap 'exit 130' INT TERM

pulls=0
while kill -0 "$runner" 2>/dev/null; do
  for _ in $(seq "$pull_seconds"); do kill -0 "$runner" 2>/dev/null || break; sleep 1; done
  kill -0 "$runner" 2>/dev/null || break
  pulls=$((pulls + 1))
  tmp=$dest/.pull-$pulls
  if "$ubi" pull "$vm" "mcp-out/$name" "$tmp" --skip-unreadable >> "$dest/runner.log" 2>&1 && [ -d "$tmp/$name" ]; then
    mkdir -p "$dest/latest" && cp -a "$tmp/$name/." "$dest/latest/" && log "pull $pulls: $(wc -l < "$dest/latest/trials.jsonl" 2>/dev/null || echo 0) row(s)"
  else
    log "pull $pulls failed or found nothing; the next one retries"
  fi
  rm -rf "$tmp"
done
rc=0
wait "$runner" || rc=$?
log "runner exited $rc; final results in $dest/final/$name"
teardown
[ "$cleanup" != retained ] || { [ "$rc" -ne 0 ] || rc=1; exit "$rc"; }
if [ "$rc" -eq 0 ] && [ -n "$phase" ]; then
  [ "$cleanup" = done ] || { log "phase $phase cannot be marked complete without confirmed cleanup"; exit 1; }
  runts phase-complete "${opts[@]}" --phase "$phase" --out "$dest/final/$name" "${mode_args[@]}"
  if [ "$phase" = 2 ]; then runts merge-phases "${opts[@]}" --out "$root" "${mode_args[@]}"; fi
fi
exit "$rc"
