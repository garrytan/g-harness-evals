#!/usr/bin/env bash
# Run one shard of a frontier Harbor run (internal-task): Harbor 0.24.0 with the agent classes of agents.py on the 52 pinned
# Terminal-Bench 2.1 tasks, every model call metered by our proxy under the shard's lease, every task container behind
# the egress blocklist. Runs on a Ubicloud VM (one standard-16 per shard) or on any Linux machine with Docker and
# nftables; scripts/frontier-harbor/install-check.sh runs it keyless against a fake upstream.
#
#   scripts/frontier-harbor/vm-run.sh --prereg <prereg.json> --name <shard> --lease-usd <n> --out <results dir>
#       --tb21 <terminal-bench-2-1 checkout at the pinned commit> [--stage <name> | --rerun <list.json> [--rerun-stage <name>] [--no-earlier-rerun]]
#       [--done <trials.jsonl> ...] [--fake-upstream] [--uncounted <reason>]
#
# --rerun (amendment 4 of frontier-harness-2026-11) runs the listed trials of the shard once more under their own ids,
# in a fresh results directory, as the stage rerun1 (jobs <cell>__a<n>__rerun1, lease <run_id>:<shard>:rerun1): plan.ts
# check-shard --rerun and jobs --rerun, each told the stage with --rerun-stage. The --done files must hold every planned
# trial of the shard (every earlier stage's trials.jsonl), whose spend counts, with an earlier rerun stage's records in
# --done or --own.
# --rerun-stage rerun1-a<m> (amendment 6) names the stage of a later list's first rerun, so its lease is its own. check-shard
# refuses it unless --done or --own holds a record of the shard from an earlier rerun stage, or --no-earlier-rerun says
# that stage ran none of the shard's trials.
#
# --stage runs only that preregistered stage's trials of the shard (plan.ts stages). Without it the shard's every trial
# runs. Either way a trial already recorded in <out>/trials.jsonl, or in a --done file (an earlier stage's results from
# another VM), is left out, so a later stage reuses the results directory and never reruns a trial. --stage also names
# the stage's Harbor jobs (<cell>__a<n>__<stage>) and its lease (<run_id>:<shard>:<stage>; the main stage's is
# <run_id>:<shard>). Each stage opens its own lease in ledger.sqlite (--new-run closes an earlier stage's), and a resume
# of a stage reopens that stage's lease at the same amount, since check-shard leaves this directory's records of the
# stage out (it passes <out>/trials.jsonl as --own; every --done record counts). A later stage refuses to start while
# any trial of the shard's earlier stages is in neither file.
#
# The chain, every piece on this machine:
#   the harness in a task container (only the per-trial dummy token and the proxy URL) -> the egress sidecar of its
#   trial (gost, blocklist) -> our metering proxy (runner/proxy/metering-proxy.ts on the docker bridge gateway :8790,
#   lease mode, one slot per trial, the only process holding ANTHROPIC_API_KEY and OPENAI_API_KEY) -> the provider.
#   The proxy refuses requests that declare a hosted web tool (--refuse-hosted-tools), caps output at the largest model
#   max output in pin.json (128,000; Claude Code sends max_tokens 128000) and writes every forwarded body, hash-chained,
#   to <run>/jobs/<job>/<trial>/proxy-capture/proxy-requests.ndjson (--capture-bodies), on the host, outside the task
#   container, for the contamination audit.
#   broker.ts (127.0.0.1:8791, the only other holder of the proxy's control token) binds each trial's slot when its
#   agent class asks at setup and hands the class only the token and its route: /<trial>/anthropic or /<trial>/openai.
#   Harbor runs with a scrubbed environment (PATH, HOME, TZ, PYTHONPATH, DOCKER_HOST only): no key reaches it, and the
#   classes in agents.py read nothing from its environment.
# Every shard, counted or not, must be a shard of the preregistration with a lease no more than its planned one and no
# less than its headroom floor, and the plan's leases plus its reserve within its cap (plan.ts check-shard); otherwise
# nothing runs (exit 2).
# Order: the shard checked, Harbor installed from the pinned wheel (sha256 checked), the preregistration attested, tasks
# materialized, proxy and broker up, one Harbor job per cell and attempt (plan.ts jobs: retries off, the preregistered
# concurrency, default 4), then the drain: every slot unbound and every trial's meter finalized before to-trials.ts
# writes the records. umask 077. Harbor, proxy and agent output goes to files under --out; stdout and
# <out>/run-shard.log get counts only, never a task id or task text.
# Exit: 0, or Harbor's last non-zero exit code; 2 usage or plan refusal; 3 setup failure; 6 the meter did not drain.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
prereg="" name="" lease="" out="" tb21="" fake=0 uncounted="" stage="" rerun="" rerun_stage="" no_earlier_rerun=0
done_files=()
while [ $# -gt 0 ]; do
  case "$1" in
    --stage) stage=$2; shift 2 ;;
    --rerun) rerun=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --rerun-stage) rerun_stage="$2"; shift 2 ;;
    --no-earlier-rerun) no_earlier_rerun=1; shift ;;
    --done) done_files+=("$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"); shift 2 ;;
    --prereg) prereg=$2; shift 2 ;;
    --name) name=$2; shift 2 ;;
    --lease-usd) lease=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --tb21) tb21=$2; shift 2 ;;
    --fake-upstream) fake=1; shift ;;
    --uncounted) uncounted=$2; shift 2 ;;
    *) echo "vm-run (frontier): unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$prereg" ] && [ -n "$name" ] && [ -n "$lease" ] && [ -n "$out" ] && [ -n "$tb21" ] || { echo "vm-run (frontier): --prereg, --name, --lease-usd, --out and --tb21 are required" >&2; exit 2; }
