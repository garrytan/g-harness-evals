# Codex CLI harness

[Codex CLI](https://github.com/openai/codex) `0.165.0` (npm `@openai/codex`), installed globally on `node:24-bookworm-slim`. The build checks the sha256 of the vendored linux-x64 binary against `pin.json` and that `codex --version` prints `codex-cli 0.165.0`. No key, no `auth.json` and no login are in the image. Both entry points of the [adapter protocol](../../docs/adapters.md) are implemented.

`run` is one turn: `codex exec --json --skip-git-repo-check --strict-config -C /workspace -` with `/workspace/instruction.md` on stdin.

`serve` answers each `TurnRequest` with one `codex exec` turn. The first turn of a session key (`dm:<member>`, `channel:<id>`, `:t<thread_ts>` for a thread turn) starts a new Codex thread, and the adapter records the thread id from the `thread.started` event in `/harness-state/codex-threads.json`. Later turns of that key run `codex exec resume <thread id> --json --skip-git-repo-check --strict-config -`. All threads live in one `CODEX_HOME`. The reply is the text of the last `agent_message` item.

At serve start the adapter appends `[mcp_servers.world]` (Streamable HTTP, `bearer_token_env_var = "HE_WORLD_MCP_TOKEN"`, `required = true`) to the config, and `[mcp_servers.gbrain]` on a gbrain cell. Each server must answer `tools/list` with the bot token before `ready`, else exit 2.

**gbrain's installer.** `HE_GBRAIN_INSTALL=gbrain-installer` applies what `gbrain setup codex --instructions-only` wrote at gbrain image build (the brain-first block in `AGENTS.md`, the per-turn `UserPromptSubmit` hook in `hooks.json` with its `config.toml` trust table, gbrain's ledger and binary, and from gbrain#8424 the hook launcher, placed alone in its directory) and checks the hook prints its rule before ready. Any other `HE_GBRAIN_INSTALL` exits 2. See [docs/gbrain-arm.md](../../docs/gbrain-arm.md), "The Claude Code and Codex installer".

## Configuration

`config/config.toml` is a template. The adapter fills in the cell model, the proxy URL and `codex_config` from `pin.json`, and writes it to `$CODEX_HOME/config.toml` (`/harness-state/codex`):

- **One provider, the proxy.** `model_provider = "he-proxy"` with `base_url = HE_MODEL_BASE_URL/v1`, `env_key = "HE_MODEL_API_KEY"` and `wire_api = "responses"`. Codex sends only `POST /v1/responses`.
- **One model.** `model`, `review_model`, the subagent default, the memory models and the realtime model are all the cell model. Reasoning effort is `medium`.
- **No prompts, no sandbox.** `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`. Codex's bubblewrap sandbox cannot create a namespace in our unprivileged containers, so the container is the sandbox.
- **No side traffic.** Web search, analytics, feedback, OTEL, update checks and plugins are off. Retries are 1 and 1, and endless connection retries are off.

The sandbox mode and the reasoning effort are named settings; Garry kept both on 2026-10-30 ([Named settings](../../docs/harness-anatomy/README.md#named-settings)).

Every key was checked with `--strict-config` at this pin (`pin.json` `config_keys_confirmed`), and every turn runs with it.

**Official-minimal (internal-task).** A cell with `config: "official-minimal"` (`HE_HARNESS_CONFIG`) adds `model_instructions_file` as the first top-level key of `config.toml`. It names `ablation/official-minimal.txt`, a byte copy of [harnesses/ablation/official-minimal.txt](../ablation/official-minimal.txt) that the adapter checks against `pin.json` `official_minimal.sha256`. At 0.165.0 on gpt-6 models the text replaces Codex's base instructions, the first developer message of the request (there is no `instructions` field). The tools item and the skills, multi-agent and environment messages stay. A container turn with the key runs under `--strict-config`. Unset, empty or `default` leaves `config.toml` byte-identical; any other value exits 2 (HE-ADAPTER-007). Tests: `tests/official-minimal.test.ts`.

**Exit mapping.** 0 when codex exits 0 with `turn.completed`. 124 when the budget runs out: the turn runs under `setsid`, the adapter signals its process group, then kills every process the turn started. 3 when `turn.failed` carries an HTTP status, or says `Connection failed: error sending request` (the proxy unreachable after the retries; Claude Code and Hermes map that to 3 too). Codex 0.165.0 prints most statuses as `unexpected status NNN`, a 400 as the raw error body and a 500 as "We're currently experiencing high demand". 2 for anything else, including an MCP transport error and a CLI version other than the pin.

**Provider check.** The adapter exits 2 at startup, with the reason in `adapter.log`, unless `HE_MODEL_BASE_URL` ends in `/openai` (the runner's `<proxy>/<slot>/openai` route). Codex speaks only the Responses API.

## What to know before reading a Codex result

- **Code mode.** On gpt-6 models Codex offers the model one JavaScript tool, `exec`, plus multi-agent tools. Shell commands and MCP tools are called from inside it (`tools.exec_command`, `tools.mcp__world__<tool>`).
- **World tools are not listed up front.** They are deferred and found through `ALL_TOOLS` inside `exec`. That is Codex's default, so it is part of what is measured.
- **Output cap.** Codex sends no `max_output_tokens`, so the proxy writes its cap. Codex cells run the proxy with `--max-output-tokens 128000`.
- **Network.** With plugins on, Codex calls chatgpt.com and three other hosts at startup. With this config the only connections are the proxy and the MCP servers. Every Codex cell runs on the internal network anyway: preregistration refuses one without `network: "internal"` (HE-NET-001). The serve smoke there passes (`tests/internal-network-harnesses.test.ts`).
- **Skills.** A skill goes in `$CODEX_HOME/skills/<name>/SKILL.md`, and `$<name>` in the prompt invokes it.

## Tests

`bun test tests/codex-adapter.test.ts`, keyless. The process level runs the adapter against a stub `codex`. The container level builds the image and runs `serve` through the real metering proxy in lease mode into `tests/fixtures/fake-responses.ts`, with an in-process world.

## Changelog

### 2026-11-02: the gbrain hook launcher (internal-task-a, internal-task-b)

The installer line says the adapter also places gbrain#8424's hook launcher, alone in its directory. Why: from gbrain `2c469d1b` the hook command runs gbrain through `.gbrain/hook-launcher/gbrain-hook`, which refuses to run beside any other file, and the image build refused it as a file setup should not have written, so no view reached the adapter.

### 2026-10-31: official-minimal config (internal-task)

`HE_HARNESS_CONFIG=official-minimal` sets `model_instructions_file` to the fixed text in `ablation/official-minimal.txt`, for the prompt archaeology run's descriptive official-minimal cells. Unset, `config.toml` is unchanged.

### 2026-10-29: Image, adapter and keyless tests (internal-task)

First image, config template, adapter (`run` and `serve`) and keyless tests. No paid trial yet.

Review fixes: `Connection failed` is a model error (3), the provider check, and the internal-network smoke.
