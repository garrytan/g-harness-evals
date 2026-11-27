#!/usr/bin/env bash
# Run one shard of a frontier Harbor run (internal-task): Harbor 0.24.0 with the agent classes of agents.py on the 52 pinned
# Terminal-Bench 2.1 tasks, every model call metered by our proxy under the shard's lease, every task container behind
# the egress blocklist. Runs on a Ubicloud VM (one standard-16 per shard) or on any Linux machine with Docker and
# nftables; scripts/frontier-harbor/install-check.sh runs it keyless against a fake upstream.
#
#   scripts/frontier-harbor/vm-run.sh --prereg <prereg.json> --name <shard> --lease-usd <n> --out <results dir>
#       --tb21 <terminal-bench-2-1 checkout at the pinned commit> | --tasks-src <dataset dir>
#       [--stage <name> | --rerun <list.json> [--rerun-stage <name>] [--no-earlier-rerun]]
#       [--done <trials.jsonl> ...] [--fake-upstream] [--uncounted <reason>]
#   scripts/frontier-harbor/vm-run.sh --canary-spec <spec.json> --name <shard> --lease-usd <n> --out <results dir> --tb21 <dir>
#       [--fake-upstream]
#
# The task source comes from the preregistration: a task_list naming pin.json runs the Terminal-Bench 2.1 tasks from
# --tb21; a task_list naming a second source's pin (pin-swe-rebench-07-2026.json) runs that source from --tasks-src, a
# directory swe_rebench_fetch.py fills with the shard's pinned tasks (each fetched from the Harbor hub by its content hash,
# or already there because the controller uploaded it, and checked either way) before materialize.ts swerebench copies
# them with their images pinned. The other source's flag is refused. Trials of a second source run in egress.py
# SourceBlocklistDockerEnvironment with that source's blocklist (plan.ts jobs).
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
# A preregistration with repo_tasks (plan.ts, internal-task) runs gstack-native repo tasks with a delivery arm per cell:
# materialize.ts repo copies the shard's tasks of that split into the run root (with its kinds.json for the delivery
# kwarg) in place of Terminal-Bench 2.1, and --tb21 is not needed.
#
# --canary-spec runs a regression canary spec in place of a preregistration: a frontier-harbor/1 file that
# scripts/canary/gstack/run-tier.sh rendered (scripts/canary/gstack/spec.ts). It is never a counted run. Before anything
# else spec.ts check renders the spec again from the inputs it records and refuses it unless every byte matches, so
# only a spec the canary renderer wrote runs this way; the attestation then records the spec's sha256 and its inputs'
# sha256 in place of a preregistration commit. Every other gate (check-shard, leases, floors) is the same.
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
#   lease mode, one slot per trial, the only process holding the provider keys scripts/ubicloud/provider-keys.sh lists:
#   ANTHROPIC_API_KEY, OPENAI_API_KEY, PARTICLE_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY and XAI_API_KEY, less the
#   ones shard_keys leaves out: GEMINI_API_KEY only for a shard with a google: model on the native route) -> the provider.
#   The google route (Gemini CLI's, and since amendment 2 of frontier-shootout-2026-11 the Gemini 4 Carbon and Hydrogen cells of
#   Hermes, OpenClaw and Pi) goes to Google's Gemini API directly, keyed with GEMINI_API_KEY. --gemini-cli-route
#   openrouter-fallback, the named fallback and never the default, sends it through OpenRouter instead (--google-via
#   openrouter: Gemini requests translated to OpenRouter's Chat Completions, pinned to Google AI Studio's standard endpoint, keyed with
#   OPENROUTER_API_KEY; GEMINI_API_KEY is not read); every google line in proxy-usage.ndjson then carries
#   upstream "openrouter", and manifest.json and run-summary.json record gemini_cli_route.
#   The proxy refuses requests that declare a hosted web tool (--refuse-hosted-tools), caps output at the largest model
#   max output in pin.json (128,000; Claude Code sends max_tokens 128000) and writes every forwarded body, hash-chained,
#   to <run>/jobs/<job>/<trial>/proxy-capture/proxy-requests.ndjson (--capture-bodies), on the host, outside the task
#   container, for the contamination audit.
#   broker.ts (127.0.0.1:8791, the only other holder of the proxy's control token) binds each trial's slot when its
#   agent class asks at setup and hands the class only the token and its route: /<trial>/anthropic, /<trial>/openai or
#   /<trial>/particle (Particle-1 on Hermes, OpenClaw, Pi and DeepSeek Harness; Chat Completions only) or /<trial>/openrouter
#   (DeepSeek V4.1 Flash 1017 on Pi, Hermes, OpenClaw and DeepSeek Harness; Chat Completions only, every request pinned to
#   DeepSeek's endpoint by the proxy).
#   Harbor runs with a scrubbed environment (PATH, HOME, TZ, PYTHONPATH, DOCKER_HOST only): no key reaches it, and the
#   classes in agents.py read nothing from its environment.
# Every shard, counted or not, must be a shard of the preregistration with a lease no more than its planned one and no
# less than its headroom floor, and the plan's leases plus its reserve within its cap (plan.ts check-shard); otherwise
# nothing runs (exit 2).
# Order: the shard checked, Harbor installed from the pinned wheel (sha256 checked), the preregistration attested, tasks
# materialized, proxy and broker up, one Harbor job per cell and attempt (plan.ts jobs: retries off, the preregistered
# concurrency, default 4), then the drain: every slot unbound and every trial's meter finalized before to-trials.ts
# writes the records. While Harbor runs, to-trials.ts journal appends each finished trial's record to
# <out>/trials.journal.jsonl every 60 s, so a mid-run mirror of <out> holds them before finish() runs (CREW R16).
# umask 077. Harbor, proxy and agent output goes to files under --out; stdout and
# <out>/run-shard.log get counts only, never a task id or task text.
# Cursor cells (harness cursor, scripts/frontier-harbor/README.md "Cursor"): the Cursor CLI calls Cursor's servers with
# CURSOR_API_KEY, so a Cursor cell binds no slot, and a shard of Cursor cells only starts no proxy, broker or lease. A
# counted shard with Cursor cells runs only Cursor cells and needs CURSOR_API_KEY in this shell (exit 2 otherwise, before
# anything is installed). The value is copied into an unexported shell variable, unset from the environment like every
# other key, checked by the key-list selfcheck, and written to a 0600 file under ~/.frontier-harbor (outside --out) that
# plan.ts names to the Cursor jobs as cursor_key_file; agents.py uploads it into each Cursor task container, where the
# turn reads and deletes it. The file is removed on exit, and after the records are written bun scripts/cursor/key-scan.ts
# scans --out for the value (exit 5 on a hit, HE-CURSOR-003). With --fake-upstream no key file is written, so each Cursor
# cell stops at agent setup with HE-CURSOR-002 before any command runs in its container (the keyless install check).
# Exit: 0, or Harbor's last non-zero exit code; 2 usage or plan refusal; 3 setup failure; 5 the Cursor key scan found the
# value; 6 the meter did not drain.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
. "$repo/scripts/ubicloud/provider-keys.sh"
prereg="" name="" lease="" out="" tb21="" tasks_src="" fake=0 uncounted="" stage="" rerun="" rerun_stage="" no_earlier_rerun=0 canary=0 gemini_route=native
done_files=()
while [ $# -gt 0 ]; do
  case "$1" in
    --stage) stage=$2; shift 2 ;;
    --rerun) rerun=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --rerun-stage) rerun_stage="$2"; shift 2 ;;
    --no-earlier-rerun) no_earlier_rerun=1; shift ;;
    --done) done_files+=("$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"); shift 2 ;;
    --prereg) [ "$canary" -eq 0 ] && [ -z "$prereg" ] || { echo "vm-run (frontier): give one of --prereg and --canary-spec" >&2; exit 2; }; prereg=$2; shift 2 ;;
    --canary-spec) [ -z "$prereg" ] || { echo "vm-run (frontier): give one of --prereg and --canary-spec" >&2; exit 2; }; prereg=$2; canary=1; shift 2 ;;
    --name) name=$2; shift 2 ;;
    --lease-usd) lease=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --tb21) tb21=$2; shift 2 ;;
    --tasks-src) tasks_src=$2; shift 2 ;;
    --fake-upstream) fake=1; shift ;;
    --uncounted) uncounted=$2; shift 2 ;;
    --gemini-cli-route) gemini_route=$2; shift 2 ;;
    *) echo "vm-run (frontier): unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$prereg" ] && [ -n "$name" ] && [ -n "$lease" ] && [ -n "$out" ] || { echo "vm-run (frontier): --prereg, --name, --lease-usd and --out are required" >&2; exit 2; }