[ "$fake" -eq 0 ] || [ -n "$uncounted" ] || { echo "vm-run (frontier): --fake-upstream is for an --uncounted check only" >&2; exit 2; }
# Only the metering proxy holds provider keys: they stay shell variables (not exported) and are exported again inside
# the proxy's subshell alone.
export -n ANTHROPIC_API_KEY OPENAI_API_KEY 2>/dev/null || true
unset UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY
if [ "$fake" -eq 0 ]; then
  [ -n "${ANTHROPIC_API_KEY:+x}" ] || [ -n "${OPENAI_API_KEY:+x}" ] || { echo "vm-run (frontier): neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set; the proxy needs the key of each provider the shard uses (or pass --fake-upstream)" >&2; exit 2; }
fi
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mkdir -p "$out/run"
out=$(cd "$out" && pwd)
run=$out/run
prereg=$(cd "$(dirname "$prereg")" && pwd)/$(basename "$prereg")
tb21=$(cd "$tb21" && pwd)
venv=${FRONTIER_HARBOR_VENV:-$HOME/.frontier-harbor/venv}
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$out/run.log"; }
say() { printf '%s vm-run[%s]: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$*" | tee -a "$out/run-shard.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
# exec "$@" with only PATH, HOME, TZ and the variables named in $KEEP exported. Called inside a subshell.
run_scrubbed() {
  local keep=" PATH HOME TZ ${KEEP:-} " v
  for v in $(compgen -e); do [[ $keep == *" $v "* ]] || unset "$v" 2>/dev/null || true; done
  exec "$@"
}
pids=() harbor_pid="" harbor_started=0 finished=0 control_token="" accounting_incomplete=0 rc=""
cleanup() {
  [ -z "$harbor_pid" ] || kill "$harbor_pid" 2>/dev/null || true
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null || true; done
}
trap cleanup EXIT
on_signal() {
  trap - TERM INT HUP
  say "interrupted (exit $1); stopping Harbor and writing the records so far"
  [ -z "$harbor_pid" ] || { kill "$harbor_pid" 2>/dev/null || true; timeout 60 tail --pid="$harbor_pid" -f /dev/null 2>/dev/null || kill -KILL "$harbor_pid" 2>/dev/null || true; wait "$harbor_pid" 2>/dev/null || true; harbor_pid=""; }
  [ "$harbor_started" -eq 0 ] || finish 1 30000 || true
  exit "$1"
}
trap 'on_signal 143' TERM
trap 'on_signal 130' INT
trap 'on_signal 129' HUP

# 1. the shard against the preregistration, before anything else; earlier stages' spend counts against the lease
[ -z "$rerun" ] || [ -z "$stage" ] || { echo "vm-run (frontier): --rerun takes no --stage" >&2; exit 2; }
stage_arg=()
plan_arg=()
[ -z "$stage" ] || { stage_arg=(--stage "$stage"); plan_arg=(--stage "$stage"); }
[ -z "$rerun_stage" ] || [ -n "$rerun" ] || { echo "vm-run (frontier): --rerun-stage needs --rerun" >&2; exit 2; }
[ -z "$rerun" ] || { stage=${rerun_stage:-rerun1}; stage_arg=(--stage "$stage"); plan_arg=(--rerun "$rerun" --rerun-stage "$stage"); }
[ "$no_earlier_rerun" -eq 0 ] || plan_arg+=(--no-earlier-rerun)
done_args=()
[ ! -f "$out/trials.jsonl" ] || done_args+=(--own "$out/trials.jsonl")
for f in ${done_files[@]+"${done_files[@]}"}; do done_args+=(--done "$f"); done
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/plan.ts check-shard --prereg "$prereg" --name "$name" --lease-usd "$lease" ${plan_arg[@]+"${plan_arg[@]}"} ${done_args[@]+"${done_args[@]}"} 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "the shard, its stage or its lease does not match the preregistration (run.log); nothing ran"; exit 2; }
read -r run_id ids models <<< "$(cd "$repo" && "${safe_env[@]}" bun -e '
const { loadPlan } = await import("./scripts/frontier-harbor/plan.ts");
const p = loadPlan(process.argv[1]); const s = p.shards.find((x) => x.name === process.argv[2]);
const cells = p.cells.filter((c) => s.cells.includes(c.id));
const ids = [...p.order, ...p.kept_order].filter((t) => cells.some((c) => c.task_ids.includes(t)));
const r = Bun.spawnSync(["python3", "-c", "import sys,json; sys.path.insert(0, sys.argv[1]); import frontier_settings as f; print(\",\".join(sorted({m for a in json.loads(sys.argv[2]) for m in f.slot_models(*a)})))", process.argv[3], JSON.stringify(cells.map((c) => [c.harness, c.model]))]);
if (r.exitCode !== 0) { console.error(r.stderr.toString()); process.exit(2); }
console.log(p.prereg.run_id, ids.join(","), r.stdout.toString().trim());' "$prereg" "$name" "$here" 2>>"$out/run.log")"
[ -n "${models:-}" ] || { say "could not read the shard's tasks and models (run.log)"; exit 2; }
providers=$(printf '%s' "$models" | tr ',' '\n' | cut -d: -f1 | sort -u | tr '\n' ' ')
if [ "$fake" -eq 0 ]; then
  for p in $providers; do
    case $p in
      anthropic) [ -n "${ANTHROPIC_API_KEY:+x}" ] || { say "the shard uses anthropic models and ANTHROPIC_API_KEY is not set"; exit 2; } ;;
      openai) [ -n "${OPENAI_API_KEY:+x}" ] || { say "the shard uses openai models and OPENAI_API_KEY is not set"; exit 2; } ;;
    esac
  done
