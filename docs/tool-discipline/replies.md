# What the harness says back (internal-task plan step 2)

Keyless probe, 2026-10-31. Each harness got the same five scripted model turns from the fake model endpoint, and we read the reply the harness sent back in its next request. Records: [replies/](replies/). Script: [scripts/tool-discipline/reply-probe.ts](../../scripts/tool-discipline/reply-probe.ts). Test: [tests/tool-discipline-probe.test.ts](../../tests/tool-discipline-probe.test.ts).

**The five turns:** (1) unknown tool `frobnicate {}`; (2) `skills_read {"name":"review"}`; (3) world `post_message` with `text` missing; (4) world `post_message` to channel `@nobody`; (5) shell `/bin/true 2>&1 | head -40`. No image here has gstack, so turn 5 uses `/bin/true`, not the gstack start helper.

## Findings by harness

**OpenClaw 2026.10.6** ([openclaw.json](replies/openclaw.json))
- Unknown tool and `skills_read` both get `Tool <name> not found`, is_error true, and name no real tool. Its own system prompt tells the model to "use `skills_read` with its exact name", but `skills_read` is deferred, so a direct call fails with no hint to go through `tool_call` (turn 2).
- A world call by the bare name `post_message` is refused with a useful hint: "Did you mean: message, world__post_message, automations?" plus the tool_search, tool_describe, tool_call route (extra turn).
- Missing argument and wrong channel both reach the world server and come back is_error true, wrapped in an EXTERNAL_UNTRUSTED_CONTENT block (turns 3 and 4).
- Shell reply is `(no output)`, is_error false, no exit code shown (turn 5).

**Hermes v2026.9.24, one-shot** ([hermes-oneshot.json](replies/hermes-oneshot.json))
- Never sets is_error, on any of the five replies, errors included.
- Unknown tool and `skills_read` get "does not exist. Available tools:" and the full list of 24 offered names (turns 1 and 2).
- Missing argument is caught by Hermes itself: "missing required argument(s): text. The tool was NOT invoked", with the full schema. The world server never sees it (turn 3).
- Wrong channel reaches the world server; the reply is wrapped in an `<untrusted_tool_result>` block (turn 4).
- Shell reply is JSON with `"exit_code": 0` (turn 5).

**Hermes v2026.9.24, chat mode, gstack-none overlay** ([hermes-chat.json](replies/hermes-chat.json))
- Ran through `harnesses/run-trial.sh` with no world. The chat overlay implements only the `run` entry, and the runner's world path needs `serve` (its log: "chat mode implements the run entry only, not 'serve'").
- Turns 1, 2 and 5 match one-shot word for word: no is_error, full tool list, `"exit_code": 0`.
- With no world server, both world calls get "is not a known tool name. Deferred tools must be invoked through tool_call by the exact name tool_search returns" (turns 3 and 4).

**Claude Code 2.1.312** ([claude-code.json](replies/claude-code.json))
- Unknown tool and `skills_read` get `<tool_use_error>Error: No such tool available: <name></tool_use_error>`, is_error true, no real tool named (turns 1 and 2).
- After a `ToolSearch` load (extra turn), the missing argument reaches the world server and its MCP error -32602 comes back verbatim, is_error true (turn 3). Wrong channel comes back as the server's raw JSON error, is_error true (turn 4).
- Shell reply is `(Bash completed with no output)`, no exit code shown (turn 5).

**QM main@b6786d67, Pi** ([qm-pi.json](replies/qm-pi.json))
- Unknown tool and `skills_read` get `Tool <name> not found`, is_error true (turns 1 and 2).
- World errors through `mcp_call` start with `[error] mcp tool post_message error:` but have is_error false, so the error flag says success (turns 3 and 4).
- The shell call never runs: "this scope has no default sandbox; use sandbox list, create, set_default, then retry", is_error true. No exit code (turn 5).

## H3: does a malformed world-MCP call leave a line in events.jsonl?

**No.** A call that fails the world tool's input schema is rejected before the logging handler, so events.jsonl gets nothing. A call that passes the schema but names a wrong channel gets one `deny` line (`chat.postMessage`, `channel_not_found`).
- Live: OpenClaw, Claude Code and QM-Pi sent the missing-argument call to the world server, got MCP error -32602 back, and no events line was written between that call and the next request (turn 3, `world_events: []` in [openclaw.json](replies/openclaw.json), [claude-code.json](replies/claude-code.json), [qm-pi.json](replies/qm-pi.json)).
- Live: the wrong-channel call left exactly one deny line in OpenClaw, Hermes one-shot, Claude Code and QM-Pi (turn 4 `world_events` in each JSON).
- Hermes one-shot blocks the missing-argument call itself, so its turn 3 never reaches the server ([hermes-oneshot.json](replies/hermes-oneshot.json)).
- Server alone: the H3 test in [tests/tool-discipline-probe.test.ts](../../tests/tool-discipline-probe.test.ts) calls world-MCP directly and checks both cases.

## How to rerun

```
bun scripts/tool-discipline/reply-probe.ts --target openclaw --write docs/tool-discipline/replies
```

Targets: openclaw, hermes-oneshot, hermes-chat, claude-code, qm-pi. Each runs one capture trial (run id prefix `anatomy-capture-`) against the fake model with dummy keys, about a minute each. `--extract <dir>` re-reads a finished capture without running anything, and takes the image and commit fields from the `probe-run.json` saved at capture, not from today's image and HEAD; a capture saved before that file held them writes them as unknown. Reply text is copied from the fake's request log, with token-like strings replaced by `[scrubbed]`.
