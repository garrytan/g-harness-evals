#!/usr/bin/env bash
# Runs one shard of an MCP-at-scale run spec (scripts/mcp-at-scale/run.ts) on one Ubicloud VM, through
# scripts/ubicloud/ubi-runner.sh as it is (internal-task).
#
#   UBI_OWNER=<thread code> scripts/mcp-at-scale/run-shard-vm.sh --spec <spec.json> --name <shard> --dest <local dir>
#       [--phase 1|2 | --ttl-hours <n>] [--interim-state <state.json>] [--size standard-8] [--pull-seconds 1200]
#       [--deadline-seconds <n>] [--fake-upstream]
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
#    Phase 2 needs --interim-state, the interim look's completed state, computed from this shard's phase 1 trials.
#    Every paid phase launch needs HE_MCP_LAUNCH_RECORDS on the same durable filesystem on every controller. The atomic
#    claim is keyed by lease, independent of the results destination. Unknown launch outcomes keep their claim.
# 4. On every exit (done, failed, INT, TERM) this script stops the runner, runs ubi-runner.sh down on the VM (a no-op when
#    it is gone) and logs whether list --mine still names it. UBI_QUOTA_VCPUS defaults to 464, so the VM starts only while
#    the project has room. A VM ubi-runner retains after a failed final pull is left for recovery under its TTL.
# 5. The wrapper does not rely on the Ubicloud TTL reaper alone. --deadline-seconds after this script started (default
#    45 minutes under the TTL) it sends TERM to run.ts shard on the VM, which drains, accounts and exits 130, so the
#    runner takes the failed run's path: the final pull, the VM kept for recovery if that pull fails, else destroyed.
#    If the VM cannot be reached, or the runner is still going 15 minutes before the TTL, the runner is stopped and
#    the VM destroyed without the final pull (exit 124).
# Exit: the runner's exit (vm-shard.sh passes run.ts's: 0 done, 4 stopped on the lease, 5 key scan hit, 6 undrained, 7 error,
# 130 stopped by a signal, the deadline's included), or 124 when the deadline had to stop the runner itself.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
ubi=$repo/scripts/ubicloud/ubi-runner.sh
spec="" name="" dest="" ttl="" size=standard-8 pull_seconds=1200 fake=0 phase="" interim="" record="" deadline=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) spec=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --name) name=$2; shift 2 ;;
    --dest) mkdir -p "$2"; dest=$(cd "$2" && pwd); shift 2 ;;
    --ttl-hours) ttl=$2; shift 2 ;;
    --phase) phase=$2; shift 2 ;;
    --interim-state) interim=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --size) size=$2; shift 2 ;;
    --pull-seconds) pull_seconds=$2; shift 2 ;;
    --deadline-seconds) deadline=$2; shift 2 ;;
    --fake-upstream) fake=1; shift ;;
    *) echo "run-shard-vm: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$spec" ] && [ -n "$name" ] && [ -n "$dest" ] || { echo "usage: run-shard-vm.sh --spec <spec.json> --name <shard> --dest <dir> [--phase 1|2 | --ttl-hours <n>] [--interim-state <state.json>] [--size standard-8] [--pull-seconds 1200] [--deadline-seconds <n>] [--fake-upstream]" >&2; exit 2; }
