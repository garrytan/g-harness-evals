#!/usr/bin/env bash
# Run one shard of a sharded, preregistered run on an ephemeral Ubicloud VM instead of a Capy machine (docs/ubicloud.md).
# One VM per shard, the repository pinned at the preregistration commit, images built there, the one-trial smoke the Capy
# shards ran before every counted shard, then the repository's own scripts/run-shard.sh under the shard's lease, the
# results tree copied back and the VM destroyed on every exit path.
#
#   scripts/ubicloud/run-shard.sh --commit <sha> --prereg <path in the repo at that commit, or a scratch file> --name <shard>
#       --cells a,b --lease-usd <n> --dest <local directory> [--size standard-16] [--location eu-central-h1] [--storage GiB]
#       [--smoke-lease-usd <n>] [--smoke-task <task id>] [--smoke-first-cell] [--no-smoke] [--embedded] [--gbrain-image <tag>]
#       [--amendment <sha>]
#       [--resume] [--attach] [--poll-seconds 30] [--timeout-hours 12] [--sealed-root <local dir> --opening-receipt <local file>]
#       [--workload harness|gstack-laneb] [--laneb-root <dir from scripts/gstack-laneb/fetch.ts>]
#       [--pre-smoke <script in the repository, e.g. scripts/ablation-golden.sh>] [-- <extra arguments for scripts/run-shard.sh>]
#
# --pre-smoke runs a keyless check script from the pinned checkout on the VM after bootstrap and before any key
# reaches the VM, the smoke or the shard: bash <script> in the repository, its output in <dest>/lane.log. It is off unless
# given (put it in the fan-out manifest's options). A non-zero exit stops the lane with exit 4 before the smoke, so no
# trial runs. scripts/ablation-golden.sh, the layer filter's docker golden check, is the one in use. It must be a .sh file
# under scripts/ at the commit, and is refused for --attach and --workload gstack-laneb.
#
# --workload gstack-laneb (docs/gstack-laneb.md) runs the shard's cells through the Lane B bridge instead of the
# harness runner: the --laneb-root directory (default ~/.capy/work/gstack-laneb: the pinned gstack-evals checkout, the arm
# tars, and terminal-bench-2 when fetched) is streamed to ~/laneb on the VM without its .git directory (terminal-bench-2
# keeps its own), only the arms the shard's cells use plus none and placebo for the smoke; vm-shard.sh then runs the
# keyless bridge smoke (scripts/gstack-laneb/smoke.sh, fake upstream, no spend) in place of the harness smoke and
# scripts/gstack-laneb/vm-run.sh in place of scripts/run-shard.sh. Poll lines carry the count of finished Harbor trials
# only, never a log line. --resume, --embedded, --sealed-root and --opening-receipt are refused for this workload
# (held-out Lane B runs are not supported yet). Everything else (one VM per shard, the keys over SSH, the pull, the
# destroy) is the same.
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
#   4. With --sealed-root and --opening-receipt (docs/sealed-custody.md; both or neither, and refused when --dest is
#      inside a git work tree, since the raw sealed results come back there): the custodian's sealed root is streamed as a
#      tar to ~/sealed/root and the receipt to ~/sealed/opening-receipt.json on the VM, outside ~/work/harness-evals, with
#      no local staging copy; the lane log names the paths and the receipt's sha256 only, shard-vm.json records sealed=true,
#      and vm-shard.sh gets --sealed-root /home/ubi/sealed/root --opening-receipt /home/ubi/sealed/opening-receipt.json. A
#      --resume uploads them again to its fresh VM. The diagnostics of tar and the remote unpack (of the root, the receipt
#      and a sealed --resume's results) go to <dest>/sealed-upload.log only (removed by scripts/sealed/cleanup.ts), since they
#      can name a sealed path; a failed upload prints a fixed line naming that log. On the VM, scripts/run-shard.sh runs from its own copy of ~/sealed/root.
#   5. ANTHROPIC_API_KEY, OPENAI_API_KEY and PARTICLE_API_KEY (each one that is set here; the run needs the first,
#      --embedded the second, a Particle cell the third, which preflight requires) are written to ~/.ubirun-env on the
#      VM with umask 077 over the multiplexed SSH connection, exactly as ubi-runner.sh run --pass writes them. The
#      launcher reads the file into the shell and deletes it before vm-shard.sh starts, so no file on the VM holds a key
#      while the run is live; the keys live in that process's environment (the runner's own child processes inherit it)
#      and only the metering proxy uses them, as on a Capy shard; no container or image receives them. Nothing goes through cloud-init user data, images or logs.
#   6. vm-shard.sh runs detached on the VM (setsid, nohup): checkout --detach, bun install, the smoke (a copy of the
#      preregistration with only this shard's harness cells on one dev task, one repetition, under its own lease and
#      ledger; it builds the images; a sealed lane's smoke is a public dev run, without the sealed flags and with the public
#      gbrain image), then scripts/run-shard.sh --skip-build for the shard (a sealed shard builds instead, for its
#      receipt-bound gbrain image) with --max-output-tokens 128000 as that script passes it. With --resume the local
#      <dest>/results tree (minus harness state) is uploaded first.
#   7. Every --poll-seconds this script appends the new bytes of the VM's run-shard.log, run.stdout.log and run.log to
#      <dest>/run-shard.log, <dest>/run.stdout.log and <dest>/run.log, and vm-shard's own output to <dest>/vm-shard.out.
#   8. On exit (the run finished, a failure, or an interrupt) the shard process on the VM is stopped if still running,
#      every ledger is checkpointed (PRAGMA wal_checkpoint(TRUNCATE)) so ledger.sqlite is complete on its own, the whole
#      results tree is copied back to <dest>/results (the smoke's to <dest>/smoke), a sealed shard's ~/sealed is deleted
#      from the VM, <dest>/results/shard-vm.json is written beside shard.json (VM name, size, location, timings, exit,
#      list-price cost), and the VM is destroyed. shard-vm.json says cleanup "pending" from creation, "done" with
#      destroyed_at only after ubi-runner.sh down exits 0, and "failed" (the VM id appended to <dest>/cleanup-pending) when
#      down fails; a sealed shard's poll lines carry the trial count only, never a log line. When the pull of the results
#      tree fails or <dest>/results is missing afterwards (any exit but 4, where the counted run never started), the VM is
#      not destroyed: its id goes to <dest>/cleanup-pending, shard-vm.json keeps cleanup "pending" with a cleanup_reason,
#      and the VM's TTL ends it unless --attach pulls and destroys it first. A VM that answers that it holds no
#      ~/shard/results (a failure before the counted run wrote any) is destroyed as before.
#   --attach (with --dest) rejoins a VM an earlier invocation of this script left running (this machine slept or the
#   controller died): it reads the VM name (and whether the shard is sealed) from <dest>/shard-vm.json, polls, pulls,
#   deletes ~/sealed when sealed and destroys as above. A sealed attach whose --dest is inside a git work tree is refused
#   (HE-SEALED-002) before it polls, appends a log or pulls, and leaves the VM running.
#
# Exit code: scripts/run-shard.sh's; 4 when the --pre-smoke check failed or the smoke did not end with every trial
# completed (the counted run never started); 3 when the VM, the sync or the bootstrap failed before the run; 2 for a usage error; 130 on interrupt.
# Needs UBICLOUD_API_KEY and UBI_OWNER (your thread code) in the environment, git, python3, ssh and tar. Nothing here
# prints or stores a key. The VM's list price is the Germany per-minute rate (standard-8 $0.00416, standard-16 $0.00831,
# standard-30 $0.01559), minutes rounded up, plus the public IPv4 at $3 a month pro rata, as pr-check.sh computes it.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
runner=${UBI_RUNNER:-$here/ubi-runner.sh}

