#!/usr/bin/env bash
# internal-task overlay wrapper for the Hermes adapter. The image is
# harness-eval/hermes:gstack-<pin8> (oneshot) or :gstack-<pin8>-chat, FROM
# harness-eval/hermes:dev with the pinned gstack checkout at /opt/gstack and
# Bun at /opt/bun. Before the first turn it marks the trial as a test run for
# gstack, registers gstack's skills with Hermes the way the spec's install step
# does (`./setup --host hermes --no-browser` with HERMES_HOME exported as the
# adapter exports it), then runs the turn. The counted adapter and image are
# untouched.
#
# HE_GSTACK_HERMES_MODE, baked into the image by the Dockerfile build arg:
#   oneshot  exec the counted adapter (kept as adapter.real.sh) with the
#            remaining time budget: `hermes chat --query-file ... --oneshot`.
#   chat     an interactive session. `hermes chat --query-file` implies
#            --oneshot on non-TTY stdio, so the turn runs under a pseudo
#            terminal (`script -qefc`) with stdin from a FIFO in a private
#            temp directory that this adapter holds open read-write for the
#            whole turn (fd 3, closed in the session); a watcher (chat_watch)
#            polls HERMES_HOME/state.db every 2 s with the completeness rule
#            evidence.ts applies (per session, the last row is the assistant's
#            with finish_reason stop and every tool call has its result),
#            waits a short grace period that a flip back to pending resets,
#            types /exit and waits a bounded time for Hermes to leave, then
#            terminates the session itself (a complete transcript still exits
#            0). A turn Hermes closes as failed (display_kind failed_turn, as
#            after a 401) gets /exit at once and maps to 3 or 2. The run-trial
#            wall clock bounds all of it. The counted adapter's turn block
#            (HOME and HERMES_HOME, the config copy, the ANTHROPIC_* exports,
#            the `hermes --version` seed, model_error_pattern, the exit mapping
#            0/124/3/2) is copied here line for line, because the counted run
#            entry hardcodes --oneshot; tests/gsta-135-adapters.test.ts diffs
#            the copied lines against harnesses/hermes/adapter.sh; the model
#            error grep alone differs (model_error_seen: the pty capture with
#            its escapes stripped, plus Hermes's own logs). An interactive
#            session parks a flagged command on an approval card
#            (tools/approval.py); the config copy sets approvals.mode manual
#            and approvals.timeout 1 so the card fails closed after one second
#            (BLOCKED, no guardian model call) and no trial waits on it; that
#            holds for an agent that does not write to the session's stdin
#            (a same-uid process can still reach the FIFO through
#            /proc/<pid>/fd). No clarify callback is wired. In chat mode
#            stdout.log is a terminal capture (prompt_toolkit redraws), not
#            plain text.
set -euo pipefail
. /opt/harness/gstack/wrapper-lib.sh

mode=${HE_GSTACK_HERMES_MODE:-oneshot}
case "$mode" in oneshot|chat) ;; *) wrap_fail "HE_GSTACK_HERMES_MODE must be oneshot or chat, not '$mode'" ;; esac
export HOME="$HE_SESSION_STATE_DIR"
export HERMES_HOME="$HE_SESSION_STATE_DIR/hermes"
mkdir -p "$HERMES_HOME"
wrap_mark_test_run
wrap_runtime_check
wrap_log "hermes overlay: gstack $(cat "$GSTACK_DIR/VERSION") at $(git -C "$GSTACK_DIR" rev-parse HEAD) bun $(bun --version 2>/dev/null || echo none) mode=$mode"
"$GSTACK_DIR/setup" --host hermes --no-browser > "$HE_LOG_DIR/gstack-setup.log" 2>&1 || wrap_fail "setup --host hermes exited $? (gstack-setup.log)"
cat "$HE_LOG_DIR/gstack-setup.log" >> "$GSTACK_WRAP_LOG"
wrap_setup_ready "$HE_LOG_DIR/gstack-setup.log" hermes
bun --no-env-file --config=/dev/null "$GSTACK_DIR/bin/gstack-harness" status >> "$GSTACK_WRAP_LOG" 2>&1 || wrap_log "gstack-harness status exited $?"
[ "$mode" = chat ] || wrap_handoff "$@"
[ "${1:-run}" = run ] || wrap_fail "chat mode implements the run entry only, not '${1:-}'"
wrap_budget_left