fi
# the clean-arm preflight (CREW.md "Clean no-gstack and no-brain arms"): every cell of this path is a no-gstack cell, so the
# machine must hold no Capy drive and no gstack install; harnesses install into the task container at run time
(cd "$repo" && "${safe_env[@]}" bun scripts/v04/clean-arm-audit.ts preflight --out "$out/preflight-clean-arm.json" --host-only 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "clean-arm preflight: a Capy drive or a gstack install is reachable on this machine ($out/preflight-clean-arm.json); nothing ran"; exit 2; }
say "shard $name: run $run_id, $(printf '%s' "$ids" | tr ',' '\n' | grep -c .) task(s), providers $providers, lease \$$lease$([ "$fake" -eq 1 ] && echo ', fake upstream (keyless)')$([ -n "$uncounted" ] && echo ", uncounted")"

# 2. Harbor and every package around it from the hashed lock file (harbor-requirements.txt: --require-hashes, wheels only,
# the harbor line carrying only the pinned wheel's hash), with the pinned uv; then an nftables probe (the blocklist
# sidecar needs inet tables; egress.py refuses too)
read -r wheel_sha lock_file lock_sha uv_version <<< "$(python3 -c 'import json,sys; h=json.load(open(sys.argv[1]))["harbor"]; d=h["dependencies"]; print(h["wheel_sha256"], d["file"], d["sha256"], d["uv"])' "$here/pin.json")"
lock=$repo/$lock_file
[ "$(sha256sum "$lock" | cut -d' ' -f1)" = "$lock_sha" ] || { say "$lock_file is not the pinned sha256 $lock_sha"; exit 3; }
grep -A1 '^harbor==' "$lock" | grep -q "sha256:$wheel_sha$" || { say "$lock_file does not pin harbor to the wheel sha256 $wheel_sha"; exit 3; }
if [ ! -x "$venv/bin/harbor" ] || [ "$(cat "$venv/.wheel-sha256" 2>/dev/null)" != "$wheel_sha" ] || [ "$(cat "$venv/.lock-sha256" 2>/dev/null)" != "$lock_sha" ]; then
  uv=$HOME/.local/bin/uv
  if [ "$("$uv" --version 2>/dev/null | cut -d' ' -f2)" != "$uv_version" ]; then
    curl -LsSf "https://astral.sh/uv/$uv_version/install.sh" | "${safe_env[@]}" UV_NO_MODIFY_PATH=1 sh >> "$out/run.log" 2>&1 || { say "installing uv $uv_version failed"; exit 3; }
  fi
  [ "$("$uv" --version 2>/dev/null | cut -d' ' -f2)" = "$uv_version" ] || { say "uv at $uv is not the pinned $uv_version"; exit 3; }
  rm -rf "$venv"
  mkdir -p "$(dirname "$venv")"
  ("${safe_env[@]}" "$uv" venv --python 3.12 "$venv" && "${safe_env[@]}" "$uv" pip install --python "$venv/bin/python" --require-hashes --only-binary :all: -r "$lock") >> "$out/run.log" 2>&1 || { say "installing Harbor from $lock_file failed; see run.log"; exit 3; }
  printf '%s' "$wheel_sha" > "$venv/.wheel-sha256"
  printf '%s' "$lock_sha" > "$venv/.lock-sha256"
