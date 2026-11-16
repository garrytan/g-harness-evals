#!/usr/bin/env bash
# One tier of the gbrain suite of the regression canary (docs/canary.md):
#
#   scripts/canary/gbrain/run-tier.sh --tier T1|T2|T3 --prev <sha|tag> --new <sha|tag> --tasks <tasks.json> --attempts <k>
#       --arms plain,prev,new --models opus,sol[,particle] --lease-usd <n> --run-id <id> --out <dir>
#       [--fake [--fake-break prev|new]] [--remote]
#
# It renders one spec per arm (canary.ts render: the h2h told-scoped cell for each model in its home harness, Claude Code on
# Opus 5.5, Codex on GPT-6.1 Sol, Hermes on particle-1, on the tier's tasks of tasks.json; the release arms carry the gbrain
# block, the gbrain-memory preamble, the release's peeled commit as gbrain_commit and its image's measured tool counts; the
# plain arm carries none of them; each arm's spec has its own run id, <run-id>-<arm>), writes their sha256s to
# <out>/specs/canary-spec.json, and runs each arm as one scripts/run-shard.sh shard on this machine, trials sequential
# within a shard, each with --clean-arm-preflight and the release's own image (harness-eval/gbrain:canary-<version>).
# The harness images are built once before the shards, which all run with --skip-build. The arms run at the same time
# (preregistration amendment 2), so a drift in the models or the network over the hours a tier takes lands on every arm
# alike: --lease-usd is split by weight, 1.6 for a release arm and 1.0 for the plain arm (the product-to-plain cost ratio
# the leases are priced on), and a shard never spends past its share. When any share would be below one worst-case call
# reservation ($8; the metering proxy would refuse that call), the arms run in turn instead, prev, new, plain, each under
# what is left of --lease-usd after the shards before it, read from their ledgers. Either way the run never spends past
# --lease-usd. It then writes
# <out>/trials.jsonl: every trial record of every shard with its canary block (suite, tier, arm, product version and sha,
# model key, task, attempt, exposure, safety; canary.ts annotate), and <out>/run-tier.json with the specs' hashes, each
# shard's exit and spend, and the plain arm's post-run clean-arm audit.
#
# Exit 0 when every shard completed, 20 when the lease stopped the run (a shard's runner exited 3, HE-BUDGET-001, or nothing
# was left for the next shard), anything else for an infrastructure failure. A partial trials.jsonl is written in every case.
# --fake runs offline with no docker, no key and no model call: the releases resolve against fixtures/ls-remote.txt and each
# shard is built from the recorded fixtures (canary.ts fake-shard), then annotated by the same code; --fake-break <arm> leaves
# that arm's gbrain tools/list out, so its exposure reads false. --remote runs the same command on one Ubicloud VM
# (remote.sh), with only the provider keys the models need, copies <out> back and destroys the VM on every exit path.
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PATH="$HOME/.bun/bin:$PATH"
tier="" prev="" new="" tasks="" attempts="" arms="" models="" lease="" run_id="" out="" fake=0 remote=0 fake_break=""
argv=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --tier) tier="$2"; shift 2 ;;
    --prev) prev="$2"; shift 2 ;;
    --new) new="$2"; shift 2 ;;
    --tasks) tasks="$2"; shift 2 ;;
    --attempts) attempts="$2"; shift 2 ;;
    --arms) arms="$2"; shift 2 ;;
    --models) models="$2"; shift 2 ;;
    --lease-usd) lease="$2"; shift 2 ;;
    --run-id) run_id="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --fake) fake=1; shift ;;
    --fake-break) fake_break="$2"; shift 2 ;;
    --remote) remote=1; shift ;;
    -h|--help) sed -n '2,/^set -euo pipefail/{/^set /!p}' "$0"; exit 0 ;;
    *) echo "run-tier (gbrain): unknown argument $1" >&2; exit 2 ;;
  esac
