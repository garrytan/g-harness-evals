#!/usr/bin/env bash
# Run one shard of a sharded, preregistered run on an ephemeral Ubicloud VM instead of a Capy machine (docs/ubicloud.md).
# One VM per shard, the repository pinned at the preregistration commit, images built there, the one-trial smoke the Capy
# shards ran before every counted shard, then the repository's own scripts/run-shard.sh under the shard's lease, the
# results tree copied back and the VM destroyed on every exit path.
#
#   scripts/ubicloud/run-shard.sh --commit <sha> --prereg <path in the repo at that commit, or a scratch file> --name <shard>
#       --cells a,b --lease-usd <n> --dest <local directory> [--size standard-16] [--location eu-central-h1] [--storage GiB]
#       [--smoke-lease-usd 0.5] [--smoke-task <task id>] [--no-smoke] [--embedded] [--gbrain-image <tag>] [--amendment <sha>]
#       [--resume] [--attach] [--poll-seconds 30] [--timeout-hours 12] [-- <extra arguments for scripts/run-shard.sh>]
#
# What happens, in order (every line goes to <dest>/lane.log with a UTC stamp):
#   1. The commit is resolved (fetched from origin if this checkout lacks it) and the preregistration checked: a path that
#      exists in the repository at that commit is used from the pinned checkout on the VM; any other readable file is a
#      scratch preregistration, copied to the VM and named as such.
#   2. A clean detached checkout of the commit is cloned from this repository into a scratch directory (a worktree's .git
#      file does not survive the sync, so pr-check.sh does the same); a dirty tree is impossible by construction, and the
#      VM refuses one anyway the way scripts/run-shard.sh does.
#   3. ubi-runner.sh up creates the VM (standard-16 unless --size), sync streams the scratch checkout to ~/work/<repo>,
#      bootstrap.sh installs Docker, Bun at ci.yml's pin, Node, python3 and jq, and vm-shard.sh is uploaded to ~/shard/bin.
#   4. ANTHROPIC_API_KEY and OPENAI_API_KEY (each one that is set here; the run needs the first, --embedded the second)
#      are written to ~/.ubirun-env on the VM with umask 077 over the multiplexed SSH connection, exactly as
#      ubi-runner.sh run --pass writes them. The launcher reads the file into the shell and deletes it before vm-shard.sh
#      starts, so no file on the VM holds a key while the run is live; the keys live in that process's environment and
#      reach only the metering proxy, as on a Capy shard. Nothing goes through cloud-init user data, images or logs.
#   5. vm-shard.sh runs detached on the VM (setsid, nohup): checkout --detach, bun install, the smoke (a copy of the
#      preregistration with only this shard's harness cells on one dev task, one repetition, under its own lease and
#      ledger; it builds the images), then scripts/run-shard.sh --skip-build for the shard with --max-output-tokens 128000
#      as that script passes it. With --resume the local <dest>/results tree (minus harness state) is uploaded first.
#   6. Every --poll-seconds this script appends the new bytes of the VM's run-shard.log, run.stdout.log and run.log to
#      <dest>/run-shard.log, <dest>/run.stdout.log and <dest>/run.log, and vm-shard's own output to <dest>/vm-shard.out.
#   7. On exit (the run finished, a failure, or an interrupt) the shard process on the VM is stopped if still running,
#      every ledger is checkpointed (PRAGMA wal_checkpoint(TRUNCATE)) so ledger.sqlite is complete on its own, the whole
#      results tree is copied back to <dest>/results (the smoke's to <dest>/smoke), <dest>/results/shard-vm.json is written
#      beside shard.json (VM name, size, location, timings, exit, list-price cost), and the VM is destroyed.
#   --attach (with --dest) rejoins a VM an earlier invocation of this script left running (this machine slept or the
#   controller died): it reads the VM name from <dest>/shard-vm.json, polls, pulls and destroys as above.
#
# Exit code: scripts/run-shard.sh's; 4 when the smoke did not end with every trial completed (the counted run never
# started); 3 when the VM, the sync or the bootstrap failed before the run; 2 for a usage error; 130 on interrupt.
# Needs UBICLOUD_API_KEY and UBI_OWNER (your thread code) in the environment, git, python3, ssh and tar. Nothing here
# prints or stores a key. The VM's list price is the Germany per-minute rate (standard-8 $0.00416, standard-16 $0.00831,
# standard-30 $0.01559), minutes rounded up, plus the public IPv4 at $3 a month pro rata, as pr-check.sh computes it.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
runner=${UBI_RUNNER:-$here/ubi-runner.sh}