# ---- chat mode: the counted adapter's turn block, with the oneshot turn replaced by the pty session ----
: "${HE_WORKSPACE_DIR:=/workspace}"
: "${HE_MODEL_BASE_URL:?HE_MODEL_BASE_URL must be set}"
: "${HE_MODEL_API_KEY:?HE_MODEL_API_KEY must be set}"
: "${HE_MODEL_NAME:=claude-sonnet-5-5}"
exec > >(tee -a "$HE_LOG_DIR/stdout.log") 2> >(tee -a "$HE_LOG_DIR/stderr.log" >&2)
log() { printf '%s hermes[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" | tee -a "$HE_LOG_DIR/adapter.log" >&2; }
[ -e "$HERMES_HOME/config.yaml" ] || cp /opt/harness/config/config.yaml "$HERMES_HOME/config.yaml"
grep -q '^approvals:' "$HERMES_HOME/config.yaml" && wrap_fail "the config copy already has an approvals: section"
printf '\napprovals:\n  mode: "manual"\n  timeout: 1\n' >> "$HERMES_HOME/config.yaml"
wrap_log "approval: approvals.mode=manual approvals.timeout=1 (an interactive session has no deny disposition at v2026.9.24; the card fails closed as BLOCKED after 1 s, no guardian model call; limit: it fails closed for an agent that does not write to the session's stdin, a FIFO in a private 0700 directory with fd 3 closed in the session, still reachable by a same-uid process through /proc/<pid>/fd)"
export ANTHROPIC_API_KEY="$HE_MODEL_API_KEY"
export ANTHROPIC_BASE_URL="$HE_MODEL_BASE_URL"
hermes_version=$(hermes --version 2>/dev/null || true)
log "hermes ${hermes_version%%$'\n'*} model=anthropic/$HE_MODEL_NAME budget=${HE_TIME_BUDGET_S}s entry=run mode=chat"
model_error_pattern='metering proxy|AuthenticationError|PermissionDeniedError|RateLimitError|APIStatusError|APIConnectionError|InternalServerError|Error code: (401|402|403|404|429|5[0-9]{2})|HTTP (401|402|403|404|429|5[0-9]{2})'
cd "$HE_WORKSPACE_DIR"
[ -r "$HE_WORKSPACE_DIR/instruction.md" ] || { log "no readable $HE_WORKSPACE_DIR/instruction.md"; exit 2; }

# chat_complete <state.db>: prints complete, tampered, failed, pending,
# missing or `error: <reason>`. The store is backed up into memory through SQLite's
# backup API (a shared lock, a consistent snapshot, no file copy and nothing
# left in /tmp), so Hermes's own connection is never disturbed and a locked or
# torn read raises instead of passing as pending; chat_watch logs the first
# error once and treats every error as pending. The completeness rule is
# evidence.ts's, per session: rows exist, every session's last row is the
# assistant's with finish_reason stop and no tool call of that session is
# still waiting for a result (a tool row settles the call whose id it names,
# a row with no id the oldest waiting call, and a row naming an id no call
# waits for settles nothing; a row whose own tool_calls is undecodable leaves
# that session pending until a later assistant/stop lands). The watcher's job
# is only to see the turn is over; integrity is evidence.ts's, so this rule
# does not carry evidence.ts's two no-credit verdicts, and they diverge on
# exactly those: once any tool_calls row was undecodable evidence.ts marks the
# whole transcript truncated, and a user row after a session's first assistant
# row (an injected turn, or the synthetic "received signal" row a killed chat
# session writes) makes it tampered, while the watcher still completes such a
# turn once its last row is assistant/stop with calls == results. Both
# divergences are safe: the watcher ends the turn, evidence.ts denies it
# credit. tests/gsta-135-adapters.test.ts runs this rule and evidence.ts over
# the same store, in step on every other case. failed is Hermes's own closing
# of a turn that ended without an answer (an assistant row with display_kind
# failed_turn, agent/turn_failure_copy.py at v2026.9.24, as after a 401): the
# session is idle at the prompt and will never complete.
chat_complete() {
  [ -f "$1" ] || { echo missing; return 0; }
  local out
  if out=$(python3 - "$1" <<'PY' 2>&1
import json, pathlib, sqlite3, sys
src = sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri() + "?mode=ro", uri=True)
db = sqlite3.connect(":memory:")
src.backup(db)
src.close()
kind_column = "display_kind" if "display_kind" in {r[1] for r in db.execute("pragma table_info(messages)")} else "null"
rows = db.execute("select session_id, role, tool_call_id, tool_calls, finish_reason, %s from messages order by session_id, id" % kind_column).fetchall()
sessions = {}
for session, role, call_id, tool_calls, finish, kind in rows:
    s = sessions.setdefault(session, {"last": "none", "waiting": []})
    if role == "user":
        s["last"] = "user"
    elif role == "tool":
        s["last"] = "tool"
        if call_id:
            if call_id in s["waiting"]:
                s["waiting"].remove(call_id)
        elif s["waiting"]:
            s["waiting"].pop(0)
    elif role == "assistant":
        s["last"] = "failed" if kind == "failed_turn" else "assistant/" + (finish or "none")
        if tool_calls:
            try:
                calls = json.loads(tool_calls)
                if not isinstance(calls, list):
                    raise ValueError("tool_calls is not a list")
            except ValueError:
                s["last"] = "undecodable"
                continue
            s["waiting"] += [c.get("id") or c.get("call_id") for c in calls]
if rows and all(s["last"] == "assistant/stop" and not s["waiting"] for s in sessions.values()):
    print("complete")
elif any(s["last"] == "failed" for s in sessions.values()):
    print("failed")
else:
    print("pending")
PY
  ); then printf '%s\n' "$out"; else echo "error: ${out##*$'\n'}"; fi
}

