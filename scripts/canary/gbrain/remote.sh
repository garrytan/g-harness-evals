#!/usr/bin/env bash
# Run t0.sh or run-tier.sh of the gbrain canary suite on one Ubicloud VM, through the repository's lane
# (scripts/ubicloud/ubi-runner.sh run and bootstrap.sh, docs/ubicloud.md), and copy its results back:
#
#   scripts/canary/gbrain/remote.sh --entry t0|run-tier --out <local dir> --hours <expected wall hours> [--tasks <tasks.json>]
#       [--key ANTHROPIC_API_KEY ...] -- <the entry's arguments, without --out, --tasks and --remote>
#
# The VM gets a clean clone of this checkout's HEAD (a dirty checkout is refused, so the VM runs a commit), bootstrap.sh,
# bun install --frozen-lockfile, then the entry with --out /home/ubi/canary/out. Only the keys named by --key go to the VM,
# over SSH through ubi-runner.sh --pass into a 0600 file the command deletes before anything else runs; t0 names none. The
# VM is named ubirun-<UBI_OWNER>-<epoch>-<hex>-t<hours> (UBI_OWNER must be set by the caller), with a TTL of --hours or
# UBI_TTL_HOURS, whichever is longer, and ubi-runner.sh destroys it on every exit path. Every ten minutes the results are
# pulled into <out>/vm-replica, and at the end into <out>/vm/out and copied over <out>. <out>/remote.json records the VM,
# the commit, the times and the VM's list-price cost (standard-16 at $0.00831 a minute plus IPv4); <out>/lane.log the lane.
# Exit: the entry's exit code, 3 when the VM, the sync, the bootstrap or bun install failed, 2 for a usage error.
set -euo pipefail
cd "$(dirname "$0")/../../.."
root=$(pwd)
die() { echo "remote (gbrain canary): $*" >&2; exit 2; }
entry="" out="" hours="" tasks="" keys=()
while [ $# -gt 0 ]; do
  case "$1" in
    --entry) entry="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --hours) hours="$2"; shift 2 ;;
    --tasks) tasks="$2"; shift 2 ;;
    --key) keys+=("$2"); shift 2 ;;
    --) shift; break ;;
    *) die "unknown argument $1" ;;
  esac
done
rest=("$@")
case "$entry" in t0|run-tier) ;; *) die "--entry must be t0 or run-tier" ;; esac
[ -n "$out" ] && [[ "$hours" =~ ^[1-9][0-9]{0,2}$ ]] || die "--out and --hours (1 to 999) are required"
[ -n "${UBI_OWNER:+x}" ] || die "UBI_OWNER is not set; the caller sets it to its thread code"
[ -n "${UBICLOUD_API_KEY:+x}${UBICLOUD_API_TOKEN:+x}" ] || die "UBICLOUD_API_KEY is not set"
for k in ${keys[@]+"${keys[@]}"}; do
  case "$k" in ANTHROPIC_API_KEY|OPENAI_API_KEY|PARTICLE_API_KEY) ;; *) die "--key $k is not a model key" ;; esac
  [ -n "${!k:+x}" ] || die "$k is not set in this shell; the metering proxy on the VM needs it"
