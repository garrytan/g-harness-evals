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
# plain arm carries none of them), writes their sha256s to <out>/specs/canary-spec.json, and runs each arm as one
# scripts/run-shard.sh shard on this machine, in the order prev, new, plain, trials sequential, each with
# --clean-arm-preflight and the release's own image (harness-eval/gbrain:canary-<version>). Each shard's lease is what is
# left of --lease-usd after the shards before it, read from their ledgers, so the run never spends past it. It then writes
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
lease_stop=0 infra_rc=0 spent=0
write_summary() {
  jq -n --arg tier "$tier" --arg run_id "$run_id" --argjson lease "$lease" --argjson spent "$spent" --argjson shards "$shards" \
    --argjson fake "$([ "$fake" -eq 1 ] && echo true || echo false)" --argjson exit "$1" --slurpfile spec "$out/specs/canary-spec.json" \
    --argjson trials "$(grep -c . "$out/trials.jsonl" || true)" \
    '{suite: "gbrain", tier: $tier, run_id: $run_id, fake: $fake, lease_usd: $lease, spent_usd: $spent, trials: $trials, exit: $exit, specs: ($spec[0].arms | map_values({spec_sha256, release})), shards: $shards}' > "$out/run-tier.json"
}
end() { write_summary "$1"; log "wrote $out/trials.jsonl ($(grep -c . "$out/trials.jsonl" || true) trials) and $out/run-tier.json, exit $1"; exit "$1"; }

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

# 2. One shard per arm, sequential, each under what is left of the lease.
built_harness=0
for arm in prev new plain; do
  case ",$arms," in *,"$arm",*) ;; *) continue ;; esac
  shard="$out/shards/$arm"
  spec="$out/specs/$arm.prereg.json"
  cells=$(jq -r '[.cells[].id] | join(",")' "$spec")
  left=$(python3 -c 'import sys; print(f"{float(sys.argv[1]) - float(sys.argv[2]):.4f}")' "$lease" "$spent")
  if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) < 0.5 else 1)' "$left"; then log "lease stop: \$$left left of \$$lease before the $arm shard"; lease_stop=1; break; fi
  if [ "$fake" -eq 1 ]; then
    set +e; "${canary[@]}" fake-shard --spec "$spec" --arm "$arm" --out "$shard" $([ "$fake_break" = "$arm" ] && echo --break) >> "$out/run-tier.log" 2>&1; rc=$?; set -e
    arm_spent=0
  else
    shard_args=(--prereg "$spec" --name "$arm" --cells "$cells" --lease-usd "$left" --out "$shard" --clean-arm-preflight)
    if [ "$arm" = plain ]; then
      # The plain arm runs no sidecar; after a release shard it reuses that shard's harness images and names its image only
      # because run-shard.sh records one.
      if [ "$built_harness" -eq 1 ]; then shard_args+=(--skip-build --gbrain-image "$(jq -r .image "$out/$last_release/release.json")"); fi
    else
      shard_args+=(--gbrain-image "$(jq -r .image "$out/$arm/release.json")")
    fi
    log "shard $arm: scripts/run-shard.sh ${shard_args[*]}"
    set +e; scripts/run-shard.sh "${shard_args[@]}" > "$out/shard-$arm.log" 2>&1; rc=$?; set -e
    arm_spent=$( [ -f "$shard/ledger.sqlite" ] && bun runner/proxy/metering-proxy.ts summary --budget-ledger "$shard/ledger.sqlite" --run-id "$run_id" 2>/dev/null | jq -r '.committed_usd // 0' || echo 0)
    [ "$arm" = plain ] || { built_harness=1; last_release=$arm; }
  fi
  spent=$(python3 -c 'import sys; print(f"{float(sys.argv[1]) + float(sys.argv[2]):.6f}")' "$spent" "${arm_spent:-0}")
  if [ -f "$shard/trials.jsonl" ] && ! "${canary[@]}" annotate --spec-dir "$out/specs" --arm "$arm" --shard "$shard" --out "$out/trials.jsonl" >> "$out/run-tier.log" 2>&1; then
    log "annotating the $arm shard failed ($out/run-tier.log)"; [ "$rc" -ne 0 ] || rc=2
  fi
  audit=null
  if [ "$arm" = plain ] && [ "$fake" -eq 0 ] && [ -s "$shard/trials.jsonl" ]; then
    set +e; bun scripts/v04/clean-arm-audit.ts audit --results "$shard" --out "$shard/clean-arm-audit.json" > "$shard/clean-arm-audit.log" 2>&1; arc=$?; set -e
    audit=$(jq -nc --argjson rc "$arc" '{exit: $rc, file: "shards/plain/clean-arm-audit.json"}')
  fi
  shards=$(jq -c --arg arm "$arm" --argjson rc "$rc" --argjson usd "${arm_spent:-0}" --argjson n "$(grep -c . "$shard/trials.jsonl" 2>/dev/null || echo 0)" --argjson planned "$(jq '[.cells[] | (.tasks | length) * .repetitions] | add' "$spec")" --argjson audit "$audit" \
    '. + [{arm: $arm, exit: $rc, spent_usd: $usd, trials: $n, planned: $planned, clean_arm_audit: $audit}]' <<<"$shards")
  log "shard $arm exited $rc, \$${arm_spent:-0} spent, \$$spent in all"
  if [ "$rc" -eq 3 ]; then lease_stop=1; break; fi
  if [ "$rc" -ne 0 ]; then infra_rc=$rc; break; fi
done
[ "$lease_stop" -eq 0 ] || end 20
[ "$infra_rc" -eq 0 ] || end "$infra_rc"
end 0
