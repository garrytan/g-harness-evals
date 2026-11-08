# QM harness

**[QM](https://github.com/yc-software/qm) at main commit `90e4ced75dba0f711e9737e5bb2f2d718870fb0f`, through Pi.**

- **Pin:** `main@90e4ced7` (2026-11-07 UTC), set by the S1 edition rerun's pilot amendment ([below](#re-pin-to-main-90e4ced7-2026-11-06-gst-1514-pilot-amendment)). QM has no release tag past `v0.1.15`. Most sections below were written at `b6786d67` and say so.
- **The `serve` entry does not work at this pin:** QM refuses MCP servers on private network addresses, so the world MCP server can't be registered (below). A build-arg alone does not get around this: `prepare.sh` refuses any image whose `harness-eval.commit` label differs from `pin.json`'s commit, and this Dockerfile copies files that `b6786d67` lacks. A multi-user cell runs from a worktree at the last main commit before the pilot amendment merged, where `pin.json`, the Dockerfile and the image label all name `b6786d675f83d9a818c5d5335cc017ffea9ec7a7`.
- **Older cells:** cells before 2026-10-30 ran tag `v0.1.15` (commit `7417aa2a`); their results keep that pin.
- **Topology:** QM is a service, so this is the sidecar topology of the [adapter protocol](../../docs/adapters.md). `compose.yaml` runs Postgres (`pgvector/pgvector:0.8.1-pg16`), QM core, and a task container whose entrypoint is `adapter.sh` (`HE_ENTRY` selects `run` or `serve`). Both entry points are implemented.
- **Signing:** `qm-api.mjs` signs every request to core the way QM's own plugins do (`x-timestamp`, `x-signature = v0=HMAC-SHA256(secret, "v0:<ts>:<METHOD>\n<path>\n<body>")`).

`run` posts one DM turn to core's `POST /v1/turns` as actor `U1` with `instruction.md` as the text, waits for the synchronous turn result and exits per the protocol.

`serve` first registers the world-MCP server through QM's admin API, `PUT /v1/admin/mcp-servers/world` with `{url: $HE_WORLD_MCP_URL, auth: "bearer", bearerToken: $HE_WORLD_MCP_TOKEN, credentialScope: "shared", readOnly: false, enabled: true}`, as the principal `harness-admin` (`x-admin-actor: harness-admin@harness-eval`; `config/core.env` grants it `org_admin` through `ADMIN_GRANTS`, the route refuses anyone else); core probes `tools/list` against the world before saving, so the 200 in `qm-mcp-register.json` lists the 14 tools. Then each `TurnRequest` becomes one `POST /v1/turns` whose `actor.externalId` is the requester's Slack user id (with `displayName`) and whose conversation is `{kind: "dm", threadRef: "dm:<member>"}` or `{kind: "channel", threadRef: "channel:<id>", channelRef: <id>, channelName}`. That is QM's native scoping: a DM runs in scope `personal:<slack user id>`, a channel in `channel:<id>`, and `threadRef` names the session inside the scope. The reply is `TurnResult.reply`. Core stays up for the whole trial; nothing is restarted between turns.

## Agent loop and configs (internal-task, re-pinned 2026-10-30)

**At `b6786d67` QM has one agent loop, Pi.**

- **Before:** at `v0.1.15` QM shipped two loops, chosen by core's `HARNESS` variable.
- **Now:** Pi only (`src/agent/agent-run.ts`, renamed from `src/harness/pi-harness.ts`). [yc-software/qm#2768](https://github.com/yc-software/qm/pull/2768) removed the Claude harness and the `HARNESS` variable; #2471 moved the mock harness into test support.
- **So:** the adapter's `claude` and `claude-probe` configs are gone, and core no longer gets `HARNESS` or `CLAUDE_MODEL`.

**How a config reaches QM.**

- The cell's `config` reaches the stack as `HE_HARNESS_CONFIG`.
- `prepare.sh` maps it to `QM_MEMORY_CAPTURE_QUIET_MS` and `QM_PROBE_CONFIG`, plus `QM_HARNESS=pi` as a label for the ready line. `compose.yaml` interpolates them into the core and task services.
- Accepted values (`pin.json` `configs`): `pi` (the default), `pi-probe`, `pi-strict`, `pi-command-deny` and `pi-memory-provider`. Any other value, `claude` and `claude-probe` included, exits 2 before the stack starts.
- `pi-memory-provider` (internal-task, the C4 run): `pi` plus gbrain as QM's per-turn memory provider. The runner gives core `MEMORY_PROVIDER_CONFIG` and a per-trial OAuth client pair through the stack's environment and registers no gbrain MCP server. The model can still search the brain through QM's own memory tool (action `search`), on the provider's credential and whole-brain (`provider_op` `query`). `prepare.sh` exits 2 without the three variables; `adapter.sh` exits 2 if `HE_GBRAIN_MCP_URL` is set. Details: [docs/gbrain-arm.md](../../docs/gbrain-arm.md), "QM's memory-provider cell".

- `pi`: QM's vendored pi-ai loop, model from `PI_MODEL` (set from `HE_MODEL_NAME`).
- No Codex loop exists at this pin: Codex is only a ChatGPT-subscription model provider inside Pi (`src/agent/agent-run.ts` `CODEX_SUBSCRIPTION_PROVIDER`, `src/model/codex-device-login.ts`).
- The published `qm-claude` results ([anatomy record](../../docs/harness-anatomy/records/qm-claude/plain.json), the probe runs) were measured at `v0.1.15` and stay as published.

Memory capture quiet time: QM captures memory after `MEMORY_CAPTURE_QUIET_MS` of quiet following a turn, 180 s by default (`src/memory/strategies/per-turn.ts:9`). The probe configs (`pi-probe`, `pi-strict`, `pi-command-deny`) set it to 5 s so a fact told in one turn can be captured before the next probe turn; this is a deviation from the shipped product recorded in `pin.json` and reaches probe cells only. The held-out config `pi` keeps 180 s.

`pi-strict` and `pi-command-deny` PUT one org-scope setting through QM's admin API before the first turn (`qm-api.mjs admin-put`, as `harness-admin`); the 2xx response is saved as `qm-admin-<resource>.json` beside `qm-mcp-register.json`. Before every turn, `serve` also reads what QM's memory holds per scope through the admin memory routes into `<turn>.memory.json`, as an observation for the probe report.

Core runs without QM's Slack worker, which is what fills QM's directory store (members, channels, rosters) in the shipped product. QM reads channel membership from that store to decide who may use or create a channel's sandbox (`src/resolution/scope-membership.ts`, `src/wiring.ts` `canUseSandboxScope` at the pin), so an empty directory refuses every channel-scoped `execute` and `sandbox create` (docs/qm-findings.md F5, run `qm-probes-2026-10`). Since 2026-10-25 `serve` pushes the bot's channels and their rosters once before the first turn (`qm-directory.mjs` reads them from the world's Slack API, `qm-api.mjs post /v1/directory`; body and 2xx saved as `qm-directory.body.json` and `qm-directory.json`); the reads land in the trial's event log before turn 1. Members are not pushed, so identity classification is unchanged. Runs before that date (`qm-inner-harness-2026-10`, `qm-probes-2026-10` and every earlier QM cell) ran with an empty directory.

**MCP tools at `b6786d67`** (measured in the [anatomy captures](../../docs/harness-anatomy/qm.md)):

- **No schemas.** QM no longer sends a registered server's tools with their schemas. The model sees a `## Connectors` note of at most about 2,000 tokens and reaches the tools through `tool_search` and `mcp_call` (`src/agent/deferred-tools.ts`), unless the registration sets `catalog: true`.
- **QM's defaults.** The adapter leaves `catalog`, `approval` and `attestActor` unset, so the world and gbrain get QM's defaults.
- **Approval.** Under the default `approval: annotations`, a tool needs approval only when it declares `destructiveHint: true` and not `readOnlyHint` (`src/mcp/mcp-tool-service.ts:37-44`). The world's tools declare no annotations.
- **Read-only turns.** The `readOnly` label now hides unmarked tools on read-only turns (`src/agent/deferred-tools.ts:12-17`). The adapter registers with `readOnly: false`, as before.

## Particle cells (internal-task)

**QM can run Particle-1.** On a Particle cell the runner's URL ends in `/<slot>/particle`. Pi at `b6786d67` has custom model providers: protocol `openai` is pi-ai's `openai-completions`, Chat Completions at any base URL (`src/model/custom-providers.ts`). With no Anthropic key, QM makes no Haiku call: the auxiliary model for a provider with no auxiliary model is the cell model (`auxiliaryModelFor`, `src/model/pi-models.ts`), and the Anthropic-only ack call is skipped without an Anthropic key (`pickAckEmoji`, `src/agent/agent-run.ts`). An Anthropic cell's stack is unchanged.

- **`prepare.sh`** prints four overrides for a Particle URL only: `QM_PI_MODEL=custom/particle/<model>`, and empty `QM_MODEL_PROVIDER`, `QM_ANTHROPIC_API_KEY` and `QM_ANTHROPIC_BASE_URL`. With `MODEL_PROVIDER=anthropic` core refuses to start without an Anthropic key (`src/deployment/secret-schema.ts`).
- **`compose.yaml`** reads those overrides for core and falls back to the old values when they are unset. `docker compose config` for an Anthropic cell is the same as before.
- **`adapter.sh`** registers the provider before the first turn: `PUT /v1/admin/custom-providers/particle` as `harness-admin`, protocol `openai`, base URL `$HE_MODEL_BASE_URL/v1`, the cell model with reasoning on and `maxTokens` 128,000, and the per-trial token as its key. The request file holds the token, so it is written mode 0600 outside the trial's logs and deleted after the call.
- **Requests.** Pi sends `reasoning_effort: medium` (its `auto` effort is medium for a non-Anthropic model) and `max_completion_tokens` 128,000 on every request, streamed with usage.
- **Caveat.** On a provider refusal or `model_unavailable` error, Pi retries the turn on `claude-opus-5` (`REFUSAL_FALLBACK_MODEL_IDS`, `src/agent/agent-run.ts`). On a Particle cell core has no Anthropic key, so that retry cannot reach a model, and the turn fails as a model error.
- **Errors.** QM's turn mapping is unchanged: `qm-api.mjs` maps any failed turn whose reason names the provider or model to exit 3. Pi words every provider error that way, so on a Particle cell any provider 400 is exit 3, wider than plan decision 12. The runner applies decision 12 from the metering proxy's record and overrides this (HE-MODEL-002, [docs/errors.md](../../docs/errors.md)): an exit 3 on a 400 outside the listed codes becomes `harness_error` unless the trial also logged a 429, a 5xx or a failed request.

Keyless proof (2026-10-31, `tests/particle-branch.test.ts`): one `run` turn through the compose stack, straight against a fake Particle endpoint, because the proxy's Particle route was not on main yet. The turn completed. Both requests (one side call, one agent turn) named `particle-1` with effort medium and `max_completion_tokens` 128,000. An Anthropic trap URL on the fake was never called. No paid Particle call has been made.

## OpenAI models

**A QM cell can run on an OpenAI model such as GPT-6.1 Sol.**

- **Cell model:** `openai:<model>`, for example `openai:gpt-6.1-sol`. The runner then merges `compose.openai.yaml` over `compose.yaml`. An Anthropic cell loads no extra file.
- **Wiring:** QM core gets `OPENAI_BASE_URL` set to the metering proxy's `/openai` route plus `/v1`, and the per-trial dummy token as `OPENAI_API_KEY`. `MODEL_PROVIDER=openai` is set and the Anthropic pair is cleared. No real key reaches the stack.
- **Housekeeping:** on an OpenAI cell, QM's own housekeeping calls go to `gpt-5.6-luna` (harness housekeeping, shipped default), as they go to `claude-haiku-5-5` on an Anthropic cell. List it in the cell's `utility_models` so the proxy forwards and meters it.
- **Where it runs:** Sol cells run through the runner and the shard path (`scripts/run-shard.sh`). The single-shot `harnesses/run-trial.sh` now merges `compose.<provider>.yaml` the same way, so hello and smoke runs work too.

## Images

Both images fetch QM by commit (`QM_COMMIT`), not by tag: `git fetch --depth 1 origin <sha>`, then the build fails unless `git rev-parse HEAD` equals that sha. Both carry the labels `harness-eval.commit` and `harness-eval.version`.

**`prepare.sh` refuses stale images.** Before the stack starts, the `harness-eval.commit` label on `QM_IMAGE` and `QM_SANDBOX_IMAGE` must equal `pin.json` `commit`; a missing or other-commit image exits 2 (HE-RUN-006). The tags are reused across pins, and a `v0.1.15` core with no `HARNESS` set runs QM's mock harness (canned replies, no model call).

- **`Dockerfile`** builds QM core from the pinned source the way the repository's `deploy/core/Dockerfile` does at that commit: same `node:24.22.1-alpine3.24` digest, `npm ci --omit=dev --ignore-scripts`, connector SDK build, the same runtime `COPY` list.
  - **Added:** Docker CLI and bash for the local sandbox backend, `adapter.sh`, `qm-api.mjs` and `qm-directory.mjs`. `GIT_SHA` is set to the commit, as QM's own build argument does.
  - **Left off:** the WireGuard egress helper and `npm run audit:prod`.
  - The same image runs the `core` service and the `task` container.
- **`Dockerfile.sandbox`** builds the per-scope sandbox image (`harness-eval/qm-sandbox:dev`) the way `scripts/local-sandbox-build.sh` does.
  - **Base:** the repository's `fly/Dockerfile` (Debian 12, Node 24.22.1, Claude Code and Codex CLIs, gh, a Python venv).
  - **Daemon:** the in-sandbox agent from `local/Dockerfile` (`cli/templates/aws/microvm-agent/agent.mjs` at this commit).
  - **Left off:** the browser engine (off by default upstream too), the AWS CLI and the arm64 branch.

## How a turn reaches the workspace

QM's agent never touches core's filesystem. Its `files` and `execute` tools act inside a per-scope sandbox container that core spawns through the Docker socket, and the scope's working directory is `/root/workspace` inside that sandbox. So `compose.yaml` gives core the host's Docker socket and `capture.sh` runs after the turn: it copies `/root/workspace` out of every sandbox labelled `qm.sandbox=1` for org `harness-eval` into the trial's `/workspace`, then removes the sandbox container, its home volume and its network. Sandbox names derive from the scope, not the trial, so without that removal the next trial would start on the previous trial's files (methodology item 2 asks for a fresh sandbox per trial). `prepare.sh` mints the per-trial `CORE_SIGNING_SECRET` and `CONNECTOR_SECRET_KEY` and pre-creates the bind-mount targets so Docker does not create them as root.

Core runs with `NODE_ENV=development`.

- **Production** (`NODE_ENV=production`, or `REQUIRE_SIGNED_PORTAL_IDENTITY=1`; `src/api/server.ts:481`, `src/config.ts:1546`) requires a portal identity token, on top of the source signature, on person and admin routes. System routes are exempt: a non-web `POST /v1/turns` and `POST /v1/directory`, the two the adapter posts as a source (`src/api/server.ts:283-291` at `b6786d67`).
- **Development** (with `REQUIRE_SIGNED_PORTAL_IDENTITY` unset) accepts the signature alone on every route, so the adapter's admin calls pass.
- **Known deviation:** counted runs use development mode. Production mode would need the adapter to mint a portal identity token for its admin calls; `qm-api.mjs` sends no `x-portal-identity` header today.

## Where it stopped and why, and what was changed

1. **No sandbox backend, no file.** With `SANDBOX_BACKEND=local` but no Docker socket in the stack, Pi answered (trial qm-hello-2) that it could not create the file: `The only sandbox provider here is local, which needs a running Docker daemon, and Docker isn't running.` Both the shell and the file tool refuse without a sandbox. Fixed by mounting the socket and building the sandbox image.
2. **A containerised core cannot reach its sandboxes.**
   - **Why:** the local backend publishes each sandbox's daemon on `127.0.0.1:<random>` and dials that address. `localSandboxEnv` in `src/config.ts` never reads `QM_CORE_CONTAINER`, so the by-name path through a shared network is unreachable from config.
   - **Still true at `b6786d67`:** `LocalSandboxEnv` declares `coreContainer` (`src/config.ts:301`), but `localSandboxEnv` never sets it (`:305-313`). The `QM_CORE_CONTAINER` line at `:288` is in the AWS backend's env.
   - **What it looked like:** a core in its own network namespace gets `connection refused` on its own loopback (trial qm-hello-3, two sandbox attempts; Pi reported `its exec daemon never became reachable (connection refused on 127.0.0.1)`).
   - **Fix, without patching QM:** core runs with `network_mode: host`, Postgres on a loopback port (`QM_PG_PORT`, default 55432) and core on `QM_CORE_PORT` (default 58080).
   - **Cost:** one QM trial at a time per host, unless the ports are varied per trial.
3. **Permissions.** The image's `node` user (uid 1000) could not write the trial's log mount; the services now run as the calling user (`HE_UID`, `HE_GID`) with the Docker socket's group added, and core's `DATA_DIR` is a bind mount under the trial's state directory.
4. **Required secrets.** Core refuses to start with a durable store unless `CONNECTOR_SECRET_KEY` is set (trial qm-hello-1). Minted per trial by `prepare.sh`.

Not done: the `admin` and `web-ui` services, Slack, the egress proxy, and the model gateway (`MODEL_GATEWAY_URL` wants LiteLLM-style `/v1/models` and `/model_group/info` discovery, which the metering proxy does not serve; the direct `ANTHROPIC_BASE_URL` override works instead). QM's MCP connector registration is done in `serve` (above). The per-trial `CREATE DATABASE trial_x TEMPLATE qm_seed` reset from the plan is replaced by a fresh Postgres container per trial, which is slower (about 10 s to healthy plus migrations) but equivalent for isolation.

## Re-pin to main 90e4ced7 (2026-11-06, internal-task pilot amendment)

**The S1 edition driver runs at `90e4ced7`; the adapter's `serve` entry does not.** The pilot amendment of [qm-s1-edition](../../docs/benchmarks/2026-11-06-qm-s1-edition/PREREGISTRATION.md#amendments) pins the newest QM main, 265 commits after `b6786d67`.

- **Core build.** QM's `deploy/core/Dockerfile` gained a web UI build stage; `Dockerfile` follows it (the `web-ui-build` stage and the `cli/src/web-release.ts`, `plugins/auth/src`, `plugins/portal/src`, `plugins/web-ui` files it copies).
- **Session reads.** QM #2964 and #2971 answer `GET /v1/admin/sessions/:id` with `items`, not `entries`. The gstack driver maps them back (`gstack/s1-count.ts` `entryFromItem`, a port of QM `b6786d67`'s own converter).
- **Checked:** the keyless S1 edition dry run passes at this pin ([receipt](gstack/receipts/s1e-dry-run-6cf00aee.json), edition `6cf00aee`; the earlier [receipt](gstack/receipts/s1e-dry-run-90e4ced7.json) ran edition `eaf1701d`): core starts, the deployment layer installs, skills load, sandbox commands run, and a floor-rule command is approved once through `POST /v1/turns`.
- **Broken: world-MCP registration.** QM #2801 (2026-10-30, after `b6786d67`) sends MCP and OAuth requests through `publicFetch` (`src/util/network.ts:98`, used by `src/mcp/mcp-client.ts:103` and `src/connectors/oauth.ts:74`), which refuses any host that resolves to a private address, with no setting to allow one. A keyless anatomy capture (`scripts/anatomy/capture.ts --harness qm --scenario plain --egress off`, 2026-11-07) got `400 {"error":"unreachable","message":"tools/list against host.docker.internal:<port> failed: ... resolves to a private network address"}` from `PUT /v1/admin/mcp-servers/world`, so `adapter.sh serve` exits 2 before `ready`. The gbrain memory provider's OAuth goes through the same guard and was not tried.
- **Not re-checked at this pin:** `adapter.sh run`, the Particle branch and the provider preflight.

## Re-pin to main b6786d67 (2026-10-30, internal-task-a for internal-task-b M1)

**The adapter runs QM at `b6786d67` with two config changes and no API change.** QM's routes, signing and admin bodies the adapter uses still work; the Claude loop is gone and MCP tools now hide behind a search tool. Checked against `git diff 7417aa2a b6786d67` (211 commits).

Changed in QM, adapted here:

- **One agent loop.** [#2768](https://github.com/yc-software/qm/pull/2768) removed the Claude harness and the `HARNESS` variable. Dropped the `claude` and `claude-probe` configs (`prepare.sh`, `runner/run.ts`, `harnesses/serve-smoke.ts`, `tests/qm-config.test.ts`) and `HARNESS` and `CLAUDE_MODEL` from core (`compose.yaml`, `config/core.env`).
- **Core build.** `deploy/core/Dockerfile` now pins `node:24.22.1-alpine3.24` by digest, runs `npm ci --omit=dev --ignore-scripts` without `.husky/install.mjs`, and copies three more `cli/src` files (`canonical-json.ts`, `render-job-command.ts`, `render-source.ts`). `Dockerfile` follows it.
- **Sandbox build.** `local/Dockerfile` copies the agent daemon from `cli/templates/aws/microvm-agent/agent.mjs` (was `aws/microvm-agent/agent.mjs`), and `fly/Dockerfile` pins `node:24.22.1-bookworm-slim` by digest and checks `claude --version` and `codex --version`. `Dockerfile.sandbox` follows it.

Changed in QM, no adapter change needed:

- **Route actors.** Routes now declare an actor. `POST /v1/turns` and `POST /v1/directory` are `system` routes; admin routes are `person` routes, which need a portal identity only in production (`src/api/server.ts:283-291`, `:481`). Core runs with `NODE_ENV=development`, so the source signature alone still passes, as before.
- **MCP registration.** `PUT /v1/admin/mcp-servers/:id` takes three new optional fields (`approval`, `catalog`, `attestActor`) and stores the server's `serverInfo.description` or instructions as its about line (`src/api/routes/admin/mcp-servers.ts:91-123`, `:229-231`). The response is still `{ok, server, tools}`; the smoke's registration answered 200.
- **MCP exposure.** Registered tools are listed in a `## Connectors` note and called through `tool_search` and `mcp_call` (above). This changes what QM sends the model, not what the adapter sends QM; [docs/harness-anatomy/qm.md](../../docs/harness-anatomy/qm.md) measures it.
- **Turn request.** `TurnRequest` gains `surfaceBriefing` and loses `harness`; `POST /v1/turns/:runId/metrics` is gone. The adapter sends neither. `TurnResult.status` keeps the same seven values.

Unchanged: the request signature (`plugins/chassis/src/source-auth-sign.ts`), the admin memory routes and their handler (`src/api/routes/admin/memory.ts`), the admin principal check (`src/api/routes/shared.ts`), the `security-posture` and `command-policy` scope routes, the org floor command rules, and every variable in `config/core.env`.

Keyless smoke on the images the anatomy captures used ([smoke-b6786d67.json](smoke-b6786d67.json)), $0, fake model endpoint, re-run 2026-10-31 UTC:

- **Images.** Local image ids; nothing was pushed to a registry.
  - Core `harness-eval/qm:dev` `sha256:dea5ec20c66e15be540702967c10acbd5e3c33fb7273f1575b04caad10b6b55d`: built from `12e1ad9b`, the core image in every capture's `capture.json`.
  - Sandbox `harness-eval/qm-sandbox:dev` `sha256:e997a1db94e07f105132d3927c242744d1fcb1ce2ea2b0e076c1e9ada74f3ea8`: the only sandbox build of this pin.
  - Both carry the label `harness-eval.commit=b6786d675f83d9a818c5d5335cc017ffea9ec7a7`, and both builds printed `qm checkout b6786d675f83d9a818c5d5335cc017ffea9ec7a7` from the `git rev-parse` check.
- **Turn.** The anatomy kit's plain capture ran one two-turn trial through the runner (run `anatomy-capture-qm-pi-plain-20261031t023435`): both turns `status: ok`, reply `ok` (the fake's scripted text).
- **Final tree.** Rebuilt after the review fixes (not run): the sandbox image has the same layers and image config as `e997a1db`. Core's first 16 of 19 layers match `dea5ec20`; the last 3 hold the adapter files the fixes touched (comments in `config/core.env`, two strings in `pin.json`).
- **Earlier smoke.** On 2026-10-30 the same two steps passed on an earlier core build (`sha256:1cf55ef0…`); core was rebuilt from `12e1ad9b` before the captures.
- **Sandbox command.** A scripted `execute` with `scope: scratch` ran in a container from `harness-eval/qm-sandbox:dev` and returned `sandbox-ok`, `x86_64`, Debian `12.15`, Node `v24.22.1`, Python `3.11.2`, Claude Code `2.1.210`, `agent.mjs`, `/root/workspace`, exit 0.
- **A scope has no sandbox until the agent makes one.** `execute` without a scope answered `this scope has no default sandbox; use sandbox list, create, set_default, then retry`. QM behaves the same at `v0.1.15` (`NoDefaultSandboxError`, `src/sandbox/sandbox-routing.ts`), so this is not new.

## gstack on QM (2026-10-31, internal-task-a for internal-task-b M1 step 6)

**Raw gstack does not import as a QM skill pack at `b6786d67`.** QM registers it, then refuses it with `pack exceeds max bytes (33554432)`: the tree is 74.9 MiB against a 32 MiB cap. A keyless S1 fixture puts gstack's paste-in router in the org SOUL and reads one staged skill in full. Details, scripts and receipts: [gstack/README.md](gstack/README.md).

## Memory-provider preflight (2026-10-31, internal-task-a for internal-task-b M1 step 3)

**QM reached gbrain as a memory provider, with real OAuth client credentials, and the seeded fact showed up in the stored turn.** All 10 checks passed at `b6786d67` against gbrain `a590ad07` (the pin in `gbrain/pin.json`), $0, no model call ([provider-preflight-b6786d67.json](provider-preflight-b6786d67.json)).

**Run it** (keyless; needs Docker, `harness-eval/qm:dev` built at the commit, `harness-eval/gbrain:dev`):

```
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/provider-preflight.ts [--qm-commit <sha>] [--receipt <file>]
```

- **Inputs:** `--qm-commit` (default `pin.json` `commit`; the core image's `harness-eval.commit` label must match it, or the script exits 2 with the build command), `--qm-image`, `--gbrain-image`, `--core-port` and `--pg-port` (58080 and 55432, as `compose.yaml`), `--out`.
- **Re-run at another commit:** `docker build --build-arg QM_COMMIT=<sha> -t harness-eval/qm:dev harnesses/qm`, then `--qm-commit <sha>`. The checks accept both stored-turn shapes: `b6786d67` (recall text in `payload.environment`) and `f3577189` (recall rows in an `untrusted-data` block, plus `memoryRecallOutcomes`, where the gbrain outcome must be `ok` on the good turn and not `ok` on the bad one).
- **Outputs** under `--out` (default `~/.capy/work/harn15/provider-preflight/<run>`, never committed): `receipt.json`, `events.ndjson` (the world's log: the tap's `gbrain.*` events and the issuer's `oauth.token` events), `stored-turns.json` (every `UserMessage` row of QM's `items` table), `fake.ndjson` (every model request), `core.log`, `<turn>.turn.json`. `--receipt` also writes the receipt where you name it. The script scans the receipt for token shapes and the run's own secrets before writing it.

**What runs.**

- QM core and Postgres from `compose.yaml`, plus a generated override that adds `MEMORY_PROVIDER_CONFIG` and the two client variables. No MCP server is registered, so the provider is QM's only way to gbrain.
- The model is `scripts/gsta-135/fake-anthropic.ts` with a dummy key. It answers `ok`.
- The world server runs in process with the gbrain tap and its OAuth issuer (`world/services/oauth-issuer.ts`, off unless the upstream's `provider` block has `clients`). The keyword gbrain sidecar sits behind the tap.
- Steps: seed one fact with `remember` (straight to the sidecar); a DM turn asking for it; a DM turn in a new thread asking something unrelated; then core recreated with a wrong client secret, and the fact question again.

**The exact `MEMORY_PROVIDER_CONFIG`** (`url` is the world's tap; the port is random per run):

```json
{"providers":[{"id":"gbrain","type":"mcp","url":"http://127.0.0.1:<world port>/gbrain","timeoutMs":10000,
  "read":{"tool":"recall","queryArg":"question","maxCharsArg":"max_chars","clientIdEnv":"QM_PF_READ_CLIENT_ID","clientSecretEnv":"QM_PF_READ_CLIENT_SECRET"}}],
 "routes":[{"provider":"default","scopes":["personal","channel","group","team","org"],"capture":"automatic"},
  {"provider":"gbrain","scopes":["personal"],"capture":"off","manage":false,"label":"gbrain","failOpen":false}]}
```

`QM_PF_READ_CLIENT_ID` is `qm-memory-read`; the secret is random per run and never written.

**How the OAuth check works.** QM's client (MCP SDK 1.32.1, `ClientCredentialsProvider`) binds the pair to the issuer `new URL("/", <MCP URL>)` and refuses to send it anywhere else (`src/mcp/mcp-client.ts`). So the world issuer advertises the origin of the request as the client addressed it. QM got a 401 from the tap, read `/.well-known/oauth-protected-resource/gbrain` and `/.well-known/oauth-authorization-server`, and posted `grant_type=client_credentials` with `client_secret_basic`. The issued token then passed the tap like a world token.

**Results at `b6786d67`** (core `sha256:52f1ab3c...`, gbrain `a590ad07` image `sha256:8cf58f10...`):

| Check | Result |
|---|---|
| Issuer equals the MCP URL origin | pass |
| Client-credentials token issued (one, `client_secret_basic`) | pass |
| `failOpen: false` on the gbrain route | pass |
| Stored `UserMessage`: `payload.environment` holds the fact under `### gbrain`; `payload.memoryRecall` present | pass |
| Recall event in the tap's log (`gbrain.recall`, ok, 30 ms) | pass |
| Unrelated question: recall ran, no fact in the stored turn | pass |
| Wrong secret: 4 token requests refused `invalid_client`, no token, no recall, no stored turn | pass |
| Failure visible: the turn answered HTTP 500 | pass |

**What we found** (labelled for M1's preregistration):

- **`max_chars`: gbrain runs the call but ignores the argument.** gbrain at `a590ad07` (0.60.522.0; `mcp.strict_params` default `warn`), and at `32366ac2` in an earlier run of the same script, answers `recall` and adds a text block: `warning: unknown parameter "max_chars" ignored. A future release rejects unknown parameters.` The same happens for QM's default `acting_user` argument. QM joins every text block, so both warnings land in the stored `<environment>` on every turn. A gbrain release that rejects unknown read parameters would fail every recall, and under `failOpen: false` every DM turn.
- **`recall` with `query` alone is not query-scoped for facts.** gbrain returns the newest saved facts whatever the query (its own `recall_hint` notice says so). `question` ranks facts and returns none for an unrelated question, so the config maps `queryArg` to `question`.
- **An empty recall is not empty to QM.** For the unrelated question gbrain sent `{"facts":[],...}` plus three notices (degraded keyword search, and the two unknown-parameter warnings). QM stored that 1,139-character environment and a `memoryRecall` record, as for a real hit.
- **A fail-closed turn says little to the caller.** The wrong-secret turn answered HTTP 500 `{"error":"internal_error"}` in this receipt's run and in 3 of 3 reruns with one connector key for the whole run. One early run, made while the script still drew a new `QM_CONNECTOR_SECRET_KEY` per phase, got HTTP 200 `status: failed` instead; it did not reproduce, so treat it as a preflight artifact. Only core's log names the cause (`InvalidClientError: unknown client or wrong secret`). The user turn was not stored.
- **The fact reached the model.** The fake's log shows the seed fact in the positive turn's agent request (`model_request_carried_seed_fact`).

## M0 smoke

Run on 2026-10-22 with `harnesses/run-trial.sh --harness qm --task tasks/hello`, proxy lease `m0-laneb-hermes` (`--allow-models anthropic:claude-sonnet-5-5`, `--max-output-tokens 128000`), task container with stdin from `/dev/null` and no TTY.

| Trial | Exit | Termination | Grade | Wall | Proxy calls | Tokens in / out | Cost | Note |
|---|---|---|---|---|---|---|---|---|
| qm-hello-1 | 1 | infra_error | fail | 15.0 s | 0 | 0 / 0 | $0 | core refused to start: `CONNECTOR_SECRET_KEY is required with durable storage` |
| qm-hello-2 | 0 | completed | fail | 22.9 s | 6 forwarded | 92,553 / 571 | $0.0611 | turn ok; Pi reported no sandbox backend available |
| qm-hello-3 | 0 | completed | fail | 88.0 s | 7 forwarded | 109,292 / 732 | $0.0372 | sandboxes spawned but unreachable from a bridged core |
| qm-hello-4 | 0 | completed | pass | 26.9 s | 6 forwarded | 93,023 / 588 | $0.0321 | host networking for core; file captured from the sandbox |
| qm-hello-5 | 0 | completed | pass | 25.5 s | 6 forwarded | 93,516 / 600 | $0.0321 | rerun on the final compose file; no sandbox or volume left behind |

Wall time includes about 10 s for Postgres and core to come up and 2 s of health polling. Each QM turn costs more input tokens than the other two harnesses (six to seven Pi steps of 15k tokens each against two of 13k to 17k) because Pi runs a sandbox-provisioning tool loop before writing the file.

Findings:

- QM also sends one `claude-haiku-5-5` request per turn (refused 403 by the allowlist, turn unaffected), like OpenClaw.
- Pi's reply in the passing trial notes `The workspace path is /root/workspace, not /workspace`: the model saw our instruction's path and worked in the sandbox's own workspace, which is the right behavior for QM and is what `capture.sh` grades.
- The sandbox image is large (Claude Code and Codex CLIs, gh, Python). It builds in about 90 s on this machine with a warm base.

## M1 serve smoke

Run on 2026-10-22 with `bun harnesses/serve-smoke.ts --harness qm --trial-id <trial> --budget 180`, proxy lease `m1-lanec-qm` (`--allow-models anthropic:claude-sonnet-5-5`, `--max-output-tokens 128000`), stack as the host user, task container with stdin closed and no TTY, world in-process on `0.0.0.0:8791` (core on the host network reaches it as `host.docker.internal`). Actors Dana Okafor (DM) and Hollis Mbeki (#general).

| Trial | Turn | Conversation | Exit | Wall | Proxy calls | Tokens in / out | Cost | World-MCP calls in the window |
|---|---|---|---|---|---|---|---|---|
| qm-serve-1 | 1 | dm:dana-okafor | 0 | not recorded | 2 | 40,374 / 155 | $0.0580 | `conversations.list` |
| qm-serve-1 | 2 | channel:C8PPLDSJBEF (#general) | 0 | not recorded | 2 | 39,666 / 134 | $0.0211 | `conversations.history`, `conversations.list` |
| qm-serve-1 | 3 | dm:dana-okafor | 0 | not recorded | 1 | 22,761 / 48 | $0.0091 | none |
| qm-serve-2 | 1 | dm:dana-okafor | 0 | 4.5 s | 2 | 40,243 / 130 | $0.0187 | `conversations.list` |
| qm-serve-2 | 2 | channel:C8PPLDSJBEF (#general) | 0 | 3.7 s | 2 | 39,666 / 135 | $0.0183 | `conversations.list`, `conversations.history` |
| qm-serve-2 | 3 | dm:dana-okafor | 0 | 2.5 s | 1 | 22,630 / 81 | $0.0094 | none |

Trial totals: qm-serve-1 5 forwarded calls, $0.0881; qm-serve-2 5 forwarded calls, 102,539 tokens in, 346 out, $0.0464 (the second trial read the prompt cache the first had written); lease `m1-lanec-qm` committed $0.1345 in total (`metering-proxy.ts summary`). Both task containers exited 0 on `docker compose stop`; ready about 10 to 17 s after `up` (Postgres, migrations, the MCP registration probe). In both trials turn 3 restated turn 1 without tools, so the `dm:dana-okafor` thread in scope `personal:<Dana's Slack id>` carried across turns. qm-serve-1's wall times are "not recorded" because the Alpine image's busybox `date` has no milliseconds and the adapter wrote truncated timestamps; the adapter now takes them from node and qm-serve-2 is the clean rerun.

Findings:

- Two `claude-haiku-5-5` requests per trial, refused 403 at $0 (the M0 finding, here per trial rather than per turn).
- No sandbox container was created in either trial: these turns needed no file or shell tool, so `capture.sh` had nothing to copy and reported so.
- The MCP registration route needs an `org_admin` grant; with Postgres and no `ADMIN_GRANTS`, core boots with no admin at all and the route answers 403, so `config/core.env` names `harness-admin`.

## Changelog

### 2026-11-06: re-pinned to main 90e4ced7 (internal-task pilot amendment)

Both images and `pin.json` name QM `90e4ced7`, the core build follows QM's new web UI stage, and the "Re-pin to main 90e4ced7" section says what was checked at the pin and that the `serve` entry's world-MCP registration fails there. Why: the S1 edition rerun pins the newest QM main.

### 2026-10-31: Particle cells (internal-task)

The "Particle cells" section: `prepare.sh`, `compose.yaml` and `adapter.sh` run Pi on a custom `openai` provider for a Particle URL, with no Anthropic key. Why: internal-task's cheap row runs Particle-1 on QM if a keyless check shows no Anthropic call, and it does (`tests/particle-branch.test.ts`).

### 2026-10-31: memory-provider preflight (internal-task-a, internal-task-b M1 step 3)

`provider-preflight.ts` and its receipt: QM core reaches gbrain only through `MEMORY_PROVIDER_CONFIG`, with OAuth client credentials from the world's new issuer, and the stored turn shows the seeded fact. The section lists the inputs, outputs, the exact config and what the run found about `max_chars`.

### 2026-10-31: gstack smoke and S1 probe staging (internal-task-a, internal-task-b M1 step 6)

Added the gstack section pointing at `gstack/README.md`: the skill-pack smoke's refusal, the Bun answer, and the keyless S1 fixture.

### 2026-10-30: re-pinned to main b6786d67 (internal-task-a, internal-task-b M1)

QM fetched by commit in both images, the core and sandbox builds re-derived from QM's own Dockerfiles at that commit, the `claude` and `claude-probe` configs dropped (QM removed its Claude harness), every QM change between the two pins listed, and a keyless turn and sandbox command run in the built images.

### 2026-10-24: inner-harness configs, thread sessions, database dump (internal-task)

`HE_HARNESS_CONFIG` through `prepare.sh` selects `pi` or `claude` and the probe configs; `:t<thread_ts>` session keys; `qm-api.mjs admin-put` and `admin-get`; per-turn memory snapshots; `capture.sh` writes a sandbox manifest and `logs/qm-db.sql.gz` through every caller (`COMPOSE_PROJECT_NAME`).

### 2026-10-22: serve (M1 lane C)

harness-evals v0.0.3. `serve` posting per-conversation turns as the requester, world-MCP registered through the admin API, `qm-api.mjs` replacing `post-turn.mjs`, `HE_ENTRY` and the turns mount in `compose.yaml`; two live three-turn trials.

### 2026-10-22: Stack and smoke

harness-evals v0.0.1. Core and sandbox images, compose stack, signed turn adapter, prepare and capture hooks; five trials, the last two passing.