[[ -z "$phase" || "$phase" == 1 || "$phase" == 2 ]] || { echo "run-shard-vm: --phase takes 1 or 2" >&2; exit 2; }
runts() { (cd "$repo" && env -i PATH="$PATH" HOME="$HOME" TZ=UTC bun scripts/mcp-at-scale/run.ts "$@"); }
root=$dest
opts=(--spec "$spec" --name "$name")
phase_args=() mode_args=()
[ "$fake" -eq 0 ] || mode_args=(--fake-upstream)
[ -z "$phase" ] || phase_args=(--phase "$phase")
pinned=$(runts phase-ttl "${opts[@]}" "${phase_args[@]}" "${mode_args[@]}") || exit $?
read -r pinned_ttl lease_id <<<"$pinned"
if [ -n "$pinned_ttl" ]; then
  [ -z "$ttl" ] || [ "$ttl" = "$pinned_ttl" ] || { echo "run-shard-vm: phase $phase TTL is pinned at $pinned_ttl hours" >&2; exit 2; }
  ttl=$pinned_ttl
  if [ "$fake" -eq 0 ] && { [ -z "${HE_MCP_LAUNCH_RECORDS:-}" ] || [ ! -d "$HE_MCP_LAUNCH_RECORDS" ]; }; then
    echo "run-shard-vm: set HE_MCP_LAUNCH_RECORDS to the existing durable claim directory shared by all controllers" >&2
    exit 2
  fi
  exec 9>"$root/.phase-launch.lock"
  flock -n 9 || { echo "run-shard-vm: a phase is already running at $root" >&2; exit 2; }
  dest=$root/phase-$phase
  record=${HE_MCP_LAUNCH_RECORDS:-$HOME/.local/state/mcp-at-scale/launches}/$lease_id
  [ ! -e "$record" ] || { echo "run-shard-vm: lease $lease_id already has a launch record ($record); refusing to open it again" >&2; exit 2; }
  [ ! -e "$dest/vm-map.jsonl" ] && [ ! -e "$dest/final" ] || { echo "run-shard-vm: $dest already has phase launch evidence" >&2; exit 2; }
  if [ "$phase" = 2 ]; then
    prior=$root/phase-1/final/$name
    runts phase-check "${opts[@]}" --phase 1 --out "$prior" ${interim:+--interim-state "$interim"} "${mode_args[@]}"
  fi
fi
[[ "$ttl" =~ ^[1-9][0-9]{0,2}$ ]] || { echo "run-shard-vm: --ttl-hours is a whole number of hours, above the shard's wall time" >&2; exit 2; }
hard_stop=$(( ttl * 3600 - 900 ))
deadline=${deadline:-$(( ttl * 3600 - 2700 ))}
[[ "$deadline" =~ ^[1-9][0-9]*$ ]] && [ "$deadline" -lt "$hard_stop" ] || { echo "run-shard-vm: --deadline-seconds is a whole number of seconds, under $hard_stop (15 minutes before the ${ttl}h TTL)" >&2; exit 2; }
deadline_epoch=$(( $(date +%s) + deadline - SECONDS ))
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
  cp -- "$interim" "$stage/.mcp-input/phase-1/interim-state.json"
  phase_args+=(--prior-phase .mcp-input/phase-1)
fi
owner=$(printf '%s' "$UBI_OWNER" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
suffix=mcp${phase:+p$phase}$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-12)
vm=ubirun-$owner-$(date +%s)-$suffix-t$ttl
if [ -n "$record" ]; then
  mkdir -p "$(dirname "$record")"
  ( set -o noclobber; printf '{"lease": "%s", "dest": "%s", "vm": "%s", "started": "%s"}\n' "$lease_id" "$dest" "$vm" "$(date -u +%FT%TZ)" > "$record" ) 2>/dev/null \
    || { echo "run-shard-vm: lease $lease_id already has a launch record ($record); refusing to open it again" >&2; rm -rf "$(dirname "$stage")"; exit 2; }
fi
log "shard $name of $(basename "$spec") at $(git -C "$repo" rev-parse --short=12 HEAD) on $vm ($size, ttl ${ttl}h), keys passed: ${keys:-none}"
printf '{"vm": "%s", "shard": "%s", "owner": "%s", "commit": "%s", "started": "%s"}\n' "$vm" "$name" "$UBI_OWNER" "$(git -C "$repo" rev-parse HEAD)" "$(date -u +%FT%TZ)" >> "$dest/vm-map.jsonl"

