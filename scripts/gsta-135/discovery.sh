#!/usr/bin/env bash
# internal-task paid driver: harnesses/run-trial.sh trials through the metering
# proxy, the native-transcript evidence extracted after each trial, one row per
# planned trial in results/gsta-135/runs/<run id>/cells.jsonl whether dispatched
# or not, and report.md beside it. Two modes:
#
#   discovery (the default, the 2026-10-28 uncounted diagnostic): the spec's
#   single-trial cells under one lease for the run.
#     scripts/gsta-135/discovery.sh [--discovery] [--pin bd8907d6] [--lease-usd 10] [--max-output-tokens 128000]
#                                   [--run-id gsta-135-discovery-2026-10] [--qm] [--only <cell,...>] [--dry-run]
#
#   panel (internal-task's approved re-measure panel): two arms that differ only by
#   the gstack pin, 5 trials per cell in a fixed interleaved order, one
#   metering proxy process and one lease per trial, a panel cap enforced here
#   before every lease, and manifest.json written before trial 1.
#     scripts/gsta-135/discovery.sh --arms baseline:<sha>,candidate:<sha> --gstack-dir <checkout> --run-id <name>
#                                   [--trials 5] [--hermes-mode chat] [--max-tokens 128000] [--per-trial-usd 1.00]
#                                   [--panel-cap-usd 20] [--approval <setting>=<value>] [--ceilings <json>]
#                                   [--runtime-preflight <json>] [--only <trial,...>] [--dry-run]
#   --pin, --lease-usd and --qm are discovery-only and refused in panel mode
#   (exit 64): the panel's lease is per_trial_usd + R_max and its images come
#   from --arms. Test hooks, read from the environment: HE_PROXY_GATEWAY (the
#   proxy's bind address instead of the docker bridge gateway; containers
#   reach the proxy only at the bridge gateway, so this is for runs with a
#   stubbed docker on PATH), HE_PROXY_PORT (the first port, default 8797) and
#   HE_PROXY_UPSTREAM (passed to the proxy as --upstream anthropic=<url>, so a
#   trial runs against scripts/gsta-135/fake-anthropic.ts).
#
# A run directory that already holds anything is never reused: a second
# invocation with the same run id is refused, so one ledger, one usage log and
# one cells file describe exactly one invocation (a dry run writes under
# runs/<run id>-dry-run and may be repeated). Nothing under docs/ is touched.
#
# Discovery cells, in dispatch order (informative first, so a lease stop loses
# the least): t1 gstack arm on openclaw, hermes (and qm with --qm); t2 gstack
# arms; the controls (t3, 120 s) in the gstack arm; then the no-gstack arms
# (the :dev image, same seed) for t1, t2, t3. QM cells run only with --qm (at
# pin bd8907d6 QM core cannot import the pack, results/gsta-135/preflight/qm.log),
# otherwise they are rows with termination not_run:register_failed.
#
# Panel arms and images: the candidate SHA must contain the baseline SHA in
# --gstack-dir (git merge-base --is-ancestor; equal SHAs are allowed with a
# warning, for dry runs), both must resolve, and the images are
# harness-eval/<h>:gstack-<sha8> (hermes: -chat suffix in chat mode); a paid
# run refuses when an image is missing, a dry run records it as missing. An
# image that exists must carry the label org.harness-eval.gstack.commit equal
# to the arm's full SHA and (hermes) org.harness-eval.gstack.hermes_mode equal
# to --hermes-mode, else exit 2. The manifest records each image's id
# (docker image inspect .Id); every trial is dispatched by that id, never by
# the tag, after the tag is checked against the manifest's id again (a retag
# mid-run writes the trial as infra_error, stops the run and exits 2).
# Lease per trial = per_trial_usd + R_max from scripts/gsta-135/lease.ts, as
# lease id "<run id>.<trial id>" in one ledger for the run; --new-run on each
# proxy start closes a lease a killed trial left open, and each finalized
# trial's lease is closed with the ledger's own CLI (budget-ledger.ts close).
# The lease admits requests serially (k = 1); see lease.ts. Panel cap: before
# each lease, the ledger's settled + open reservations + lease_usd must fit
# the cap (lease.ts cap-check --budget-ledger, so an undrained request counts
# at its reservation), else the remaining rows are not_run:panel_cap and the
# run stops. Terminations beyond run-trial.sh's (completed, timeout,
# model_error, harness_error, infra_error): ceiling:lease,
# infra:reservation_refused, infra:cap_refused, infra:upstream,
# infra:no_model_request(<term>), infra:runtime, not_run:panel_cap,
# not_run:infra_stop, not_run:not_selected, not_run:dry_run (see lease.ts
# classifyTermination and the manifest's terminations block for which are
# evaluator infrastructure). Every planned trial gets a row whatever happens
# to the plumbing: a proxy that does not start, a slot that does not bind, a
# cap check or lease close that fails, or an image id that moved writes this
# trial as infra_error (nothing was dispatched) or its row with a note, sets
# the stop reason, and the remaining rows are not_run:infra_stop; the loop
# always reaches report.ts. Only an unreadable usage log aborts, because a
# zero row would misstate money the ledger holds.
# The manifest's marker block is read from the wrapper's source line before
# trial 1; the approval block from --approval or the Hermes overlay adapter's
# own approval: log line in its source; the runtime preflight verdict per
# image comes from --runtime-preflight, a JSON object {"<image>":
# "pass"|"fail"} (default results/gsta-135/preflight/runtime-preflight.json,
# written by scripts/gsta-135/preflight.sh, when it exists; any other value
# is exit 64), else "not_run" with a warning. A trial on an image whose
# preflight failed is not dispatched and is written as infra:runtime, never
# replaced.
#
# The proxy follows the post-#97 flow: bound to the docker bridge gateway (never
# a wildcard), a control token, one slot per trial bound with a random
# per-trial token that is the only credential the container sees. The real key
# stays in this shell's environment for the proxy alone. After each trial the
# key is finalized through the proxy (which waits up to 120 s for the trial's
# in-flight requests to settle) before its spend is read, so a trial that ends
# mid-request still has its cost in the row. A request still in flight after
# that wait is carried as a requests_undrained count on the row (its cost is in
# the ledger summary and in the next cap check, in no row); a finalize that
# fails leaves requests_undrained null and a note, never a zero.
set -euo pipefail
cd "$(dirname "$0")/../.."