done
for a in ${rest[@]+"${rest[@]}"}; do [[ "$a" =~ ^[A-Za-z0-9._,/:=+-]+$ ]] || die "argument '$a' has characters the VM command does not pass"; done
[ -z "$(git status --porcelain)" ] || die "the checkout is not clean; commit first, the VM runs a commit"
commit=$(git rev-parse HEAD)
mkdir -p "$out"
out=$(cd "$out" && pwd)
ttl=$hours
if [ -n "${UBI_TTL_HOURS:+x}" ] && [[ "$UBI_TTL_HOURS" =~ ^[0-9]+$ ]] && [ "$UBI_TTL_HOURS" -gt "$ttl" ]; then ttl=$UBI_TTL_HOURS; fi
export UBI_TTL_HOURS=$ttl
runner="$root/scripts/ubicloud/ubi-runner.sh"
owner=$(bash "$runner" owner)
vm="ubirun-$owner-$(date +%s)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')-t$ttl"
log() { printf '%s remote (gbrain canary): %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/lane.log" >&2; }

scratch=$(mktemp -d "${TMPDIR:-/tmp}/canary-gbrain.XXXXXX")
rep_pid=""
cleanup() { [ -z "$rep_pid" ] || kill "$rep_pid" 2>/dev/null || true; rm -rf "$scratch"; }
trap cleanup EXIT
git clone -q --no-checkout "$root" "$scratch/harness-evals"
git -C "$scratch/harness-evals" checkout -q --detach "$commit"
[ -z "$(git -C "$scratch/harness-evals" status --porcelain)" ] || die "the scratch checkout at $commit is not clean"

home=/home/ubi/canary
cmd="rm -f ~/.ubirun-env; mkdir -p $home"
task_args=""
if [ -n "$tasks" ]; then
  [ -f "$tasks" ] || die "--tasks $tasks does not exist"
  cmd+="; printf %s $(base64 -w0 < "$tasks") | base64 -d > $home/tasks.json"
  task_args="--tasks $home/tasks.json"
fi
cmd+="; bun install --frozen-lockfile > $home/bun-install.log 2>&1 || { tail -20 $home/bun-install.log; exit 3; }"
cmd+="; sg docker -c \"bash scripts/canary/gbrain/$entry.sh ${rest[*]+${rest[*]}} $task_args --out $home/out\""
pass=()
for k in ${keys[@]+"${keys[@]}"}; do pass+=(--pass "$k"); done
started=$(date +%s)
jq -n --arg vm "$vm" --arg owner "$UBI_OWNER" --argjson ttl "$ttl" --arg commit "$commit" --arg entry "$entry" --arg args "${rest[*]+${rest[*]}}" --arg keys "${keys[*]+${keys[*]}}" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{vm: $vm, owner: $owner, size: "standard-16", ttl_hours: $ttl, commit: $commit, entry: $entry, args: $args, keys: $keys, started_at: $at}' > "$out/remote.json"
log "VM $vm (TTL $ttl h) for $entry at $commit; keys: ${keys[*]+${keys[*]}}"
( while sleep 600; do bash "$runner" pull "$vm" canary/out "$out/vm-replica" > /dev/null 2>&1 || true; done ) &
rep_pid=$!
set +e
bash "$runner" run -n "$vm" --src "$scratch/harness-evals" --setup "$root/scripts/ubicloud/bootstrap.sh" ${pass[@]+"${pass[@]}"} --pull "canary/out:$out/vm" -- "$cmd" >> "$out/lane.log" 2>&1
rc=$?
set -e
kill "$rep_pid" 2>/dev/null || true; rep_pid=""
[ ! -d "$out/vm/out" ] || cp -a "$out/vm/out/." "$out/"
if bash "$runner" list --mine 2>/dev/null | grep -qF "$vm"; then log "VM $vm is still listed; destroying it"; bash "$runner" down "$vm" >> "$out/lane.log" 2>&1 || log "WARNING: down $vm failed; run: UBI_OWNER=$UBI_OWNER $runner down $vm"; fi
left=$(bash "$runner" list --mine 2>/dev/null | grep -cF "$vm" || true)
minutes=$(( ($(date +%s) - started + 59) / 60 ))
jq --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson rc "$rc" --argjson min "$minutes" --argjson left "${left:-0}" \
  '. + {finished_at: $at, exit: $rc, vm_minutes: $min, vm_left: $left, vm_usd: (($min * 0.00831 + $min * 3 / (30 * 24 * 60)) * 10000 | round / 10000)}' "$out/remote.json" > "$out/remote.json.tmp" && mv "$out/remote.json.tmp" "$out/remote.json"
log "$entry exited $rc after $minutes min; VM left: ${left:-0}; results in $out"
exit "$rc"