commit="" prereg="" name="" cells="" lease="" dest="" size=standard-16 location="" storage="" smoke_lease=0.5 smoke_task="" smoke=1
embedded=0 gbrain_image="" amendment="" resume=0 attach=0 poll=30 timeout_h=12
extra=()
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) commit=$2; shift 2 ;;
    --prereg) prereg=$2; shift 2 ;;
    --name) name=$2; shift 2 ;;
    --cells) cells=$2; shift 2 ;;
    --lease-usd) lease=$2; shift 2 ;;
    --dest) dest=$2; shift 2 ;;
    --size) size=$2; shift 2 ;;
    --location) location=$2; shift 2 ;;
    --storage) storage=$2; shift 2 ;;
    --smoke-lease-usd) smoke_lease=$2; shift 2 ;;
    --smoke-task) smoke_task=$2; shift 2 ;;
    --no-smoke) smoke=0; shift ;;
    --embedded) embedded=1; shift ;;
    --gbrain-image) gbrain_image=$2; shift 2 ;;
    --amendment) amendment=$2; shift 2 ;;
    --resume) resume=1; shift ;;
    --attach) attach=1; shift ;;
    --poll-seconds) poll=$2; shift 2 ;;
    --timeout-hours) timeout_h=$2; shift 2 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    --) shift; extra=("$@"); break ;;
    *) echo "run-shard (ubicloud): unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$dest" ] || { echo "run-shard (ubicloud): --dest is required" >&2; exit 2; }
if [ "$attach" -eq 0 ]; then
  [ -n "$commit" ] && [ -n "$prereg" ] && [ -n "$name" ] && [ -n "$cells" ] && [ -n "$lease" ] || { echo "run-shard (ubicloud): --commit, --prereg, --name, --cells, --lease-usd and --dest are required" >&2; exit 2; }
  [ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "run-shard (ubicloud): ANTHROPIC_API_KEY is not set in this shell; the metering proxy on the VM needs it" >&2; exit 2; }
  [ "$embedded" -eq 0 ] || [ -n "${OPENAI_API_KEY:-}" ] || { echo "run-shard (ubicloud): --embedded needs OPENAI_API_KEY in this shell" >&2; exit 2; }
fi
[ -n "${UBI_OWNER:-}" ] || { echo "run-shard (ubicloud): set UBI_OWNER to your thread code so the VM carries its owner" >&2; exit 2; }
[ -n "${UBICLOUD_API_KEY:-${UBICLOUD_API_TOKEN:-}}" ] || { echo "run-shard (ubicloud): UBICLOUD_API_KEY is not set" >&2; exit 2; }
[ -f "$runner" ] || { echo "run-shard (ubicloud): ubi-runner.sh not found at $runner" >&2; exit 2; }
case $size in standard-2) rate=0.00104 ;; standard-4) rate=0.00208 ;; standard-8) rate=0.00416 ;; standard-16) rate=0.00831 ;; standard-30) rate=0.01559 ;; standard-60) rate=0.03117 ;; *) rate="" ;; esac

mkdir -p "$dest"
dest=$(cd "$dest" && pwd)
export TZ=UTC
stamp() { local line; while IFS= read -r line; do printf '%(%Y-%m-%dT%H:%M:%SZ)T %s\n' -1 "$line"; done; }
log() { printf '%(%Y-%m-%dT%H:%M:%SZ)T run-shard[%s]: %s\n' -1 "${name:-attach}" "$*" | tee -a "$dest/lane.log" >&2; }
fmt() { local s=$1; if [ -z "$s" ]; then printf '?'; elif [ "$s" -ge 3600 ]; then printf '%dh%02dm%02ds' $(( s / 3600 )) $(( s % 3600 / 60 )) $(( s % 60 )); elif [ "$s" -ge 60 ]; then printf '%dm%02ds' $(( s / 60 )) $(( s % 60 )); else printf '%ds' "$s"; fi; }
# jset key=jsonvalue ...: merge fields into <dest>/shard-vm.json (created if missing); teardown copies it beside shard.json.
jset() {
  python3 - "$dest/shard-vm.json" "$@" <<'PY'
import json, os, sys
p = sys.argv[1]
d = json.load(open(p)) if os.path.exists(p) else {}
for kv in sys.argv[2:]:
    k, v = kv.split('=', 1)
    d[k] = json.loads(v)
json.dump(d, open(p, 'w'), indent=1); open(p, 'a').write('\n')
PY
}
jq1() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); v=d.get(sys.argv[2]); print('' if v is None else v)" "$dest/shard-vm.json" "$1" 2>/dev/null || true; }
vssh() { bash "$runner" ssh "$vm" "$@"; }
remote_home=/home/ubi
repo_dir=$remote_home/work/harness-evals
now() { date +%s; }
lines() { if [ -f "$1" ]; then wc -l < "$1"; else echo 0; fi; }