pin=bd8907d6 lease=10 cap=128000 run_id=gsta-135-discovery-2026-10 with_qm=0 only='' dry=0 pin_set=0 lease_set=0
mode=discovery arms='' trials=5 gstack_dir='' hermes_mode=chat per_trial=1.00 panel_cap=20 approval='' ceilings_file=results/gsta-135/preflight/ceilings.json runtime_file=''
while [ $# -gt 0 ]; do
  case "$1" in
    --discovery) shift ;;
    --arms) arms=$2; mode=panel; shift 2 ;;
    --trials) trials=$2; shift 2 ;;
    --gstack-dir) gstack_dir=$2; shift 2 ;;
    --hermes-mode) hermes_mode=$2; shift 2 ;;
    --max-tokens|--max-output-tokens) cap=$2; shift 2 ;;
    --per-trial-usd) per_trial=$2; shift 2 ;;
    --panel-cap-usd) panel_cap=$2; shift 2 ;;
    --approval) approval=$2; shift 2 ;;
    --ceilings) ceilings_file=$2; shift 2 ;;
    --runtime-preflight) runtime_file=$2; shift 2 ;;
    --pin) pin=$2; pin_set=1; shift 2 ;;
    --lease-usd) lease=$2; lease_set=1; shift 2 ;;
    --run-id) run_id=$2; shift 2 ;;
    --qm) with_qm=1; shift ;;
    --only) only=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