[ "$fake" -eq 0 ] || [ -n "$uncounted" ] || [ "$canary" -eq 1 ] || { echo "vm-run (frontier): --fake-upstream is for an --uncounted check or a --canary-spec only" >&2; exit 2; }
[ "$canary" -eq 0 ] || [ -z "$uncounted" ] || { echo "vm-run (frontier): a --canary-spec run is uncounted already; --uncounted does not apply" >&2; exit 2; }
case $gemini_route in native|openrouter-fallback) ;; *) echo "vm-run (frontier): --gemini-cli-route is native (the default) or openrouter-fallback, not $gemini_route" >&2; exit 2 ;; esac
# Only the metering proxy holds provider keys (provider_keys, scripts/ubicloud/provider-keys.sh): they stay shell variables
# (not exported) and are exported again inside the proxy's subshell alone.
export -n "${provider_keys[@]}" 2>/dev/null || true
# CURSOR_API_KEY: kept only as this unexported shell variable (a Cursor shard), never passed in any environment but the
# key scan's; a fake-upstream run drops it.
cursor_key=${CURSOR_API_KEY-}
[ "$fake" -eq 0 ] || cursor_key=""
unset UBICLOUD_API_KEY VOYAGE_API_KEY GOOGLE_API_KEY CURSOR_API_KEY
if [ "$fake" -eq 0 ]; then
  any_key=$cursor_key
  for k in "${provider_keys[@]}"; do [ -z "${!k:+x}" ] || any_key=x; done
  [ -n "${any_key:+x}" ] || { echo "vm-run (frontier): none of the provider keys (${provider_keys[*]}) is set; the proxy needs the key of each provider the shard uses (or pass --fake-upstream). A shard of Cursor cells needs CURSOR_API_KEY instead: no CURSOR_API_KEY is set either" >&2; exit 2; }
  unset any_key
