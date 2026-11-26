#!/usr/bin/env bash
# Run one shard of the rules-at-scale eval: Harbor 0.24.0 with the rules agent classes of agents_rules.py on
# the shard's tasks and arms (scripts/rules-at-scale/plan.ts), every model call metered by our proxy under the shard's
# lease, then collect.ts to turn the trial directories into the rows analyze.ts reads. Runs on a Ubicloud VM through
# scripts/rules-at-scale/ubicloud/fanout.sh (vm-shard.sh starts it), or on any Linux machine with Docker.
#
#   scripts/rules-at-scale/run-shard.sh --plan <plan.json> --name <shard> --lease-usd <n> --out <results dir>
#       [--smoke] [--fake-upstream [--fake-tool-call]] [--uncounted <reason>] [--no-clean-arm-preflight]
#
# The proxy, broker, Harbor install and drain are copied from scripts/frontier-harbor/vm-run.sh, which the frontier
# preregistration pins and which only runs frontier preregistrations, so the chain is the same: the harness in a task
# container (the per-trial dummy token and the proxy URL only) -> the egress sidecar (blocklist) -> the metering proxy
# (runner/proxy/metering-proxy.ts on the docker bridge gateway :8790, lease mode, the only process holding provider keys,
# --refuse-hosted-tools, every forwarded body captured to <out>/run/jobs/<job>/<trial>/proxy-capture/) -> the provider.
# broker.ts on 127.0.0.1:8791 binds each trial's slot. Harbor runs with a scrubbed environment (PATH, HOME, TZ,
# PYTHONPATH=scripts/frontier-harbor:scripts/rules-at-scale, DOCKER_HOST); no key reaches it.
#
# Order: lane A's file-time stamp (scripts/repo-tasks/rules-fix/build.ts --stamp: git keeps no file times, and docker
# buildx reuses an earlier upload of a same-named build folder when path, size and time match, docker/buildx#3232), then
# plan.ts check-shard (the shard is in the plan, the lease no more than its planned one; exit 2 otherwise), the
# keys the shard's providers need, the clean-arm preflight (no Capy drive and no gstack install on this machine), Harbor
# from the pinned wheel (scripts/frontier-harbor/pin.json, sha256 checked), the task preflight (task-preflight.ts: lane A's
# task contract, verifier_image_matches_files included, on each of the shard's rules-fix tasks; <out>/task-preflight.json;
# exit 2 on a failing task), plan.ts jobs (each task copied into a Harbor task with its own file time, rules files
# materialized, every arm checked, one Harbor job per trial), proxy and broker up, the Harbor jobs in plan order (task-major) with the shard's
# concurrency (1 at a time on QM, 4 elsewhere; verifier on; one log per job in <out>/run/harbor-<job>.log), then the drain (every slot unbound, every trial's meter finalized; <out>/accounting.json) and
# collect.ts --results <out> --out <out>/rules-trials.jsonl, then <out>/shard.json.
#
# --smoke runs plan.ts jobs --smoke instead: one trial (the shard's first task, its first arm that is not none) under the
# job <cell>__a1__smoke, and exits 4 when that trial's row carries an infra code. --fake-upstream answers every model call with scripts/frontier-harbor/fake-upstream.ts behind the
# real proxy (keyless; the proxy's keys are a canary) and needs --smoke or --uncounted; --fake-tool-call makes its first
# agent-loop reply one shell tool call (fake-upstream.ts --tool-call), so the harness runs a command before it stops. --no-clean-arm-preflight is
# allowed with --fake-upstream only (a keyless check on a machine that may hold a Capy drive).
#
# Exit: 0, or Harbor's non-zero exit code; 2 usage, plan or key refusal; 3 setup failure; 4 collect.ts refused the
# trials; 6 the meter did not drain.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
fh=$repo/scripts/frontier-harbor
. "$repo/scripts/ubicloud/provider-keys.sh"
plan="" name="" lease="" out="" smoke=0 fake=0 fake_tool=() uncounted="" preflight=1
while [ $# -gt 0 ]; do
  case "$1" in
    --plan) plan=$2; shift 2 ;;
    --name) name=$2; shift 2 ;;
    --lease-usd) lease=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --smoke) smoke=1; shift ;;
    --fake-upstream) fake=1; shift ;;
    --fake-tool-call) fake_tool=(--tool-call); shift ;;
    --uncounted) uncounted=$2; shift 2 ;;
    --no-clean-arm-preflight) preflight=0; shift ;;
    *) echo "run-shard (rules-at-scale): unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$plan" ] && [ -n "$name" ] && [ -n "$lease" ] && [ -n "$out" ] || { echo "run-shard (rules-at-scale): --plan, --name, --lease-usd and --out are required" >&2; exit 2; }
