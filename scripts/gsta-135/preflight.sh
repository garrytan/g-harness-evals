#!/usr/bin/env bash
# Skill-use panel free preflight (no model calls, no key): the spec's checks against
# the overlay images, run as the host uid with the same mounts as a trial so a
# permission failure shows up free, plus the keyless probes that settle what a
# paid trial would see. Every model request goes to the repository's fake
# Anthropic endpoint (scripts/gsta-135/fake-anthropic.ts) bound to the docker
# bridge gateway, the address containers reach as host.docker.internal; it
# holds no credential.
#
#   scripts/gsta-135/preflight.sh [--pin bd8907d6] [--only openclaw,hermes,qm] [--roots parent,exec,both]
#                                 [--hermes-mode oneshot|chat] [--max-tokens 128000] [--start-hook] [--no-negative]
#
# Per harness (openclaw, hermes):
#   1. the exec probe: one plain turn through run-trial.sh's exact docker run;
#      registration receipts, the skill in the system prompt, the skills list.
#   2. the runtime smoke (fake-anthropic.ts --script): the fake asks the
#      harness's own shell tool (OpenClaw exec, Hermes terminal) for an
#      environment dump and the Bun-backed probe, and the second request's
#      tool_result is the harness's own view: GSTACK_SESSION_KIND=spawned,
#      GSTACK_EPHEMERAL=1, a fresh GSTACK_STATE_ROOT, no GSTACK_CAPY, the
#      harness's state dir, bun's version, 'gstack-harness status' (visible to
#      harness: yes), 'gstack-skill-start' (SKILL_START_PROTO: 1, SESSION_KIND:
#      spawned, no INSTALL: warn or fail row), exit 0. The first and the
#      post-tool request must carry max_tokens = the pin (--max-tokens).
#   3. the missing-Bun negative (unless --no-negative): the same image with
#      PATH stripped of /opt/bun/bin must log 'runtime: degraded' and stop
#      with exit 2 before any model request.
#   Hermes in chat mode (--hermes-mode chat, image :gstack-<pin>-chat) also:
#   4. the system prompt must carry the interactive skills guidance ("you
#      MUST load it") and not the one-shot block, and the tool's view must
#      show HERMES_SINGLE_QUERY_SESSION unset; and
#   5. the flagged-command smoke: the fake asks for 'rm -rf <path>'; the
#      approval card must fail closed (BLOCKED in the tool result) and the
#      trial still end with exit 0 and a complete transcript (evidence.ts).
#   The start hook: --start-hook runs the hook images,
#   harness-eval/openclaw:gstack-<pin>-hook and harness-eval/hermes:gstack-
#   <pin>-hook(-chat), built with --build-arg GSTACK_START_HOOK=on. On every
#   image the exec probe reads org.harness-eval.gstack.start_hook (absent is
#   off): on, the wrapper must log `start_hook: on active` and the first
#   agent-turn request the fake receives (the first /v1/messages with tools)
#   must carry gstack's START_NOTE; off, the wrapper logs `start_hook: off`
#   and no request carries it. Hermes sends its session-title call (no tools,
#   max_tokens 512) at the same moment as the turn and pre_llm_call does not
#   reach it, so the note is checked on the agent turn and the very first
#   request is reported beside it. The OpenClaw root probes other than parent
#   are skipped on a hook image (the wrapper refuses them). With the
#   negatives on, every gstack image also gets the pinned-tree negative: the
#   image env naming another commit (GSTACK_IMAGE_COMMIT) must stop with exit 2
#   before any model request.
#   When a chat-mode check fails the summary also prints
#   'HERMES: not measured (<reason>)': the panel then runs OpenClaw only.
#
# Output: results/gsta-135/preflight/<tag>.log (everything), the probe
# directories beside it (requests.ndjson, logs/, state/), one
# PREFLIGHT: <tag> <ok|fail> <detail> line per harness on stdout, and
# results/gsta-135/preflight/runtime-preflight.json, a flat object keyed by
# the image tag each harness ran (harness-eval/<h>:gstack-<pin8>, or
# ...-chat for Hermes in chat mode) with "pass" or "fail", merged over runs
# so --only and --hermes-mode runs add up: it is what discovery.sh's
# --runtime-preflight reads to skip a failed image as infra:runtime. Exit 1
# when any harness fails. Fake endpoints bind the bridge gateway on ports
# 8798 (plain) and 8799 upward (one per scripted probe).
set -euo pipefail
cd "$(dirname "$0")/../.."

