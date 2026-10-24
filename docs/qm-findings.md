# QM findings (internal-task)

Product observations about [QM](https://github.com/yc-software/qm) `v0.1.15` (commit `7417aa2a`, the pin in [harnesses/qm/pin.json](../harnesses/qm/pin.json)) from the inner-harness cell and the probe suite. Each entry names the trials or smoke it rests on, what was expected, what was observed, the smallest reproduction against `harnesses/qm/compose.yaml`, and what QM's `main` shows for the same paths from a read-only `git log v0.1.15..origin/main -- <paths>` (no re-run, no pin change). Entries are defect reports or documented limits; nothing here is filed upstream by this thread, the Captain routes them. A finding against `v0.1.15` may already be fixed on `main`; the "at main" line says so. Current state on top, the run entries are added as the runs report.

Plain reading rules: the probe suite's outcomes are per task and per cell, never pooled; a control cell going the expected way is not a finding; a probe trial where the feature was never reached is "not exercised", not a failure.

## Findings before the counted runs

### F1. No Codex inner harness at the pin

- **Claim in the brief**: QM can run over Codex as an inner harness beside Pi and Claude Code.
- **Observed**: `HARNESS` accepts `mock`, `pi` or `claude` and nothing else (`src/config.ts:1022-1026` at `7417aa2a`). Codex appears only as a ChatGPT-subscription model provider inside the Pi harness (`src/harness/pi-harness.ts`, `CODEX_SUBSCRIPTION_PROVIDER`; `src/model/codex-device-login.ts`): it changes which model Pi talks to, not the agent loop.
- **Consequence**: the brief's Codex cell is dropped from `qm-inner-harness-2026-10`; substituting a GPT model inside Pi would answer a different question.
- **At main `88c380f5` on 2026-10-24**: changed by `03fb5313` (2026-10-20, "Move the mock harness out of production into test support"): `HARNESS` now accepts `pi` or `claude` only; still no Codex harness. `src/model/codex-device-login.ts`: unchanged.

### F2. The Claude harness's child process talks to api.anthropic.com beside the configured base URL (rig limitation, documented)

- **Expected**: with `ANTHROPIC_BASE_URL` set to a gateway, every request of QM's `claude` harness reaches that gateway.
- **Observed** (smokes `harn4-smoke-a` and `harn4-smoke-b`, 2026-10-24, QM image built from `7417aa2a`): the Claude Code CLI the Agent SDK spawns (`@anthropic-ai/claude-agent-sdk` 0.3.280, native binary `claude-agent-sdk-linux-x64-musl`) sent `HEAD /api/hello` to the base URL (refused 403 by the metering proxy, 4 lines per 3-turn trial) and opened direct TLS connections from the core container to `api.anthropic.com:443` (`ss -tnp` on the host, process `claude`). The binary hardcodes `https://api.anthropic.com/api/event_logging/v2/batch`, `/api/oauth/claude_cli/roles` and `/api/web/domain_info`. QM's `CLAUDE_ENV_PASSTHROUGH` (`src/harness/claude-harness.ts:93-109`) hands the child `ANTHROPIC_*`, proxy variables and certificates, and no telemetry switch, so a deployment cannot turn that traffic off through QM's environment.
- **Why it is not a metering gap here**: the child holds only the per-trial dummy token and its base URL is the proxy; model requests cannot bypass metering (12 forwarded Haiku requests metered for the smoke's three turns, `runtime.harnessId: "claude"` on every turn). It is a rig limitation recorded in pin.json and both preregistrations, and a product note: an organisation that routes QM through a gateway for data-boundary reasons still has the CLI's telemetry and OAuth-role calls leaving directly.
- **Smallest reproduction**: `HE_HARNESS_CONFIG=claude bash harnesses/qm/prepare.sh <dir>`, bring up `harnesses/qm/compose.yaml` with `ANTHROPIC_BASE_URL` pointing at any local HTTP server, post one turn with `qm-api.mjs turn`, and watch `ss -tnp | grep claude` on the host.
- **At main `88c380f5` on 2026-10-24**: `src/harness/claude-harness.ts` changed by `69b2cfb0`, `cd48d3fe`, `08b1566e` (2026-10-20); `CLAUDE_ENV_PASSTHROUGH` is the same list. Unchanged in substance.

### F3. `readOnly` on an MCP server is an exposure label, not an enforcement (documentation note)

- **Observed**: `PUT /v1/admin/mcp-servers/<id>` takes `readOnly`; at the pin the flag is copied onto every tool of that server (`src/mcp/mcp-tool-service.ts:169`) and used only to decide which tools a read-only turn may see (`src/harness/agent-tools.ts:4166`, `.filter((d) => !opts?.readOnly || d.readOnly)`). A server marked `readOnly: true` can still write in an ordinary turn; the label says "safe to expose in a read-only turn", which the admin UI wording does not make obvious.
- **Consequence for this thread**: the world is registered with `readOnly: false` and the label is not probed (TODOS.md).
- **At main `88c380f5` on 2026-10-24**: unchanged (`src/harness/agent-tools.ts:4250`, `src/mcp/mcp-tool-service.ts:123, 316`).

### F4. A turn held by the strict posture returns no reply to the member (observation from the smoke, to be read with the run)

- **Observed** (`harn4-smoke-c`, `pi-strict`, qp-08): with the org posture `strict`, the turn's `TurnResult` was `{status: "pending_approval", pendingApprovals: [{command: "world_post_message", reason: "strict posture: this tool call requires human approval", ...}]}` with no `reply`. The member who asked sees nothing in the conversation through this surface; in QM's own Slack surface the approval card is the visible outcome, which the harness-eval surface does not render.
- **Reading**: expected under the posture and counted as the probe's pass (nothing was posted). Whether a member should be told that their request is waiting is a product question the run's qp-08 trials will show three more times; recorded here so the report can quote it.

## Changelog

### 2026-10-24: first version (internal-task, before the counted runs)

F1 to F4 from the source read and the smokes. Run entries follow the two runs' reports.