commit="" prereg="" name="" cells="" lease="" dest="" size=standard-16 location="" storage="" smoke_lease="" smoke_task="" smoke=1
smoke_first=0 embedded=0 gbrain_image="" amendment="" resume=0 attach=0 poll=30 timeout_h=12 sealed_root="" opening_receipt="" sealed=0
workload=harness laneb_root="$HOME/.capy/work/gstack-laneb" pre_smoke=""
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
    --smoke-first-cell) smoke_first=1; shift ;;
    --no-smoke) smoke=0; shift ;;
    --embedded) embedded=1; shift ;;
    --gbrain-image) gbrain_image=$2; shift 2 ;;
    --amendment) amendment=$2; shift 2 ;;
    --resume) resume=1; shift ;;
    --attach) attach=1; shift ;;
    --poll-seconds) poll=$2; shift 2 ;;
    --timeout-hours) timeout_h=$2; shift 2 ;;
    --sealed-root) sealed_root=$2; shift 2 ;;
    --opening-receipt) opening_receipt=$2; shift 2 ;;
    --workload) workload=$2; shift 2 ;;
    --laneb-root) laneb_root=$2; shift 2 ;;
    --pre-smoke) pre_smoke=$2; shift 2 ;;
    -h|--help) sed -n '2,/^set -euo pipefail/{/^set /!p}' "$0"; exit 0 ;;
    --) shift; extra=("$@"); break ;;
    *) echo "run-shard (ubicloud): unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$dest" ] || { echo "run-shard (ubicloud): --dest is required" >&2; exit 2; }