pin=bd8907d6 only=openclaw,hermes,qm roots=parent,exec,both hermes_mode=oneshot max_tokens=128000 negative=1 start_hook=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pin) pin=$2; shift 2 ;;
    --only) only=$2; shift 2 ;;
    --roots) roots=$2; shift 2 ;;
    --hermes-mode) hermes_mode=$2; shift 2 ;;
    --max-tokens) max_tokens=$2; shift 2 ;;
    --no-negative) negative=0; shift ;;
    --start-hook) start_hook=1; shift ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
case "$hermes_mode" in oneshot|chat) ;; *) echo "--hermes-mode must be oneshot or chat" >&2; exit 64 ;; esac
out=results/gsta-135/preflight
mkdir -p "$out"
task=$out/probe-task
rm -rf "$task" && mkdir -p "$task/grader" "$task/workspace"
printf 'slice = "coding"\ntime_budget_s = 120\n' > "$task/task.toml"
echo 'Say ok.' > "$task/instruction.md"
printf '#!/usr/bin/env bash\necho PASS\nexit 0\n' > "$task/grader/check.sh" && chmod +x "$task/grader/check.sh"

gateway=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
uid=$(id -u) gid=$(id -g)
fake_pids=()
trap 'kill "${fake_pids[@]}" 2>/dev/null || true' EXIT

# start_fake <port> <request log> [--script <file>]: one fake endpoint; its
# pid is appended to fake_pids.
start_fake() {
  local port=$1 log=$2; shift 2
  : > "$log"
  bun scripts/gsta-135/fake-anthropic.ts --host "$gateway" --port "$port" --log "$log" "$@" > "$log.fake.log" 2>&1 &
  fake_pids+=($!)
  for _ in $(seq 1 50); do grep -q listening "$log.fake.log" 2>/dev/null && break; sleep 0.2; done
  grep -q listening "$log.fake.log" || { echo "fake endpoint on port $port did not start: $(cat "$log.fake.log")" >&2; exit 1; }
}
port=8798
reqlog=$out/fake-requests.ndjson
start_fake "$port" "$reqlog"
next_port=8799

# The scripted turns. The probe command runs in the harness's shell tool and
# prints the environment the tool sees, bun's version, gstack-harness status,
# the skill-start preamble's receipt lines and its own exit code.
probe_cmd='env | grep -E "^(GSTACK_|OPENCLAW_STATE_DIR|HERMES_HOME)"; echo HERMES_SINGLE_QUERY_SESSION=${HERMES_SINGLE_QUERY_SESSION-unset}; echo bun_version=$(bun --version 2>&1); bun --version > /dev/null && /opt/gstack/bin/gstack-harness status && /opt/gstack/bin/gstack-skill-start --skill review --model claude > /tmp/he-skill-start.txt; rc=$?; grep -E "^(SKILL_START_PROTO|INSTALL|SESSION_KIND|STATE_ROOT|CAPY):" /tmp/he-skill-start.txt; echo HE_PROBE_EXIT=$rc'
runtime_script=$out/script-runtime.json
python3 -c 'import json,sys; print(json.dumps([{"tool": sys.argv[1]}, {"text": "Done."}]))' "$probe_cmd" > "$runtime_script"
# The flagged smoke's first command is the red team's move: type 'y' at the
# old FIFO path under /he-logs and at the agent shell's own fd 3, before the
# flagged command parks its card. Neither is the session's stdin any more (the
# FIFO is in a private directory, and fd 3 is closed in the session, so the
# agent shell has no fd 3), so the card must still fail closed. The writes are
# synchronous: Hermes's terminal tool rejects '&' backgrounding.
flagged_script=$out/script-flagged.json
printf '%s\n' '[{"tool": "printf \"y\\r\" >> /he-logs/hermes-chat.fifo 2>&1 || true; printf \"y\\r\" > /proc/self/fd/3 2>&1 || echo no-fd-3; echo writer_done"}, {"tool": "rm -rf /tmp/he-flagged-probe"}, {"text": "Done."}]' > "$flagged_script"
# The image's PATH without Bun, for the negative.
image_path_without_bun() { docker image inspect "$1" -f '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PATH=//p' | sed 's|/opt/bun/bin:||'; }