fi
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mkdir -p "$out/run"
out=$(cd "$out" && pwd)
run=$out/run
prereg=$(cd "$(dirname "$prereg")" && pwd)/$(basename "$prereg")
[ -z "$tb21" ] || tb21=$(cd "$tb21" && pwd)
[ -z "$tasks_src" ] || { mkdir -p "$tasks_src"; tasks_src=$(cd "$tasks_src" && pwd); }
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
pids=() harbor_pid="" journal_pid="" stop_pid="" lane_pids=() harbor_started=0 finished=0 control_token="" accounting_incomplete=0 rc="" metered=1 cursor_key_dir=""
cleanup() {
  [ -z "$cursor_key_dir" ] || rm -rf "$cursor_key_dir"
  docker ps -aq --filter "label=harness-eval.frontier-qm.jobs=$run/jobs" 2>/dev/null | xargs -r docker rm -f -v >/dev/null 2>&1 || true
  [ -z "$harbor_pid" ] || kill "$harbor_pid" 2>/dev/null || true
  for p in ${lane_pids[@]+"${lane_pids[@]}"}; do kill "$p" 2>/dev/null || true; done
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null || true; done
}
trap cleanup EXIT
on_signal() {
  trap - TERM INT HUP
  trap '' USR1
  if [ "$1" -eq 8 ]; then say "HE-PROVIDER-006 provider stop ($out/provider-stop.json): stopping Harbor and writing the records so far"; else say "interrupted (exit $1); stopping Harbor and writing the records so far"; fi
  [ -z "$harbor_pid" ] || { kill "$harbor_pid" 2>/dev/null || true; timeout 60 tail --pid="$harbor_pid" -f /dev/null 2>/dev/null || kill -KILL "$harbor_pid" 2>/dev/null || true; wait "$harbor_pid" 2>/dev/null || true; harbor_pid=""; }
  for p in ${lane_pids[@]+"${lane_pids[@]}"}; do kill "$p" 2>/dev/null || true; done
  for p in ${lane_pids[@]+"${lane_pids[@]}"}; do timeout 70 tail --pid="$p" -f /dev/null 2>/dev/null || kill -KILL "$p" 2>/dev/null || true; wait "$p" 2>/dev/null || true; done
  lane_pids=()
  [ "$harbor_started" -eq 0 ] || finish 1 30000 || true
  exit "$1"
}
trap 'on_signal 143' TERM
trap 'on_signal 130' INT
trap 'on_signal 129' HUP
trap 'on_signal 8' USR1

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
if [ "$canary" -eq 1 ]; then
  (cd "$repo" && "${safe_env[@]}" bun scripts/canary/gstack/spec.ts check --spec "$prereg" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "the canary spec is not one scripts/canary/gstack/spec.ts renders from its own inputs (run.log); nothing ran"; exit 2; }