done
for v in tier tasks attempts arms models lease run_id out; do [ -n "${!v}" ] || { echo "run-tier (gbrain): --${v//_/-} is required" >&2; exit 2; }; done
[ -f "$tasks" ] || { echo "run-tier (gbrain): --tasks $tasks does not exist" >&2; exit 2; }
case ",$arms," in *,prev,*) [ -n "$prev" ] || { echo "run-tier (gbrain): the prev arm needs --prev" >&2; exit 2; } ;; esac
case ",$arms," in *,new,*) [ -n "$new" ] || { echo "run-tier (gbrain): the new arm needs --new" >&2; exit 2; } ;; esac
[[ "$lease" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "run-tier (gbrain): --lease-usd must be a number of dollars" >&2; exit 2; }
if [ "$remote" -eq 1 ]; then
  [ "$fake" -eq 0 ] || { echo "run-tier (gbrain): --fake runs here; drop --remote" >&2; exit 2; }
  # The VM's wall time: about 40 minutes of builds and preflight, then about four minutes a trial.
  trials=$(jq --arg tier "$tier" --arg models "$models" --argjson k "$attempts" --arg arms "$arms" \
    '[($models | split(","))[] as $m | .models[$m] | if $tier == "T1" then .t1 elif $tier == "T2" then (.tasks + .digest | unique) else .tasks end | length] | add * $k * ($arms | split(",") | length)' "$tasks")
  hours=$(( (40 + trials * 4) / 60 + 2 ))
  keys=()
  case ",$models," in *,opus,*) keys+=(ANTHROPIC_API_KEY) ;; esac
  case ",$models," in *,sol,*) keys+=(OPENAI_API_KEY) ;; esac
  case ",$models," in *,particle,*) keys+=(PARTICLE_API_KEY) ;; esac
  rest=(); skip=0
  for a in "${argv[@]}"; do
    if [ "$skip" -eq 1 ]; then skip=0; continue; fi
    case "$a" in --remote) ;; --out|--tasks) skip=1 ;; *) rest+=("$a") ;; esac
  done
  exec bash scripts/canary/gbrain/remote.sh --entry run-tier --out "$out" --hours "$hours" --tasks "$tasks" $(printf -- '--key %s ' "${keys[@]}") -- "${rest[@]}"