if [ -n "$pre_smoke" ]; then
  [ "$attach" -eq 0 ] && [ "$workload" = harness ] || { echo "run-shard (ubicloud): --pre-smoke applies only to a new harness shard, not --attach or --workload gstack-laneb" >&2; exit 2; }
  [[ "$pre_smoke" =~ ^scripts/[A-Za-z0-9._/-]+\.sh$ && "$pre_smoke" != *..* ]] || { echo "run-shard (ubicloud): --pre-smoke must be a .sh file under scripts/ in the repository, e.g. scripts/ablation-golden.sh" >&2; exit 2; }
fi
case $workload in harness) ;; gstack-laneb)
  [ "$resume" -eq 0 ] && [ "$embedded" -eq 0 ] || { echo "run-shard (ubicloud): --resume and --embedded do not apply to --workload gstack-laneb (docs/gstack-laneb.md)" >&2; exit 2; }
  [ -z "$sealed_root" ] && [ -z "$opening_receipt" ] || { echo "run-shard (ubicloud): --workload gstack-laneb runs public sets only; held-out (sealed) Lane B runs are not supported yet (docs/gstack-laneb.md, Known limits)" >&2; exit 2; }
  [ "$attach" -eq 1 ] || { [ -d "$laneb_root/gstack-evals" ] && [ -d "$laneb_root/arms" ]; } || { echo "run-shard (ubicloud): --laneb-root $laneb_root needs gstack-evals/ and arms/ (bun scripts/gstack-laneb/fetch.ts --out $laneb_root)" >&2; exit 2; } ;;
  *) echo "run-shard (ubicloud): --workload must be harness or gstack-laneb" >&2; exit 2 ;;
esac
if [ "$attach" -eq 0 ]; then
  [ -n "$commit" ] && [ -n "$prereg" ] && [ -n "$name" ] && [ -n "$cells" ] && [ -n "$lease" ] || { echo "run-shard (ubicloud): --commit, --prereg, --name, --cells, --lease-usd and --dest are required" >&2; exit 2; }
  [ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "run-shard (ubicloud): ANTHROPIC_API_KEY is not set in this shell; the metering proxy on the VM needs it" >&2; exit 2; }
  [ "$embedded" -eq 0 ] || [ -n "${OPENAI_API_KEY:-}" ] || { echo "run-shard (ubicloud): --embedded needs OPENAI_API_KEY in this shell" >&2; exit 2; }
  if [ -n "$sealed_root" ] || [ -n "$opening_receipt" ]; then
    [ -n "$sealed_root" ] && [ -n "$opening_receipt" ] || { echo "run-shard (ubicloud): --sealed-root and --opening-receipt go together; give both or neither" >&2; exit 2; }
    [ -d "$sealed_root" ] || { echo "run-shard (ubicloud): --sealed-root $sealed_root is not a directory" >&2; exit 2; }
    [ -f "$opening_receipt" ] || { echo "run-shard (ubicloud): --opening-receipt $opening_receipt does not exist" >&2; exit 2; }
    [ "$embedded" -eq 0 ] || { echo "run-shard (ubicloud): --embedded is not supported with --sealed-root (the embedded brains are built inside the checkout; docs/sealed-custody.md)" >&2; exit 2; }
    probe=$dest
    while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
    if git -C "$probe" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "HE-SEALED-002 run-shard (ubicloud): --dest $dest is inside a git work tree; the raw sealed results come back there, so keep --dest outside every checkout" >&2; exit 2; fi
    sealed_root=$(cd "$sealed_root" && pwd -P)
    opening_receipt=$(realpath "$opening_receipt")
    sealed=1
  fi