vm="" scratch="" launched=0 exited=0 rc=3 t_create="" t_ready="" t_sync0="" t_sync1="" t_boot0="" t_boot1="" t_pull0="" t_pull1=""
# seconds between two epoch values, or null when either is missing (for the timings in shard-vm.json)
span() { if [ -n "${1:-}" ] && [ -n "${2:-}" ]; then echo $(( $2 - $1 )); else echo null; fi; }
teardown() {
  trap "" INT TERM HUP QUIT
  set +e
  [ -z "$scratch" ] || rm -rf "$scratch"
  [ -n "$vm" ] || return 0
  if [ "$launched" -eq 1 ] && [ "$exited" -eq 0 ]; then
    log "stopping the shard on $vm (SIGTERM to its process group, up to 90 s)"
    vssh 'pid=$(cat ~/shard/pid 2>/dev/null); [ -n "$pid" ] && kill -TERM -- -"$pid" 2>/dev/null; for i in $(seq 90); do [ -f ~/shard/exit ] && break; kill -0 "$pid" 2>/dev/null || break; sleep 1; done; [ -f ~/shard/exit ] || echo interrupted > ~/shard/exit; cat ~/shard/exit' 2>>"$dest/lane.log" | stamp | tee -a "$dest/lane.log" >&2
  fi
  if [ "$launched" -eq 1 ]; then
    log "checkpointing ledgers and copying the results tree back to $dest"
    vssh 'for f in $(find ~/shard -name ledger.sqlite 2>/dev/null); do bun -e "const {Database}=require(\"bun:sqlite\"); const db=new Database(process.argv[1]); db.exec(\"PRAGMA wal_checkpoint(TRUNCATE)\"); db.close(); console.log(\"checkpointed\", process.argv[1])" "$f"; done' 2>>"$dest/lane.log" | stamp | tee -a "$dest/lane.log" >&2
    t_pull0=$(now)
    bash "$runner" pull "$vm" "shard/results" "$dest" 2>/dev/null || log "WARNING: no shard/results on the VM to pull (the run never started, or the VM is gone)"
    bash "$runner" pull "$vm" "shard/smoke" "$dest" 2>/dev/null || log "WARNING: no shard/smoke on the VM to pull"
    for f in vm-shard.out phases.json exit bun-install.log prereg.json; do bash "$runner" pull "$vm" "shard/$f" "$dest" 2>/dev/null || true; done
    t_pull1=$(now)
    for f in run-shard.log run.stdout.log run.log vm-shard.out; do [ -f "$dest/results/$f" ] && cp "$dest/results/$f" "$dest/$f"; done
    [ -f "$dest/exit" ] && rc=$(cat "$dest/exit") && [ "$rc" != interrupted ] || true
    [ "$rc" = interrupted ] && rc=130
    log "pull took $(( t_pull1 - t_pull0 ))s; $(lines "$dest/results/trials.jsonl") trial lines in $dest/results/trials.jsonl"
  fi
  # phases.json from the VM: checkout_start/end, smoke_start/end, run_start/end (epoch seconds).
  local ph="$dest/phases.json" checkout_s="" image_s="" smoke_s="" run_s=""
  if [ -f "$ph" ]; then
    checkout_s=$(python3 -c "import json;d=json.load(open('$ph'));print(d['checkout_end']-d['checkout_start'] if 'checkout_end' in d else '')")
    smoke_s=$(python3 -c "import json;d=json.load(open('$ph'));print(d['smoke_end']-d['smoke_start'] if 'smoke_end' in d else '')")
    run_s=$(python3 -c "import json;d=json.load(open('$ph'));print(d['run_end']-d['run_start'] if 'run_end' in d else '')")
    # The smoke's run-shard.log stamps the first image build and the preflight; the gap is the image build.
    if [ -f "$dest/smoke/results/run-shard.log" ]; then
      image_s=$(python3 - "$dest/smoke/results/run-shard.log" <<'PY'
import sys, datetime
t = lambda l: datetime.datetime.strptime(l.split(' ')[0], '%Y-%m-%dT%H:%M:%SZ')
lines = open(sys.argv[1]).read().splitlines()
b = [l for l in lines if ' building ' in l]; p = [l for l in lines if ': preflight --cells' in l or ': preflight skipped' in l]
print(int((t(p[0]) - t(b[0])).total_seconds()) if b and p else '')
PY
)
      [ -n "$image_s" ] && [ -n "$smoke_s" ] && smoke_s=$(( smoke_s - image_s ))
    fi
  fi
  t_down0=$(now)
  log "destroying $vm"
  bash "$runner" down "$vm" 2>&1 | stamp | tee -a "$dest/lane.log" >&2
  t_down1=$(now)
  local created=${t_create:-$(jq1 created_epoch)} life=null minutes="" cost=""
  [ -z "$created" ] || life=$(( t_down1 - created ))
  if [ "$life" != null ] && [ -n "$rate" ]; then
    minutes=$(( (life + 59) / 60 ))
    cost=$(awk -v m="$minutes" -v r="$rate" 'BEGIN { printf "%.4f", m * (r + 3 / 43200) }')
  fi
  jset "exit=$rc" "destroyed_at=\"$(date -u -d @$t_down1 +%Y-%m-%dT%H:%M:%SZ)\"" \
    "timings_s={\"create_to_ready\": $(span "$t_create" "$t_ready"), \"sync\": $(span "$t_sync0" "$t_sync1"), \"bootstrap\": $(span "$t_boot0" "$t_boot1"), \"checkout_install\": ${checkout_s:-null}, \"image_build\": ${image_s:-null}, \"smoke\": ${smoke_s:-null}, \"run\": ${run_s:-null}, \"pull\": $(span "$t_pull0" "$t_pull1"), \"destroy\": $(( t_down1 - t_down0 )), \"vm_life\": $life}" \
    "cost={\"vm_minutes\": ${minutes:-null}, \"rate_usd_per_min\": ${rate:-null}, \"ipv4_usd_per_min\": $(awk 'BEGIN{printf "%.8f", 3/43200}'), \"list_price_usd\": ${cost:-null}, \"basis\": \"Ubicloud Germany list price per minute, VM life from create to confirmed destroy rounded up to the minute, plus the public IPv4 at USD 3 a month pro rata; the CLI reports no per-VM cost\"}"
  [ -f "$dest/results/shard.json" ] && cp "$dest/shard-vm.json" "$dest/results/shard-vm.json"
  log "shard ${name:-?}: exit $rc, $(lines "$dest/results/trials.jsonl") trial lines, run $(fmt "${run_s:-}"), VM life $(fmt "$([ "$life" = null ] || echo "$life")") on $size, list price ${cost:+\$}${cost:-?}; $dest/shard-vm.json"
  return 0
}