fi
"$venv/bin/python" -c 'import importlib.metadata as m, sys; sys.exit(m.version("harbor") != sys.argv[1])' "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["harbor"]["version"])' "$here/pin.json")" || { say "the installed Harbor is not the pinned version"; exit 3; }
if sudo -n nft add table inet frontier_probe 2>/dev/null; then sudo -n nft delete table inet frontier_probe; else say "nftables inet is missing on this kernel; the egress blocklist cannot run"; exit 3; fi

# 3. the preregistration attestation, before any trial
attest=(--prereg "$prereg" --out "$out")
[ -z "$uncounted" ] || attest+=(--uncounted "$uncounted")
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/to-trials.ts attest "${attest[@]}" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "attestation refused (run.log); nothing ran"; exit 3; }

# 4. tasks (a refusal can name a task, so it goes to run.log only)
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/materialize.ts tb21 --src "$tb21" --out "$run" --ids "$ids" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "materialize refused (run.log); nothing ran"; exit 3; }

# 5. proxy and broker
gw=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
control_token=$(openssl rand -hex 32)
lease_run="$run_id:$name${stage:+:$stage}"
upstream=()
if [ "$fake" -eq 1 ]; then
  canary="fake-provider-key-canary-$(openssl rand -hex 16)"
  printf '%s' "$canary" > "$out/canary.txt"
  (export FAKE_UPSTREAM_CANARY=$canary; cd "$repo"; KEEP=FAKE_UPSTREAM_CANARY run_scrubbed setsid bun scripts/frontier-harbor/fake-upstream.ts --listen 127.0.0.1:8799 --log "$out/fake-upstream.jsonl" --bodies "$out/fake-upstream-bodies.jsonl" --canary-env FAKE_UPSTREAM_CANARY) >> "$out/fake-upstream.log" 2>&1 & pids+=($!)
  upstream=(--upstream anthropic=http://127.0.0.1:8799 --upstream openai=http://127.0.0.1:8799)
fi
(
  cd "$repo"
  if [ "$fake" -eq 1 ]; then export ANTHROPIC_API_KEY=$canary OPENAI_API_KEY=$canary; else export ANTHROPIC_API_KEY OPENAI_API_KEY 2>/dev/null || true; fi
  export SHOOTOUT_PROXY_CONTROL_TOKEN=$control_token
  KEEP="ANTHROPIC_API_KEY OPENAI_API_KEY SHOOTOUT_PROXY_CONTROL_TOKEN" run_scrubbed setsid bun runner/proxy/metering-proxy.ts --listen "$gw:8790" \
    --budget-ledger "$out/ledger.sqlite" --lease-usd "$lease" --run-id "$lease_run" --new-run --usage-log "$out/proxy-usage.ndjson" \
    --allow-models "$models" --refuse-hosted-tools --capture-bodies "$run/jobs" --max-output-tokens "$(python3 -c 'import json,sys; print(max(m["max_output_tokens"] for m in json.load(open(sys.argv[1]))["models"].values()))' "$here/pin.json")" ${upstream[@]+"${upstream[@]}"}
) >> "$out/proxy.log" 2>&1 & pids+=($!)
(export SHOOTOUT_PROXY_CONTROL_TOKEN=$control_token; cd "$repo"; KEEP=SHOOTOUT_PROXY_CONTROL_TOKEN run_scrubbed setsid bun scripts/frontier-harbor/broker.ts --listen 127.0.0.1:8791 \
  --proxy "http://$gw:8790" --gateway "http://$gw:8790" --models "$models" --log "$run/binds.jsonl" --capture) >> "$out/broker.log" 2>&1 & pids+=($!)
up=0
for _ in $(seq 60); do
  if [ "$(curl -fsS "$gw:8790/__proxy/status" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("run_id"))' 2>/dev/null)" = "$lease_run" ] && curl -fsS 127.0.0.1:8791/binds >/dev/null 2>&1; then up=1; break; fi
  sleep 0.5
done
[ "$up" -eq 1 ] || { say "the metering proxy (run $lease_run) or the broker did not come up; see proxy.log and broker.log"; exit 3; }
for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null || { say "a proxy, broker or fake upstream process exited at start; see its log"; exit 3; }; done
say "proxy up on $gw:8790 (lease $lease_run, models $models), broker on 127.0.0.1:8791"

# 6. the drain and the records. Idempotent: the normal path and on_signal both call it once. Every slot is unbound, then
# each trial's meter finalized ($1 rounds of up to $2 ms) so no request is still settling when the records are written.
# <out>/accounting.json says whether every request settled; when one did not, its reservation stays charged.
finish() {
  [ "$finished" -eq 0 ] || return 0
  finished=1
  local rounds=$1 wait_ms=$2 undrained=0 ok=true resp n k
  curl -fsS -X POST 127.0.0.1:8791/unbind-all >> "$out/run.log" 2>&1 || ok=false
  for k in $(python3 -c 'import json,sys; [print(json.loads(l)["trial"]) for l in open(sys.argv[1]) if l.strip()]' "$run/binds.jsonl" 2>/dev/null); do
    n=unknown
    for _ in $(seq "$rounds"); do
      resp=$(printf '{"key": "%s", "timeout_ms": %s}' "$k" "$wait_ms" | curl -fsS -m $(( wait_ms / 1000 + 30 )) -X POST "$gw:8790/__proxy/finalize" -H 'content-type: application/json' -H @<(printf 'x-proxy-control: %s\n' "$control_token") --data-binary @- 2>>"$out/run.log") || { n=unknown; break; }
      printf '{"key": "%s", "meter": %s}\n' "$k" "$resp" >> "$out/meter-final.jsonl"
      n=$(printf '%s' "$resp" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("undrained") or 0)' 2>/dev/null || echo unknown)
      [ "$n" != 0 ] || break
    done
    [ "$n" = 0 ] || { ok=false; [ "$n" = unknown ] || undrained=$(( undrained + n )); }
  done
  python3 -c 'import json,sys; ok = sys.argv[2] == "true"; json.dump({"complete": ok, "finalize_ok": ok, "undrained_requests": int(sys.argv[3])}, open(sys.argv[1], "w"))' "$out/accounting.json" "$ok" "$undrained"
  [ "$ok" = true ] || { say "accounting incomplete: the meter did not drain for every trial (undrained $undrained); open reservations stay charged in ledger.sqlite"; accounting_incomplete=1; }
  say "harbor done (last exit ${rc:-interrupted}); $(find "$run/jobs" -mindepth 3 -maxdepth 3 -name result.json 2>/dev/null | wc -l) trial result(s)"
  (cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/to-trials.ts convert --prereg "$prereg" --out "$out" --shard "$name" --lease-run-id "$run_id:$name" ${stage_arg[@]+"${stage_arg[@]}"} 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "to-trials refused (run.log)"; rc=${rc:-0}; [ "$rc" -ne 0 ] || rc=3; }
  python3 - "$out/shard.json" "$name" "$(hostname)" "$(git -C "$repo" rev-parse HEAD)" <<'PY'
import json, sys
p, name, machine, commit = sys.argv[1:5]
json.dump({'name': name, 'machine': machine, 'commit': commit, 'images': None, 'workload': 'frontier-harbor'}, open(p, 'w'), indent=1)
PY
}

# 7. the Harbor jobs, one per cell and attempt, in plan.ts order
jobs=$(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/plan.ts jobs --prereg "$prereg" --name "$name" --run "$run" --broker-url http://127.0.0.1:8791 ${plan_arg[@]+"${plan_arg[@]}"} ${done_args[@]+"${done_args[@]}"} 2>>"$out/run.log") || { say "plan.ts jobs refused (run.log)"; exit 3; }
say "harbor: $(printf '%s\n' "$jobs" | grep -c .) job(s); logs in $run/harbor.log and $run/jobs"
harbor_env=("${safe_env[@]}" "PYTHONPATH=$here")
[ -z "${DOCKER_HOST:-}" ] || harbor_env+=("DOCKER_HOST=$DOCKER_HOST")
set +e
last=0
harbor_started=1
for cfg in $jobs; do
  (cd "$run" && exec "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$cfg") >> "$run/harbor.log" 2>&1 &
  harbor_pid=$!
  wait "$harbor_pid"
  code=$?
  harbor_pid=""
  log "harbor job $(basename "$cfg" .json) exited $code"
  [ "$code" -eq 0 ] || last=$code
done
rc=$last
set -e
finish 8 120000
[ "$rc" -ne 0 ] || [ "$accounting_incomplete" -eq 0 ] || rc=6
exit "$rc"