fi
[ -n "${UBI_OWNER:-}" ] || { echo "run-shard (ubicloud): set UBI_OWNER to your thread code so the VM carries its owner" >&2; exit 2; }
[ -n "${UBICLOUD_API_KEY:-${UBICLOUD_API_TOKEN:-}}" ] || { echo "run-shard (ubicloud): UBICLOUD_API_KEY is not set" >&2; exit 2; }
[ -f "$runner" ] || { echo "run-shard (ubicloud): ubi-runner.sh not found at $runner" >&2; exit 2; }
[[ "$timeout_h" =~ ^[1-9][0-9]{0,2}$ ]] && [ "$timeout_h" -le 998 ] || { echo "run-shard (ubicloud): --timeout-hours must be a whole number of hours from 1 to 998" >&2; exit 2; }
# The VM's name carries its TTL (-t<hours>, ubi-runner.sh's header), after which gstack's reaper destroys it whoever owns it,
# so it must outlive the shard: --timeout-hours plus an hour for the stop, the copy back and the teardown (13 for the default
# 12). An inherited UBI_TTL_HOURS is kept when it is longer than --timeout-hours and refused otherwise.
if [ "$attach" -eq 0 ]; then
  if [ -z "${UBI_TTL_HOURS:-}" ]; then
    export UBI_TTL_HOURS=$(( timeout_h + 1 ))
  else
    ttl=$(bash "$runner" ttl) || exit 2
    [ "$ttl" -gt "$timeout_h" ] || { echo "run-shard (ubicloud): UBI_TTL_HOURS=$UBI_TTL_HOURS gives the VM a ${ttl}h TTL, which would let the reaper destroy it before --timeout-hours $timeout_h runs out; unset it or set it above $timeout_h" >&2; exit 2; }
  fi