die() { echo "$2" >&2; exit "$1"; }
warn() { echo "[$mode] warning: $*" >&2; }
[[ $run_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die 64 "--run-id must be a plain name (letters, digits, . _ -): $run_id"
out=results/gsta-135/runs/$run_id
[ "$dry" = 0 ] || { out=$out-dry-run; rm -rf "$out"; }
# The guard is the directory, not the cells file: a run killed during its first cell leaves a ledger and a usage log but no row.
[ ! -e "$out" ] || die 2 "$out exists; a run directory is never reused. Pass a new --run-id (or move the old run) instead of appending to its receipts."
model=claude-opus-5-5
# docker image inspect prints an empty line before it fails on a missing image, so the id must be non-empty to count.
digest_of() { local id; id=$(docker image inspect "$1" -f '{{.Id}}' 2>/dev/null) && [ -n "$id" ] && echo "$id" || echo missing; }
label_of() { docker image inspect "$1" -f "{{index .Config.Labels \"$2\"}}" 2>/dev/null || true; }

# Panel validation: everything that can be refused without the key is refused here.
if [ "$mode" = panel ]; then
  [ "$pin_set$lease_set$with_qm" = 000 ] || die 64 "--pin, --lease-usd and --qm are discovery-only options; the panel's lease is per_trial_usd + R_max and its images come from --arms"
  [[ $arms =~ ^baseline:([0-9a-fA-F]{7,40}),candidate:([0-9a-fA-F]{7,40})$ ]] || die 64 "--arms must be baseline:<sha>,candidate:<sha>: $arms"
  base_ref=${BASH_REMATCH[1]} cand_ref=${BASH_REMATCH[2]}
  [ -n "$gstack_dir" ] && [ -e "$gstack_dir/.git" ] || die 64 "--gstack-dir must name the gstack git checkout the SHAs live in"
  base_sha=$(git -C "$gstack_dir" rev-parse --verify --quiet "$base_ref^{commit}") || die 2 "baseline $base_ref does not resolve to a commit in $gstack_dir"
  cand_sha=$(git -C "$gstack_dir" rev-parse --verify --quiet "$cand_ref^{commit}") || die 2 "candidate $cand_ref does not resolve to a commit in $gstack_dir"
  if [ "$base_sha" = "$cand_sha" ]; then warn "baseline and candidate are the same commit $base_sha; the arms will not differ (fine for a dry run, meaningless for a paid one)"
  else git -C "$gstack_dir" merge-base --is-ancestor "$base_sha" "$cand_sha" || die 2 "candidate $cand_sha does not contain baseline $base_sha (git merge-base --is-ancestor in $gstack_dir); internal-task supplies a candidate rebased onto the freeze SHA"; fi
  [[ $hermes_mode =~ ^(oneshot|chat)$ ]] || die 64 "--hermes-mode must be oneshot or chat: $hermes_mode"
  [[ $trials =~ ^[1-9][0-9]*$ ]] || die 64 "--trials must be a positive integer: $trials"
  [[ $cap =~ ^[1-9][0-9]*$ ]] || die 64 "--max-tokens must be a positive integer: $cap"
  [ -z "$approval" ] || [[ $approval == *=* ]] || die 64 "--approval must be <setting>=<value>: $approval"
  [ "${#run_id}" -le 90 ] || die 64 "--run-id must be at most 90 characters so every lease id <run id>.<trial id> stays inside the ledger's 128"
  declare -A img_tag img_digest
  for arm in baseline candidate; do
    sha=$([ "$arm" = baseline ] && echo "$base_sha" || echo "$cand_sha")
    img_tag[$arm.openclaw]="harness-eval/openclaw:gstack-${sha:0:8}"
    img_tag[$arm.hermes]="harness-eval/hermes:gstack-${sha:0:8}$([ "$hermes_mode" = chat ] && echo -chat)"
    for h in openclaw hermes; do
      img_digest[$arm.$h]=$(digest_of "${img_tag[$arm.$h]}")
      if [ "${img_digest[$arm.$h]}" = missing ]; then
        if [ "$dry" = 1 ]; then warn "image ${img_tag[$arm.$h]} is not built; a paid run refuses here"; else die 2 "image ${img_tag[$arm.$h]} is not built (docker image inspect); build it before the panel"; fi
        continue
      fi
      label=$(label_of "${img_tag[$arm.$h]}" org.harness-eval.gstack.commit)
      [ "$label" = "$sha" ] || die 2 "image ${img_tag[$arm.$h]} carries org.harness-eval.gstack.commit=${label:-<none>}, not the $arm SHA $sha; rebuild it from that commit"
      [ "$h" != hermes ] || { label=$(label_of "${img_tag[$arm.$h]}" org.harness-eval.gstack.hermes_mode); [ "$label" = "$hermes_mode" ] || die 2 "image ${img_tag[$arm.$h]} carries org.harness-eval.gstack.hermes_mode=${label:-<none>}, not --hermes-mode $hermes_mode; rebuild it in that mode"; }
    done
  done
  lease_json=$(bun scripts/gsta-135/lease.ts r-max --model "$model" --max-tokens "$cap" --per-trial-usd "$per_trial")
  r_max=$(jq -r .r_max_usd <<< "$lease_json"); lease=$(jq -r .lease_usd <<< "$lease_json")
  order_json=$(bun scripts/gsta-135/lease.ts order --trials "$trials")
  if [ -s "$ceilings_file" ]; then ceilings_json=$(jq -c '{task1, task2, task3, per_harness, source, derived_at}' "$ceilings_file")
  elif [ "$dry" = 1 ]; then warn "no ceilings file at $ceilings_file (run scripts/gsta-135/ceilings.ts); the manifest carries internal-task's placeholders"; ceilings_json=$(bun scripts/gsta-135/lease.ts placeholder-ceilings)
  else die 2 "no ceilings file at $ceilings_file; run scripts/gsta-135/ceilings.ts before a paid panel"; fi
  marker_json=null
  if marker_line=$(grep -n -m1 -E '^[[:space:]]*export[[:space:]]+GSTACK_SESSION_KIND=' harnesses/_gstack/wrapper-lib.sh); then
    marker_json=$(jq -nc --arg line "harnesses/_gstack/wrapper-lib.sh:${marker_line%%:*}" --arg vars "$(grep -oE '\b[A-Z_]+=' <<< "${marker_line#*:}" | tr -d = | paste -sd ' ')" --arg text "${marker_line#*:}" \
      '{line:$line, variables:($vars|split(" ")|map(select(length>0))), source:"the wrapper source line, read before trial 1; each trial'"'"'s gstack-register.log carries the wrapper'"'"'s marker: line as the runtime proof", text:$text}')
  elif [ "$dry" = 1 ]; then warn "harnesses/_gstack/wrapper-lib.sh has no 'export GSTACK_SESSION_KIND=' line yet; marker recorded as null"
  else die 2 "harnesses/_gstack/wrapper-lib.sh exports no GSTACK_SESSION_KIND; the test-run marker must exist before a paid panel"; fi
  # The Hermes chat-mode approval disposition: --approval, else the overlay adapter's own 'approval: <key>=<value> ...' log line read from its source.
  approval_json=null approval_src="--approval (the chat-mode config copy, the same in both arms)"
  if [ -z "$approval" ] && [ "$hermes_mode" = chat ] && approval_line=$(grep -n -m1 -E 'wrap_log "approval: ' harnesses/hermes/gstack/adapter.sh); then
    approval=$(grep -oE '\b[a-z_.]+=[A-Za-z0-9_.-]+' <<< "${approval_line#*:}" | paste -sd ' ')
    approval_src="harnesses/hermes/gstack/adapter.sh:${approval_line%%:*} (the source line, read before trial 1; each Hermes trial's gstack-register.log carries the approval: line)"
  fi
  if [ -n "$approval" ]; then
    approval_json=$(jq -nc --arg all "$approval" --arg src "$approval_src" '($all|split(" ")|map(select(length>0))) as $pairs | {setting:($pairs[0]|split("=")[0]), value:($pairs[0]|split("=")[1:]|join("=")), settings:($pairs|map(split("=")|{key:.[0], value:(.[1:]|join("="))})|from_entries), source:$src}')
  elif [ "$hermes_mode" = chat ]; then
    if [ "$dry" = 1 ]; then warn "no --approval given and harnesses/hermes/gstack/adapter.sh logs no approval: line; the Hermes chat-mode approval disposition is recorded as null"; else die 2 "--approval <setting>=<value> is required for a paid chat-mode panel when the Hermes overlay adapter logs no approval: line (finding ceo-native-3)"; fi
  fi
  runtime_json='{}'
  [ -n "$runtime_file" ] || [ ! -s results/gsta-135/preflight/runtime-preflight.json ] || runtime_file=results/gsta-135/preflight/runtime-preflight.json
  if [ -n "$runtime_file" ]; then
    runtime_json=$(jq -c . "$runtime_file") || die 2 "--runtime-preflight $runtime_file is not JSON"
    jq -e 'type == "object" and (to_entries | all(.value | IN("pass", "fail", "not_run")))' <<< "$runtime_json" >/dev/null || die 64 "--runtime-preflight $runtime_file must map each image tag to pass, fail or not_run: $(jq -c 'with_entries(select(.value | IN("pass", "fail", "not_run") | not))' <<< "$runtime_json")"
  else warn "no --runtime-preflight file; every image's runtime preflight is recorded as not_run"; fi
  for k in "${!img_tag[@]}"; do runtime_json=$(jq -c --arg i "${img_tag[$k]}" '.[$i] //= "not_run"' <<< "$runtime_json"); done
fi

[ -n "${ANTHROPIC_API_KEY:-}" ] || [ "$dry" = 1 ] || die 2 "ANTHROPIC_API_KEY is not in this shell (the proxy reads it; nothing else does)"
tasks=~/.capy/work/he/gsta135/tasks
cells=$out/cells.jsonl
mkdir -p "$out/trials" "$out/evidence" "$tasks"
tree=$(git rev-parse HEAD); dirty=$([ -z "$(git status --porcelain)" ] && echo false || echo true)
git status --porcelain > "$out/tree-status.txt"
image_of() { case "$2" in gstack) echo "harness-eval/$1:gstack-$pin" ;; baseline|candidate) echo "${img_tag[$2.$1]}" ;; *) echo "harness-eval/$1:dev" ;; esac; }