[ "$fake" -eq 0 ] || [ "$smoke" -eq 1 ] || [ -n "$uncounted" ] || { echo "run-shard (rules-at-scale): --fake-upstream is for --smoke or an --uncounted check only" >&2; exit 2; }
[ ${#fake_tool[@]} -eq 0 ] || [ "$fake" -eq 1 ] || { echo "run-shard (rules-at-scale): --fake-tool-call goes with --fake-upstream" >&2; exit 2; }
[ "$preflight" -eq 1 ] || [ "$fake" -eq 1 ] || { echo "run-shard (rules-at-scale): --no-clean-arm-preflight is allowed with --fake-upstream only" >&2; exit 2; }
export -n "${provider_keys[@]}" 2>/dev/null || true
unset UBICLOUD_API_KEY VOYAGE_API_KEY GOOGLE_API_KEY CURSOR_API_KEY
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mkdir -p "$out/run"
out=$(cd "$out" && pwd)
run=$out/run
plan=$(cd "$(dirname "$plan")" && pwd)/$(basename "$plan")
venv=${FRONTIER_HARBOR_VENV:-$HOME/.frontier-harbor/venv}
say() { printf '%s run-shard[%s]: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "$*" | tee -a "$out/run-shard.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
run_scrubbed() {
  local keep=" PATH HOME TZ ${KEEP:-} " v
  for v in $(compgen -e); do [[ $keep == *" $v "* ]] || unset "$v" 2>/dev/null || true; done
  exec "$@"
}
pids=() harbor_pid="" harbor_started=0 finished=0 control_token="" accounting_incomplete=0 rc=""
cleanup() {
  [ -z "$harbor_pid" ] || kill -- "-$harbor_pid" 2>/dev/null || true
  for p in ${pids[@]+"${pids[@]}"}; do kill "$p" 2>/dev/null || true; done
  for p in ${pids[@]+"${pids[@]}"}; do wait "$p" 2>/dev/null || true; done
}
trap cleanup EXIT
on_signal() {
  trap - TERM INT HUP
  say "interrupted (exit $1); stopping Harbor and writing the records so far"
  [ -z "$harbor_pid" ] || { kill -TERM -- "-$harbor_pid" 2>/dev/null || true; timeout 60 tail --pid="$harbor_pid" -f /dev/null 2>/dev/null || kill -KILL "$harbor_pid" 2>/dev/null || true; wait "$harbor_pid" 2>/dev/null || true; harbor_pid=""; }
  [ "$harbor_started" -eq 0 ] || finish 1 30000 || true
  exit "$1"
}
trap 'on_signal 143' TERM
trap 'on_signal 130' INT
trap 'on_signal 129' HUP

# 0. distinct file times on the rules-fix task set before any image build (lane A, docker/buildx#3232)
(cd "$repo" && "${safe_env[@]}" bun scripts/repo-tasks/rules-fix/build.ts --stamp 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "build.ts --stamp failed (run.log); nothing ran"; exit 3; }

# 1. the shard against the plan
shard_json=$(cd "$repo" && "${safe_env[@]}" bun scripts/rules-at-scale/plan.ts check-shard --plan "$plan" --name "$name" --lease-usd "$lease" 2>>"$out/run.log") || { say "the shard or its lease does not match the plan (run.log); nothing ran"; exit 2; }
read -r run_id harness models tasks_dir design environment trials concurrency <<< "$(python3 -c 'import json,sys; s=json.loads(sys.argv[1]); print(s["run_id"], s["harness"], ",".join(s["models"]), s["tasks_dir"], s["design"], s["environment"], s["trials"], s["concurrency"])' "$shard_json")"
read -r -a proxy_keys <<< "$(shard_keys "$models" native | tr '\n' ' ')"
for k in "${provider_keys[@]}"; do case " ${proxy_keys[*]} " in *" $k "*) ;; *) unset "$k" ;; esac; done
providers=$(printf '%s' "$models" | tr ',' '\n' | cut -d: -f1 | sort -u | tr '\n' ' ')
if [ "$fake" -eq 0 ]; then
  for p in $providers; do
    case $p in
      anthropic) k=ANTHROPIC_API_KEY ;; openai) k=OPENAI_API_KEY ;; particle) k=PARTICLE_API_KEY ;; openrouter) k=OPENROUTER_API_KEY ;; google) k=GEMINI_API_KEY ;; xai) k=XAI_API_KEY ;;
      *) say "the shard uses $p models, which have no proxy route"; exit 2 ;;
    esac
    [ -n "${!k:+x}" ] || { say "the shard uses $p models and $k is not set"; exit 2; }
  done
