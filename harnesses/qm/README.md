# QM harness

[QM](https://github.com/yc-software/qm) at tag `v0.1.15` (commit `7417aa2a3f917cf97406914897078ae3b273e173`) through its Pi inner harness. QM is a service, so this is the sidecar topology of the [adapter protocol](../../docs/adapters.md): `compose.yaml` runs Postgres (`pgvector/pgvector:0.8.1-pg16`), QM core, and a task container whose entrypoint is `adapter.sh`. The task container posts one DM turn to core's `POST /v1/turns` as actor `U1` with `instruction.md` as the text, signed the way QM's own plugins sign requests (`x-timestamp`, `x-signature = v0=HMAC-SHA256(secret, "v0:<ts>:POST\n/v1/turns\n<body>")`), waits for the synchronous turn result and exits per the protocol.

## Images

- `Dockerfile` builds QM core from the pinned source the way the repository's `deploy/core/Dockerfile` does (npm ci, connector SDK build, source copied in), plus Docker CLI for the local sandbox backend and our adapter. The same image runs the `core` service and the `task` container.
- `Dockerfile.sandbox` builds the per-scope sandbox image (`harness-eval/qm-sandbox:dev`) the way `scripts/local-sandbox-build.sh` does: the repository's `fly/Dockerfile` base (Debian 12, Node 24, Claude Code and Codex CLIs, gh, a Python venv) with the in-sandbox agent daemon from `local/Dockerfile`. The browser engine is left off.

## How a turn reaches the workspace

QM's agent never touches core's filesystem. Its `files` and `execute` tools act inside a per-scope sandbox container that core spawns through the Docker socket, and the scope's working directory is `/root/workspace` inside that sandbox. So `compose.yaml` gives core the host's Docker socket and `capture.sh` runs after the turn: it copies `/root/workspace` out of every sandbox labelled `qm.sandbox=1` for org `harness-eval` into the trial's `/workspace`, then removes the sandbox container, its home volume and its network. Sandbox names derive from the scope, not the trial, so without that removal the next trial would start on the previous trial's files (methodology item 2 asks for a fresh sandbox per trial). `prepare.sh` mints the per-trial `CORE_SIGNING_SECRET` and `CONNECTOR_SECRET_KEY` and pre-creates the bind-mount targets so Docker does not create them as root.

Core runs with `NODE_ENV=development`. In production mode QM requires a portal identity token on every POST in addition to the source signature; development mode accepts the signature alone. A counted run should mint the portal identity (`PORTAL_IDENTITY_SECRET`) so the deployment matches what a company would run.

## Where it stopped and why, and what was changed

1. **No sandbox backend, no file.** With `SANDBOX_BACKEND=local` but no Docker socket in the stack, Pi answered (trial qm-hello-2) that it could not create the file: `The only sandbox provider here is local, which needs a running Docker daemon, and Docker isn't running.` Both the shell and the file tool refuse without a sandbox. Fixed by mounting the socket and building the sandbox image.
2. **A containerised core cannot reach its sandboxes at v0.1.15.** The local backend publishes each sandbox's daemon on `127.0.0.1:<random>` and dials that address. At this tag `localSandboxEnv` in `src/config.ts` never reads `QM_CORE_CONTAINER` (only the AWS backend's env does), so the by-name path through a shared network is unreachable from config, and a core running in its own network namespace gets `connection refused` on its own loopback (trial qm-hello-3, two sandbox attempts, Pi reported `its exec daemon never became reachable (connection refused on 127.0.0.1)`). Fixed without patching QM by running core with `network_mode: host`, Postgres on a loopback port (`QM_PG_PORT`, default 55432) and core on `QM_CORE_PORT` (default 58080). The consequence is one QM trial at a time per host unless the ports are varied per trial.
3. **Permissions.** The image's `node` user (uid 1000) could not write the trial's log mount; the services now run as the calling user (`HE_UID`, `HE_GID`) with the Docker socket's group added, and core's `DATA_DIR` is a bind mount under the trial's state directory.
4. **Required secrets.** Core refuses to start with a durable store unless `CONNECTOR_SECRET_KEY` is set (trial qm-hello-1). Minted per trial by `prepare.sh`.

Not done in M0: the `admin` and `web-ui` services, Slack, the egress proxy, the model gateway (`MODEL_GATEWAY_URL` wants LiteLLM-style `/v1/models` and `/model_group/info` discovery, which the metering proxy does not serve; the direct `ANTHROPIC_BASE_URL` override works instead), and QM's MCP connector registration. The per-trial `CREATE DATABASE trial_x TEMPLATE qm_seed` reset from the plan is replaced in M0 by a fresh Postgres container per trial, which is slower (about 10 s to healthy plus migrations) but equivalent for isolation.

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

## Changelog

### 2026-10-22: Stack and smoke

harness-evals v0.0.1. Core and sandbox images, compose stack, signed turn adapter, prepare and capture hooks; five trials, the last two passing.
