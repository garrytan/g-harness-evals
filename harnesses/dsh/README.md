# DeepSeek Harness (dsh)

**DeepSeek's open-source agent harness, run headless on the cell model through the metering proxy.** [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) is built as a stack of plugins. Its `headless` profile answers one task and exits, which is the shape the adapter needs. dsh can drive many providers. Here it drives the same Anthropic model as every other harness, so a comparison changes the harness and nothing else.

- **Pin:** npm `@deepseek-ai/dsh@0.2.2-rc.1`, installed with `npm ci` from the committed `package-lock.json` (every dependency fixed by integrity hash). The release is a developer preview, and upstream warns of breaking changes, so any re-pin is a new run ([pin.json](pin.json)).
- **Status:** keyless only. No paid trial has run on this harness.

## How a turn runs

```sh
dsh --profile headless --patch /opt/harness/config/patch.yml --json --permission-mode danger-full-access [--session-id <id>] - < prompt
```

- [config/patch.yml](config/patch.yml) is the only config change. It reads every per-trial value from the adapter's environment, so it holds no URL or token:
  - the `anthropic` route at `HE_MODEL_BASE_URL` with the per-trial token, two retries instead of five;
  - the cell model (`HE_MODEL_NAME`) as the default for every agent;
  - `tool-web` off, so no `web_fetch` (no harness here has web tools);
  - the world-MCP server, and gbrain on a gbrain cell, as `@deepseek-ai/dsh-mcp-client` rows. Tools appear as `mcp__world__<tool>`.
- **Sessions.** dsh makes a Session id on a key's first turn. The adapter keeps `key -> id` in `/harness-state/dsh-sessions.json` and passes `--session-id` after that. Keys are `dm:<member>` and `channel:<id>`, plus `:t<thread_ts>` for a new thread, as for every adapter.
- **Exit codes** follow [docs/adapters.md](../../docs/adapters.md): 3 when the final event's error starts with an HTTP status or has code `TRANSPORT`, 2 for any other failure (including an MCP tool call that failed at the transport level), 124 past the budget.
- **No side traffic.** `DSH_TELEMETRY_DISABLED=1` stops dsh's session telemetry. dsh's DeepSeek routes stay mounted with no key.

## Build

```sh
docker build -t harness-eval/dsh:dev harnesses/dsh
```

Behind an npm registry mirror, pass `--build-arg npm_config_registry=<url>`. The lockfile's hashes still decide what is installed.

## Checked keyless (2026-11-08, image built for linux/amd64)

- **`tests/dsh-adapter.test.ts`** (10 tests, process level, a stand-in `dsh`): the turn flags and environment, the exit mapping, sessions per key and thread, the MCP check before ready, the version check, the refusals, SIGTERM and the budget.
- **`run` against `scripts/gsta-135/fake-anthropic.ts`:** a scripted `bash` tool call wrote a file in `/workspace`, and the turn exited 0. Every request went to `<base>/v1/messages` on the cell model.
- **`harnesses/serve-smoke.ts --harness dsh`** against the same fake endpoint and an in-process world: ready in 1.3 s, three turns exited 0, one `mcp__world__list_channels` call landed in the world's event log, the third turn resumed the first turn's DM Session (9 messages sent), and SIGTERM stopped the container with exit 0. On Docker Desktop, run it with `HE_CONTAINER_HOST_IP=127.0.0.1`.
- **What dsh sends** (observed against the fake endpoint, `claude-opus-5-5`): 23 built-in tools plus the 18 world tools, `max_tokens` 128000, adaptive thinking. Each new Session also sends one title request with no tools and `max_tokens` 4096, on the cell model.
- **Errors observed:** a 402 or 500 from the endpoint ends as a final error starting with the status; a closed port as `TRANSPORT: Connection error.` in 3 s; an MCP server's HTTP 502 mid-turn as the tool result `Error: Error POSTing to endpoint: bad gateway`.

## Limits

- **No paid run yet.** Nothing here says how dsh does on the tasks.
- **Not checked yet:** the real metering proxy in lease mode (the fake endpoint stood in for it) and the `internal` network.
- **No gbrain install rung and no instruction routes.** `HE_GBRAIN_INSTALL` and any `HE_HARNESS_CONFIG` other than `default` are refused with exit 2. A bare gbrain MCP server is wired in.
- **Session titles cost one small extra request per new Session.** That is dsh as shipped, kept as is.
