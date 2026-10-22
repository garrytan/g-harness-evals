# OpenClaw harness

[OpenClaw](https://docs.openclaw.ai/) `2026.10.6` from npm, installed under `/opt/harness`. One turn is `openclaw agent exec --message-file /workspace/instruction.md --cwd /workspace --config <state>/openclaw.json --state-dir <state>/exec --model anthropic/claude-sonnet-5-5 --json` ([docs](https://docs.openclaw.ai/cli/agent)). `agent exec` is OpenClaw's own headless path: no gateway, no onboarding, temporary run state under the directory we give it.

## Configuration

`config/openclaw.json` (JSON5) is copied to `/harness-state/openclaw/openclaw.json` at the start of a trial. It overrides the built-in `anthropic` provider's `baseUrl` and `apiKey` with `${HE_MODEL_BASE_URL}` and `${HE_MODEL_API_KEY}` (OpenClaw substitutes `${VAR}` from the environment), declares the `claude-sonnet-5-5` catalog row, and pins `agents.defaults.model.primary`. `OPENCLAW_STATE_DIR` and `HOME` point at `/harness-state`. No wizard runs because the config exists and `agent exec` never calls onboarding.

Exit mapping: OpenClaw exits 0 on a completed turn, 1 on a model or result error and 2 on its own timeout. The adapter reports 0, then 124 if the outer `timeout` fired, then 3 if the JSON envelope or stderr shows a provider status, proxy refusal, rate limit or auth error, else 2.

## M0 smoke

Run on 2026-10-22 with `harnesses/run-trial.sh --harness openclaw --task tasks/hello`, proxy lease `m0-laneb` (`--allow-models anthropic:claude-sonnet-5-5`, default 32768 output-token cap), container run as the host user with stdin from `/dev/null` and no TTY.

| Trial | Exit | Termination | Grade | Wall | Proxy calls | Tokens in / out | Cost |
|---|---|---|---|---|---|---|---|
| openclaw-hello-1 | 0 | completed | fail (file written as root, unreadable by the grader; driver fixed to run as the host user) | 21.0 s | 2 forwarded | 27,127 / 121 | $0.0380 |
| openclaw-hello-2 | 0 | completed | pass | 28.1 s | 2 forwarded | 27,131 / 120 | $0.0100 |

The first trial's cost is mostly a prompt-cache write (13,614 tokens); the second read the cache. OpenClaw's own envelope reported `costUsd` 0.0380 for trial 1, matching the proxy to the cent.

Findings:

- OpenClaw sends one request to `claude-haiku-5-5` per run before the main turn (a utility call; the allowlist refuses it with 403 and the turn proceeds unaffected). A counted run should decide whether to allow a utility model or record the refusal. It is logged in the proxy's usage log either way.
- The grader could not read `hello.txt` after the first trial because the container ran as root; `run-trial.sh` now passes `--user $(id -u):$(id -g)`, and the image works unprivileged with `HOME=/harness-state`.

## Changelog

### 2026-10-22: Image and smoke

harness-evals v0.0.1. First image, config and adapter; one live hello-world trial passed.