if [ "$attach" -eq 1 ]; then
  vm=$(jq1 vm); size=$(jq1 size); name=$(jq1 name)
  [ -n "$vm" ] || { echo "run-shard (ubicloud): --attach needs $dest/shard-vm.json (or $dest/results/shard-vm.json) with a vm field" >&2; exit 2; }
  case $size in standard-2) rate=0.00104 ;; standard-4) rate=0.00208 ;; standard-8) rate=0.00416 ;; standard-16) rate=0.00831 ;; standard-30) rate=0.01559 ;; standard-60) rate=0.03117 ;; *) rate="" ;; esac
  trap teardown EXIT
  trap 'exit 130' INT TERM HUP QUIT
  launched=1
  log "attaching to $vm ($size), results under $dest"
else
  # 1. commit and preregistration
  full=$(git -C "$root" rev-parse --verify --quiet "$commit^{commit}" || true)
  if [ -z "$full" ]; then git -C "$root" fetch -q origin "$commit" 2>/dev/null || true; full=$(git -C "$root" rev-parse --verify --quiet "$commit^{commit}" || true); fi
  [ -n "$full" ] || { echo "run-shard (ubicloud): commit $commit is not in this repository and could not be fetched from origin" >&2; exit 2; }
  commit=$full
  scratch_prereg=""
  if git -C "$root" cat-file -e "$commit:$prereg" 2>/dev/null; then
    remote_prereg="$repo_dir/$prereg"
  elif [ -f "$prereg" ]; then
    scratch_prereg=$(cd "$(dirname "$prereg")" && pwd)/$(basename "$prereg")
    remote_prereg="$remote_home/shard/prereg.json"
  else
    echo "run-shard (ubicloud): $prereg is neither a path in the repository at $commit nor a readable file" >&2; exit 2
  fi
  if [ -n "$scratch_prereg" ]; then run_id=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['run_id'])" "$scratch_prereg"); else run_id=$(git -C "$root" show "$commit:$prereg" | python3 -c "import json,sys; print(json.load(sys.stdin)['run_id'])"); fi
  [ "$resume" -eq 0 ] || [ -f "$dest/results/shard.json" ] || { echo "run-shard (ubicloud): --resume needs an earlier attempt's $dest/results/shard.json" >&2; exit 2; }
  log "shard $name: commit $commit, run $run_id, cells $cells, lease \$$lease, ${scratch_prereg:+scratch }preregistration $prereg, $size${location:+ in $location}, dest $dest"

  # 2. a clean detached checkout to sync
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/he-ubi-shard.XXXXXX")
  trap 'rm -rf "$scratch"' EXIT
  git clone -q --no-checkout "$root" "$scratch/harness-evals"
  git -C "$scratch/harness-evals" checkout -q --detach "$commit"
  [ -z "$(git -C "$scratch/harness-evals" status --porcelain)" ] || { echo "run-shard (ubicloud): the scratch checkout at $commit is not clean" >&2; exit 3; }
  [ -f "$scratch/harness-evals/scripts/run-shard.sh" ] || { echo "run-shard (ubicloud): $commit has no scripts/run-shard.sh; a shard runs the preregistration commit's own script" >&2; exit 2; }

  # 3. the VM
  up_args=(-s "$size")
  [ -z "$location" ] || up_args+=(-l "$location")
  [ -z "$storage" ] || up_args+=(-S "$storage")
  t_create=$(now)
  vm=$(bash "$runner" up "${up_args[@]}" 2> >(stamp | tee -a "$dest/lane.log" >&2)) || { log "VM creation failed"; exit 3; }
  [ -n "$vm" ] || { log "VM creation returned no name"; exit 3; }
  t_ready=$(now)
  trap teardown EXIT
  trap 'exit 130' INT TERM HUP QUIT
  location=$(sed -n 's/^LOCATION=//p' "${UBI_RUNNER_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/ubi-runner}/$vm/env" | tr -d "'" || true)
  jset "name=\"$name\"" "vm=\"$vm\"" "size=\"$size\"" "location=\"$location\"" "owner=\"$(bash "$runner" owner)\"" "commit=\"$commit\"" "run_id=\"$run_id\"" "cells=\"$cells\"" "lease_usd=$lease" "prereg=\"$prereg\"" "scratch_prereg=$([ -n "$scratch_prereg" ] && echo true || echo false)" "created_at=\"$(date -u -d @$t_create +%Y-%m-%dT%H:%M:%SZ)\"" "created_epoch=$t_create" "ready_at=\"$(date -u -d @$t_ready +%Y-%m-%dT%H:%M:%SZ)\"" "dest=\"$dest\""
  log "VM $vm ready in $(( t_ready - t_create ))s; $dest/shard-vm.json records it (run-shard.sh --attach --dest $dest rejoins it)"

  t_sync0=$(now)
  bash "$runner" sync "$vm" "$scratch/harness-evals" work/harness-evals 2> >(stamp | tee -a "$dest/lane.log" >&2) || { log "sync failed"; exit 3; }
  rm -rf "$scratch"
  vssh 'mkdir -p ~/shard/bin'
  for f in bootstrap.sh vm-shard.sh; do vssh "cat > ~/shard/bin/$f" < "$here/$f"; done
  [ -z "$scratch_prereg" ] || vssh 'cat > ~/shard/prereg.json' < "$scratch_prereg"
  t_sync1=$(now)
  t_boot0=$(now)
  log "bootstrap (Docker, Bun at ci.yml's pin, Node, python3, jq)"
  if ! vssh "cd $repo_dir && bash -l ~/shard/bin/bootstrap.sh" 2>&1 | stamp | tee -a "$dest/lane.log" >&2; then log "bootstrap failed"; exit 3; fi
  t_boot1=$(now)
  log "bootstrap done in $(( t_boot1 - t_boot0 ))s"

  # 4. the keys, over SSH only, into a 0600 file the launcher reads and deletes
  { for k in ANTHROPIC_API_KEY OPENAI_API_KEY; do [ -n "${!k:-}" ] && printf 'export %s=%q\n' "$k" "${!k}"; done; } | vssh 'umask 077 && cat > ~/.ubirun-env'

  if [ "$resume" -eq 1 ]; then
    log "resume: uploading $dest/results (without harness state and workspaces) to the VM"
    tar -C "$dest" -czf - --exclude='results/trials/*/*/*/state' --exclude='results/trials/*/*/*/workspace' --exclude='results/shard-vm.json' results | bash "$runner" unpack "$vm" shard
  fi

  # 5. launch vm-shard.sh detached
  vm_args=(--commit "$commit" --prereg "$remote_prereg" --name "$name" --cells "$cells" --lease-usd "$lease" --smoke-lease-usd "$smoke_lease")
  [ -z "$smoke_task" ] || vm_args+=(--smoke-task "$smoke_task")
  [ "$smoke" -eq 1 ] || vm_args+=(--no-smoke)
  [ "$resume" -eq 0 ] || vm_args+=(--resume)
  [ -z "$amendment" ] || vm_args+=(--amendment "$amendment")
  [ "$embedded" -eq 0 ] || vm_args+=(--embedded)
  [ -z "$gbrain_image" ] || vm_args+=(--gbrain-image "$gbrain_image")
  [ ${#extra[@]} -eq 0 ] || vm_args+=(-- "${extra[@]}")
  qargs=$(printf '%q ' "${vm_args[@]}")
  printf '#!/usr/bin/env bash\nset -u\ncd ~/shard\n. ~/.ubirun-env\nrm -f ~/.ubirun-env\nsetsid nohup bash -l ~/shard/bin/vm-shard.sh %s > ~/shard/vm-shard.out 2>&1 < /dev/null &\necho $! > ~/shard/pid\necho "launched pid $(cat ~/shard/pid)"\n' "$qargs" | vssh 'cat > ~/shard/bin/launch.sh'
  vssh 'bash ~/shard/bin/launch.sh && ! test -e ~/.ubirun-env && echo "key file deleted"' 2>&1 | stamp | tee -a "$dest/lane.log" >&2
  launched=1
  jset "launched_at=\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  log "vm-shard.sh running detached on $vm; tail -f $dest/run-shard.log (and run.stdout.log, run.log, vm-shard.out)"
fi

# 6. poll: append new bytes of the VM's logs, until ~/shard/exit exists
deadline=$(( $(now) + timeout_h * 3600 ))
fails=0 polls=0 last_count=-1
while :; do
  sleep "$poll"
  polls=$(( polls + 1 ))
  out=$(vssh 'cat ~/shard/exit 2>/dev/null; echo "::trials $(wc -l < ~/shard/results/trials.jsonl 2>/dev/null || echo 0)"' 2>/dev/null) || { fails=$(( fails + 1 )); [ $(( fails % 10 )) -eq 0 ] && log "WARNING: $fails consecutive SSH failures to $vm"; [ "$(now)" -lt "$deadline" ] || { log "timeout after $timeout_h h"; exit 3; }; continue; }
  fails=0
  for f in results/run-shard.log results/run.stdout.log results/run.log vm-shard.out; do
    local_f="$dest/$(basename "$f")"
    have=$(stat -c %s "$local_f" 2>/dev/null || echo 0)
    vssh "tail -c +$(( have + 1 )) ~/shard/$f 2>/dev/null" >> "$local_f" 2>/dev/null || true
  done
  count=${out##*::trials }
  if [ "$count" != "$last_count" ] || [ $(( polls % 20 )) -eq 0 ]; then log "poll: $count trial lines, $(tail -1 "$dest/run-shard.log" 2>/dev/null | cut -c1-160)"; last_count=$count; fi
  code=$(printf '%s\n' "$out" | sed -n '1{/^::trials/!p}')
  if [ -n "$code" ]; then
    exited=1
    case $code in interrupted) rc=130 ;; *) rc=$code ;; esac
    log "the shard on $vm exited $rc"
    break
  fi
  [ "$(now)" -lt "$deadline" ] || { log "timeout after $timeout_h h; stopping the shard"; exit 3; }
done
exit "$rc"