fi
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/plan.ts check-shard --prereg "$prereg" --name "$name" --lease-usd "$lease" ${plan_arg[@]+"${plan_arg[@]}"} ${done_args[@]+"${done_args[@]}"} 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "the shard, its stage or its lease does not match the preregistration (run.log); nothing ran"; exit 2; }
read -r run_id ids repo_src models source source_pin <<< "$(cd "$repo" && "${safe_env[@]}" bun -e '
const { loadPlan } = await import("./scripts/frontier-harbor/plan.ts");
const p = loadPlan(process.argv[1]); const s = p.shards.find((x) => x.name === process.argv[2]);
const cells = p.cells.filter((c) => s.cells.includes(c.id));
const shared = [...p.order, ...p.kept_order].filter((t) => cells.some((c) => c.task_ids.includes(t)));
const ids = [...shared, ...new Set(cells.flatMap((c) => c.task_ids).filter((t) => !shared.includes(t)))];
const r = Bun.spawnSync(["python3", "-c", "import sys,json; sys.path.insert(0, sys.argv[1]); import frontier_settings as f; print(\",\".join(sorted({m for a in json.loads(sys.argv[2]) for m in f.slot_models(*a)})))", process.argv[3], JSON.stringify(cells.map((c) => [c.harness, c.model]))]);
if (r.exitCode !== 0) { console.error(r.stderr.toString()); process.exit(2); }
console.log(p.prereg.run_id, ids.join(","), p.prereg.repo_tasks?.dir ?? "-", r.stdout.toString().trim() || "-", p.source.name, p.source.file ?? "-");' "$prereg" "$name" "$here" 2>>"$out/run.log")"
[ -n "${ids:-}" ] && [ -n "${repo_src:-}" ] && [ -n "${source:-}" ] || { say "could not read the shard's tasks, models and task source (run.log)"; exit 2; }
[ "$models" != "-" ] || models=""
[ "$repo_src" != "-" ] || case $source in
  terminal-bench-2.1) [ -n "$tb21" ] && [ -z "$tasks_src" ] || { say "the preregistration runs Terminal-Bench 2.1 tasks: give --tb21, not --tasks-src"; exit 2; } ;;
  swe-rebench-07-2026) [ -n "$tasks_src" ] && [ -z "$tb21" ] || { say "the preregistration runs the $source source ($source_pin): give --tasks-src, not --tb21"; exit 2; } ;;
  *) say "task source $source has no materializer"; exit 2 ;;
esac
# Cursor cells: no slot models (frontier_settings.py slot_models), so a shard of Cursor cells only has none and runs no proxy.
harnesses=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); s=next(x for x in p["shards"] if x["name"] == sys.argv[2]); print(" ".join(sorted({c["harness"] for c in p["cells"] if c["id"] in s["cells"]})))' "$prereg" "$name")
[ -n "${models:-}" ] || metered=0
# The OpenRouter fallback is Gemini CLI's alone (the preregistration's named fallback); a Gemini cell of any other harness stays
# on Google's Gemini API (amendment 2 of frontier-shootout-2026-11), and the flag would send every google request of the shard.
if [ "$gemini_route" != native ]; then
  others=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); s=next(x for x in p["shards"] if x["name"] == sys.argv[2]); print(" ".join(sorted({c["harness"] for c in p["cells"] if c["id"] in s["cells"] and str(c.get("model")).startswith("google:") and c["harness"] != "gemini-cli"})))' "$prereg" "$name")
  [ -z "$others" ] || { say "--gemini-cli-route $gemini_route is Gemini CLI's named fallback alone; this shard's google cells in $others stay on Google's Gemini API (amendment 2 of frontier-shootout-2026-11)"; exit 2; }
fi
# The proxy keeps only the keys this shard needs (shard_keys, scripts/ubicloud/provider-keys.sh): GEMINI_API_KEY only for a
# shard with a google: model on the native route. Every other provider key is dropped here.
read -r -a proxy_keys <<< "$(shard_keys "$models" "$gemini_route" | tr '\n' ' ')"
for k in "${provider_keys[@]}"; do case " ${proxy_keys[*]} " in *" $k "*) ;; *) unset "$k" ;; esac; done
case " $harnesses " in
  *" cursor "*)
    if [ "$fake" -eq 0 ]; then
      [ "$harnesses" = cursor ] || { say "the shard mixes Cursor cells with $harnesses: Cursor cells call Cursor's servers and the others the metering proxy, so a counted run shards them apart; nothing ran"; exit 2; }
      [ -n "${cursor_key:+x}" ] || { say "HE-CURSOR-002 no CURSOR_API_KEY: the shard has Cursor cells and CURSOR_API_KEY is not set in this shell; nothing was installed or run, and nothing contacted Cursor"; exit 2; }
      (cd "$repo" && "${safe_env[@]}" bun scripts/cursor/key-scan.ts selfcheck 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "the key-list selfcheck failed (run.log): a keyless list that misses CURSOR_API_KEY could carry it into a keyless step; nothing ran"; exit 2; }
    else
      say "cursor: --fake-upstream, so no key file is written: each Cursor cell stops at agent setup with HE-CURSOR-002, before any command runs in its container"
    fi ;;
  *) cursor_key="" ;;