fi
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
  local results_pulled=1
  if [ "$launched" -eq 1 ] && [ "$exited" -eq 0 ]; then
    if [ "$workload" = gstack-laneb ]; then
      # the Lane B shard drains its meter and writes its records after the signal (vm-shard.sh waits for vm-run.sh and
      # then writes ~/shard/exit), so wait for the exit file itself, up to 240 s
      log "stopping the shard on $vm (SIGTERM to its process group, up to 240 s for its records)"
      vssh 'pid=$(cat ~/shard/pid 2>/dev/null); [ -n "$pid" ] && kill -TERM -- -"$pid" 2>/dev/null; for i in $(seq 240); do [ -f ~/shard/exit ] && break; sleep 1; done; [ -f ~/shard/exit ] || echo interrupted > ~/shard/exit; cat ~/shard/exit' 2>>"$dest/lane.log" | stamp | tee -a "$dest/lane.log" >&2
    else
    log "stopping the shard on $vm (SIGTERM to its process group, up to 90 s)"
    vssh 'pid=$(cat ~/shard/pid 2>/dev/null); [ -n "$pid" ] && kill -TERM -- -"$pid" 2>/dev/null; for i in $(seq 90); do [ -f ~/shard/exit ] && break; kill -0 "$pid" 2>/dev/null || break; sleep 1; done; [ -f ~/shard/exit ] || echo interrupted > ~/shard/exit; cat ~/shard/exit' 2>>"$dest/lane.log" | stamp | tee -a "$dest/lane.log" >&2
    fi
  fi
  if [ "$launched" -eq 1 ]; then
    log "checkpointing ledgers and copying the results tree back to $dest"
    vssh 'for f in $(find ~/shard -name ledger.sqlite 2>/dev/null); do bun -e "const {Database}=require(\"bun:sqlite\"); const db=new Database(process.argv[1]); db.exec(\"PRAGMA wal_checkpoint(TRUNCATE)\"); db.close(); console.log(\"checkpointed\", process.argv[1])" "$f"; done' 2>>"$dest/lane.log" | stamp | tee -a "$dest/lane.log" >&2
    t_pull0=$(now)
    bash "$runner" pull "$vm" "shard/results" "$dest" 2>/dev/null || { results_pulled=0; log "WARNING: no shard/results on the VM to pull (the run never started, or the VM is gone)"; }
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
  if [ "$sealed" -eq 1 ]; then
    log "sealed: deleting ~/sealed (the sealed root and receipt) from $vm"
    vssh 'rm -rf ~/sealed' < /dev/null 2>>"$dest/lane.log" || log "WARNING: rm -rf ~/sealed on $vm failed; the VM is destroyed next"
  fi
  # A shard that got past the smoke (any exit but 4) has results only on the VM until this pull, so a failed pull or a
  # missing <dest>/results keeps the VM: destroying it would lose them. The VM id goes to cleanup-pending, shard-vm.json
  # keeps cleanup "pending" with the reason, and the VM's TTL bounds its life. A VM that answers that it has no
  # ~/shard/results (a checkout, install or smoke-lease failure before the counted run) has nothing to lose and is destroyed.
  if [ "$launched" -eq 1 ] && [ "$rc" != 4 ] && { [ "$results_pulled" -eq 0 ] || [ ! -d "$dest/results" ]; }; then
    if vssh 'if [ -d ~/shard/results ]; then echo shard-results=yes; else echo shard-results=no; fi' < /dev/null 2>>"$dest/lane.log" | grep -qx 'shard-results=no'; then
      log "no shard/results on $vm (exit $rc: the counted run wrote none), so there is nothing to keep it for"
    else
      log "WARNING: the results tree did not come back from $vm, so $vm is NOT destroyed (its TTL ends it); pull it with run-shard.sh --attach --dest $dest, or bash $runner pull $vm shard/results $dest, then bash $runner down $vm. The VM id is in $dest/cleanup-pending"
      printf '%s\n' "$vm" >> "$dest/cleanup-pending"
      jset "exit=$rc" "cleanup=\"pending\"" "cleanup_reason=\"results not pulled; VM kept\""
      return 0
    fi
  fi
  t_down0=$(now)
  log "destroying $vm"
  bash "$runner" down "$vm" 2>&1 | stamp | tee -a "$dest/lane.log" >&2
  local down_rc=${PIPESTATUS[0]}
  t_down1=$(now)
  # The destroy is recorded only once down has confirmed it. A failed down keeps the VM id for a later sweep, and a
  # controller that dies before this line leaves cleanup "pending" in shard-vm.json, which scripts/sealed/cleanup.ts and
  # the sweep (ubi-runner.sh list --mine) treat as unresolved.
  if [ "$down_rc" -ne 0 ]; then
    log "WARNING: down $vm failed (exit $down_rc); the VM id is kept in $dest/cleanup-pending for a sweep: bash $runner list --mine, then down $vm"
    printf '%s\n' "$vm" >> "$dest/cleanup-pending"
    jset "exit=$rc" "cleanup=\"failed\""
    [ -f "$dest/results/shard.json" ] && cp "$dest/shard-vm.json" "$dest/results/shard-vm.json"
    return 0
  fi
  local created=${t_create:-$(jq1 created_epoch)} life=null minutes="" cost=""
  [ -z "$created" ] || life=$(( t_down1 - created ))
  if [ "$life" != null ] && [ -n "$rate" ]; then
    minutes=$(( (life + 59) / 60 ))
    cost=$(awk -v m="$minutes" -v r="$rate" 'BEGIN { printf "%.4f", m * (r + 3 / 43200) }')
  fi
  jset "exit=$rc" "cleanup=\"done\"" "destroyed_at=\"$(date -u -d @$t_down1 +%Y-%m-%dT%H:%M:%SZ)\"" \
    "timings_s={\"create_to_ready\": $(span "$t_create" "$t_ready"), \"sync\": $(span "$t_sync0" "$t_sync1"), \"bootstrap\": $(span "$t_boot0" "$t_boot1"), \"checkout_install\": ${checkout_s:-null}, \"image_build\": ${image_s:-null}, \"smoke\": ${smoke_s:-null}, \"run\": ${run_s:-null}, \"pull\": $(span "$t_pull0" "$t_pull1"), \"destroy\": $(( t_down1 - t_down0 )), \"vm_life\": $life}" \
    "cost={\"vm_minutes\": ${minutes:-null}, \"rate_usd_per_min\": ${rate:-null}, \"ipv4_usd_per_min\": $(awk 'BEGIN{printf "%.8f", 3/43200}'), \"list_price_usd\": ${cost:-null}, \"basis\": \"Ubicloud Germany list price per minute, VM life from create to confirmed destroy rounded up to the minute, plus the public IPv4 at USD 3 a month pro rata; the CLI reports no per-VM cost\"}"
  [ -f "$dest/results/shard.json" ] && cp "$dest/shard-vm.json" "$dest/results/shard-vm.json"
  log "shard ${name:-?}: exit $rc, $(lines "$dest/results/trials.jsonl") trial lines, run $(fmt "${run_s:-}"), VM life $(fmt "$([ "$life" = null ] || echo "$life")") on $size, list price ${cost:+\$}${cost:-?}; $dest/shard-vm.json"
  return 0
}