fi
say "shard $name: run $run_id, $trials trial(s)$([ "$smoke" -eq 1 ] && echo ' (smoke: 1 trial)'), providers $providers, lease \$$lease$([ "$fake" -eq 1 ] && echo ', fake upstream (keyless)')$([ -n "$uncounted" ] && echo ", uncounted: $uncounted")"

# 2. the clean-arm preflight (CREW.md "Clean no-gstack and no-brain arms"): no Capy drive and no gstack install here
if [ "$preflight" -eq 1 ]; then
  (cd "$repo" && "${safe_env[@]}" bun scripts/v04/clean-arm-audit.ts preflight --out "$out/preflight-clean-arm.json" --host-only 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "clean-arm preflight: a Capy drive or a gstack install is reachable on this machine ($out/preflight-clean-arm.json); nothing ran"; exit 2; }
else
  say "clean-arm preflight skipped (--no-clean-arm-preflight, keyless)"
fi

# 3. Harbor from the hashed lock file, as vm-run.sh installs it; then the nftables probe for the egress blocklist
read -r wheel_sha lock_file lock_sha uv_version harbor_version <<< "$(python3 -c 'import json,sys; h=json.load(open(sys.argv[1]))["harbor"]; d=h["dependencies"]; print(h["wheel_sha256"], d["file"], d["sha256"], d["uv"], h["version"])' "$fh/pin.json")"
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
"$venv/bin/python" -c 'import importlib.metadata as m, sys; sys.exit(m.version("harbor") != sys.argv[1])' "$harbor_version" || { say "the installed Harbor is not the pinned version $harbor_version"; exit 3; }
case $environment in
  egress:*) if sudo -n nft add table inet rules_probe 2>/dev/null; then sudo -n nft delete table inet rules_probe; else say "nftables inet is missing on this kernel; the egress blocklist cannot run"; exit 3; fi ;;
  *) [ "$fake" -eq 1 ] || { say "environment $environment has no egress blocklist; a run that calls a provider needs an egress:* environment"; exit 2; }
     say "environment $environment: no egress blocklist (keyless check)" ;;
esac