esac
providers=$(printf '%s' "$models" | tr ',' '\n' | cut -d: -f1 | sort -u | tr '\n' ' ')
if [ "$fake" -eq 0 ]; then
  for p in $providers; do
    case $p in
      anthropic) [ -n "${ANTHROPIC_API_KEY:+x}" ] || { say "the shard uses anthropic models and ANTHROPIC_API_KEY is not set"; exit 2; } ;;
      openai) [ -n "${OPENAI_API_KEY:+x}" ] || { say "the shard uses openai models and OPENAI_API_KEY is not set"; exit 2; } ;;
      particle) [ -n "${PARTICLE_API_KEY:+x}" ] || { say "the shard uses particle models and PARTICLE_API_KEY is not set"; exit 2; } ;;
      openrouter) [ -n "${OPENROUTER_API_KEY:+x}" ] || { say "the shard uses openrouter models and OPENROUTER_API_KEY is not set"; exit 2; } ;;
      google) if [ "$gemini_route" = native ]; then [ -n "${GEMINI_API_KEY:+x}" ] || { say "the shard uses google models, which the proxy reaches directly on Gemini CLI's native route, and GEMINI_API_KEY is not set (--gemini-cli-route openrouter-fallback is the named fallback)"; exit 2; }
        else [ -n "${OPENROUTER_API_KEY:+x}" ] || { say "the shard uses google models, which the proxy reaches through OpenRouter on --gemini-cli-route openrouter-fallback, and OPENROUTER_API_KEY is not set"; exit 2; }; fi ;;
      xai) [ -n "${XAI_API_KEY:+x}" ] || { say "the shard uses xai models and XAI_API_KEY is not set"; exit 2; } ;;
    esac
  done
fi
# the clean-arm preflight (CREW.md "Clean no-gstack and no-brain arms"): the machine must hold no Capy drive and no gstack
# install; harnesses install into the task container at run time, a skill ablation gstack arm is built in a docker builder
# (step 1b) and uploaded into its own trials' containers only, and a release gstack arm installs from its tar into the task
# container at run time
(cd "$repo" && "${safe_env[@]}" bun scripts/v04/clean-arm-audit.ts preflight --out "$out/preflight-clean-arm.json" --host-only 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "clean-arm preflight: a Capy drive or a gstack install is reachable on this machine ($out/preflight-clean-arm.json); nothing ran"; exit 2; }
# 1b. the gstack arms of the shard (internal-task), before any lease: built in the docker builder at the preregistration's
# gstack_pin, each lock checked against the preregistered one (HE-FRONTIER-009) and every gstack refusal passed through
# with its arm (HE-FRONTIER-008); agents.py installs each cell from <run>/gstack/cells/<cell>.json. A shard with no gstack
# cell builds nothing.
gstack_env=("${safe_env[@]}")
[ -z "${DOCKER_HOST:-}" ] || gstack_env+=("DOCKER_HOST=$DOCKER_HOST")
(cd "$repo" && "${gstack_env[@]}" bun scripts/frontier-harbor/gstack-build.ts --prereg "$prereg" --name "$name" --run "$run" 2>"$out/gstack-build.err") | tee -a "$out/run-shard.log" || { say "gstack arms refused: $(tail -n 1 "$out/gstack-build.err")"; exit 2; }
# 1c. the QM images (internal-task), before any lease: a shard with a qm cell builds QM core and its source stage from
# harnesses/qm/Dockerfile at pin.json's commit and pulls the pinned Postgres image; agents.py FrontierQm checks all three
# (the core image's harness-eval.commit label, the exec daemon's sha256) and refuses a trial without them (HE-QM-001).
case " $harnesses " in
  *" qm "*)
    read -r qm_commit qm_pg <<< "$(python3 -c 'import json,sys; h=json.load(open(sys.argv[1]))["harnesses"]["qm"]; print(h["commit"], h["postgres_image"])' "$here/pin.json")"
    (cd "$repo/harnesses/qm" && "${gstack_env[@]}" docker build -q --build-arg "QM_COMMIT=$qm_commit" --target src -t "harness-eval/qm-src:${qm_commit:0:12}" -f Dockerfile . \
      && "${gstack_env[@]}" docker build -q --build-arg "QM_COMMIT=$qm_commit" -t "harness-eval/qm:${qm_commit:0:12}" -f Dockerfile . && "${gstack_env[@]}" docker pull -q "$qm_pg") >> "$out/qm-build.log" 2>&1 \
      || { say "building the QM images failed (qm-build.log); nothing ran"; exit 2; }
    say "qm: harness-eval/qm:${qm_commit:0:12} and harness-eval/qm-src:${qm_commit:0:12} built at $qm_commit, $qm_pg pulled" ;;