if [ "$attach" -eq 1 ]; then
  vm=$(jq1 vm); size=$(jq1 size); name=$(jq1 name)
  [ "$(jq1 sealed)" != True ] || sealed=1
  [ "$(jq1 workload)" != gstack-laneb ] || workload=gstack-laneb
  [ -n "$vm" ] || { echo "run-shard (ubicloud): --attach needs $dest/shard-vm.json (or $dest/results/shard-vm.json) with a vm field" >&2; exit 2; }
  # A sealed lane's raw logs and results come back to --dest, so an attach rechecks it once it knows the lane is sealed.
  if [ "$sealed" -eq 1 ] && git -C "$dest" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "HE-SEALED-002 run-shard (ubicloud): --dest $dest is inside a git work tree and $vm runs a sealed shard, whose raw logs and results come back there; nothing was polled or pulled and $vm is still running. Move $dest outside every checkout and attach from there, or destroy the VM (its results are lost): bash $runner down $vm" >&2; exit 2; fi
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
  read_key='import json,sys; print(json.load(sys.stdin).get("shard_resume", ""))'
  if [ -n "$scratch_prereg" ]; then shard_resume=$(python3 -c "$read_key" < "$scratch_prereg"); else shard_resume=$(git -C "$root" show "$commit:$prereg" | python3 -c "$read_key"); fi
  if [ "$shard_resume" = refused ] && { [ "$resume" -eq 1 ] || [[ " ${extra[*]-} " == *" --resume "* ]] || [ -f "$dest/results/shard.json" ] || [ -n "$(jq1 launched_at)" ]; }; then
    echo "run-shard (ubicloud): run $run_id's preregistration sets shard_resume refused: an interrupted shard ends its cell as incomplete and is never resumed or relaunched into $dest (merge with scripts/merge-shards.ts --partial --vm-lost <cell>)" >&2; exit 2
  fi
  log "shard $name: commit $commit, run $run_id, cells $cells, lease \$$lease, ${scratch_prereg:+scratch }preregistration $prereg, $size${location:+ in $location}, dest $dest"

  # 2. a clean detached checkout to sync
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/he-ubi-shard.XXXXXX")
  trap 'rm -rf "$scratch"' EXIT
  git clone -q --no-checkout "$root" "$scratch/harness-evals"
  git -C "$scratch/harness-evals" checkout -q --detach "$commit"
  [ -z "$(git -C "$scratch/harness-evals" status --porcelain)" ] || { echo "run-shard (ubicloud): the scratch checkout at $commit is not clean" >&2; exit 3; }
  [ -f "$scratch/harness-evals/scripts/run-shard.sh" ] || { echo "run-shard (ubicloud): $commit has no scripts/run-shard.sh; a shard runs the preregistration commit's own script" >&2; exit 2; }
  [ -z "$pre_smoke" ] || [ -f "$scratch/harness-evals/$pre_smoke" ] || { echo "run-shard (ubicloud): --pre-smoke $pre_smoke is not in the repository at $commit" >&2; exit 2; }

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
  jset "name=\"$name\"" "vm=\"$vm\"" "size=\"$size\"" "location=\"$location\"" "owner=\"$(bash "$runner" owner)\"" "commit=\"$commit\"" "run_id=\"$run_id\"" "cells=\"$cells\"" "lease_usd=$lease" "prereg=\"$prereg\"" "scratch_prereg=$([ -n "$scratch_prereg" ] && echo true || echo false)" "sealed=$([ "$sealed" -eq 1 ] && echo true || echo false)" "workload=\"$workload\"" "created_at=\"$(date -u -d @$t_create +%Y-%m-%dT%H:%M:%SZ)\"" "created_epoch=$t_create" "ready_at=\"$(date -u -d @$t_ready +%Y-%m-%dT%H:%M:%SZ)\"" "dest=\"$dest\"" "cleanup=\"pending\""
  log "VM $vm ready in $(( t_ready - t_create ))s; $dest/shard-vm.json records it (run-shard.sh --attach --dest $dest rejoins it)"

  t_sync0=$(now)
  bash "$runner" sync "$vm" "$scratch/harness-evals" work/harness-evals 2> >(stamp | tee -a "$dest/lane.log" >&2) || { log "sync failed"; exit 3; }
  rm -rf "$scratch"
  vssh 'mkdir -p ~/shard/bin'
  for f in bootstrap.sh vm-shard.sh smoke-lease.ts; do vssh "cat > ~/shard/bin/$f" < "$here/$f"; done
  [ -z "$scratch_prereg" ] || vssh 'cat > ~/shard/prereg.json' < "$scratch_prereg"
  t_sync1=$(now)
  t_boot0=$(now)
  log "bootstrap (Docker, Bun at ci.yml's pin, Node, python3, jq)"
  if ! vssh "cd $repo_dir && bash -l ~/shard/bin/bootstrap.sh" 2>&1 | stamp | tee -a "$dest/lane.log" >&2; then log "bootstrap failed"; exit 3; fi
  t_boot1=$(now)
  log "bootstrap done in $(( t_boot1 - t_boot0 ))s"

  # 3b. the --pre-smoke check, before any key reaches the VM; a failure ends the lane before the smoke (exit 4)
  if [ -n "$pre_smoke" ]; then
    log "pre-smoke: bash $pre_smoke (keyless, before the keys, the smoke and the shard)"
    pre_rc=0
    vssh "cd $repo_dir && bash -l $(printf %q "$pre_smoke")" < /dev/null 2>&1 | stamp | tee -a "$dest/lane.log" >&2 || pre_rc=$?
    if [ "$pre_rc" -ne 0 ]; then rc=4; log "pre-smoke $pre_smoke failed (exit $pre_rc); no smoke and no trial ran"; exit 4; fi
    log "pre-smoke $pre_smoke passed"
  fi

  # 4. a sealed shard's root and receipt, streamed straight to ~/sealed (outside the checkout); no local staging copy
  if [ "$sealed" -eq 1 ]; then
    log "sealed: uploading $sealed_root to ~/sealed/root and $opening_receipt (sha256 $(sha256sum "$opening_receipt" | cut -d' ' -f1)) to ~/sealed/opening-receipt.json"
    # tar and the remote unpack can name an archive member (a sealed task path), so their diagnostics go to <dest>/sealed-upload.log, which cleanup.ts removes
    tar -C "$sealed_root" -czf - . 2>>"$dest/sealed-upload.log" | bash "$runner" unpack "$vm" sealed/root >>"$dest/sealed-upload.log" 2>&1 || { log "sealed upload failed; its diagnostics are in $dest/sealed-upload.log (custody only)"; exit 3; }
    vssh 'mkdir -p ~/sealed && cat > ~/sealed/opening-receipt.json' < "$opening_receipt" >>"$dest/sealed-upload.log" 2>&1 || { log "sealed receipt upload failed; its diagnostics are in $dest/sealed-upload.log (custody only)"; exit 3; }
  fi

  # 4b. the Lane B bridge's pinned checkout and arm tars (--workload gstack-laneb), streamed to ~/laneb; no key is in them
  if [ "$workload" = gstack-laneb ]; then
    laneb_arms=$(printf '%s\n' none placebo ${cells//,/ } | sed 's/.*\.//' | sort -u | sed 's#^#arms/#; s#$#.tar.gz#' | tr '\n' ' ')
    laneb_parts=(gstack-evals $laneb_arms)
    [ ! -d "$laneb_root/terminal-bench-2" ] || laneb_parts+=(terminal-bench-2)
    log "laneb: uploading $laneb_root (${laneb_parts[*]}) to ~/laneb"
    # shellcheck disable=SC2086
    tar -C "$laneb_root" -czf - --exclude=gstack-evals/.git "${laneb_parts[@]}" 2>>"$dest/lane.log" | bash "$runner" unpack "$vm" laneb >>"$dest/lane.log" 2>&1 || { log "laneb upload failed"; exit 3; }
  fi

  # 5. the keys, over SSH only, into a 0600 file the launcher reads and deletes. Only the model keys go (PARTICLE_API_KEY
  # for Particle cells); the custody identity (a file in the project-user drive, never in the environment) never
  # reaches the VM, which gets the opened plaintext and never decrypts.
  { for k in ANTHROPIC_API_KEY OPENAI_API_KEY PARTICLE_API_KEY; do if [ -n "${!k:-}" ]; then printf 'export %s=%q\n' "$k" "${!k}"; fi; done; } | vssh 'umask 077 && cat > ~/.ubirun-env'

  if [ "$resume" -eq 1 ]; then
    log "resume: uploading $dest/results (without harness state and workspaces) to the VM"
    resume_tar=(tar -C "$dest" -czf - --exclude='results/trials/*/*/*/state' --exclude='results/trials/*/*/*/workspace' --exclude='results/shard-vm.json' results)
    if [ "$sealed" -eq 1 ]; then
      # sealed raw results: a tar diagnostic names a trial path, which carries a task id
      "${resume_tar[@]}" 2>>"$dest/sealed-upload.log" | bash "$runner" unpack "$vm" shard >>"$dest/sealed-upload.log" 2>&1 || { log "resume upload failed; its diagnostics are in $dest/sealed-upload.log (custody only)"; exit 3; }
    else
      "${resume_tar[@]}" | bash "$runner" unpack "$vm" shard
    fi
  fi

  # 6. launch vm-shard.sh detached
  vm_args=(--commit "$commit" --prereg "$remote_prereg" --name "$name" --cells "$cells" --lease-usd "$lease")
  [ -z "$smoke_lease" ] || vm_args+=(--smoke-lease-usd "$smoke_lease")
  [ -z "$smoke_task" ] || vm_args+=(--smoke-task "$smoke_task")
  [ "$smoke_first" -eq 0 ] || vm_args+=(--smoke-first-cell)
  [ "$smoke" -eq 1 ] || vm_args+=(--no-smoke)
  [ "$resume" -eq 0 ] || vm_args+=(--resume)
  [ -z "$amendment" ] || vm_args+=(--amendment "$amendment")
  [ "$embedded" -eq 0 ] || vm_args+=(--embedded)
  [ -z "$gbrain_image" ] || vm_args+=(--gbrain-image "$gbrain_image")
  [ "$sealed" -eq 0 ] || vm_args+=(--sealed-root "$remote_home/sealed/root" --opening-receipt "$remote_home/sealed/opening-receipt.json")
  [ "$workload" = harness ] || vm_args+=(--workload "$workload")
  [ ${#extra[@]} -eq 0 ] || vm_args+=(-- "${extra[@]}")
  qargs=$(printf '%q ' "${vm_args[@]}")
  printf '#!/usr/bin/env bash\nset -u\ncd ~/shard\n. ~/.ubirun-env\nrm -f ~/.ubirun-env\nsetsid nohup bash -l ~/shard/bin/vm-shard.sh %s > ~/shard/vm-shard.out 2>&1 < /dev/null &\necho $! > ~/shard/pid\necho "launched pid $(cat ~/shard/pid)"\n' "$qargs" | vssh 'cat > ~/shard/bin/launch.sh'
  vssh 'bash ~/shard/bin/launch.sh && ! test -e ~/.ubirun-env && echo "key file deleted"' 2>&1 | stamp | tee -a "$dest/lane.log" >&2
  launched=1
  jset "launched_at=\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  log "vm-shard.sh running detached on $vm; tail -f $dest/run-shard.log (and run.stdout.log, run.log, vm-shard.out)"
fi

# 7. poll: append new bytes of the VM's logs, until ~/shard/exit exists
deadline=$(( $(now) + timeout_h * 3600 ))
# A VM whose name carries a TTL (-t<hours>) is reaped once its epoch plus that many hours plus ten minutes has passed, so
# the shard is stopped half an hour before the TTL ends, whatever --timeout-hours says (an --attach after a long sleep
# included): the stop, the copy back and the destroy then happen while the VM still exists.
if [[ "$vm" =~ -([0-9]{10})-.+-t([0-9]{1,3})$ ]]; then
  ttl_stop=$(( 10#${BASH_REMATCH[1]} + 10#${BASH_REMATCH[2]} * 3600 - 1800 ))
  if [ "$ttl_stop" -lt "$deadline" ]; then
    deadline=$ttl_stop
    log "$vm's TTL ends at $(date -u -d @$(( ttl_stop + 1800 )) +%Y-%m-%dT%H:%M:%SZ); the shard is stopped by $(date -u -d @"$ttl_stop" +%Y-%m-%dT%H:%M:%SZ) so its results come back first"
  fi
fi
fails=0 polls=0 last_count=-1
while :; do
  sleep "$poll"
  polls=$(( polls + 1 ))
  if [ "$workload" = gstack-laneb ]; then count_cmd='find ~/shard/results/laneb/jobs -mindepth 3 -maxdepth 3 -name result.json 2>/dev/null | wc -l'; else count_cmd='wc -l < ~/shard/results/trials.jsonl 2>/dev/null || echo 0'; fi
  out=$(vssh "cat ~/shard/exit 2>/dev/null; echo \"::trials \$($count_cmd)\"" 2>/dev/null) || { fails=$(( fails + 1 )); [ $(( fails % 10 )) -eq 0 ] && log "WARNING: $fails consecutive SSH failures to $vm"; [ "$(now)" -lt "$deadline" ] || { log "timeout after $timeout_h h"; exit 3; }; continue; }
  fails=0
  for f in results/run-shard.log results/run.stdout.log results/run.log vm-shard.out; do
    local_f="$dest/$(basename "$f")"
    have=$(stat -c %s "$local_f" 2>/dev/null || echo 0)
    vssh "tail -c +$(( have + 1 )) ~/shard/$f 2>/dev/null" >> "$local_f" 2>/dev/null || true
  done
  count=${out##*::trials }
  if [ "$count" != "$last_count" ] || [ $(( polls % 20 )) -eq 0 ]; then
    # A sealed shard's log lines can name sealed tasks, so the controller prints only the count (docs/sealed-custody.md).
    # A Lane B shard's logs can name its tasks too, so it prints only the count of finished Harbor trials.
    if [ "$workload" = gstack-laneb ]; then log "poll: $count finished Harbor trials"; elif [ "$sealed" -eq 1 ]; then log "poll: $count trial lines"; else log "poll: $count trial lines, $(tail -1 "$dest/run-shard.log" 2>/dev/null | cut -c1-160)"; fi
    last_count=$count
  fi
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