# 4. the task preflight, then the jobs: Harbor task copies, rules files materialized and every arm checked (plan.ts jobs)
jobs_arg=()
[ "$smoke" -eq 0 ] || jobs_arg=(--smoke)
(cd "$repo" && "${safe_env[@]}" bun scripts/rules-at-scale/task-preflight.ts --plan "$plan" --name "$name" --out "$out/task-preflight.json" ${jobs_arg[@]+"${jobs_arg[@]}"} 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "task preflight: a task fails its contract ($out/task-preflight.json); nothing ran"; exit 2; }
jobs=$(cd "$repo" && "${safe_env[@]}" bun scripts/rules-at-scale/plan.ts jobs --plan "$plan" --name "$name" --run "$run" --broker-url http://127.0.0.1:8791 ${jobs_arg[@]+"${jobs_arg[@]}"} 2>>"$out/run.log") || { say "plan.ts jobs refused (run.log); nothing ran"; exit 3; }

# 5. proxy and broker (vm-run.sh step 5)
gw=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
control_token=$(openssl rand -hex 32)
lease_run=$run_id:$name
[ "$smoke" -eq 0 ] || lease_run=$lease_run:smoke
upstream=()
if [ "$fake" -eq 1 ]; then
  canary="fake-provider-key-canary-$(openssl rand -hex 16)"
  printf '%s' "$canary" > "$out/canary.txt"
  (export FAKE_UPSTREAM_CANARY=$canary; cd "$repo"; KEEP=FAKE_UPSTREAM_CANARY run_scrubbed setsid bun scripts/frontier-harbor/fake-upstream.ts --listen 127.0.0.1:8799 --log "$out/fake-upstream.jsonl" --bodies "$out/fake-upstream-bodies.jsonl" --canary-env FAKE_UPSTREAM_CANARY ${fake_tool[@]+"${fake_tool[@]}"}) >> "$out/fake-upstream.log" 2>&1 & pids+=($!)
  upstream=(--upstream anthropic=http://127.0.0.1:8799 --upstream openai=http://127.0.0.1:8799 --upstream particle=http://127.0.0.1:8799/particle --upstream openrouter=http://127.0.0.1:8799/openrouter --upstream google=http://127.0.0.1:8799/google --upstream xai=http://127.0.0.1:8799/xai)
fi
max_out=$(python3 -c 'import json,sys; print(max(m["max_output_tokens"] for m in json.load(open(sys.argv[1]))["models"].values()))' "$fh/pin.json")
(
  cd "$repo"
  if [ "$fake" -eq 1 ]; then for k in "${proxy_keys[@]}"; do export "$k=$canary"; done; else export "${proxy_keys[@]}" 2>/dev/null || true; fi
  export SHOOTOUT_PROXY_CONTROL_TOKEN=$control_token
  KEEP="${proxy_keys[*]} SHOOTOUT_PROXY_CONTROL_TOKEN" run_scrubbed setsid bun runner/proxy/metering-proxy.ts --listen "$gw:8790" \
    --budget-ledger "$out/ledger.sqlite" --lease-usd "$lease" --run-id "$lease_run" --new-run --usage-log "$out/proxy-usage.ndjson" \
    --allow-models "$models" --refuse-hosted-tools --capture-bodies "$run/jobs" --max-output-tokens "$max_out" ${upstream[@]+"${upstream[@]}"}
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

# 6. the drain and the rows (vm-run.sh step 6, then collect.ts in place of to-trials.ts). Idempotent.
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
  say "harbor done (exit ${rc:-interrupted}); $(find "$run/jobs" -mindepth 3 -maxdepth 3 -name result.json 2>/dev/null | wc -l) trial result(s)"
  if (cd "$repo" && "${safe_env[@]}" bun scripts/rules-at-scale/collect.ts --results "$out" --tasks "$tasks_dir" --design "$design" --out "$out/rules-trials.jsonl" 2>>"$out/run.log") | tee -a "$out/run-shard.log"; then
    say "collect: $(wc -l < "$out/rules-trials.jsonl") row(s) in rules-trials.jsonl"
    if [ "$smoke" -eq 1 ]; then
      infra=$(python3 -c 'import json,sys; rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; bad=sorted({r["infra"] for r in rows if r["infra"]}); print(",".join(bad) if bad or rows else "no row")' "$out/rules-trials.jsonl")
      [ -z "$infra" ] || { say "smoke: the trial ended with $infra, not a finished trial"; [ "${rc:-0}" -ne 0 ] || rc=4; }
    fi
  else
    say "collect.ts refused the trials (run.log)"; [ "${rc:-0}" -ne 0 ] || rc=4
  fi
  python3 - "$out/shard.json" "$name" "$(hostname)" "$(git -C "$repo" rev-parse HEAD)" "$run_id" "$plan" "$smoke" "$fake" "$uncounted" <<'PY'
import hashlib, json, sys
p, name, machine, commit, run_id, plan, smoke, fake, uncounted = sys.argv[1:10]
json.dump({'name': name, 'machine': machine, 'commit': commit, 'images': None, 'workload': 'rules-at-scale', 'run_id': run_id,
           'plan_sha256': hashlib.sha256(open(plan, 'rb').read()).hexdigest(), 'smoke': smoke == '1', 'fake_upstream': fake == '1',
           'uncounted': uncounted or None}, open(p, 'w'), indent=1)
PY
}

# 7. the Harbor jobs, one per trial, in plan order, $concurrency at a time (xargs in a session of its own, so a signal reaches every job)
say "harbor: $(printf '%s\n' "$jobs" | grep -c .) job(s), $concurrency at a time; logs in $run/harbor-<job>.log, trials in $run/jobs"
harbor_env=("${safe_env[@]}" "PYTHONPATH=$fh:$here" PYTHONDONTWRITEBYTECODE=1)
[ -z "${DOCKER_HOST:-}" ] || harbor_env+=("DOCKER_HOST=$DOCKER_HOST")
set +e
harbor_started=1
printf '%s\n' "$jobs" | setsid xargs -P "$concurrency" -I{} bash -c 'r=$1 cfg=$2 && shift 2 && cd "$r" && "$@" run -y -c "$cfg" >> "$r/harbor-$(basename "$cfg" .json).log" 2>&1' _ "$run" {} "${harbor_env[@]}" "$venv/bin/harbor" &
harbor_pid=$!
wait "$harbor_pid"
rc=$?
harbor_pid=""
set -e
finish 8 120000
[ "$rc" -ne 0 ] || [ "$accounting_incomplete" -eq 0 ] || rc=6
exit "$rc"
