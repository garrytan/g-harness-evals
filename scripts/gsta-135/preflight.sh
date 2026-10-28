#!/usr/bin/env bash
# internal-task free preflight (no model calls, no key): the spec's checks against
# the three overlay images, run as the host uid with the same mounts as a
# trial so a permission failure shows up free, plus the keyless OpenClaw exec
# probe that settles which skills root the exec turn reads. Every model request
# goes to the repository's fake Anthropic endpoint (scripts/gsta-135/fake-
# anthropic.ts) bound to the docker bridge gateway, the address containers
# reach as host.docker.internal; it holds no credential.
#
#   scripts/gsta-135/preflight.sh [--pin bd8907d6] [--only openclaw,hermes,qm] [--roots parent,exec,both]
#
# Output: results/gsta-135/preflight/<harness>.log (everything), the probe
# directories beside it, and one PREFLIGHT: <harness> <ok|fail> <detail> line
# per harness on stdout. Exit 1 when any harness fails.
set -euo pipefail
cd "$(dirname "$0")/../.."

pin=bd8907d6 only=openclaw,hermes,qm roots=parent,exec,both
while [ $# -gt 0 ]; do
  case "$1" in
    --pin) pin=$2; shift 2 ;;
    --only) only=$2; shift 2 ;;
    --roots) roots=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
out=results/gsta-135/preflight
mkdir -p "$out"
task=$out/probe-task
rm -rf "$task" && mkdir -p "$task/grader" "$task/workspace"
printf 'slice = "coding"\ntime_budget_s = 120\n' > "$task/task.toml"
echo 'Say ok.' > "$task/instruction.md"
printf '#!/usr/bin/env bash\necho PASS\nexit 0\n' > "$task/grader/check.sh" && chmod +x "$task/grader/check.sh"

gateway=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
port=8798
reqlog=$out/fake-requests.ndjson
: > "$reqlog"
bun scripts/gsta-135/fake-anthropic.ts --host "$gateway" --port "$port" --log "$reqlog" > "$out/fake-anthropic.log" 2>&1 &
fake_pid=$!
trap 'kill "$fake_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do grep -q listening "$out/fake-anthropic.log" 2>/dev/null && break; sleep 0.2; done
grep -q listening "$out/fake-anthropic.log" || { echo "fake endpoint did not start: $(cat "$out/fake-anthropic.log")" >&2; exit 1; }
base_url="http://host.docker.internal:$port/anthropic"
uid=$(id -u) gid=$(id -g)
failed=0

# in_image <harness> <state dir> <log dir> <script>: a bash in the overlay
# image as the host uid with the trial's mounts, HOME at the state dir.
in_image() {
  docker run --rm --user "$uid:$gid" --entrypoint bash -v "$2:/harness-state" -v "$3:/he-logs" -v "$(cd "$task/workspace" && pwd):/workspace" \
    -e HOME=/harness-state -e HE_SESSION_STATE_DIR=/harness-state -e HE_LOG_DIR=/he-logs "harness-eval/$1:gstack-$pin" -c "$4"
}

# probe <harness> <name> <extra docker -e flags...>: one keyless turn through
# run-trial.sh's exact docker run (same flags, same mounts) with the wrapper
# in front, against the fake endpoint; records the requests it produced.
probe() {
  local h=$1 name=$2; shift 2
  local dir=$out/probe-$name abs n0
  rm -rf "$dir" && mkdir -p "$dir/workspace" "$dir/state" "$dir/logs"
  cp "$task/instruction.md" "$dir/workspace/"
  abs=$(cd "$dir" && pwd)
  n0=$(wc -l < "$reqlog")
  set +e
  timeout -k 10 180 docker run -i --rm --name "he-$name" --user "$uid:$gid" --network bridge --add-host host.docker.internal:host-gateway \
    -v "$abs/workspace:/workspace" -v "$abs/state:/harness-state" -v "$abs/logs:/he-logs" \
    -e HE_MODEL_BASE_URL="$base_url" -e HE_MODEL_API_KEY="trial-token:$name" -e HE_MODEL_NAME=claude-opus-5-5 \
    -e HE_TIME_BUDGET_S=120 -e HE_LOG_DIR=/he-logs -e HE_SESSION_STATE_DIR=/harness-state -e HE_TASK_SLICE=coding -e HE_TRIAL_ID="$name" \
    "$@" "harness-eval/$h:gstack-$pin" run </dev/null > "$dir/logs/docker-stdout.log" 2> "$dir/logs/docker-stderr.log"
  echo "probe $name: adapter exit $?"
  set -e
  tail -n +"$((n0 + 1))" "$reqlog" > "$dir/requests.ndjson"
  python3 scripts/gsta-135/system-prompt.py "$dir/requests.ndjson" "$h" || true
  grep -h 'gstack-wrap\[' "$dir/logs/gstack-register.log" 2>/dev/null | cut -c1-240 || true
}

check() { # check <label> <got> <want...>: one line per expectation
  local label=$1 got=$2; shift 2
  for want in "$@"; do
    if printf '%s' "$got" | grep -q -- "$want"; then echo "  ok   $label: $want"; else echo "  FAIL $label: wanted '$want' in: $(printf '%s' "$got" | head -c 400)"; failed=1; fi
  done
}

