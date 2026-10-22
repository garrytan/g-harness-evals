# Fake harness

A shell adapter that follows the [adapter protocol](../../docs/adapters.md) with no model, so the protocol itself can be tested without a key or a network. `tests/adapter-conformance.test.ts` runs it both as a process and as a container.

Markers in the text drive it (`instruction.md` for `run`, the `TurnRequest` prompt for `serve`): `[fake:harness_error]` exits 2, `[fake:model_error]` exits 3, `[fake:sleep N]` makes the turn take N seconds so the wall clock can be tested, and in `run` any instruction mentioning `hello.txt` writes `hello` to that file. State goes to `/harness-state/fake/session.json`.

`serve` follows the file queue in docs/adapters.md with the same markers per turn, plus `[fake:call <tool> <json>]` (one per line), which POSTs a JSON-RPC `tools/call` to `HE_WORLD_MCP_URL` as the bot with curl, so a test can see an event in the world; the raw results go to `$HE_LOG_DIR/world-mcp-calls.jsonl`. Sessions are keyed `dm:<member>` or `channel:<id>` with a turn counter per key under `/harness-state/fake/sessions/`, and the reply is a fixed text that names the requester, the turn, the conversation and the session's turn count, so the runner lane can test posting and attribution without a model. The image carries `jq` and `curl` for this.