esac
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
[ "$canary" -eq 0 ] || attest=(--canary-spec "$prereg" --out "$out")
[ -z "$uncounted" ] || attest+=(--uncounted "$uncounted")
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/to-trials.ts attest "${attest[@]}" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "attestation refused (run.log); nothing ran"; exit 3; }

# 4. tasks (a refusal can name a task, so it goes to run.log only); a second source's tasks are fetched first, by content hash
if [ "$repo_src" != "-" ]; then
  (cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/materialize.ts repo --src "$repo_src" --out "$run" --ids "$ids" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "materialize refused (run.log); nothing ran"; exit 3; }
elif [ "$source" = terminal-bench-2.1 ]; then
  (cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/materialize.ts tb21 --src "$tb21" --out "$run" --ids "$ids" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "materialize refused (run.log); nothing ran"; exit 3; }
else
  "${safe_env[@]}" "$venv/bin/python" "$here/swe_rebench_fetch.py" fetch --pin "$repo/$source_pin" --out "$tasks_src" --ids "$ids" 2>>"$out/run.log" | tee -a "$out/run-shard.log" || { say "fetching the $source tasks failed or a task differs from its pin ($tasks_src/fetch.json); nothing ran"; exit 3; }
  (cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/materialize.ts swerebench --src "$tasks_src" --out "$run" --ids "$ids" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "materialize refused (run.log); nothing ran"; exit 3; }
fi