hook_suffix=''; [ "$start_hook" = 0 ] || hook_suffix=-hook
image_of() { if [ "$1" = hermes ] && [ "$hermes_mode" = chat ]; then echo "harness-eval/hermes:gstack-$pin$hook_suffix-chat"; else echo "harness-eval/$1:gstack-$pin$hook_suffix"; fi; }
# start_note <requests.ndjson>: whether gstack's start-hook note (START_NOTE in
# lib/harness-start-hook.ts) is on the first agent-turn request (the first
# /v1/messages with tools), on the very first /v1/messages, and how many
# requests carry it.
start_note() {
  python3 - "$1" <<'PY'
import json, sys
note = "gstack: if you use a gstack skill this turn, first run the gstack-skill-start command"
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
msgs = [r for r in rows if r.get("path", "").endswith("/v1/messages") and isinstance(r.get("body"), dict)]
turns = [r for r in msgs if r["body"].get("tools")]
has = lambda r: note in json.dumps(r["body"], ensure_ascii=False)
print("first_turn_note=%s" % ("none" if not turns else "yes" if has(turns[0]) else "no"))
print("first_request_note=%s (%s, max_tokens %s)" % ("none" if not msgs else "yes" if has(msgs[0]) else "no", "agent turn" if msgs and msgs[0]["body"].get("tools") else "no tools" if msgs else "-", msgs[0]["body"].get("max_tokens") if msgs else "-"))
print("requests_with_note=%d of %d" % (sum(has(r) for r in msgs), len(msgs)))
PY
}
base_url="http://host.docker.internal:$port/anthropic"
failed=0
probe_exit=

# in_image <harness> <state dir> <log dir> <script>: a bash in the overlay
# image as the host uid with the trial's mounts, HOME at the state dir.
in_image() {
  docker run --rm --user "$uid:$gid" --entrypoint bash -v "$2:/harness-state" -v "$3:/he-logs" -v "$(cd "$task/workspace" && pwd):/workspace" \
    -e HOME=/harness-state -e HE_SESSION_STATE_DIR=/harness-state -e HE_LOG_DIR=/he-logs "$(image_of "$1")" -c "$4"
}

# probe <harness> <name> <script file or -> <extra docker -e flags...>: one
# keyless turn through run-trial.sh's exact docker run (same flags, same
# mounts) with the wrapper in front, against the plain fake (script -) or a
# fresh scripted fake on the next port; records the requests it produced in
# the probe directory and the adapter's exit code in probe_exit.
probe() {
  local h=$1 name=$2 script=$3; shift 3
  local dir=$out/probe-$name abs n0 url=$base_url
  rm -rf "$dir" && mkdir -p "$dir/workspace" "$dir/state" "$dir/logs"
  cp "$task/instruction.md" "$dir/workspace/"
  abs=$(cd "$dir" && pwd)
  if [ "$script" != - ]; then
    start_fake "$next_port" "$dir/requests.ndjson" --script "$script"
    url="http://host.docker.internal:$next_port/anthropic"
    next_port=$((next_port + 1))
  else
    n0=$(wc -l < "$reqlog")
  fi
  set +e
  timeout -k 10 180 docker run -i --rm --name "he-a-$name" --user "$uid:$gid" --network bridge --add-host host.docker.internal:host-gateway \
    -v "$abs/workspace:/workspace" -v "$abs/state:/harness-state" -v "$abs/logs:/he-logs" \
    -e HE_MODEL_BASE_URL="$url" -e HE_MODEL_API_KEY="trial-token:$name" -e HE_MODEL_NAME=claude-opus-5-5 \
    -e HE_TIME_BUDGET_S=120 -e HE_LOG_DIR=/he-logs -e HE_SESSION_STATE_DIR=/harness-state -e HE_TASK_SLICE=coding -e HE_TRIAL_ID="$name" \
    "$@" "$(image_of "$h")" run </dev/null > "$dir/logs/docker-stdout.log" 2> "$dir/logs/docker-stderr.log"
  probe_exit=$?
  set -e
  echo "probe $name: adapter exit $probe_exit"
  if [ "$script" != - ]; then kill "${fake_pids[-1]}" 2>/dev/null || true; else tail -n +"$((n0 + 1))" "$reqlog" > "$dir/requests.ndjson"; fi
  python3 scripts/gsta-135/system-prompt.py "$dir/requests.ndjson" "$h" || true
  grep -h 'gstack-wrap\[' "$dir/logs/gstack-register.log" 2>/dev/null | cut -c1-240 || true
}