fi
mkdir -p "$out"
out=$(cd "$out" && pwd)
canary=(bun scripts/canary/gbrain/canary.ts)
log() { printf '%s run-tier (gbrain): %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/run-tier.log" >&2; }
[ ! -s "$out/trials.jsonl" ] || { log "refused: $out/trials.jsonl exists; a run id writes one results directory"; exit 2; }
: > "$out/trials.jsonl"
shards="[]"
lease_stop=0 infra_rc=0 spent=0 spend_unknown=0
ntrials() { local n=""; [ ! -f "$out/trials.jsonl" ] || n=$(grep -c . "$out/trials.jsonl" || true); echo "${n:-0}"; }
write_summary() {
  jq -n --arg tier "$tier" --arg run_id "$run_id" --argjson lease "$lease" --argjson spent "$spent" --argjson shards "$shards" \
    --argjson fake "$([ "$fake" -eq 1 ] && echo true || echo false)" --argjson exit "$1" --slurpfile spec "$out/specs/canary-spec.json" \
    --argjson trials "$(ntrials)" \
    '{suite: "gbrain", tier: $tier, run_id: $run_id, fake: $fake, lease_usd: $lease, spent_usd: $spent, trials: $trials, exit: $exit, specs: ($spec[0].arms | map_values({spec_sha256, release})), shards: $shards}' > "$out/run-tier.json"
}
end() { write_summary "$1"; log "wrote $out/trials.jsonl ($(ntrials) trials) and $out/run-tier.json, exit $1"; exit "$1"; }

# 1. The releases, and for a real run each release image built and its tools listed, so the spec states what it serves.
mkdir -p "$out/specs"
ls_args=()
[ "$fake" -eq 0 ] || ls_args=(--ls-remote scripts/canary/gbrain/fixtures/ls-remote.txt)
render_args=()
for arm in prev new; do
  case ",$arms," in *,"$arm",*) ;; *) continue ;; esac
  mkdir -p "$out/$arm"
  "${canary[@]}" resolve --ref "${!arm}" ${ls_args[@]+"${ls_args[@]}"} > "$out/$arm/release.json" 2> "$out/$arm/resolve.log" || { log "$arm ${!arm} does not resolve: $(tail -1 "$out/$arm/resolve.log")"; exit 2; }
  render_args+=(--"$arm" "$out/$arm/release.json")
  log "$arm: $(jq -r '"\(.sha) \(.tag // "no stable tag") -> \(.image)"' "$out/$arm/release.json")"
  [ "$fake" -eq 0 ] || continue
  image=$(jq -r .image "$out/$arm/release.json")
  scripts/build-gbrain-image.sh --gbrain "$(jq -r .sha "$out/$arm/release.json")" --tag "$image" --out "$out/$arm/gbrain-image" > "$out/$arm/build-gbrain.log" 2>&1 || { log "the $arm image $image did not build: $(tail -1 "$out/$arm/build-gbrain.log")"; exit 2; }
  "${canary[@]}" probe-tools --image "$image" --out "$out/$arm/tools.json" > "$out/$arm/tools.log" 2>&1 || { log "the $arm image $image did not list its tools: $(tail -1 "$out/$arm/tools.log")"; exit 2; }
  render_args+=(--"$arm"-tools "$out/$arm/tools.json")
done
"${canary[@]}" render --tasks "$tasks" --tier "$tier" --attempts "$attempts" --arms "$arms" --models "$models" --run-id "$run_id" --lease-usd "$lease" --out "$out/specs" ${render_args[@]+"${render_args[@]}"} >> "$out/run-tier.log" 2>&1 || { log "rendering the specs failed: $(tail -1 "$out/run-tier.log")"; exit 2; }

# 2. One shard per arm: at the same time under weighted shares of the lease, or in turn when a share would be too small.
run_arms=()
for arm in prev new plain; do case ",$arms," in *,"$arm",*) run_arms+=("$arm") ;; esac; done
release_image=""
for arm in "${run_arms[@]}"; do [ "$arm" = plain ] || { release_image=$(jq -r .image "$out/$arm/release.json"); break; }; done
prebuilt=0
if [ "$fake" -eq 0 ] && [ -n "$release_image" ]; then
  for h in $(jq -r '.cells[].harness' "$out"/specs/*.prereg.json | sort -u); do
    log "building harness-eval/$h:dev from harnesses/$h"
    docker build -q -t "harness-eval/$h:dev" "harnesses/$h" > "$out/build-$h.log" 2>&1 || { log "the harness image harness-eval/$h:dev did not build: $(tail -1 "$out/build-$h.log")"; exit 2; }
  done
  prebuilt=1
fi
mapfile -t shares < <(python3 -c '
import sys
lease, arms = float(sys.argv[1]), sys.argv[2:]
w = [1.0 if a == "plain" else 1.6 for a in arms]
for x in w: print(f"{lease * x / sum(w):.4f}")' "$lease" "${run_arms[@]}")
together=0
if [ "${#run_arms[@]}" -gt 1 ] && python3 -c 'import sys; sys.exit(0 if min(map(float, sys.argv[1:])) >= 8 else 1)' "${shares[@]}"; then together=1; fi
mkdir -p "$out/shards"
run_arm() { # <arm> <lease usd>: one arm's shard; writes <out>/shards/<arm>.rc and <arm>.usd
  local arm=$1 left=$2 rc usd=0
  local shard="$out/shards/$arm" spec="$out/specs/$arm.prereg.json"
  if [ "$fake" -eq 1 ]; then
    set +e; "${canary[@]}" fake-shard --spec "$spec" --arm "$arm" --out "$shard" $([ "$fake_break" = "$arm" ] && echo --break) >> "$out/run-tier.log" 2>&1; rc=$?; set -e
  else
    local shard_args=(--prereg "$spec" --name "$arm" --cells "$(jq -r '[.cells[].id] | join(",")' "$spec")" --lease-usd "$left" --out "$shard" --clean-arm-preflight)
    # The plain arm runs no sidecar; it names a release image only because run-shard.sh records one.
    if [ "$arm" != plain ]; then shard_args+=(--gbrain-image "$(jq -r .image "$out/$arm/release.json")"); elif [ -n "$release_image" ]; then shard_args+=(--gbrain-image "$release_image"); fi
    [ "$prebuilt" -eq 0 ] || shard_args+=(--skip-build)
    log "shard $arm: scripts/run-shard.sh ${shard_args[*]}"
    set +e; scripts/run-shard.sh "${shard_args[@]}" > "$out/shard-$arm.log" 2>&1; rc=$?; set -e
    usd=$( [ -f "$shard/ledger.sqlite" ] && bun runner/proxy/metering-proxy.ts summary --budget-ledger "$shard/ledger.sqlite" --run-id "$(jq -r .run_id "$spec")" 2>/dev/null | jq -r '.committed_usd // 0' || echo 0)
  fi
  echo "$rc" > "$out/shards/$arm.rc"; echo "${usd:-0}" > "$out/shards/$arm.usd"
}
declare -A arm_lease=()
# stop_arms <signal>: a TERM or INT while the arms run, at once or in turn (each arm's subshell runs in the background and
# is waited for, so the handler runs as soon as the signal lands), sends TERM to every process under each arm's subshell, not
# only to its shard: scripts/run-shard.sh runs bun runner/run.ts in the foreground, and its own TERM trap acts only once
# that runner exits, so the runner has to be signalled itself. It waits up to 10 minutes, kills whatever still runs and
# exits non-zero, so no shard or runner keeps running after the tier is stopped. It removes the tier's trials.jsonl,
# which may hold only some of the shards' rows, so run.sh settles the tier at its whole reservation instead of $0 or a
# subtotal. The handler stays set until every arm's rows are in the tier's trials.jsonl.
running() { case $(ps -o stat= -p "$1" 2>/dev/null) in ""|Z*) return 1 ;; esac; }
proc_tree() { local p; for p in "$@"; do echo "$p"; proc_tree $(pgrep -P "$p" || true); done; }
stop_arms() {
  trap '' TERM INT
  log "stopped by SIG$1: stopping the arm shards"
  local p procs=() alive=() waited=0
  procs=($(proc_tree "${pids[@]}"))
  kill -TERM "${procs[@]}" 2>/dev/null || true
  for p in "${pids[@]}"; do wait "$p" 2>/dev/null || true; done
  for p in ${procs[@]+"${procs[@]}"}; do
    while [ "$waited" -lt 600 ] && running "$p"; do sleep 1; waited=$(( waited + 1 )); done
    ! running "$p" || alive+=("$p")
  done
  if [ ${#alive[@]} -gt 0 ]; then kill -KILL "${alive[@]}" 2>/dev/null || true; log "WARNING: shard processes ${alive[*]} still ran after 10 minutes; killed them"; else log "the arm shards stopped"; fi
  rm -f "$out/trials.jsonl"; log "removed the tier's trials.jsonl: the shards may have spent money it does not record, so the lease charges the whole reservation"
  if [ "$1" = INT ]; then exit 130; fi
  exit 143
}
pids=()
trap 'stop_arms TERM' TERM
trap 'stop_arms INT' INT
if [ "$together" -eq 1 ]; then
  for i in "${!run_arms[@]}"; do
    arm_lease[${run_arms[$i]}]=${shares[$i]}
    log "shard ${run_arms[$i]}: \$${shares[$i]} of \$$lease, run at the same time as the other arms"
    run_arm "${run_arms[$i]}" "${shares[$i]}" &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || true; done
else
  [ "${#run_arms[@]}" -le 1 ] || log "the arms run in turn: a weighted share (\$${shares[*]}) would be below one worst-case call reservation (\$8)"
fi
for arm in "${run_arms[@]}"; do
  shard="$out/shards/$arm"
  spec="$out/specs/$arm.prereg.json"
  if [ "$together" -eq 0 ]; then
    left=$(python3 -c 'import sys; print(f"{float(sys.argv[1]) - float(sys.argv[2]):.4f}")' "$lease" "$spent")
    if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) < 0.5 else 1)' "$left"; then log "lease stop: \$$left left of \$$lease before the $arm shard"; lease_stop=1; break; fi
    arm_lease[$arm]=$left
    run_arm "$arm" "$left" &
    pids=($!)
    wait "${pids[0]}" || true
  fi
  rc=$(cat "$shard.rc" 2>/dev/null || echo 2)
  arm_spent=$(cat "$shard.usd" 2>/dev/null || echo 0)
  spent=$(python3 -c 'import sys; print(f"{float(sys.argv[1]) + float(sys.argv[2]):.6f}")' "$spent" "${arm_spent:-0}")
  if [ -f "$shard/trials.jsonl" ] && ! "${canary[@]}" annotate --spec-dir "$out/specs" --arm "$arm" --shard "$shard" --out "$out/trials.jsonl" >> "$out/run-tier.log" 2>&1; then
    log "annotating the $arm shard failed ($out/run-tier.log)"; [ "$rc" -ne 0 ] || rc=2; spend_unknown=1
  elif [ ! -f "$shard/trials.jsonl" ] && python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) > 0 else 1)' "${arm_spent:-0}"; then
    log "the $arm shard spent \$${arm_spent} but wrote no trials.jsonl"; [ "$rc" -ne 0 ] || rc=2; spend_unknown=1
  fi
  audit=null
  if [ "$arm" = plain ] && [ "$fake" -eq 0 ] && [ -s "$shard/trials.jsonl" ]; then
    set +e; bun scripts/v04/clean-arm-audit.ts audit --results "$shard" --out "$shard/clean-arm-audit.json" > "$shard/clean-arm-audit.log" 2>&1; arc=$?; set -e
    audit=$(jq -nc --argjson rc "$arc" '{exit: $rc, file: "shards/plain/clean-arm-audit.json"}')
  fi
  shards=$(jq -c --arg arm "$arm" --argjson rc "$rc" --argjson usd "${arm_spent:-0}" --argjson lease_usd "${arm_lease[$arm]}" --argjson together "$([ "$together" -eq 1 ] && echo true || echo false)" --argjson n "$(grep -c . "$shard/trials.jsonl" 2>/dev/null || echo 0)" --argjson planned "$(jq '[.cells[] | (.tasks | length) * .repetitions] | add' "$spec")" --argjson audit "$audit" \
    '. + [{arm: $arm, exit: $rc, lease_usd: $lease_usd, at_once: $together, spent_usd: $usd, trials: $n, planned: $planned, clean_arm_audit: $audit}]' <<<"$shards")
  log "shard $arm exited $rc, \$${arm_spent:-0} spent, \$$spent in all"
  if [ "$rc" -eq 3 ]; then lease_stop=1; [ "$together" -eq 1 ] || break; continue; fi
  if [ "$rc" -ne 0 ]; then [ "$infra_rc" -ne 0 ] || infra_rc=$rc; [ "$together" -eq 1 ] || break; fi
done
trap - TERM INT
if [ "$spend_unknown" -eq 1 ]; then
  rm -f "$out/trials.jsonl"; log "removed the tier's trials.jsonl: an arm's spend is not all in it, so the lease charges the whole reservation"
fi
[ "$lease_stop" -eq 0 ] || end 20
[ "$infra_rc" -eq 0 ] || end "$infra_rc"
end 0
