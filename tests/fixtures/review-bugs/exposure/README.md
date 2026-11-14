# Exposure reader fixtures

Fixtures for scripts/review-bugs/exposure.ts, tested by tests/review-bugs/exposure.test.ts. Each harness has a known-good case, known-bad cases and one case per gap code. materialize.ts turns a case into a session output dir with the harness's real layout.

**Where they come from.**

- **codex, openclaw, hermes:** taken from the keyless background-wait canaries (scripts/review-bugs/wait-canary.ts) run on 2026-11-14 through the real metering proxy, with a scripted fake model and dummy keys. Nothing here came from a paid run or a real model.
- **claude-code:** hand-written in the Agent SDK message format the gstack-evals review rig writes (transcript.ndjson). No real rig run was available keylessly, so these are synthetic.
- **reader-map.json:** a copy of gstack-evals' reader map at gstack 699a41cb (wiki/plans/2026-11-03-geva-255-r2-after-pin-amendment/reader-map-gstack-699a41cb6808.json).

**How they were trimmed.** The sqlite stores are kept as JSON row dumps (openclaw.rows.json, hermes.rows.json) so a diff is readable; materialize.ts writes them back into a store. Every string over 3,000 characters (tool catalogues, system and developer text, the 78 KB gstack-review SKILL.md in a skill_view result) was cut to its first 1,200 characters plus a "[fixture: trimmed N characters]" note. A cut string keeps a copy of the review skill markers ("# Pre-Landing PR Review", "AUTO-GENERATED from SKILL.md.tmpl") when the original carried them. The string "EMPTY_FILE" in place of a row dump means a zero-byte store.

## Cases

| harness | case | source | what it shows |
|---|---|---|---|
| codex | good | canary cx-full (Codex 0.165.0) | skill read, testing and adversarial readers dispatched with spawn_agent, both FINAL_ANSWER messages back before task_complete |
| codex | not-returned | canary cx-endturn | testing reader started, main turn ended with no wait_agent, exec exited, no FINAL_ANSWER: the internal-task failure |
| codex | truncated | cx-full, task_complete lines removed from the main rollout | E_EXPOSURE_TRUNCATED |
| codex | undecodable | cx-endturn, main rollout line 5 replaced by a torn JSON object | E_EXPOSURE_UNDECODABLE |
| codex | empty | a zero-byte rollout file | E_EXPOSURE_EMPTY |
| codex | missing | no rollout at all | E_EXPOSURE_MISSING |
| openclaw | spawn-refused | canary oc-full (OpenClaw 2026.10.6, openclaw agent exec) | real skill file read; both sessions_spawn calls refused with "published reply runtime missing for main"; with an empty expected list this is the small-diff pass |
| openclaw | run-failed | canary oc-collector | collector spawn accepted, agents_wait reports the run failed with the same error; the reader never ran |
| openclaw | good | synthetic: oc-collector with oc-full's skill read inserted, the agents_wait result edited to status done with the reader's report, and the final text edited | the path a version whose children run would need; no OpenClaw child ran in any canary |
| openclaw | stub-only | synthetic: oc-full with the read pointed at the 805-byte stub and its result replaced by stub text | the stub is not the skill |
| openclaw | tampered | synthetic: oc-full with a user message added after the first assistant row | E_EXPOSURE_TAMPERED |
| openclaw | truncated | oc-full without the final assistant event | E_EXPOSURE_TRUNCATED |
| openclaw | undecodable | oc-full with event seq 7 replaced by a torn JSON object | E_EXPOSURE_UNDECODABLE |
| openclaw | empty, missing | a zero-byte store; no store | E_EXPOSURE_EMPTY, E_EXPOSURE_MISSING |
| hermes | oneshot-good | canary he-oneshot-full (harness-eval/hermes:gstack-4bee369d) | skill_view gstack-review, delegate_task with two tasks run synchronously, both result entries completed |
| hermes | chat-good | canary he-chat-full (harness-eval/hermes:gstack-4bee369d-chat) | background delegate_task (status dispatched, delegation_id), the async_delegation_complete user row re-enters the main session before its final row |
| hermes | chat-not-returned | synthetic: canary he-chat-wait cut after the child's first row (id 5), the child session's ended_at cleared | dispatched, still running, main session ended: the "child still running" signal |
| hermes | chat-tampered | synthetic: he-chat-wait with display_kind removed from the async_delegation_complete row | E_EXPOSURE_TAMPERED: a user turn that is not the harness's delivery |
| hermes | oneshot-budget-refused | synthetic: he-oneshot-full with the delegate_task result replaced by Hermes's one-shot budget error (tools/delegate_tool.py _oneshot_spawn_budget) and the child sessions dropped | dispatched but not started: both tasks counted as refused |
| hermes | small-diff | synthetic: he-oneshot-full with the delegate_task call and result removed | skill open alone; passes the gate when the depth rule names no readers |
| hermes | truncated | he-oneshot-full without the final assistant row | E_EXPOSURE_TRUNCATED |
| hermes | undecodable | he-oneshot-full with row 4's tool_calls torn | E_EXPOSURE_UNDECODABLE |
| hermes | empty, missing | a zero-byte state.db; no state.db | E_EXPOSURE_EMPTY, E_EXPOSURE_MISSING |
| claude-code | good | synthetic | /review skill body, a batched testing and security Agent in the background with its task_notification, an adversarial Agent in the foreground |
| claude-code | not-returned | synthetic | the batched reader's task_notification arrives after the final result |
| claude-code | missing-adversarial | synthetic | Review Army only |
| claude-code | no-skill | synthetic, under host/ | no skill open, no launch |
| claude-code | truncated, undecodable, empty, missing | synthetic | one per gap code |
