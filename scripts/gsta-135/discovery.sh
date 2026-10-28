#!/usr/bin/env bash
# internal-task paid discovery run (uncounted diagnostic, no preregistration): the
# spec's single-trial cells through harnesses/run-trial.sh under one metering
# lease, the native-transcript evidence extracted after each cell, one row per
# planned cell in results/gsta-135/runs/<run id>/cells.jsonl whether dispatched
# or not, and report.md beside it. A run directory that already holds cells is
# never reused: a second invocation with the same run id is refused, so one
# proxy usage log and one cells file describe exactly one invocation (a dry run
# writes under runs/<run id>-dry-run and may be repeated). Nothing under docs/
# is touched.
#
#   scripts/gsta-135/discovery.sh [--pin bd8907d6] [--lease-usd 10] [--max-output-tokens 128000]
#                                 [--run-id gsta-135-discovery-2026-10] [--qm] [--only <cell,...>] [--dry-run]
#
# Cells, in dispatch order (informative first, so a lease stop loses the least):
#   t1 gstack arm on openclaw, hermes (and qm with --qm); t2 gstack arms; the
#   controls (t3, 120 s) in the gstack arm; then the no-gstack arms (the :dev
#   image, same seed) for t1, t2, t3. QM cells are prompt-only (QM's agent never
#   sees /workspace) and run only with --qm: at pin bd8907d6 the preflight showed
#   QM core cannot import the pack (results/gsta-135/preflight/qm.log), so
#   without --qm they are rows with termination not_run:register_failed.
#
# The proxy follows the post-#97 flow: bound to the docker bridge gateway (never
# a wildcard), a control token, one slot per trial bound with a random
# per-trial token that is the only credential the container sees. The real key
# stays in this shell's environment for the proxy alone. After each trial the
# key is finalized through the proxy (which waits up to 120 s for the trial's
# in-flight requests to settle) before its spend is read, so a cell that ends
# mid-request still has its cost in the row. A request still in flight after
# that wait is carried as a requests_undrained count on the row (its cost is in
# the ledger summary, in no row); a finalize that fails leaves
# requests_undrained null and a note, never a zero.
set -euo pipefail
cd "$(dirname "$0")/../.."

pin=bd8907d6 lease=10 cap=128000 run_id=gsta-135-discovery-2026-10 with_qm=0 only='' dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pin) pin=$2; shift 2 ;;
    --lease-usd) lease=$2; shift 2 ;;
    --max-output-tokens) cap=$2; shift 2 ;;
    --run-id) run_id=$2; shift 2 ;;
    --qm) with_qm=1; shift ;;
    --only) only=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
[[ $run_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "--run-id must be a plain name (letters, digits, . _ -): $run_id" >&2; exit 64; }
out=results/gsta-135/runs/$run_id
[ "$dry" = 0 ] || { out=$out-dry-run; rm -rf "$out"; }
# The guard is the directory, not the cells file: a run killed during its first cell leaves a ledger and a usage log but no row.
[ ! -e "$out" ] || { echo "$out exists; a run directory is never reused. Pass a new --run-id (or move the old run) instead of appending to its receipts." >&2; exit 2; }
[ -n "${ANTHROPIC_API_KEY:-}" ] || [ "$dry" = 1 ] || { echo "ANTHROPIC_API_KEY is not in this shell (the proxy reads it; nothing else does)" >&2; exit 2; }
tasks=~/.capy/work/he/gsta135/tasks
cells=$out/cells.jsonl
mkdir -p "$out/trials" "$out/evidence" "$tasks"
tree=$(git rev-parse HEAD); dirty=$([ -z "$(git status --porcelain)" ] && echo false || echo true)
git status --porcelain > "$out/tree-status.txt"
model=claude-opus-5-5
image_of() { case "$2" in gstack) echo "harness-eval/$1:gstack-$pin" ;; *) echo "harness-eval/$1:dev" ;; esac; }
digest_of() { docker image inspect "$1" -f '{{.Id}}' 2>/dev/null || echo none; }

# planned cells: "<harness> <task> <arm>"
plan=()
plan+=("openclaw 1 gstack" "hermes 1 gstack" "qm 1 gstack")
plan+=("openclaw 2 gstack" "hermes 2 gstack")
plan+=("openclaw 3 gstack" "hermes 3 gstack" "qm 3 gstack")
plan+=("openclaw 1 none" "hermes 1 none" "openclaw 2 none" "hermes 2 none" "openclaw 3 none" "hermes 3 none")

for t in 1 2 3; do bash scripts/gsta-135/make-task.sh "$t" "$tasks/t$t" >/dev/null; done

