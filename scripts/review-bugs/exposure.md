# Exposure reader and background-wait canaries

**What we learned.**

- **Hermes and Codex can run a background reader and wait for it. OpenClaw's one-turn exec cannot run one at all.** At OpenClaw 2026.10.6, every sessions_spawn from "openclaw agent exec" fails with "published reply runtime missing for main", so the C3 cell's /review would never dispatch a reader.
- **Codex waits only when the model calls wait_agent.** If the main turn ends without it, exec exits and drops the child. That is the internal-task failure, and it depends on the model, not the harness.
- **Read exposure from the harness's own store, not a wrapper log.** Each harness records dispatch, start and return differently. exposure.ts reads all four and calls an unreadable transcript a gap, never a pass or a fail.

This page covers scripts/review-bugs/exposure.ts (the exposure gate's reader, plan internal-task build step 3) and scripts/review-bugs/wait-canary.ts (the keyless background-wait canary the plan requires before any paid trial).

## Exposure reader

**What it prints.** One row per PR-pass (one review session of one unit) with four signals:

1. skill_opened: the gstack review skill file was opened and the result shows the file, not an error.
2. army_dispatched: a Review Army specialist was dispatched. That means a started launch whose prompt names a reader-map checklist path.
3. adv_dispatched: the adversarial reader was dispatched. That means a started launch carrying the map's adversarial marker and naming no checklist.
4. all_returned: at least one reader started, and every started reader's report came back before the session ended.

**Gate and strict, side by side.**

- **gate** passes when the skill was opened and every reader that gstack's depth rule names for the unit was dispatched and returned. When the rule names no readers (a small diff), the skill open alone passes.
- **strict** passes only when all four signals hold. Otherwise it says why, for example "fail (no readers dispatched)".
- A dispatch the harness refused (OpenClaw's spawn error, Hermes's one-shot delegation budget) is counted under refused and covers no reader.

**Run it.**

    bun scripts/review-bugs/exposure.ts --sessions sessions.tsv --map reader-map.json --expected expected.json [--json]

- sessions.tsv has a header row: unit, pass, harness, path, and optionally arm. JSON lines with the same keys work too. path is the session's output dir. Relative paths resolve from the sessions file.
- reader-map.json is gstack-evals' reader map format (checklist paths to reader names, plus the adversarial markers).
- expected.json maps each unit to the readers the depth rule names, for example {"u1": ["testing", "adversarial-native"], "u2": []}. Another step computes it from each diff before the run.
- Output: TSV rows, a blank line, then totals per harness (and per harness and arm). --json prints {rows, totals}.

**Exit codes.** 0 every row read; 3 at least one gap (all other rows still print); 64 a usage or input error, including a unit missing from expected.json (E_EXPOSURE_EXPECTED).

**Gap codes.** Each gap prints one stderr line: code, file, detail, and the format the reader expected.

| code | meaning |
|---|---|
| E_EXPOSURE_MISSING | no transcript where the harness writes it |
| E_EXPOSURE_EMPTY | the transcript exists but holds nothing |
| E_EXPOSURE_UNDECODABLE | a line or row does not decode |
| E_EXPOSURE_TRUNCATED | the session has no end, or its last line is torn |
| E_EXPOSURE_TAMPERED | a user turn after the first assistant row that is not the harness's own delivery of a reader's result |

## What each harness records

The head comment of exposure.ts has the exact rule per harness. The short version:

| harness | store | dispatched | started | returned |
|---|---|---|---|---|
| Claude Code | transcript.ndjson (gstack-evals rig) | Agent or Task tool_use | task_started, or a message with that parent_tool_use_id | the tool_result (foreground) or a completed task_notification (background), before the final result |
| Codex 0.165.0 | state/codex/sessions/.../rollout-*.jsonl | function_call spawn_agent (namespace collaboration) | the output names a task_name | an agent_message from that agent path with "Message Type: FINAL_ANSWER" before task_complete |
| OpenClaw 2026.10.6 | openclaw-agent.sqlite transcript_events | sessions_spawn, direct or through tool_call {id: "sessions_spawn"} | the receipt says status accepted | an agents_wait result with status done for that runId |
| Hermes | state/hermes/state.db | each task of a delegate_task call | listed in the result (one-shot) or status dispatched (chat) | result entry completed (one-shot), or the async_delegation_complete user row (chat) |

## Hermes: the watcher signals

The Hermes chat adapter's watcher needs to know when a background reader is still out. These rows in state.db say so, from the he-chat-wait canary run (session 20261114_054817_03554a; times are 2026-11-14 UTC):

- **A child is still running** when the main session has a delegate_task tool row whose content has "status": "dispatched" and a delegation_id, and no later main-session user row with display_kind async_delegation_complete whose content names that delegation_id. A second signal: a sessions row with parent_session_id equal to the main session and ended_at NULL.
  - id 3, tool, delegate_task: {"status": "dispatched", "mode": "background", "count": 1, "delegation_id": "deleg_90301aff", ...}
  - id 4, assistant, finish_reason stop: "Waiting for the reader's report." The main turn ends here while the reader is out.
  - sessions row 20261114_054832_433037: source subagent, parent_session_id 20261114_054817_03554a, ended_at set only at agent_close.
- **Its result re-entered** when that async_delegation_complete user row appears.
  - id 6, child session, assistant stop at 05:50:32.59: the reader's report.
  - id 7, main session, user, display_kind async_delegation_complete, content starting "[ASYNC DELEGATION BATCH COMPLETE" and naming deleg_90301aff, at 05:50:32.94.
  - id 8, main session, assistant stop at 05:50:33.07: the final answer.
- The gap between the child's last row and the re-entry was about 300 ms in every run. The adapter's watcher held only because the child session's last row was a user row until then; its 5-second grace covered the rest. A watcher that keys on the signals above does not depend on that timing.
- One-shot mode is different: delegate_task is synchronous, and its tool result row (results[i].status completed) comes after the child's rows. When the one-shot budget is spent, the tool result is {"error": "Delegation budget for this one-shot run is exhausted ..."} and nothing starts; exposure.ts counts each task as refused.

## OpenClaw: does "openclaw agent exec" wait for a child?

**It cannot be shown, because no child ever starts.** From the canaries (OpenClaw 2026.10.6, harness-eval/openclaw:gstack-4bee369d and gstack-none):

- Default spawn (oc-wait, session 1902f57c): seq 6 at 05:48:51.106 calls tool_call sessions_spawn; seq 8 at 05:48:53.617 returns status error, "published reply runtime missing for main" (dist agent-turn-service-DZAVDBw4.mjs line 2507). seq 10 sessions_yield returns nothing_pending; seq 13 the assistant stops and exec exits.
- Collector spawn (oc-collector, session 5ab4ab25): seq 8 at 05:48:51.378 status accepted with a runId; seq 12 at 05:48:53.820 agents_wait reports the run failed with the same error. The reader made no model call.
- The same error appears with no gstack installed (oc-none-wait), so it is the harness's exec path, not the overlay.
- sessions_spawn is a deferred tool in exec. The model reaches it through tool_call {id: "sessions_spawn", args}.

## Codex: waits only on wait_agent

- cx-wait: spawn_agent at 05:48:01.155, wait_agent at 05:48:01.319, "Wait completed" at 05:50:01.388, the reader's FINAL_ANSWER at 05:50:01.390, the main final message at 05:50:01.417, task_complete at 05:50:01.422.
- cx-endturn: spawn_agent at 05:48:01.055, a text turn "Waiting for the reader's report." at 05:48:01.155, task_complete at 05:48:01.230. Exec exited; the child got its NEW_TASK and never answered.
- The child's task reaches it as encrypted_content, but the spawn_agent call's message argument in the main rollout is plain text, so exposure.ts can name the reader from it.

## Background-wait canary

    bun scripts/review-bugs/wait-canary.ts --harness openclaw|hermes|codex [--scenario wait|end-turn|collector|full] [--image <tag>] [--hermes-mode oneshot|chat] [--delay 120] [--out <dir>]

- A scripted fake model (fake-reader-model.ts) plays the main session and the reader. The reader's answer comes only after --delay seconds (120 by default), with an SSE keepalive every 5 seconds.
- The real metering proxy runs as a child process with a scratch lease and dummy keys only. No request leaves the machine.
- The verdict comes from the harness's own store through exposure.ts: waited, ended-early, reader-never-ran, spawn-refused, not-dispatched or gap.
- Exit codes: 0 waited, 3 not waited (a harness finding), 4 skipped (no docker or image), 2 infrastructure, 64 usage.
- Hermes probes model-discovery routes at every start (/api/tags, /v1/models, /api/show and others). The proxy refuses them with no model at $0. The canary counts them as metadata_probes, not as an infrastructure failure. Any refused request that names a model, or is on a messages or responses route, is still an infrastructure failure.

**Results, 2026-11-14, 120-second delay unless noted, all through the real proxy, $0.**

| run | image | verdict |
|---|---|---|
| he-oneshot-wait, rerun he-oneshot-wait-r2 | hermes:gstack-4bee369d | waited |
| he-chat-wait, rerun he-chat-wait-r2 | hermes:gstack-4bee369d-chat | waited |
| he-none-chat-wait | hermes:gstack-none-chat | waited |
| he-oneshot-full, he-chat-full (5 s) | both Hermes overlays | waited, two readers |
| cx-wait | codex:dev | waited |
| cx-endturn | codex:dev | reader-never-ran (exec exited first) |
| cx-full (5 s) | codex:dev | waited, two readers |
| oc-wait, oc-endturn, oc-full (5 s) | openclaw:gstack-4bee369d | spawn-refused |
| oc-none-wait | openclaw:gstack-none | spawn-refused |
| oc-collector | openclaw:gstack-4bee369d | reader-never-ran (run failed) |

**Deviations from the cells.** The OpenClaw and Hermes canaries used claude-opus-5-5 on the Anthropic route, not the C3 (particle-1) and C4 (DeepSeek V4 Pro) routes. The Codex image is harness-eval/codex:dev with no gstack overlay, and the canary writes a stand-in SKILL.md for the skill read; it is not the gstack-evals rig's codex host that C2 names. The Claude Code fixtures are synthetic, because no keyless rig run was available.

## Tests

- tests/review-bugs/exposure.test.ts: the four signals per harness, gate and strict, refused dispatches, the small-diff case, every gap code, the TSV and JSON output and the exit codes. Fixtures and their sources: tests/fixtures/review-bugs/exposure/README.md.
- tests/review-bugs/wait-canary.test.ts: the fake model, the canary rules and verdicts, and one short canary per built image (skipped without docker or the image).