for t in 1 2 3; do bash scripts/gsta-135/make-task.sh "$t" "$tasks/t$t" >/dev/null; done

# The manifest is the panel's preregistration record: written once, before trial 1, its sha256 beside it, never rewritten.
if [ "$mode" = panel ]; then
  jq -n --arg run_id "$run_id" --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg tree "$tree" --argjson dirty "$dirty" --arg base_sha "$base_sha" --arg cand_sha "$cand_sha" \
    --arg bo "${img_tag[baseline.openclaw]}" --arg bod "${img_digest[baseline.openclaw]}" --arg bh "${img_tag[baseline.hermes]}" --arg bhd "${img_digest[baseline.hermes]}" \
    --arg co "${img_tag[candidate.openclaw]}" --arg cod "${img_digest[candidate.openclaw]}" --arg ch "${img_tag[candidate.hermes]}" --arg chd "${img_digest[candidate.hermes]}" \
    --arg hermes_mode "$hermes_mode" --arg model "$model" --argjson max_tokens "$cap" --argjson per_trial "$per_trial" --argjson r_max "$r_max" --argjson lease "$lease" --argjson panel_cap "$panel_cap" \
    --argjson lease_inputs "$(jq -c .inputs <<< "$lease_json")" --argjson marker "$marker_json" --argjson approval "$approval_json" --argjson runtime "$runtime_json" \
    --argjson order "$order_json" --argjson ceilings "$ceilings_json" --argjson trials "$trials" --argjson dry "$dry" \
    '{run_id:$run_id, created_at:$created, dry_run:($dry==1), tree:$tree, tree_dirty:$dirty, model:$model,
      arms:{baseline:{gstack_sha:$base_sha, images:{openclaw:{tag:$bo,digest:$bod}, hermes:{tag:$bh,digest:$bhd}}}, candidate:{gstack_sha:$cand_sha, images:{openclaw:{tag:$co,digest:$cod}, hermes:{tag:$ch,digest:$chd}}}},
      hermes_mode:$hermes_mode, hermes_claim:"chat mode under the overlay adapter only; the counted Hermes entries stay one-shot and the discovery one-shot rows (0 opens) stand beside this result",
      max_tokens:$max_tokens, max_tokens_rule:"the proxy refuses a request stating more than max_tokens with 400 before any reservation; the preflight asserts the first request of each harness carries exactly this value",
      per_trial_usd:$per_trial, r_max_usd:$r_max, r_max_inputs:$lease_inputs, lease_usd:$lease, lease_id_form:"<run_id>.<trial_id>, one metering proxy process and one lease per trial in one ledger; --new-run on each start closes a lease a killed trial left open; each finalized lease is closed with budget-ledger.ts close",
      lease_assumption:"serial requests (k = 1): the ledger admits a request while settled + every open reservation + the new reservation fits the lease, so two concurrent requests near R_max refuse each other with settled near zero; a 402 that overlapped an in-flight request (ledger created_at/settled_at) is infra:reservation_refused, never ceiling:lease; a reservation charged in full for an upstream failure is usd_charged_reservation on the row, outside the $1.00 bar and inside the cap",
      dispatch:"by image id: each trial runs the manifest'"'"'s recorded image id (docker image inspect .Id), checked against the tag again before the trial; a moved tag writes the trial as infra_error and stops the run with exit 2",
      panel_cap_usd:$panel_cap, stop_rule:"before each lease, from the ledger: settled + open reservations (an undrained request at its reserved value) + lease_usd <= panel_cap_usd, else the remaining rows are not_run:panel_cap and the run stops; a 402 after a forwarded request ends that trial as ceiling:lease (the trial failed the $1.00 bar) and the run continues; a proxy that does not start, a slot that does not bind, a cap check or lease close that fails, or an image id that moved writes that trial as infra_error (or its row with a note), the remaining rows as not_run:infra_stop, and the run stops; every planned trial has a row; no trial is ever replaced; the enforced worst case is the cap",
      marker:$marker, approval:$approval, runtime_preflight:$runtime, trials_per_cell:$trials, order:$order, ceilings:$ceilings,
      bars:"internal-task, per harness: the matching skill opens in at least 3 of 5 trials on tasks 1 and 2 and strictly above baseline; starts in at least 3 of 5; the control (task 3) opens a skill in at most 1 of 5; task success not below baseline; per-cell medians under the measured ceilings and every trial under $1.00; counts are reported with Wilson 95% intervals and overlapping arm intervals read \"meets the bars; improvement inconclusive at n=5\"",
      terminations:{
        evaluator_infrastructure:{"infra:reservation_refused":"402 with zero forwarded requests: the first reservation did not fit the lease (a sizing error here, never a verdict)", "infra:cap_refused":"400 with zero forwarded requests: the harness stated max_tokens above the pin (a configuration error here)", "infra:no_model_request(<term>)":"no request reached the proxy; run-trial'"'"'s own termination in parentheses", "infra:upstream":"402 after the proxy charged a reservation in full for an upstream failure (a 5xx with no usage): the provider consumed the lease, not the trial; the charged dollars are usd_charged_reservation on the row, outside the $1.00 bar, inside the cap", "infra_error":"run-trial.sh could not run the container, or the driver could not dispatch it (proxy start, slot bind, cap check, lease close or image id; see the row'"'"'s note)", "not_run:panel_cap":"the panel cap stopped the run before this row", "not_run:infra_stop":"an evaluator failure stopped the run before this row (the report'"'"'s stop reason names it)", "not_run:not_selected":"--only left it out", "not_run:dry_run":"a dry run"},
        harness_or_gstack_runtime:{"infra:runtime":"the gstack runtime inside the harness image did not start cleanly (the wrapper'"'"'s runtime: degraded line, or the image'"'"'s runtime preflight failed); a gstack or harness runtime failure, not evaluator infrastructure: the row stays in the denominator with no skill credit and is never replaced", "harness_error":"the adapter exited 2", "model_error":"the adapter saw a model error (exit 3)", "timeout":"the time budget ran out (exit 124)", "ceiling:lease":"402 after at least one forwarded request: the trial passed $1.00 settled and failed the cost bar", "completed":"the adapter exited 0"}}}' > "$out/manifest.json"
  sha256sum "$out/manifest.json" | cut -d' ' -f1 > "$out/manifest.sha256"
  chmod a-w "$out/manifest.json" "$out/manifest.sha256"
  echo "[panel] manifest $out/manifest.json sha256 $(cat "$out/manifest.sha256"); $(jq -r '.order|length' "$out/manifest.json") rows, lease \$$lease per trial (R_max \$$r_max), cap \$$panel_cap, hermes $hermes_mode, max_tokens $cap"