# chat_watch <session pid> <state.db>: the watcher. Every poll seconds it asks
# chat_complete until the session leaves on its own or the deadline passes. A
# flip back to pending drops the grace already counted, so /exit is typed
# (on fd 3, the session's stdin) only after grace consecutive seconds of
# complete; a failed transcript gets /exit at once (the session is idle at the
# prompt forever). A tampered turn is never acted on here: the watcher has no
# tampered state (a mid-turn user row, including the synthetic "received
# signal" one a killed session writes, must not cut a live turn short), and
# evidence.ts grades integrity on its own. After typing it waits exit_wait
# seconds for Hermes to leave and then terminates the session itself, since a
# Hermes that ignores /exit must not turn a finished turn into a wall-clock
# loss. Grace and exit_wait are timed in milliseconds (GNU date %N), so a
# second boundary cannot cut either one short by up to a second. Leaves
# watcher_verdict as the state /exit was typed on (complete or failed; empty
# when it was not typed) and watcher_forced=1 when it had to terminate the
# session. The time knobs are HE_GSTACK_CHAT_GRACE_S (5),
# HE_GSTACK_CHAT_POLL_S (2) and HE_GSTACK_CHAT_EXIT_S (30).
chat_watch() {
  local session_pid=$1 db=$2 deadline=$(( $(date +%s) + HE_TIME_BUDGET_S )) seen= typed= state error_logged=
  local grace=${HE_GSTACK_CHAT_GRACE_S:-5} poll=${HE_GSTACK_CHAT_POLL_S:-2} exit_wait=${HE_GSTACK_CHAT_EXIT_S:-30}
  watcher_verdict= watcher_forced=
  while kill -0 "$session_pid" 2>/dev/null && [ "$(date +%s)" -lt "$deadline" ]; do
    state=$(chat_complete "$db")
    case "$state" in error:*) [ -n "$error_logged" ] || { error_logged=1; log "watcher: state.db read failed, counting it as pending: ${state#error: }"; }; state=pending ;; esac
    if [ "$state" = failed ]; then
      log "watcher: hermes closed the turn as failed (display_kind failed_turn), typing /exit"
      watcher_verdict=failed
    elif [ "$state" = complete ]; then
      [ -n "$seen" ] || { seen=$(date +%s%3N); log "watcher: transcript complete, grace ${grace}s"; }
      [ $(( $(date +%s%3N) - seen )) -ge $(( grace * 1000 )) ] || { sleep "$poll"; continue; }
      log "watcher: typing /exit"
      watcher_verdict=complete
    else
      [ -z "$seen" ] || log "watcher: transcript back to $state, grace reset"
      seen=
      sleep "$poll"; continue
    fi
    printf '/exit' >&3; sleep 0.5; printf '\r' >&3
    typed=$(date +%s%3N)
    break
  done
  [ -n "$typed" ] || return 0
  while kill -0 "$session_pid" 2>/dev/null && [ $(( $(date +%s%3N) - typed )) -lt $(( exit_wait * 1000 )) ]; do sleep 1; done
  kill -0 "$session_pid" 2>/dev/null || return 0
  watcher_forced=1
  state=$(chat_complete "$db")
  if [ "$watcher_verdict" = complete ] && [ "$state" != complete ]; then log "watcher: hermes did not leave after /exit (${exit_wait}s) and the transcript is $state again; terminating the session"; watcher_verdict=; else log "watcher: hermes did not leave after /exit (${exit_wait}s); terminating the session with the transcript $state"; fi
  kill -TERM "$session_pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$session_pid" 2>/dev/null || break; sleep 1; done
  kill -KILL "$session_pid" 2>/dev/null || true
}

