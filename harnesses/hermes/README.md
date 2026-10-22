# Hermes Agent harness

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) at tag `v2026.9.24` (commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`, package version 0.21.5), checked out into `/opt/harness/src` and installed with uv into `/opt/harness/venv`. One turn is `hermes chat --query-file /workspace/instruction.md --oneshot --provider anthropic --model claude-sonnet-5-5` ([CLI docs](https://hermes-agent.nousresearch.com/docs/user-guide/cli)): on a non-TTY Hermes answers the query and exits.

## Configuration

`config/config.yaml` is copied to `$HERMES_HOME/config.yaml` (`/harness-state/hermes`) at the start of a trial: provider `anthropic`, model `claude-sonnet-5-5`, local terminal backend with `cwd: /workspace`, non-streaming display. The adapter exports `ANTHROPIC_API_KEY=$HE_MODEL_API_KEY` and `ANTHROPIC_BASE_URL=$HE_MODEL_BASE_URL`, which Hermes's anthropic provider reads; nothing is written to `.env`. Hermes refuses to build a wheel outside Nix, so the install is editable (`uv pip install -e`), and the `anthropic` extra is installed at build time because Hermes would otherwise install it lazily into a read-only directory.

Exit mapping: Hermes exits 1 on a failed turn. The adapter reports 0, then 124 if the outer `timeout` fired, then 3 if stdout or stderr shows a proxy refusal or an Anthropic SDK error class or status, else 2.

## M0 smoke

Run on 2026-10-22 with `harnesses/run-trial.sh --harness hermes --task tasks/hello`, container run as the host user with stdin from `/dev/null` and no TTY.

| Trial | Proxy lease | Exit | Termination | Grade | Wall | Proxy calls | Tokens in / out | Cost |
|---|---|---|---|---|---|---|---|---|
| hermes-hello-1 | `m0-laneb` (32,768 output cap) | 3 | model_error | fail | 11.9 s | 1 refused (HTTP 400) | 0 / 0 | $0 |
| hermes-hello-2 | `m0-laneb-hermes` (`--max-output-tokens 128000`) | 0 | completed | pass | 16.6 s | 2 forwarded, 1 forwarded 400 at $0 | 35,323 / 131 | $0.0492 |

Trial 1 error text, verbatim from Hermes: `HTTP 400: metering proxy: requested 128000 output tokens, above this cell's cap of 32768`. The adapter classified it as a model error (exit 3), which is the right column: the harness ran, the model call was refused.

Findings:

- Hermes sets `max_tokens` from a per-model table in `agent/anthropic_adapter.py` (128,000 for `claude-sonnet-5*`) with no user setting to lower it. The proxy must therefore run with `--max-output-tokens 128000` for Hermes cells, and its worst-case reservation per call becomes about $1.40 (128,000 output tokens at $10 per million plus input), so a per-trial lease needs that much headroom even though a hello-world call settles at a few cents.
- Before the first call Hermes probes twelve model-discovery routes (`/v1/models`, `/api/tags`, `/props`, `/version`, `/api/show` and others); the proxy refuses them all with 403 at no cost and Hermes carries on. Context-length auto-detection therefore falls back to defaults.
- Hermes's auxiliary title-generation call fails with Anthropic's 400 `To turn thinking off on this model, send "thinking": {"type": "between_tools"}` on Sonnet 5.5; the provider does not bill it and the main turn is unaffected.
- Hermes prints `tirith security scanner enabled but not available` and falls back to pattern matching for command approval; the file write needed no approval.

## Changelog

### 2026-10-22: Image and smoke

harness-evals v0.0.1. First image, config and adapter; one live hello-world trial passed after raising the proxy's output-token cap.
