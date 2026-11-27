#!/usr/bin/env bash
# Family C launcher (owner identity, internal-task; world/owner-identity/capture.ts). The harness under test runs this from its own
# shell tool when the owner asks for the workers, so every worker is a child of the harness's own headless orchestrator session:
# the process tree gbrain's session-speaker detection reads (gbrain src/core/context/session-speaker.ts: a headless claude or codex
# with a claude or codex process among its ancestors). Byte-identical in harnesses/claude-code/capture/ and harnesses/codex/capture/
# (tests/owner-identity-capture-launch.test.ts), at /opt/harness/capture/ in each image.
#
# The adapter wrote the plan before ready (HE_OI_CAPTURE_B64, capture/wire-capture.cjs) into ${HE_OI_CAPTURE_DIR:-/tmp/he-oi-capture},
# container-local and never bind-mounted: harness (claude-code or codex), log-dir, workspace, worker.env (mode 0600: the per-trial
# proxy token and MCP bearers the harness's own turns use, never a provider key, because Codex's shell drops every *KEY* and *TOKEN*
# variable from its tools' environment) and workers/<n>/brief.md and workers/<n>/agent. All workers start together and the script
# waits for every one, so the orchestrator outlives them and their SessionEnd hooks. Each is `claude -p` or `codex exec` with the
# brief on stdin and the model, MCP and permission settings of the harness's own turns. agent holds the GBRAIN_SESSION_AGENT label
# of an env worker; it is empty for a worker left to detection, whose environment has the variable removed. Prints one line per
# worker and a DONE line, never a worker's output, and writes <log-dir>/launch.jsonl (the launcher's ancestors by pid and process
# name, never arguments or environment; a started row per worker as it is spawned, then, once it exits, its launch, pid, parent
# pid, exit and seconds) and <log-dir>/worker-<n>.out|err. A worker whose turn ended before it exited keeps its started row.
set -u
cap=${HE_OI_CAPTURE_DIR:-/tmp/he-oi-capture}
for f in harness log-dir workspace worker.env workers; do
  [ -e "$cap/$f" ] || { echo "launch-workers: $cap/$f is missing; the adapter wrote no capture plan" >&2; exit 2; }
done
harness=$(cat "$cap/harness")
log=$(cat "$cap/log-dir")
ws=$(cat "$cap/workspace")
case "$harness" in claude-code|codex) ;; *) echo "launch-workers: unknown harness '$harness'" >&2; exit 2 ;; esac
mkdir -p "$log"

json() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '"%s"' "$s"; }

# The launcher's ancestors, nearest first, as "pid:name" from /proc/<pid>/stat and /proc/<pid>/comm.
ancestors() {
  local p=$$ out='' n=0 stat name
  while [ "$p" -gt 1 ] && [ "$n" -lt 16 ]; do
    stat=$(cat "/proc/$p/stat" 2>/dev/null) || break
    name=$(cat "/proc/$p/comm" 2>/dev/null) || break
    out="$out${out:+,}$(json "$p:$name")"
    p=${stat##*) }; p=${p#* }; p=${p%% *}
    n=$((n + 1))
  done
  printf '[%s]' "$out"
}

printf '{"launcher_pid":%s,"harness":%s,"started_at":%s,"ancestors":%s}\n' "$$" "$(json "$harness")" "$(json "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" "$(ancestors)" > "$log/launch.jsonl"

pids=() ns=() agents=() starts=()
for w in "$cap"/workers/*/; do
  w=${w%/}
  n=${w##*/}
  agent=$(cat "$w/agent")
  (
    . "$cap/worker.env"
    unset GBRAIN_SESSION_AGENT CLAUDECODE CLAUDE_CODE_ENTRYPOINT
    [ -z "$agent" ] || export GBRAIN_SESSION_AGENT="$agent"
    cd "$ws" || exit 2
    if [ "$harness" = claude-code ]; then
      exec claude -p --output-format json --model "$HE_MODEL_NAME" --permission-mode bypassPermissions --disallowedTools WebSearch,WebFetch \
        --mcp-config "$HE_OI_MCP_CONFIG" --strict-mcp-config < "$w/brief.md"
    fi
    exec codex exec --json --skip-git-repo-check --strict-config -C "$ws" - < "$w/brief.md"
  ) > "$log/worker-$n.out" 2> "$log/worker-$n.err" &
  pids+=("$!"); ns+=("$n"); agents+=("$agent"); starts+=("$SECONDS")
  launch=env; [ -n "$agent" ] || launch=detected
  printf '{"worker":%s,"launch":%s,"agent":%s,"pid":%s,"ppid":%s,"started":true}
' "$n" "$(json "$launch")" "$([ -n "$agent" ] && json "$agent" || echo null)" "$!" "$$" >> "$log/launch.jsonl"
done
[ "${#pids[@]}" -gt 0 ] || { echo "launch-workers: $cap/workers holds no worker" >&2; exit 2; }

ok=0
for i in "${!pids[@]}"; do
  wait "${pids[$i]}"; code=$?
  launch=env; [ -n "${agents[$i]}" ] || launch=detected
  printf '{"worker":%s,"launch":%s,"agent":%s,"pid":%s,"ppid":%s,"exit":%s,"seconds":%s}\n' "${ns[$i]}" "$(json "$launch")" "$([ -n "${agents[$i]}" ] && json "${agents[$i]}" || echo null)" \
    "${pids[$i]}" "$$" "$code" "$((SECONDS - starts[i]))" >> "$log/launch.jsonl"
  echo "worker ${ns[$i]}: exit $code"
  [ "$code" -ne 0 ] || ok=$((ok + 1))
done
echo "DONE $ok of ${#pids[@]} workers exited 0"
[ "$ok" -eq "${#pids[@]}" ]
