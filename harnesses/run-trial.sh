#!/usr/bin/env bash
# Run one task through one harness image under the adapter protocol
# (docs/adapters.md) and grade the workspace. This is the M0 smoke driver;
# runner/run.py replaces it once the world and ledger land.
#
#   harnesses/run-trial.sh --harness openclaw --task tasks/hello --trial-id t1 \
#     --base-url http://host.docker.internal:8787/anthropic --api-key trial-token:t1
#
# Options:
#   --harness NAME        harnesses/NAME (image defaults to harness-eval/NAME:dev, _fake -> fake)
#   --image TAG           image to run instead of the default
#   --task DIR            task directory with instruction.md and grader/check.sh
#   --trial-id ID         HE_TRIAL_ID; also names the output directory
#   --base-url URL        HE_MODEL_BASE_URL (provider-specific proxy base)
#   --api-key TOKEN       HE_MODEL_API_KEY (the per-trial dummy token, never a real key)
#   --model NAME          HE_MODEL_NAME (default claude-sonnet-5-5)
#   --time-budget S       HE_TIME_BUDGET_S (default: task.toml time_budget_s, else 300)
#   --network MODE        docker network (default bridge, with host.docker.internal mapped)
#   --out DIR             output root (default results/smoke/<trial-id>)
# Writes <out>/workspace, <out>/state, <out>/logs and <out>/result.json.
set -euo pipefail

harness="" image="" task="" trial="" base_url="" api_key="" model="claude-sonnet-5-5" budget="" network="bridge" out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --harness) harness=$2; shift 2 ;;
    --image) image=$2; shift 2 ;;
    --task) task=$2; shift 2 ;;
    --trial-id) trial=$2; shift 2 ;;
    --base-url) base_url=$2; shift 2 ;;
    --api-key) api_key=$2; shift 2 ;;
    --model) model=$2; shift 2 ;;
    --time-budget) budget=$2; shift 2 ;;
    --network) network=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
[ -n "$harness" ] && [ -n "$task" ] && [ -n "$trial" ] || { echo "need --harness, --task and --trial-id" >&2; exit 64; }
[ -n "$image" ] || image="harness-eval/${harness#_}:dev"
[ -n "$out" ] || out="results/smoke/$trial"
if [ -z "$budget" ]; then
  budget=$(sed -n 's/^time_budget_s *= *\([0-9]*\).*/\1/p' "$task/task.toml" | head -1)
  budget=${budget:-300}
fi

rm -rf "$out"
mkdir -p "$out/workspace" "$out/state" "$out/logs" "$out/turns"
cp "$task/instruction.md" "$out/workspace/instruction.md"
if [ -d "$task/workspace" ]; then cp -a "$task/workspace/." "$out/workspace/"; fi
abs_out=$(cd "$out" && pwd)

# The container runs as the calling user so the workspace it writes is readable
# by the grader and nothing in it runs as root. Container-side wall clock: the
# adapter gets the budget, the runner adds the contract's 60 s grace before it
# kills the container (methodology item 7).
slice=$(sed -n 's/^slice *= *"\(.*\)".*/\1/p' "$task/task.toml" | head -1)
start=$(date +%s%3N)
set +e
if [ -f "harnesses/$harness/compose.yaml" ]; then
  # Sidecar topology: the stack is the trial. A fresh project name, volume and
  # signing secret per trial; the task service's exit code is the adapter's.
  export HE_WORKSPACE="$abs_out/workspace" HE_STATE="$abs_out/state" HE_LOGS="$abs_out/logs" HE_TURNS="$abs_out/turns"
  export HE_MODEL_BASE_URL="$base_url" HE_MODEL_API_KEY="$api_key" HE_MODEL_NAME="$model"
  export HE_TIME_BUDGET_S="$budget" HE_TASK_SLICE="$slice" HE_TRIAL_ID="$trial" QM_IMAGE="$image"
  export HE_UID="$(id -u)" HE_GID="$(id -g)"
  # prepare.sh pre-creates bind-mount targets and prints per-trial secrets as
  # NAME=value lines; they stay in this process and the stack, never on disk.
  project="he-$(echo "$trial" | tr -c 'a-z0-9\n' '-')"
  export COMPOSE_PROJECT_NAME="$project"
  if [ -x "harnesses/$harness/prepare.sh" ]; then
    while IFS= read -r line; do export "$line"; done < <("harnesses/$harness/prepare.sh" "$abs_out")
  fi
  timeout -k 10 "$((budget + 180))" docker compose -f "harnesses/$harness/compose.yaml" -p "$project" up \
    --abort-on-container-exit --exit-code-from task --no-color </dev/null > "$abs_out/logs/compose.log" 2>&1
  code=$?
  docker compose -f "harnesses/$harness/compose.yaml" -p "$project" logs --no-color core > "$abs_out/logs/core.log" 2>&1 || true
  # capture.sh pulls world state the stack holds outside /workspace (QM's
  # sandbox) into the workspace and removes per-trial leftovers.
  if [ -x "harnesses/$harness/capture.sh" ]; then "harnesses/$harness/capture.sh" "$abs_out" 2>>"$abs_out/logs/adapter.log" || true; fi
  docker compose -f "harnesses/$harness/compose.yaml" -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
else
timeout -k 10 "$((budget + 60))" docker run -i --rm --name "he-$trial" \
  --user "$(id -u):$(id -g)" \
  --network "$network" --add-host host.docker.internal:host-gateway \
  -v "$abs_out/workspace:/workspace" \
  -v "$abs_out/state:/harness-state" \
  -v "$abs_out/logs:/he-logs" \
  -e HE_MODEL_BASE_URL="$base_url" -e HE_MODEL_API_KEY="$api_key" -e HE_MODEL_NAME="$model" \
  -e HE_TIME_BUDGET_S="$budget" -e HE_LOG_DIR=/he-logs -e HE_SESSION_STATE_DIR=/harness-state \
  -e HE_TASK_SLICE="$slice" -e HE_TRIAL_ID="$trial" \
  "$image" run </dev/null
code=$?
fi
set -e
end=$(date +%s%3N)

set +e
grade_out=$("$task/grader/check.sh" "$abs_out/workspace" 2>&1)
grade_code=$?
set -e
grade=fail; [ $grade_code -eq 0 ] && grade=pass
case $code in
  0) termination=completed ;; 124) termination=timeout ;; 3) termination=model_error ;; 2) termination=harness_error ;; *) termination=infra_error ;;
esac

printf '{"trial_id":"%s","harness":"%s","image":"%s","task":"%s","exit_code":%d,"termination":"%s","grade":"%s","grader_output":%s,"wall_ms":%d,"model":"%s"}\n' \
  "$trial" "$harness" "$image" "$task" "$code" "$termination" "$grade" "$(printf '%s' "$grade_out" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" "$((end - start))" "$model" \
  | tee "$out/result.json"