for h in ${only//,/ }; do
  log=$out/$h.log
  : > "$log"
  failed=0
  {
    echo "== preflight $h image harness-eval/$h:gstack-$pin $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    docker image inspect "harness-eval/$h:gstack-$pin" -f 'image {{.Id}} labels {{.Config.Labels}}'
    case "$h" in
      openclaw|hermes)
        # The exec probe first: the wrapper registers as a trial would, the
        # harness runs one turn against the fake endpoint, and the state dir
        # it leaves is what the free checks below inspect.
        probe "$h" "$h-probe"
        p=$out/probe-$h-probe
        sysinfo=$(python3 scripts/gsta-135/system-prompt.py "$p/requests.ndjson" "$h" || true)
        check "exec probe: one model turn" "$sysinfo" 'message_requests=[1-9]'
        check "exec probe: model named claude-opus-5-5" "$sysinfo" 'model=claude-opus-5-5'
        reg=$(cat "$p/logs/gstack-register.log")
        check "setup ready line" "$reg" "gstack ready ($h)"
        check "gstack-harness status visible" "$reg" 'visible to harness: yes'
        check "wrapper budget hand-off" "$reg" 'handing the adapter'
        if [ "$h" = openclaw ]; then
          check "exec probe: gstack router skill in the system prompt" "$sysinfo" 'openclaw_gstack_skill_locations=~/openclaw/skills/gstack/SKILL.md'
          listed=$(in_image openclaw "$(cd "$p/state" && pwd)" "$(cd "$p/logs" && pwd)" 'OPENCLAW_STATE_DIR=/harness-state/openclaw openclaw skills list --json 2>/dev/null' \
            | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps([{k:s.get(k) for k in ("source","eligible","modelVisible")} for s in d["skills"] if s.get("name")=="gstack"]))')
          echo "openclaw skills list --json gstack row: $listed"
          check "skills list row" "$listed" '"source": "openclaw-managed"' '"eligible": true' '"modelVisible": true'
          # The root question, by difference: exec root alone, parent root alone, both.
          for r in ${roots//,/ }; do
            probe openclaw "openclaw-roots-$r" -e HE_GSTACK_OPENCLAW_ROOTS="$r"
          done
          for r in ${roots//,/ }; do
            loc=$(python3 scripts/gsta-135/system-prompt.py "$out/probe-openclaw-roots-$r/requests.ndjson" openclaw | sed -n 's/^openclaw_gstack_skill_locations=//p')
            echo "root probe roots=$r: gstack skill location in the first turn's system prompt: $loc"
          done
        else
          check "exec probe: gstack category in the system prompt" "$sysinfo" 'hermes_gstack_category=yes' 'hermes_gstack_router_row=yes'
          listing=$(in_image hermes "$(cd "$p/state" && pwd)" "$(cd "$p/logs" && pwd)" 'HERMES_HOME=/harness-state/hermes hermes skills list 2>/dev/null')
          printf '%s\n' "$listing" > "$out/$h-skills-list.txt"
          nrows=$(printf '%s\n' "$listing" | grep -c 'gstack-' || true)
          echo "hermes skills list: $nrows rows matching gstack-; footer: $(printf '%s\n' "$listing" | grep -i 'local' | tail -1)"
          check "skills list rows" "$nrows" '^6[0-9]$'
          check "skills list footer" "$(printf '%s\n' "$listing" | tail -3)" 'local'
        fi
        smoke=$(in_image "$h" "$(cd "$p/state" && pwd)" "$(cd "$p/logs" && pwd)" 'env -i PATH=$PATH HOME=$HOME bash -c "/opt/gstack/bin/gstack-skill-start --skill review --model claude" | head -1')
        echo "helper smoke: $smoke"
        check "helper smoke" "$smoke" 'SKILL_START_PROTO: 1'
        ;;
      qm)
        # The whole compose stack with the overlay task image, one keyless turn;
        # the wrapper publishes the pack through core's admin API first.
        rm -rf "$out/probe-qm"
        set +e
        bash harnesses/run-trial.sh --harness qm --image "harness-eval/qm:gstack-$pin" --task "$task" --trial-id qm-probe \
          --base-url "$base_url" --api-key trial-token:qm-probe --model claude-opus-5-5 --out "$out/probe-qm" > "$out/probe-qm.run.log" 2>&1
        echo "run-trial exit $?"
        set -e
        cat "$out/probe-qm/result.json" 2>/dev/null || true; echo
        reg=$(cat "$out/probe-qm/logs/gstack-register.log" 2>/dev/null || echo '(no gstack-register.log)')
        printf '%s\n' "$reg" | cut -c1-400
        check qm "register receipt" "$reg" 'gstack-harness: QM: pack .* (installed\|unchanged)'
        check qm "wrapper budget hand-off" "$reg" 'handing the adapter'
        sysinfo=$(python3 scripts/gsta-135/system-prompt.py "$reqlog" qm || true)
        echo "$sysinfo"
        check qm "one model turn reached the endpoint" "$sysinfo" 'message_requests=[1-9]'
        ;;
    esac
  } >> "$log" 2>&1 || { echo "  FAIL $h: a step exited non-zero (see $log)" >> "$log"; failed=1; }
  if [ "$failed" -eq 0 ]; then echo "PREFLIGHT: $h ok $(grep -c '^  ok ' "$log") checks ($log)"; else echo "PREFLIGHT: $h fail $(grep '^  FAIL' "$log" | head -3 | tr '\n' ';') ($log)"; any_failed=1; fi
done
exit ${any_failed:-0}