left_file=$dest/ubi-left.log
: > "$left_file"
UBI_LEFT_FILE="$left_file" "$ubi" run -n "$vm" -s "$size" --src "$stage" --setup "$repo/scripts/ubicloud/bootstrap.sh" ${pass[@]+"${pass[@]}"} \
  --pull "mcp-out/$name:$dest/final" -- bash scripts/mcp-at-scale/vm-shard.sh "$name" "$deadline_epoch" "${mode_args[@]}" "${phase_args[@]}" > "$dest/runner.log" 2>&1 &
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
  if [ -n "$record" ] && [ "$cleanup" = done ] && [ "${rc:-0}" -eq 1 ] \
    && grep -Eq '^ubi-runner: (create refused: .*nothing was created|create failed \(HTTP 4[0-9][0-9]\); nothing was created|create failed: vCPU quota exhausted;)' "$dest/runner.log" \
    && ! grep -Fq -- "$vm carries a " "$dest/runner.log"; then
    rm -f -- "$dest/vm-map.jsonl" "$record"
    log "Ubicloud refused creation of $vm, so lease $lease_id was never opened; its launch record is released for a retry"
  fi
  rm -rf "$(dirname "$stage")"
}
trap teardown EXIT
trap 'exit 130' INT TERM

pulls=0
while kill -0 "$runner" 2>/dev/null; do
  for _ in $(seq "$pull_seconds"); do kill -0 "$runner" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ] || break; sleep 1; done
  kill -0 "$runner" 2>/dev/null || break
  if [ "$SECONDS" -ge "$deadline" ]; then
    log "deadline: ${SECONDS}s since launch (--deadline-seconds $deadline, TTL ${ttl}h); stopping run.ts shard on $vm so the runner pulls its results and destroys it"
    stopped=0
    for _ in 1 2 3; do
      remaining=$((hard_stop - SECONDS))
      [ "$remaining" -gt 0 ] || break
      [ "$remaining" -le 3 ] || remaining=3
      if timeout -k 1s "${remaining}s" "$ubi" ssh "$vm" "touch \"\$HOME/.he-mcp-deadline\" && { pkill -TERM -f '^bun scripts/mcp-at-scale/run.ts shard' || test \$? -eq 1; }" >> "$dest/runner.log" 2>&1; then
        stopped=1
        break
      fi
      kill -0 "$runner" 2>/dev/null || break
    done
    if [ "$stopped" -eq 1 ]; then
      while kill -0 "$runner" 2>/dev/null && [ "$SECONDS" -lt "$hard_stop" ]; do sleep 1; done
      ! kill -0 "$runner" 2>/dev/null || log "deadline: the runner is still going 15 minutes before the TTL; stopping it, which destroys $vm"
    else
      log "deadline: could not reach $vm to stop run.ts; stopping the runner, which destroys the VM"
    fi
    break
  fi
  pulls=$((pulls + 1))
  tmp=$dest/.pull-$pulls
  remaining=$((deadline - SECONDS))
  if [ "$remaining" -gt 0 ] && timeout -k 1s "${remaining}s" "$ubi" pull "$vm" "mcp-out/$name" "$tmp" --skip-unreadable >> "$dest/runner.log" 2>&1 && [ -d "$tmp/$name" ]; then
    mkdir -p "$dest/latest" && cp -a "$tmp/$name/." "$dest/latest/" && log "pull $pulls: $(wc -l < "$dest/latest/trials.jsonl" 2>/dev/null || echo 0) row(s)"
  else
    log "pull $pulls failed or found nothing; the next one retries"
  fi
  rm -rf "$tmp"
done
rc=0
if kill -0 "$runner" 2>/dev/null; then
  rc=124
  teardown
  log "runner stopped at the deadline; no final pull"
else
  wait "$runner" || rc=$?
  log "runner exited $rc; final results in $dest/final/$name"
  teardown
fi
[ "$cleanup" != retained ] || { [ "$rc" -ne 0 ] || rc=1; exit "$rc"; }
if [ "$rc" -eq 0 ] && [ -n "$phase" ]; then
  [ "$cleanup" = done ] || { log "phase $phase cannot be marked complete without confirmed cleanup"; exit 1; }
  runts phase-complete "${opts[@]}" --phase "$phase" --out "$dest/final/$name" "${mode_args[@]}"
  if [ "$phase" = 2 ]; then runts merge-phases "${opts[@]}" --out "$root" "${mode_args[@]}"; fi
fi
exit "$rc"