check() { # check <label> <got> <want...>: one line per expectation (grep patterns, line-anchored)
  local label=$1 got=$2; shift 2
  for want in "$@"; do
    if printf '%s\n' "$got" | grep -q -- "$want"; then echo "  ok   $label: $want"; else echo "  FAIL $label: wanted '$want' in: $(printf '%s' "$got" | head -c 400)"; failed=1; fi
  done
}
check_absent() { # check_absent <label> <got> <pattern...>: the pattern must not match
  local label=$1 got=$2; shift 2
  for bad in "$@"; do
    if printf '%s\n' "$got" | grep -q -- "$bad"; then echo "  FAIL $label: found '$bad' in: $(printf '%s\n' "$got" | grep -- "$bad" | head -3 | tr '\n' ';')"; failed=1; else echo "  ok   $label: no $bad"; fi
  done
}

for h in ${only//,/ }; do
  tag=$h; [ "$h" = hermes ] && tag=hermes-$hermes_mode
  log=$out/$tag.log
  : > "$log"
  failed=0
  {
    echo "== preflight $tag image $(image_of "$h") $(date -u +%Y-%m-%dT%H:%M:%SZ) max_tokens pin $max_tokens"
    docker image inspect "$(image_of "$h")" -f 'image {{.Id}} labels {{.Config.Labels}}'
    case "$h" in
      openclaw|hermes)
        # The exec probe first: the wrapper registers as a trial would, the
        # harness runs one turn against the fake endpoint, and the state dir
        # it leaves is what the free checks below inspect.
        probe "$h" "$tag-probe" -
        p=$out/probe-$tag-probe
        check "exec probe: adapter exit" "$probe_exit" '^0$'
        sysinfo=$(python3 scripts/gsta-135/system-prompt.py "$p/requests.ndjson" "$h" || true)
        check "exec probe: one model turn" "$sysinfo" 'message_requests=[1-9]'
        check "exec probe: model named claude-opus-5-5" "$sysinfo" 'model=claude-opus-5-5'
        check "exec probe: max_tokens pin on the first request" "$sysinfo" "^max_tokens=$max_tokens$"
        reg=$(cat "$p/logs/gstack-register.log")
        check "setup ready line" "$reg" "gstack ready ($h)"
        check "gstack-harness status visible" "$reg" 'visible to harness: yes'
        check "wrapper budget hand-off" "$reg" 'handing the adapter'
        check "test-run marker line logged" "$reg" 'marker: harnesses/_gstack/wrapper-lib.sh:[0-9][0-9]* GSTACK_SESSION_KIND=spawned GSTACK_EPHEMERAL=1 GSTACK_STATE_ROOT=/harness-state/.gstack GSTACK_CAPY=unset'
        check "wrapper runtime check" "$reg" 'runtime: ok bun 1\.'
        hook_label=$(docker image inspect "$(image_of "$h")" -f '{{index .Config.Labels "org.harness-eval.gstack.start_hook"}}' 2>/dev/null || true)
        notes=$(start_note "$p/requests.ndjson" || true)
        echo "start hook: image label start_hook=${hook_label:-<absent, off>}; $(printf '%s\n' "$notes" | tr '\n' ' ')"
        if [ "$hook_label" = on ]; then
          check "start hook: wrapper gate" "$reg" 'start_hook: on active'
          check "start hook: setup receipt" "$reg" 'start hook: active'
          check "start hook: the note on the first agent-turn request" "$notes" '^first_turn_note=yes$'
        else
          check "start hook off: wrapper line" "$reg" 'start_hook: off '
          check "start hook off: no request carries the note" "$notes" '^first_turn_note=no$' '^requests_with_note=0 of'
        fi
        if [ "$h" = openclaw ]; then
          check "exec probe: gstack router skill in the system prompt" "$sysinfo" 'openclaw_gstack_skill_locations=~/openclaw/skills/gstack/SKILL.md'
          listed=$(in_image openclaw "$(cd "$p/state" && pwd)" "$(cd "$p/logs" && pwd)" 'OPENCLAW_STATE_DIR=/harness-state/openclaw openclaw skills list --json 2>/dev/null' \
            | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps([{k:s.get(k) for k in ("source","eligible","modelVisible")} for s in d["skills"] if s.get("name")=="gstack"]))')
          echo "openclaw skills list --json gstack row: $listed"
          check "skills list row" "$listed" '"source": "openclaw-managed"' '"eligible": true' '"modelVisible": true'
          # The root question, by difference: exec root alone, parent root alone, both.
          for r in ${roots//,/ }; do
            [ "$hook_label" != on ] || [ "$r" = parent ] || { echo "root probe roots=$r: skipped (a start hook image refuses roots other than parent)"; continue; }
            probe openclaw "openclaw-roots-$r" - -e HE_GSTACK_OPENCLAW_ROOTS="$r"
          done
          for r in ${roots//,/ }; do
            [ "$hook_label" != on ] || [ "$r" = parent ] || continue
            loc=$(python3 scripts/gsta-135/system-prompt.py "$out/probe-openclaw-roots-$r/requests.ndjson" openclaw | sed -n 's/^openclaw_gstack_skill_locations=//p')
            echo "root probe roots=$r: gstack skill location in the first turn's system prompt: $loc"
          done
        else
          check "exec probe: gstack category in the system prompt" "$sysinfo" 'hermes_gstack_category=yes' 'hermes_gstack_router_row=yes'
          if [ "$hermes_mode" = chat ]; then
            check "chat mode: interactive skills guidance, no one-shot block" "$sysinfo" 'hermes_interactive_guidance=yes' 'hermes_oneshot_block=no'
            check "chat mode: approval disposition logged" "$reg" 'approval: approvals.mode=manual approvals.timeout=1'
            echo "chat mode, interactive session side effects (ceo-native-7) from the prompt dump: $(printf '%s\n' "$sysinfo" | grep -E '^hermes_(skill_manage_tool|self_improvement_coaching|delegate_tool|clarify_tool)=' | tr '\n' ' ')"
          else
            check "oneshot mode: one-shot skills block, no interactive guidance" "$sysinfo" 'hermes_interactive_guidance=no' 'hermes_oneshot_block=yes'
          fi
          listing=$(in_image hermes "$(cd "$p/state" && pwd)" "$(cd "$p/logs" && pwd)" 'HERMES_HOME=/harness-state/hermes hermes skills list 2>/dev/null')
          printf '%s\n' "$listing" > "$out/$tag-skills-list.txt"
          nrows=$(printf '%s\n' "$listing" | grep -c 'gstack-' || true)
          echo "hermes skills list: $nrows rows matching gstack-; footer: $(printf '%s\n' "$listing" | grep -i 'local' | tail -1)"
          check "skills list rows" "$nrows" '^6[0-9]$'
          check "skills list footer" "$(printf '%s\n' "$listing" | tail -3)" 'local'
        fi
        smoke=$(in_image "$h" "$(cd "$p/state" && pwd)" "$(cd "$p/logs" && pwd)" 'env -i PATH=$PATH HOME=$HOME bash -c "/opt/gstack/bin/gstack-skill-start --skill review --model claude" | head -1')
        echo "helper smoke: $smoke"
        check "helper smoke" "$smoke" 'SKILL_START_PROTO: 1'

        # The runtime smoke through the harness's own shell tool.
        probe "$h" "$tag-runtime" "$runtime_script"
        r=$out/probe-$tag-runtime
        check "runtime smoke: adapter exit" "$probe_exit" '^0$'
        sysinfo=$(python3 scripts/gsta-135/system-prompt.py "$r/requests.ndjson" "$h" || true)
        check "runtime smoke: two turn requests, the second with the tool result" "$sysinfo" 'turn_requests=2' 'post_tool_result=yes'
        check "runtime smoke: max_tokens pin on the first request" "$sysinfo" "^max_tokens=$max_tokens$"
        check "runtime smoke: max_tokens pin on the post-tool request" "$sysinfo" "^post_tool_max_tokens=$max_tokens$"
        result=$(python3 scripts/gsta-135/system-prompt.py "$r/requests.ndjson" "$h" --tool-result || echo '(no tool result)')
        printf '%s\n' "$result" > "$r/tool-result.txt"
        echo "runtime smoke: the tool result ($r/tool-result.txt):"; printf '%s\n' "$result" | sed 's/^/    | /'
        check "marker in the tool's own view" "$result" '^GSTACK_SESSION_KIND=spawned$' '^GSTACK_EPHEMERAL=1$' '^GSTACK_STATE_ROOT=/harness-state/.gstack$'
        check_absent "GSTACK_CAPY never set" "$result" '^GSTACK_CAPY='
        if [ "$h" = openclaw ]; then check "fresh state dir in the tool's view" "$result" '^OPENCLAW_STATE_DIR=/harness-state/openclaw'; else check "fresh state dir in the tool's view" "$result" '^HERMES_HOME=/harness-state/hermes$'; fi
        if [ "$h" = hermes ]; then
          if [ "$hermes_mode" = chat ]; then check "chat mode: no HERMES_SINGLE_QUERY_SESSION in the tool's view" "$result" '^HERMES_SINGLE_QUERY_SESSION=unset$'; else check "oneshot mode: HERMES_SINGLE_QUERY_SESSION=1 in the tool's view" "$result" '^HERMES_SINGLE_QUERY_SESSION=1$'; fi
        fi
        check "bun on the tool's PATH" "$result" '^bun_version=1\.[0-9][0-9]*\.[0-9]'
        # gstack-harness status checks visibility by running the harness's own
        # list command; from Hermes's terminal tool the hermes CLI (the venv
        # bin) is not on the login-shell PATH, so the row says unknown there.
        # The wrapper's own status line above (hermes on PATH) says yes.
        if [ "$h" = openclaw ]; then check "gstack-harness status through the tool" "$result" '^openclaw[[:space:]].*files[[:space:]].*visible to harness: yes'; else check "gstack-harness status through the tool (registration row; visibility unknown: hermes is not on the tool's PATH)" "$result" '^hermes[[:space:]]all[[:space:]]/harness-state/hermes/skills/gstack[[:space:]][0-9]* files[[:space:]].*visible to harness: \(yes\|unknown\)'; fi
        check "gstack-skill-start through the tool" "$result" '^SKILL_START_PROTO: 1$' '^SESSION_KIND: spawned' '^CAPY: off$' '^STATE_ROOT: /harness-state/.gstack'
        check_absent "no INSTALL: warn or fail row" "$result" 'INSTALL: \(warn\|fail\)'
        check "probe command exit 0" "$result" '^HE_PROBE_EXIT=0$'
        reg=$(cat "$r/logs/gstack-register.log")
        check "runtime smoke: wrapper runtime check" "$reg" 'runtime: ok bun 1\.'

        if [ "$negative" = 1 ]; then
          # The missing-Bun negative: the wrapper must say why and stop before any model request.
          probe "$h" "$tag-nobun" "$runtime_script" -e PATH="$(image_path_without_bun "$(image_of "$h")")"
          n=$out/probe-$tag-nobun
          check "negative (no Bun on PATH): adapter exit 2" "$probe_exit" '^2$'
          reg=$(cat "$n/logs/gstack-register.log" 2>/dev/null || echo '(no gstack-register.log)')
          check "negative (no Bun on PATH): runtime degraded logged" "$reg" 'runtime: degraded (bun not on PATH'
          check "negative (no Bun on PATH): registration failed" "$reg" 'FAIL: setup --host'
          check "negative (no Bun on PATH): no model request" "$(python3 scripts/gsta-135/system-prompt.py "$n/requests.ndjson" "$h" 2>/dev/null || echo 'message_requests=0')" '^message_requests=0$'
          # The pinned-tree negative: the image env names another commit, so the installed tree is not the pin.
          probe "$h" "$tag-pin" "$runtime_script" -e GSTACK_IMAGE_COMMIT=0000000000000000000000000000000000000000
          n=$out/probe-$tag-pin
          check "negative (GSTACK_IMAGE_COMMIT names another commit): adapter exit 2" "$probe_exit" '^2$'
          reg=$(cat "$n/logs/gstack-register.log" 2>/dev/null || echo '(no gstack-register.log)')
          check "negative (GSTACK_IMAGE_COMMIT names another commit): refused" "$reg" 'not the pinned 0000000000000000000000000000000000000000 this image names; refusing to start'
          check "negative (GSTACK_IMAGE_COMMIT names another commit): no model request" "$(python3 scripts/gsta-135/system-prompt.py "$n/requests.ndjson" "$h" 2>/dev/null || echo 'message_requests=0')" '^message_requests=0$'
        fi

        if [ "$h" = hermes ] && [ "$hermes_mode" = chat ]; then
          # The flagged-command smoke: the approval card must fail closed and the trial still end.
          started=$(date +%s)
          probe hermes "$tag-flagged" "$flagged_script"
          f=$out/probe-$tag-flagged
          echo "flagged smoke: wall $(( $(date +%s) - started ))s of the 120s budget"
          check "flagged smoke: adapter exit 0 inside the budget" "$probe_exit" '^0$'
          writer=$(python3 scripts/gsta-135/system-prompt.py "$f/requests.ndjson" hermes --tool-result || echo '(no tool result)')
          echo "flagged smoke: the FIFO writer's tool result:"; printf '%s\n' "$writer" | sed 's/^/    | /'
          check "flagged smoke: the FIFO writer ran" "$writer" 'writer_done' '^hermes_tool_exit_code=0$'
          result=$(python3 scripts/gsta-135/system-prompt.py "$f/requests.ndjson" hermes --tool-result --turn 3 || echo '(no tool result)')
          printf '%s\n' "$result" > "$f/tool-result.txt"
          echo "flagged smoke: the flagged command's tool result ($f/tool-result.txt):"; printf '%s\n' "$result" | sed 's/^/    | /'
          check "flagged smoke: the card failed closed with 'y' typed at the old FIFO path and at fd 3" "$result" 'BLOCKED'
          check_absent "flagged smoke: no FIFO under the log mount" "$(find "$f/logs" -type p | wc -l)" '^[1-9]'
          check "flagged smoke: post-tool max_tokens pin" "$(python3 scripts/gsta-135/system-prompt.py "$f/requests.ndjson" hermes || true)" "^post_tool_max_tokens=$max_tokens$"
          check "flagged smoke: watcher released on the real state.db" "$(cat "$f/logs/adapter.log")" 'watcher: transcript complete' 'watcher: typing /exit' 'completed'
          check_absent "flagged smoke: the watcher read state.db without error" "$(cat "$f/logs/adapter.log")" 'state.db read failed' 'did not leave after /exit'
          transcript=$(bun scripts/gsta-135/evidence.ts hermes "$f" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transcript"])' || echo error)
          check "flagged smoke: complete transcript (evidence.ts)" "$transcript" '^complete$'
          echo "flagged smoke: entries under HERMES_HOME/skills: $(find "$f/state/hermes/skills" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l)"
        fi
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
  } >> "$log" 2>&1 || { echo "  FAIL $tag: a step exited non-zero (see $log)" >> "$log"; failed=1; }
  verdict=pass; [ "$failed" -eq 0 ] || verdict=fail
  python3 - "$out/runtime-preflight.json" "$(image_of "$h")" "$verdict" <<'PY'
import json, os, sys
path, image, verdict = sys.argv[1:]
data = json.load(open(path)) if os.path.exists(path) else {}
data[image] = verdict
json.dump(data, open(path, "w"), indent=2, sort_keys=True)
PY
  if [ "$failed" -eq 0 ]; then
    echo "PREFLIGHT: $tag ok $(grep -c '^  ok ' "$log") checks ($log)"
  else
    echo "PREFLIGHT: $tag fail $(grep '^  FAIL' "$log" | head -3 | tr '\n' ';') ($log)"
    [ "$tag" = hermes-chat ] && echo "HERMES: not measured ($(grep '^  FAIL' "$log" | head -1 | sed 's/^  FAIL //'))"
    any_failed=1
  fi
done
exit ${any_failed:-0}