fi

# Proxy on the bridge gateway with a control token: discovery opens one lease for the run, the panel one process and one lease per trial.
gateway=dry; [ "$dry" = 1 ] || gateway=${HE_PROXY_GATEWAY:-$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')}
port=${HE_PROXY_PORT:-8797}
upstream_args=(); [ -z "${HE_PROXY_UPSTREAM:-}" ] || upstream_args=(--upstream "anthropic=$HE_PROXY_UPSTREAM")
control=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
ledger=$out/ledger.sqlite usage=$out/proxy-usage.ndjson
proxy_pid=''
proxy_stop() { if [ -n "$proxy_pid" ]; then kill -TERM "$proxy_pid" 2>/dev/null || true; wait "$proxy_pid" 2>/dev/null || true; proxy_pid=''; fi; }
trap proxy_stop EXIT
proxy_up() { curl -sf --max-time 2 "http://$gateway:$port/__proxy/status" >/dev/null 2>&1; }
# proxy_start <lease run id> <lease usd>: start, wait for /__proxy/status; a start that does not come up is retried on the
# same port three times (the bind-after-close window of the previous trial's process), then the port rotates. Returns 1 after
# nine attempts, 2 when the proxy came up on an address other than $gateway:$port alone (stopped again); never exits.
proxy_start() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9; do
    bun runner/proxy/metering-proxy.ts --listen "$gateway:$port" --control-token "$control" --budget-ledger "$ledger" --lease-usd "$2" \
      --run-id "$1" --allow-models "anthropic:$model" --max-output-tokens "$cap" --usage-log "$usage" --new-run "${upstream_args[@]}" >> "$out/proxy.log" 2>&1 &
    proxy_pid=$!
    for _ in $(seq 1 100); do kill -0 "$proxy_pid" 2>/dev/null || break; proxy_up && break; sleep 0.1; done
    if kill -0 "$proxy_pid" 2>/dev/null && proxy_up; then
      if ! ss -ltn | grep -q "$gateway:$port " || ss -ltn | grep -q "0.0.0.0:$port "; then
        proxy_stop; echo "[$mode] the proxy is not listening on $gateway:$port alone (a wildcard or another address); refusing to run" >&2; return 2
      fi
      return 0
    fi
    proxy_stop
    echo "[$mode] the proxy did not come up on $gateway:$port as $1 (attempt $attempt); see $out/proxy.log" >&2
    if [ $((attempt % 3)) = 0 ]; then port=$((port + 1)); echo "[$mode] rotating to port $port" >&2; fi
    sleep 1
  done
  return 1
}
if [ "$dry" = 0 ] && [ "$mode" = discovery ]; then
  proxy_start "$run_id" "$lease" || die 2 "the metering proxy did not start; see $out/proxy.log"
  echo "[discovery] proxy on $gateway:$port, lease \$$lease as $run_id, output cap $cap, usage $usage"
