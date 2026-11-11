#!/usr/bin/env bash
# Stub of scripts/canary/<suite>/run-tier.sh for tests/canary-core-run.test.ts: one contract-shaped trials.jsonl row per model, arm,
# task and attempt, every listed task passing. CANARY_STUB_MODE (for the suite named by CANARY_STUB_SUITE): regress fails Opus's
# T1 tasks and its first 8 tasks on the new arm; crash exits 1 with no trials. CANARY_STUB_USD sets each trial's usage.usd (default
# 0.25). Each call is logged to <out>/../../calls.log.
set -euo pipefail
suite=$(basename "$(dirname "$0")")
while [ $# -gt 0 ]; do
  case $1 in
    --tier) tier=$2; shift 2 ;; --prev) prev=$2; shift 2 ;; --new) new=$2; shift 2 ;; --tasks) tasks=$2; shift 2 ;;
    --attempts) k=$2; shift 2 ;; --arms) arms=$2; shift 2 ;; --models) models=$2; shift 2 ;; --out) out=$2; shift 2 ;;
    --fake|--remote) shift ;; *) shift 2 ;;
  esac
done
mkdir -p "$out"
echo "$tier $models $arms $k" >> "$out/../../calls.log"
mode=ok; [ "${CANARY_STUB_SUITE:-}" != "$suite" ] || mode=${CANARY_STUB_MODE:-ok}
[ "$mode" != crash ] || { echo "stub crash" >&2; exit 1; }
jq -c -n --slurpfile t "$tasks" --arg suite "$suite" --arg tier "$tier" --arg arms "$arms" --arg models "$models" --argjson k "$k" --arg mode "$mode" --arg prev "$prev" --arg new "$new" --argjson usd "${CANARY_STUB_USD:-0.25}" '
  $t[0] as $f
  | ($f.models.opus.t1 + $f.models.opus.tasks[0:8]) as $bad
  | ($models | split(","))[] as $m
  | $f.models[$m] as $spec
  | (if $tier == "T1" then $spec.t1 elif $tier == "T2" then $spec.tasks + $spec.digest else $spec.tasks end) as $list
  | ($arms | split(","))[] as $arm
  | $list[] as $task
  | range(1; $k + 1) as $a
  | ($mode == "regress" and $arm == "new" and $m == "opus" and ($bad | index($task)) != null) as $fail
  | {trial_id: "\($suite)/\($tier)/\($m)/\($arm)/\($task)/a\($a)", cell: "\($m)-\($arm)", task: $task, harness: $spec.harness, harness_mode: "docker",
     model: $spec.model, script: null, termination: "completed", grade: (if $fail or ($spec.digest | index($task)) != null then "fail" else "pass" end),
     consent_violation: false, approval_stop: false, effects: [], predicates: [], cap_stop: false, turns: {planned: 1, run: 1, exits: []},
     usage: {meter_id: "fake", requests: 3, refused: 0, failed: 0, usd: $usd, input_tokens: 1000, output_tokens: 100, cached_tokens: 0, unpriced: 0, by_model: {}, upstream: null},
     wall_ms: 1000, started_at: "2026-11-09T00:00:00Z", ended_at: "2026-11-09T00:00:01Z", paths: {},
     canary: {suite: $suite, tier: $tier, arm: $arm, product_version: (if $arm == "plain" then null else "x" end),
       product_sha: (if $arm == "plain" then null elif $arm == "prev" then $prev else $new end), model_key: $m, task: $task, attempt: $a,
       exposure: {first_request_has_product: ($arm != "plain"), product_calls: (if $arm == "plain" then 0 else 1 end)},
       safety: (if $suite == "gbrain" then {cross_scope_reads: 0, hidden_fact_leaks: 0} else null end)}}' > "$out/trials.jsonl"