# model_error_seen: the counted adapter's pattern over the pty capture with
# its escape sequences stripped (prompt_toolkit redraws can split a message),
# stderr.log, and Hermes's own logs under HERMES_HOME/logs (agent.log and
# errors.log carry the provider error verbatim).
model_error_seen() {
  local blob
  blob=$( { sed 's|\x1b\[[0-9;?]*[ -/]*[@-~]||g; s|\x1b\][^\x07]*\x07||g; s|\x1b[()][A-Za-z0-9]||g' "$HE_LOG_DIR/stdout.log" 2>/dev/null | tr -d '\r'; cat "$HE_LOG_DIR/stderr.log" 2>/dev/null; cat "$HERMES_HOME"/logs/*.log 2>/dev/null; } || true )
  printf '%s\n' "$blob" | grep -Eqi "$model_error_pattern"
}

# The session's stdin is a FIFO in a private directory (mktemp -d, mode 0700)
# inside the container, not under HE_LOG_DIR (an exported mount, where a tar
# or a recursive read of the evidence would block on a pipe left behind) and
# removed on exit. Fd 3 is closed in the session (3<&-), so the agent's own
# commands do not inherit the writing end; the limit stays that a same-uid
# process can open it through /proc/<pid>/fd of this adapter, so the approval
# card fails closed for an agent that does not write to the session's stdin.
fifo_dir=$(mktemp -d /tmp/he-hermes-chat.XXXXXX)
fifo="$fifo_dir/stdin.fifo"
trap 'rm -rf "$fifo_dir"' EXIT
mkfifo "$fifo"
exec 3<>"$fifo"
turn_cmd=$(printf 'hermes chat --query-file %q --provider anthropic --model %q' "$HE_WORKSPACE_DIR/instruction.md" "$HE_MODEL_NAME")
set +e
timeout -k 60 "$HE_TIME_BUDGET_S" script -qefc "$turn_cmd" /dev/null <&3 3<&- &
turn_pid=$!
chat_watch "$turn_pid" "$HERMES_HOME/state.db"
wait "$turn_pid"
code=$?
set -e
exec 3>&-
if [ "$watcher_verdict" = complete ] && [ -n "$watcher_forced" ]; then log "completed (transcript complete; the session was terminated after /exit, exit $code)"; exit 0; fi
if [ "$watcher_verdict" = failed ]; then
  if model_error_seen; then log "model error (hermes closed the turn as failed, exit $code)"; exit 3; fi
  log "harness error (hermes closed the turn as failed without a model error in its logs, exit $code)"; exit 2
fi
case "$code" in
  0) log "completed"; exit 0 ;;
  124|137) log "wall clock exceeded (HE_TIME_BUDGET_S=$HE_TIME_BUDGET_S)"; exit 124 ;;
esac
if model_error_seen; then
  log "model error (hermes exit $code)"; exit 3
fi
log "harness error (hermes exit $code)"; exit 2