fi

# run_trial <trial> <harness> <task> <image> <budget> <lease id>: bind (return 1 when the slot does not bind; nothing dispatched),
# run-trial.sh, finalize, unbind; sets spend, result, evidence, undrained, notes.
run_trial() {
  local trial=$1 h=$2 t=$3 image=$4 budget=$5 lease_id=$6 cred meter
  cred="trial-token:$trial.$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  curl -sf -X POST "http://$gateway:$port/__proxy/bind" -H 'content-type: application/json' -H "x-proxy-control: $control" \
    -d "$(jq -nc --arg s "$trial" --arg k "trial-token:$trial" --arg t "$cred" '{slot:$s,key:$k,token:$t}')" >/dev/null \
    || { echo "[$mode] $trial: the proxy did not bind slot $trial; not dispatched" >&2; return 1; }
  echo "[$mode] $trial start $(date -u +%H:%M:%SZ) image $image budget ${budget}s proxy $gateway:$port"
  set +e
  bash harnesses/run-trial.sh --harness "$h" --image "$image" --task "$tasks/t$t" --trial-id "$trial" \
    --base-url "http://host.docker.internal:$port/$trial/anthropic" --api-key "$cred" --model "$model" --time-budget "$budget" \
    --out "$out/trials/$trial" > "$out/trials/$trial.run.log" 2>&1
  rc=$?
  set -e
  # Finalize the key first: the proxy waits (up to 120 s) for this trial's in-flight requests to settle and reports any it could not drain.
  notes=()
  if meter=$(curl -sf -X POST "http://$gateway:$port/__proxy/finalize" -H 'content-type: application/json' -H "x-proxy-control: $control" \
      -d "$(jq -nc --arg k "trial-token:$trial" '{key:$k, timeout_ms:120000}')") && jq -e 'has("requests")' <<< "$meter" >/dev/null; then
    undrained=$(jq -c '.undrained // 0' <<< "$meter")
  else
    undrained=null; notes+=("finalize failed: the proxy did not confirm the drain; this row may miss in-flight requests (see the ledger summary)")
    echo "[$mode] $trial: finalize failed; requests_undrained unknown" >&2
  fi
  curl -sf -X POST "http://$gateway:$port/__proxy/unbind" -H 'content-type: application/json' -H "x-proxy-control: $control" -d "$(jq -nc --arg s "$trial" '{slot:$s}')" >/dev/null || true
  result=$(cat "$out/trials/$trial/result.json" 2>/dev/null || echo '{}')
  # Spend from this trial's usage lines (lease.ts spendFromUsage: settled, charged reservations, unknown, refusals; with the lease's
  # ledger entries, which lease refusals overlapped an in-flight request). A malformed usage line fails the run here rather than
  # writing a zero row; only a usage log that never came to exist (no request at all) is zeros.
  spend=$(bun scripts/gsta-135/lease.ts spend --usage "$usage" --key "trial-token:$trial" --budget-ledger "$ledger" --lease-id "$lease_id") \
    || die 2 "the usage log $usage could not be read for $trial; no zero row is written, the ledger $ledger holds this trial's money"
  evidence=$(bun scripts/gsta-135/evidence.ts "$h" "$out/trials/$trial" --task "$t" 2>>"$out/trials/$trial.run.log" || echo null)
  bun scripts/gsta-135/evidence.ts "$h" "$out/trials/$trial" --task "$t" --excerpt > "$out/evidence/$trial.txt" 2>/dev/null || true
  [ "$undrained" = 0 ] || [ "$undrained" = null ] || echo "[$mode] $trial: $undrained request(s) still in flight after finalize; their cost is in the ledger, not in this row" >&2
}
note_json() { if [ ${#notes[@]} -eq 0 ]; then echo null; else printf '%s\n' "${notes[@]}" | jq -Rs 'split("\n")|map(select(length>0))|join("; ")'; fi; }
# skip_row <row base> <termination> <note json>: a row that was never dispatched.
skip_row() {
  jq -nc --argjson base "$1" --arg term "$2" --argjson note "$3" '$base + {termination:$term, exit_code:null, wall_ms:null, requests_forwarded:0, requests_refused:0, budget_refusals:0, refusals:{}, requests_undrained:0, usd_spent:0, usd_reserved_unknown:0, usd_charged_reservation:0, evidence:null, note:$note}' >> "$cells"
}
# full_row <row base> <termination> <trial>: the dispatched row from run_trial's results.
full_row() {
  jq -nc --argjson base "$1" --argjson result "$result" --argjson spend "$spend" --argjson ev "$evidence" --arg term "$2" --argjson undrained "$undrained" --argjson note "$(note_json)" \
    '$base + {termination:$term, exit_code:($result.exit_code//null), wall_ms:($result.wall_ms//null), requests_forwarded:$spend.forwarded, requests_refused:$spend.refused, budget_refusals:$spend.budget_refusals, refusals:$spend.refusals, requests_undrained:$undrained, usd_spent:$spend.spent, usd_reserved_unknown:$spend.unknown, usd_charged_reservation:$spend.charged_reservation_usd, evidence:$ev, note:$note}' >> "$cells"
  echo "[$mode] $3 done: $2, spent \$$(jq -r .spent <<< "$spend"), evidence skill_open=$(jq -r '.skill_open.detail // "none"' <<< "$evidence") helper_run=$(jq -r '.helper_run.detail // "none"' <<< "$evidence") transcript=$(jq -r '.transcript // "none"' <<< "$evidence")"
}

stop_reason=''
if [ "$mode" = discovery ]; then
  # planned cells: "<harness> <task> <arm>"
  plan=()
  plan+=("openclaw 1 gstack" "hermes 1 gstack" "qm 1 gstack")
  plan+=("openclaw 2 gstack" "hermes 2 gstack")
  plan+=("openclaw 3 gstack" "hermes 3 gstack" "qm 3 gstack")
  plan+=("openclaw 1 none" "hermes 1 none" "openclaw 2 none" "hermes 2 none" "openclaw 3 none" "hermes 3 none")
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
      skip_row "$row_base" "$skip" "$([ "$skip" = not_run:register_failed ] && echo '"preflight: QM core cannot import the gstack pack at this pin (results/gsta-135/preflight/qm.log)"' || echo null)"
      echo "[discovery] $trial $skip"; continue
    fi
    run_trial "$trial" "$h" "$t" "$image" "$budget" "$run_id"
    term=$(jq -r '.termination // "unknown"' <<< "$result")
    if [ "$(jq -r .budget_refusals <<< "$spend")" != 0 ]; then term="incomplete:budget"; stop_reason="lease refusal during $trial: $(jq -r '[.refusals|to_entries[]|select((.key|startswith("402")) and ((.key|startswith("402 unpriced"))|not))|.key]|first' <<< "$spend")"; fi
    if [ "$(jq -r .forwarded <<< "$spend")" = 0 ] && [ "$term" != "incomplete:budget" ]; then term="infra:no_model_request($term)"; fi
    full_row "$row_base" "$term" "$trial"
  done
  proxy_stop
  summary=$([ "$dry" = 0 ] && bun runner/proxy/metering-proxy.ts summary --budget-ledger "$ledger" --run-id "$run_id" 2>/dev/null || echo '{}')
  bun scripts/gsta-135/report.ts "$cells" "$out/report.md" --pin "$pin" --run-id "$run_id" --lease-usd "$lease" --cap "$cap" --summary "$summary" --stop "$stop_reason"
  echo "[discovery] report at $out/report.md; lease summary: $summary"
  exit 0
fi

# Panel: the manifest's order, one proxy process and one lease per trial, the cap checked before each lease. An evaluator
# failure around a trial (infra_stop below) writes that trial's row, sets the stop reason and the termination the remaining rows
# get, and the loop goes on writing rows; the run exits 2 at the end when the stop was an image id that moved.
stop_skip='' exit_code=0
infra_stop() { stop_reason=$1; stop_skip='not_run:infra_stop'; echo "[panel] $stop_reason" >&2; }
while read -r row; do
  trial=$(jq -r .trial_id <<< "$row"); h=$(jq -r .harness <<< "$row"); t=$(jq -r .task <<< "$row"); arm=$(jq -r .arm <<< "$row")
  budget=$(jq -r .time_budget_s <<< "$row"); image=$(image_of "$h" "$arm"); image_id=${img_digest[$arm.$h]}
  row_base=$(jq -nc --argjson o "$row" --arg image "$image" --arg digest "$image_id" --arg tree "$tree" --argjson dirty "$dirty" --arg model "$model" \
    --arg started "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson lease "$lease" --argjson cap "$cap" \
    '{trial_id:$o.trial_id, harness:$o.harness, task:$o.task, arm:$o.arm, trial_index:$o.trial_index, order:$o.order, image:$image, image_digest:$digest, image_id:null, tree:$tree, tree_dirty:$dirty, model:$model, time_budget_s:$o.time_budget_s, workspace_seen:true, started_at:$started, lease_usd:$lease, max_tokens:$cap, grade:null}')
  skip='' note=null
  [ -z "$only" ] || case ",$only," in *",$trial,"*) ;; *) skip='not_run:not_selected' ;; esac
  [ -n "$skip" ] || [ -z "$stop_reason" ] || skip=$stop_skip
  if [ -z "$skip" ] && [ "$(jq -r --arg i "$image" '.[$i]' <<< "$runtime_json")" = fail ]; then skip='infra:runtime'; note="\"runtime preflight failed for $image (--runtime-preflight $runtime_file); not dispatched, not replaced\""; fi
  [ "$dry" = 0 ] || skip=${skip:-not_run:dry_run}
  if [ -z "$skip" ]; then
    # The cap's inputs come from the ledger, not the rows: an undrained request is an open reservation there and in no row.
    if cap_json=$(bun scripts/gsta-135/lease.ts cap-check --budget-ledger "$ledger" --run-id "$run_id" --lease "$lease" --cap "$panel_cap") || [ -n "$cap_json" ]; then
      if [ "$(jq -r .fits <<< "$cap_json")" != true ]; then
        stop_reason="panel cap: settled \$$(jq -r .settled <<< "$cap_json") + open reservations \$$(jq -r .unknown <<< "$cap_json") + lease \$$lease would pass \$$panel_cap before $trial (ledger $ledger)"
        stop_skip='not_run:panel_cap'; skip=$stop_skip; echo "[panel] $stop_reason" >&2
      fi
    else
      infra_stop "the panel cap check (lease.ts cap-check against $ledger) failed before $trial; nothing dispatched"; skip=infra_error; note=$(jq -nc --arg n "$stop_reason" '$n')
    fi
  fi
  if [ -z "$skip" ]; then
    now_id=$(digest_of "$image")
    if [ "$now_id" != "$image_id" ]; then
      infra_stop "image $image now resolves to $now_id, not the manifest's $image_id; $trial not dispatched, the run stops (exit 2)"; skip=infra_error; note=$(jq -nc --arg n "$stop_reason" '$n'); exit_code=2
    fi
  fi
  if [ -z "$skip" ] && ! proxy_start "$run_id.$trial" "$lease"; then
    infra_stop "the metering proxy did not start for $trial after nine attempts and port rotations (see $out/proxy.log); nothing dispatched"; skip=infra_error; note=$(jq -nc --arg n "$stop_reason" '$n')
    # The proxy opens its lease before it listens, so a start that never listened leaves the lease open; close it, no request ever used it.
    bun runner/ledger/budget-ledger.ts close --budget-ledger "$ledger" --budget-run-id "$run_id.$trial" >/dev/null 2>&1 || true
  fi
  if [ -n "$skip" ]; then
    skip_row "$row_base" "$skip" "$note"
    echo "[panel] $trial $skip"; continue
  fi
  if ! run_trial "$trial" "$h" "$t" "$image_id" "$budget" "$run_id.$trial"; then
    proxy_stop
    bun runner/ledger/budget-ledger.ts close --budget-ledger "$ledger" --budget-run-id "$run_id.$trial" >/dev/null 2>&1 || true
    infra_stop "the proxy did not bind slot $trial; nothing dispatched"
    skip_row "$row_base" infra_error "$(jq -nc --arg n "$stop_reason" '$n')"; echo "[panel] $trial infra_error"; continue
  fi
  proxy_stop
  grep -q 'marker:' "$out/trials/$trial/logs/gstack-register.log" 2>/dev/null || notes+=("gstack-register.log carries no marker: line")
  [ "$h" != hermes ] || [ "$hermes_mode" != chat ] || grep -q 'approval:' "$out/trials/$trial/logs/gstack-register.log" 2>/dev/null || notes+=("gstack-register.log carries no approval: line")
  term=$(bun scripts/gsta-135/lease.ts classify --termination "$(jq -r '.termination // "unknown"' <<< "$result")" --spend "$spend" --wrapper-log "$out/trials/$trial/logs/gstack-register.log") \
    || { notes+=("classify failed (lease.ts exit $?); termination unknown, run-trial.sh said $(jq -r '.termination // "unknown"' <<< "$result")"); term=unknown; }
  full_row "$(jq -c --argjson r "$result" --arg id "$image_id" '.image_id = $id | .grade = (if ($r.grade // "") | IN("pass","fail") then $r.grade else null end)' <<< "$row_base")" "$term" "$trial"
  # The proxy's SIGTERM stop leaves its lease open (a resume could rejoin it); the panel closes each lease once its row is written.
  bun runner/ledger/budget-ledger.ts close --budget-ledger "$ledger" --budget-run-id "$run_id.$trial" >/dev/null \
    || infra_stop "lease $run_id.$trial did not close (bun runner/ledger/budget-ledger.ts close); the row is written, the run stops"
done < <(jq -c '.[]' <<< "$order_json")

summary='{}'
[ "$dry" = 1 ] || summary=$(bun scripts/gsta-135/lease.ts ledger-summary --budget-ledger "$ledger" --run-id "$run_id")
bun scripts/gsta-135/report.ts "$cells" "$out/report.md" --manifest "$out/manifest.json" --summary "$summary" --stop "$stop_reason"
if [ "$dry" = 1 ]; then echo "[panel] report at $out/report.md; dry run, no ledger"; else echo "[panel] report at $out/report.md; ledger: $(jq -c '{leases, open_leases, committed_usd, open_reservations_usd, requests}' <<< "$summary")"; fi
exit "$exit_code"