# Proxy on the bridge gateway with a control token; one lease for the run.
gateway=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
port=8797
control=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
ledger=$out/ledger.sqlite usage=$out/proxy-usage.ndjson
proxy_pid=''
cleanup() { if [ -n "$proxy_pid" ]; then kill -TERM "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT
if [ "$dry" = 0 ]; then
  bun runner/proxy/metering-proxy.ts --listen "$gateway:$port" --control-token "$control" --budget-ledger "$ledger" --lease-usd "$lease" \
    --run-id "$run_id" --allow-models "anthropic:$model" --max-output-tokens "$cap" --usage-log "$usage" --new-run >> "$out/proxy.log" 2>&1 &
  proxy_pid=$!
  for _ in $(seq 1 100); do curl -sf "http://$gateway:$port/__proxy/status" >/dev/null 2>&1 && break; sleep 0.1; done
  curl -sf "http://$gateway:$port/__proxy/status" >/dev/null || { echo "the metering proxy did not start; see $out/proxy.log" >&2; exit 2; }
  ss -ltn | grep -q "$gateway:$port " || { echo "the proxy is not listening on $gateway:$port alone" >&2; exit 2; }
  ! ss -ltn | grep -q "0.0.0.0:$port " || { echo "the proxy is listening on a wildcard address; refusing to run" >&2; exit 2; }
  echo "[discovery] proxy on $gateway:$port, lease \$$lease as $run_id, output cap $cap, usage $usage"
fi

stop_reason=''
for cell in "${plan[@]}"; do
  read -r h t arm <<< "$cell"
  trial="gsta135-$h-t$t-$arm"
  image=$(image_of "$h" "$arm")
  budget=$([ "$t" = 3 ] && echo 120 || echo 600)
  row_base=$(jq -nc --arg trial "$trial" --arg h "$h" --argjson task "$t" --arg arm "$arm" --arg image "$image" --arg digest "$(digest_of "$image")" \
    --arg tree "$tree" --argjson dirty "$dirty" --arg model "$model" --argjson budget "$budget" --argjson ws "$([ "$h" = qm ] && echo false || echo true)" --arg started "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{trial_id:$trial, harness:$h, task:$task, arm:$arm, image:$image, image_digest:$digest, tree:$tree, tree_dirty:$dirty, model:$model, time_budget_s:$budget, workspace_seen:$ws, started_at:$started}')
  skip=''
  [ -z "$only" ] || case ",$only," in *",$trial,"*) ;; *) skip='not_run:not_selected' ;; esac
  [ -n "$skip" ] || [ -z "$stop_reason" ] || skip="not_run:cap"
  if [ "$h" = qm ] && [ "$with_qm" = 0 ] && [ -z "$skip" ]; then skip='not_run:register_failed'; fi
  [ "$dry" = 0 ] || skip=${skip:-not_run:dry_run}
  if [ -n "$skip" ]; then
    jq -nc --argjson base "$row_base" --arg term "$skip" '$base + {termination:$term, exit_code:null, wall_ms:null, requests_forwarded:0, requests_refused:0, budget_refusals:0, refusals:{}, requests_undrained:0, usd_spent:0, usd_reserved_unknown:0, evidence:null, note:(if $term=="not_run:register_failed" then "preflight: QM core cannot import the gstack pack at this pin (results/gsta-135/preflight/qm.log)" else null end)}' >> "$cells"
    echo "[discovery] $trial $skip"; continue
  fi

  # Fresh per-trial token; the slot is bound for this trial only.
  cred="trial-token:$trial.$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  curl -sf -X POST "http://$gateway:$port/__proxy/bind" -H 'content-type: application/json' -H "x-proxy-control: $control" \
    -d "$(jq -nc --arg s "$trial" --arg k "trial-token:$trial" --arg t "$cred" '{slot:$s,key:$k,token:$t}')" >/dev/null
  echo "[discovery] $trial start $(date -u +%H:%M:%SZ) image $image budget ${budget}s"
  set +e
  bash harnesses/run-trial.sh --harness "$h" --image "$image" --task "$tasks/t$t" --trial-id "$trial" \
    --base-url "http://host.docker.internal:$port/$trial/anthropic" --api-key "$cred" --model "$model" --time-budget "$budget" \
    --out "$out/trials/$trial" > "$out/trials/$trial.run.log" 2>&1
  rc=$?
  set -e
  # Finalize the key first: the proxy waits (up to 120 s) for this trial's in-flight requests to settle and reports any it could not drain.
  note=null
  if meter=$(curl -sf -X POST "http://$gateway:$port/__proxy/finalize" -H 'content-type: application/json' -H "x-proxy-control: $control" \
      -d "$(jq -nc --arg k "trial-token:$trial" '{key:$k, timeout_ms:120000}')") && jq -e 'has("requests")' <<< "$meter" >/dev/null; then
    undrained=$(jq -c '.undrained // 0' <<< "$meter")
  else
    undrained=null; note='"finalize failed: the proxy did not confirm the drain; this row may miss in-flight requests (see the ledger summary)"'
    echo "[discovery] $trial: finalize failed; requests_undrained unknown" >&2
  fi
  curl -sf -X POST "http://$gateway:$port/__proxy/unbind" -H 'content-type: application/json' -H "x-proxy-control: $control" -d "$(jq -nc --arg s "$trial" '{slot:$s}')" >/dev/null || true
  result=$(cat "$out/trials/$trial/result.json" 2>/dev/null || echo '{}')
  # Spend from this trial's usage lines: forwarded rows settle at actual_usd; failed rows keep their reservation as unknown; refused rows
  # cost nothing and are counted by status and reason. 402 is the lease, except the proxy's "unpriced request" 402 (a model with no price
  # row), which never touched the lease; 403 is a route or credential the proxy does not allow. A malformed usage line fails the run here
  # rather than writing a zero row; only a usage log that never came to exist (no request at all) falls back to zeros.
  if [ -e "$usage" ]; then
    spend=$({ grep -F "\"key\":\"trial-token:$trial\"" "$usage" || [ $? -eq 1 ]; } | jq -sc --arg k "trial-token:$trial" '[.[] | select(.key==$k)] | ([.[]|select(.outcome=="refused")]) as $ref
      | {forwarded:([.[]|select(.outcome=="forwarded")]|length), spent:([.[]|select(.outcome=="forwarded")|.actual_usd]|add//0), unknown:([.[]|select(.outcome=="failed")|.reserved_usd]|add//0),
         refused:($ref|length), budget_refusals:([$ref[]|select(.status==402 and ((.reason|tostring|startswith("unpriced"))|not))]|length),
         refusals:($ref|map("\(.status) \(.reason|tostring|.[0:120])")|group_by(.)|map({key:.[0], value:length})|from_entries)}')
  else
    spend='{"forwarded":0,"spent":0,"unknown":0,"refused":0,"budget_refusals":0,"refusals":{}}'
  fi
  evidence=$(bun scripts/gsta-135/evidence.ts "$h" "$out/trials/$trial" 2>>"$out/trials/$trial.run.log" || echo null)
  bun scripts/gsta-135/evidence.ts "$h" "$out/trials/$trial" --excerpt > "$out/evidence/$trial.txt" 2>/dev/null || true
  term=$(jq -r '.termination // "unknown"' <<< "$result")
  if [ "$(jq -r .budget_refusals <<< "$spend")" != 0 ]; then term="incomplete:budget"; stop_reason="lease refusal during $trial: $(jq -r '[.refusals|to_entries[]|select((.key|startswith("402")) and ((.key|startswith("402 unpriced"))|not))|.key]|first' <<< "$spend")"; fi
  if [ "$(jq -r .forwarded <<< "$spend")" = 0 ] && [ "$term" != "incomplete:budget" ]; then term="infra:no_model_request($term)"; fi
  [ "$undrained" = 0 ] || [ "$undrained" = null ] || echo "[discovery] $trial: $undrained request(s) still in flight after finalize; their cost is in the ledger, not in this row" >&2
  jq -nc --argjson base "$row_base" --argjson result "$result" --argjson spend "$spend" --argjson ev "$evidence" --arg term "$term" --argjson undrained "$undrained" --argjson note "$note" \
    '$base + {termination:$term, exit_code:($result.exit_code//null), wall_ms:($result.wall_ms//null), requests_forwarded:$spend.forwarded, requests_refused:$spend.refused, budget_refusals:$spend.budget_refusals, refusals:$spend.refusals, requests_undrained:$undrained, usd_spent:$spend.spent, usd_reserved_unknown:$spend.unknown, evidence:$ev, note:$note}' >> "$cells"
  echo "[discovery] $trial done: $term, spent \$$(jq -r .spent <<< "$spend"), evidence skill_open=$(jq -r '.skill_open.detail // "none"' <<< "$evidence") helper_run=$(jq -r '.helper_run.detail // "none"' <<< "$evidence") transcript=$(jq -r '.transcript // "none"' <<< "$evidence")"
done

cleanup; proxy_pid=''
summary=$([ "$dry" = 0 ] && bun runner/proxy/metering-proxy.ts summary --budget-ledger "$ledger" --run-id "$run_id" 2>/dev/null || echo '{}')
bun scripts/gsta-135/report.ts "$cells" "$out/report.md" --pin "$pin" --run-id "$run_id" --lease-usd "$lease" --cap "$cap" --summary "$summary" --stop "$stop_reason"
echo "[discovery] report at $out/report.md; lease summary: $summary"