# 5. proxy and broker
gw=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
control_token=$(openssl rand -hex 32)
lease_run="$run_id:$name${stage:+:$stage}"
if [ "$metered" -eq 1 ]; then
  upstream=() google_via=()
  [ "$gemini_route" = native ] || google_via=(--google-via openrouter)
  if [ "$fake" -eq 1 ]; then
    canary="fake-provider-key-canary-$(openssl rand -hex 16)"
    printf '%s' "$canary" > "$out/canary.txt"
    (export FAKE_UPSTREAM_CANARY=$canary; cd "$repo"; KEEP=FAKE_UPSTREAM_CANARY run_scrubbed setsid bun scripts/frontier-harbor/fake-upstream.ts --listen 127.0.0.1:8799 --log "$out/fake-upstream.jsonl" --bodies "$out/fake-upstream-bodies.jsonl" --canary-env FAKE_UPSTREAM_CANARY) >> "$out/fake-upstream.log" 2>&1 & pids+=($!)
    upstream=(--upstream anthropic=http://127.0.0.1:8799 --upstream openai=http://127.0.0.1:8799 --upstream particle=http://127.0.0.1:8799/particle --upstream openrouter=http://127.0.0.1:8799/openrouter --upstream google=http://127.0.0.1:8799/google --upstream xai=http://127.0.0.1:8799/xai)
  fi
  (
    cd "$repo"
    if [ "$fake" -eq 1 ]; then for k in "${proxy_keys[@]}"; do export "$k=$canary"; done; else export "${proxy_keys[@]}" 2>/dev/null || true; fi
    export SHOOTOUT_PROXY_CONTROL_TOKEN=$control_token
    KEEP="${proxy_keys[*]} SHOOTOUT_PROXY_CONTROL_TOKEN" run_scrubbed setsid bun runner/proxy/metering-proxy.ts --listen "$gw:8790" \
      --budget-ledger "$out/ledger.sqlite" --lease-usd "$lease" --run-id "$lease_run" --new-run --usage-log "$out/proxy-usage.ndjson" \
      --allow-models "$models" --refuse-hosted-tools ${google_via[@]+"${google_via[@]}"} --capture-bodies "$run/jobs" --max-output-tokens "$(python3 -c 'import json,sys; print(max(m["max_output_tokens"] for m in json.load(open(sys.argv[1]))["models"].values()))' "$here/pin.json")" ${upstream[@]+"${upstream[@]}"}
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
else
  say "no metered cell on this shard (Cursor cells only): no metering proxy, broker or lease runs; Cursor's usage export is the cost source"
fi

# 6. the drain and the records. Idempotent: the normal path and on_signal both call it once. Every slot is unbound, then
# each trial's meter finalized ($1 rounds of up to $2 ms) so no request is still settling when the records are written.
# <out>/accounting.json says whether every request settled; when one did not, its reservation stays charged.
finish() {
  [ "$finished" -eq 0 ] || return 0
  finished=1
  local rounds=$1 wait_ms=$2 undrained=0 ok=true resp n k
  [ -z "$journal_pid" ] || { kill "$journal_pid" 2>/dev/null || true; wait "$journal_pid" 2>/dev/null || true; }
  trap '' USR1
  [ -z "$stop_pid" ] || { kill "$stop_pid" 2>/dev/null || true; wait "$stop_pid" 2>/dev/null || true; }
  [ "$metered" -eq 0 ] || curl -fsS -X POST 127.0.0.1:8791/unbind-all >> "$out/run.log" 2>&1 || ok=false
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
  (cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/to-trials.ts convert --prereg "$prereg" --out "$out" --shard "$name" --lease-run-id "$run_id:$name" ${stage_arg[@]+"${stage_arg[@]}"} --gemini-cli-route "$gemini_route" 2>>"$out/run.log") | tee -a "$out/run-shard.log" || { say "to-trials refused (run.log)"; rc=${rc:-0}; [ "$rc" -ne 0 ] || rc=3; }
  python3 - "$out/shard.json" "$name" "$(hostname)" "$(git -C "$repo" rev-parse HEAD)" <<'PY'
import json, sys
p, name, machine, commit = sys.argv[1:5]
json.dump({'name': name, 'machine': machine, 'commit': commit, 'images': None, 'workload': 'frontier-harbor'}, open(p, 'w'), indent=1)
PY
}

# 7. the Harbor jobs, one per cell and attempt, in plan.ts order; with parallel_cells, one lane per cell, all lanes at once,
# each lane its cell's jobs in order (a lane stops its Harbor job when it is told to stop)
# the Cursor key file: 0600, outside --out, named to the Cursor jobs only; cleanup() removes it on every exit
cursor_args=()
if [ -n "${cursor_key:+x}" ]; then
  mkdir -p "$HOME/.frontier-harbor"
  cursor_key_dir=$(mktemp -d "$HOME/.frontier-harbor/cursor-key.XXXXXX")
  printf '%s' "$cursor_key" > "$cursor_key_dir/key"
  cursor_args=(--cursor-key-file "$cursor_key_dir/key")
  say "cursor: CURSOR_API_KEY is set; it goes to the Cursor task containers only, through a 0600 key file outside $out"
fi
jobs=$(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/plan.ts jobs --prereg "$prereg" --name "$name" --run "$run" --broker-url http://127.0.0.1:8791 ${plan_arg[@]+"${plan_arg[@]}"} ${done_args[@]+"${done_args[@]}"} ${cursor_args[@]+"${cursor_args[@]}"} 2>>"$out/run.log") || { say "plan.ts jobs refused (run.log)"; exit 3; }
parallel=$(python3 -c 'import json,sys; print(1 if json.load(open(sys.argv[1])).get("parallel_cells") else 0)' "$prereg")
if [ "$parallel" -eq 1 ]; then harbor_logs="$run/harbor-<job>.log (one per job)"; else harbor_logs="$run/harbor.log"; fi
say "harbor: $(printf '%s\n' "$jobs" | grep -c .) job(s); logs in $harbor_logs and $run/jobs"
harbor_env=("${safe_env[@]}" "PYTHONPATH=$here")
[ -z "${DOCKER_HOST:-}" ] || harbor_env+=("DOCKER_HOST=$DOCKER_HOST")
# the journal: while Harbor runs, every 60 s, one row per newly finished trial in <out>/trials.journal.jsonl (outside run/,
# so the mid-run mirror carries it; to-trials.ts recover rebuilds those records from the mirror alone). finish() stops it.
(cd "$repo" && exec "${safe_env[@]}" bun scripts/frontier-harbor/to-trials.ts journal --prereg "$prereg" --out "$out" --shard "$name" --lease-run-id "$run_id:$name" --every 60) >> "$out/run.log" 2>&1 &
journal_pid=$!
pids+=("$journal_pid")
# the provider stop (runner/cost/provider-stop.ts, internal-task): every 60 s it reads the proxy's usage log, and once one provider
# has refused 3 trials in a row for want of credit or permission it writes <out>/provider-stop.json and sends this script
# USR1, which stops Harbor as an interrupt does, writes the records so far and exits 8; the lane then frees the VM. An earlier
# stop's file (a --resume or a later --stage reuses <out>) is moved aside first, and finish() stops the watcher before it
# writes the records, so a stop found after Harbor ends still exits 8, with every record written
if [ "$metered" -eq 1 ]; then
  [ ! -e "$out/provider-stop.json" ] || mv "$out/provider-stop.json" "$out/provider-stop.$(date -u +%Y%m%dT%H%M%SZ).json"
  (cd "$repo" && exec "${safe_env[@]}" bun runner/cost/provider-stop.ts watch --usage "$out/proxy-usage.ndjson" --out "$out/provider-stop.json" --signal-pid $$ --every 60) >> "$out/run.log" 2>&1 &
  stop_pid=$!
  pids+=("$stop_pid")
fi
run_lane() { # <job config>...: the jobs in order; exits with the last failing job's code
  local cfg code lane_last=0 hp=""
  trap '[ -z "$hp" ] || { kill "$hp" 2>/dev/null; timeout 60 tail --pid="$hp" -f /dev/null 2>/dev/null || kill -KILL "$hp" 2>/dev/null; }; exit 143' TERM
  for cfg in "$@"; do
    (cd "$run" && exec "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$cfg") >> "$run/harbor-$(basename "$cfg" .json).log" 2>&1 &
    hp=$!
    wait "$hp"
    code=$?
    hp=""
    log "harbor job $(basename "$cfg" .json) exited $code"
    [ "$code" -eq 0 ] || lane_last=$code
  done
  exit "$lane_last"
}
# a lane is the jobs whose config names that cell (agents[0].kwargs.cell, which plan.ts writes), compared as a string
lanes=""
if [ "$parallel" -eq 1 ]; then
  lanes=$(python3 -c 'import json,sys
for f in sys.argv[1:]: print(json.load(open(f))["agents"][0]["kwargs"]["cell"] + "\t" + f)' $jobs 2>>"$out/run.log") || { say "could not read the cell of every job config (run.log)"; exit 3; }
fi
set +e
last=0
harbor_started=1
if [ "$parallel" -eq 1 ]; then
  for cell in $(cut -f1 <<<"$lanes" | awk '!seen[$0]++'); do
    lane=()
    while IFS=$'\t' read -r c cfg; do [ "$c" = "$cell" ] && lane+=("$cfg"); done <<<"$lanes"
    say "lane $cell: ${#lane[@]} job(s)"
    ( run_lane "${lane[@]}" ) &
    lane_pids+=($!)
  done
  for p in "${lane_pids[@]}"; do wait "$p"; code=$?; [ "$code" -eq 0 ] || last=$code; done
  lane_pids=()
else
  for cfg in $jobs; do
    (cd "$run" && exec "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$cfg") >> "$run/harbor.log" 2>&1 &
    harbor_pid=$!
    wait "$harbor_pid"
    code=$?
    harbor_pid=""
    log "harbor job $(basename "$cfg" .json) exited $code"
    [ "$code" -eq 0 ] || last=$code
  done
fi
rc=$last
set -e
finish 8 120000
[ ! -e "$out/provider-stop.json" ] || { say "HE-PROVIDER-006 provider stop ($out/provider-stop.json), found after Harbor ended"; rc=8; }
[ "$rc" -ne 0 ] || [ "$accounting_incomplete" -eq 0 ] || rc=6
# the Cursor key scan (HE-CURSOR-003): the literal value (whole, first 16, last 12 characters, gzip decoded) in any file
# under --out; key-scan.ts reads it from its own environment, deletes it there and prints a count, never the value
if [ -n "${cursor_key:+x}" ]; then
  rm -rf "$cursor_key_dir"
  cursor_key_dir=""
  set +e
  (export CURSOR_API_KEY=$cursor_key; cd "$repo"; KEEP=CURSOR_API_KEY run_scrubbed bun scripts/cursor/key-scan.ts "$out") 2>&1 | tee -a "$out/run-shard.log"
  scan_rc=${PIPESTATUS[0]}
  set -e
  [ "$scan_rc" -eq 0 ] || { say "HE-CURSOR-003 the key scan of $out exited $scan_rc (1: the CURSOR_API_KEY value is in a file there); keep $out off every copy, mirror, publication and drive until it is cleaned"; rc=5; }
fi
exit "$rc"
