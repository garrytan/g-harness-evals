# Harness images

One directory per harness, each a self-contained Docker image that implements the [adapter protocol](../docs/adapters.md). The per-layer prompt maps for the ablation filter live in [ablation/](ablation/README.md). The runtime lives under `/opt/harness`, versions are pinned as build args and image labels, `pin.json` records the pin, the model configuration, the session keying and the world-MCP wiring, `config/` holds the non-interactive config written from it, and `adapter.sh` runs headless turns: `run` for one turn, `serve` for a multi-user trial.

| Harness | Pin | Topology | Image | M0 hello-world (`run`) | M1 serve smoke |
|---|---|---|---|---|---|
| [openclaw](openclaw/) | npm `openclaw@2026.10.6` | in-container | `harness-eval/openclaw:dev` | pass, see README | 3 turns completed, world-MCP calls logged, session carried; see README |
| [hermes](hermes/) | `NousResearch/hermes-agent` tag `v2026.9.24` (`f97608f`) | in-container | `harness-eval/hermes:dev` | pass, see README | 3 turns completed, world-MCP calls logged, session carried; see README |
| [qm](qm/) | `yc-software/qm` main `b6786d67`, fetched by commit (tag `v0.1.15`, `7417aa2`, before 2026-10-30) | sidecar (compose: Postgres, core, task) | `harness-eval/qm:dev`, `harness-eval/qm-sandbox:dev` | pass at `v0.1.15`, see README; at `b6786d67` keyless only (fake endpoint: 2 turns, one sandbox command) | 3 turns completed, world-MCP calls logged, session carried at `v0.1.15`; see README |
| [claude-code](claude-code/) | npm `@anthropic-ai/claude-code@2.1.312` | in-container | `harness-eval/claude-code:dev` | keyless only (fake endpoint through the real proxy) | keyless only: 2 turns, world-MCP call logged, session carried; see README |
| [codex](codex/) | npm `@openai/codex@0.165.0` | in-container | `harness-eval/codex:dev` | keyless only (fake endpoint through the real proxy) | keyless only: 2 turns, world-MCP call logged, thread carried; see README |
| [dsh](dsh/) | npm `@deepseek-ai/dsh@0.2.2-rc.1` from the committed lockfile | in-container | `harness-eval/dsh:dev` | keyless only (fake endpoint: one turn with a bash tool call) | keyless only: 3 turns, world-MCP call logged, Session resumed; see README |
| [harness-zero](harness-zero/) | `zero.ts` sha256 in `pin.json`, Bun 1.4.3 | in-container, internal network only | `harness-eval/harness-zero:dev` | keyless only (fake endpoints through the real proxy) | keyless only: 3 turns with the `--fake-upstream` smoke, world-MCP call logged, session carried; see README |
| [_fake](_fake/) | none | in-container | `harness-eval/fake:dev` | protocol fixture for the conformance test | protocol fixture for the serve conformance tests |

## Build

```sh
docker build -t harness-eval/openclaw:dev harnesses/openclaw
docker build -t harness-eval/hermes:dev harnesses/hermes
docker build -t harness-eval/qm:dev harnesses/qm
docker build -f harnesses/qm/Dockerfile.sandbox -t harness-eval/qm-sandbox:dev harnesses/qm
docker build -t harness-eval/claude-code:dev harnesses/claude-code
docker build -t harness-eval/codex:dev harnesses/codex
docker build -t harness-eval/dsh:dev harnesses/dsh
docker build -t harness-eval/harness-zero:dev harnesses/harness-zero
docker build -t harness-eval/fake:dev harnesses/_fake
```

## gstack overlay images

For gstack's harness-registration check (2026-10-28) each counted image has an overlay, `harness-eval/<h>:gstack-<pin8>`, built FROM `harness-eval/<h>:dev` by `harnesses/<h>/gstack/Dockerfile` with a gstack checkout at /opt/gstack (fetched by sha, `--build-arg GSTACK_COMMIT=<sha>`) and a wrapper in place of `adapter.sh` that marks the trial as a test run for gstack, checks the Bun runtime, registers gstack's skills with the harness before the first turn and then runs the turn, by default through the counted adapter (`adapter.real.sh`) with the remaining budget. Nothing in the counted image, pin.json, adapter, `run-trial.sh` or `compose.yaml` changes; `run-trial.sh --image` selects the overlay. The panel's two arms are two such images at two gstack pins (baseline = gstack main at the freeze, candidate = the sha of the gstack change under test); they differ in nothing else. The three-arm form (`discovery.sh --arms none,baseline:<sha>,candidate:<sha>`) puts a no-gstack arm first in each cell: the same overlay built with `--build-arg GSTACK_COMMIT=none` (tag `harness-eval/<h>:gstack-none`, Hermes `-chat` in chat mode). It keeps Bun, the wrapper and the adapter swap but has no gstack checkout, so the wrapper logs `gstack: none` and registers nothing. An image built with a gstack commit whose checkout is missing fails setup instead of running as a no-gstack trial.

```sh
docker build -f harnesses/openclaw/gstack/Dockerfile -t harness-eval/openclaw:gstack-bd8907d6 harnesses
docker build -f harnesses/hermes/gstack/Dockerfile -t harness-eval/hermes:gstack-bd8907d6 harnesses
docker build -f harnesses/hermes/gstack/Dockerfile --build-arg HE_GSTACK_HERMES_MODE=chat -t harness-eval/hermes:gstack-bd8907d6-chat harnesses
docker build -f harnesses/openclaw/gstack/Dockerfile --build-arg GSTACK_COMMIT=none --build-arg GSTACK_REF=none -t harness-eval/openclaw:gstack-none harnesses
docker build -f harnesses/hermes/gstack/Dockerfile --build-arg GSTACK_COMMIT=none --build-arg GSTACK_REF=none -t harness-eval/hermes:gstack-none harnesses
docker build -f harnesses/hermes/gstack/Dockerfile --build-arg GSTACK_COMMIT=none --build-arg GSTACK_REF=none --build-arg HE_GSTACK_HERMES_MODE=chat -t harness-eval/hermes:gstack-none-chat harnesses
docker build -f harnesses/openclaw/gstack/Dockerfile --build-arg GSTACK_COMMIT=<sha> --build-arg GSTACK_START_HOOK=on -t harness-eval/openclaw:gstack-<sha8>-hook harnesses
docker build -f harnesses/hermes/gstack/Dockerfile --build-arg GSTACK_COMMIT=<sha> --build-arg GSTACK_START_HOOK=on --build-arg HE_GSTACK_HERMES_MODE=chat -t harness-eval/hermes:gstack-<sha8>-hook-chat harnesses
scripts/gsta-135/preflight.sh --only openclaw,hermes                      # free checks, the keyless probes, the runtime smoke; no key
scripts/gsta-135/preflight.sh --only hermes --hermes-mode chat            # the same on the chat-mode image, plus the chat checks
scripts/gsta-135/discovery.sh --runtime-preflight results/gsta-135/preflight/runtime-preflight.json   # the paid cells; results/gsta-135/runs/<run id>/ (gitignored, never reused)
scripts/gsta-135/preflight.sh --pin <sha8> --only openclaw,hermes --hermes-mode chat --start-hook   # the hook images, plus the start-hook checks
```

**Start hook arm.** `--build-arg GSTACK_START_HOOK=on` builds an image that turns on gstack's opt-in start hook, a one-line note on every turn that reminds the agent to run the skill's start command. The default is `off`; `on` with `GSTACK_COMMIT=none` fails the build. The image carries the label `org.harness-eval.gstack.start_hook` and hook images take the tag suffix `-hook` (`harness-eval/<h>:gstack-<sha8>-hook`, Hermes `-hook-chat`).

- **The wrapper follows the image.** It exports `GSTACK_HARNESS_START_HOOK=1` or `0` from the image before gstack's setup. It stops the trial with exit 2 before any model request when setup exits 4 (`HARNESS_HOOK_INACTIVE`) or `gstack-harness status` disagrees with the image (on must show the hook active, off must not). Each trial's `gstack-register.log` gets one `start_hook:` line.
- **Every arm seeds the harness's own config** (OpenClaw `openclaw.json`, Hermes `config.yaml`) before setup, so the hook's activation edits it instead of creating a bare one.
- **Every gstack arm checks its pin.** When the installed tree's HEAD is not the image's `GSTACK_IMAGE_COMMIT`, the trial stops with exit 2 before any model request.
- **The scripts.** `discovery.sh --start-hook candidate` runs the candidate arm on hook images, refuses any image whose label does not match its arm, and records `start_hook` per arm in the manifest. `preflight.sh --start-hook` checks that gstack's note is on the first agent-turn request with the hook on and on no request with it off, plus (unless `--no-negative`) a pinned-tree negative. First used by [tool-discipline-start-2026-11](../docs/benchmarks/2026-11-01-tool-discipline-start/PREREGISTRATION.md).

**Hermes modes.** The Hermes overlay has two modes, baked into the image by the build arg `HE_GSTACK_HERMES_MODE` (the ENV of the same name; `run-trial.sh` passes no extra environment, so the mode comes from the image). `oneshot` (the default, tag `:gstack-<pin8>`) execs the counted adapter: `hermes chat --query-file ... --oneshot`, the counted path, whose system prompt carries the one-shot skills block ("Do not load general process skills") and hides `skill_manage`. `chat` (tag `:gstack-<pin8>-chat`) runs an interactive session: `hermes chat --query-file` implies `--oneshot` on non-TTY stdio, so the turn runs under a pseudo terminal (`script -qefc`) with stdin from a FIFO in a private temp directory (`mktemp -d`, mode 0700, removed on exit, never under the log mount) that the adapter holds open read-write for the whole turn as fd 3, closed in the session itself; a watcher (`chat_watch`) polls `HERMES_HOME/state.db` every 2 s (`HE_GSTACK_CHAT_POLL_S`) through SQLite's in-memory backup, with the completeness rule `evidence.ts` applies per session (last row the assistant's with `finish_reason` stop, every tool call of the session answered; `tests/gsta-135-adapters.test.ts` runs both over the same store), logs the first read error once and counts it as pending, waits a 5 s grace (`HE_GSTACK_CHAT_GRACE_S`) that a flip back to pending resets, types `/exit` (the text, a pause, then Enter: Hermes reads an Enter within 50 ms of typing as a line break) and waits up to 30 s (`HE_GSTACK_CHAT_EXIT_S`) for Hermes to leave, then terminates the session itself and still exits 0 when the transcript is complete (`watcher: hermes did not leave after /exit` in adapter.log). A turn Hermes closes as failed (an assistant row with `display_kind` `failed_turn`, as after a 401: the session sits idle at the prompt) gets `/exit` at once and maps to exit 3 when the counted adapter's model-error pattern matches the pty capture with its escape sequences stripped, `stderr.log` or Hermes's own `HERMES_HOME/logs/*.log`, else 2. `run-trial.sh`'s wall clock bounds all of it; a turn still pending at the budget is exit 124. The counted adapter's turn block is copied into `harnesses/hermes/gstack/adapter.sh` line for line because the counted run entry hardcodes `--oneshot`; `tests/gsta-135-adapters.test.ts` diffs the copy against `harnesses/hermes/adapter.sh`. In chat mode `stdout.log` is a terminal capture, not plain text. Chat mode is a Hermes path harness-evals never counts: its system prompt has the interactive skills guidance ("you MUST load it"), offers `skill_manage` and the self-improvement coaching ("offer to save as a skill") and lifts the one-shot delegation cap, so a chat-mode result is labelled chat-mode and does not transfer to one-shot, cron or gateway sessions.

**Approval in chat mode.** An interactive Hermes session parks a flagged command (for example `rm -rf <path>`) on an approval card; at v2026.9.24 only `-q`, cron and unattended-platform sessions have a deny disposition (`approvals.single_query_mode`, `cron_mode`, `unattended_mode`), and the switches that would give the session one (`HERMES_SINGLE_QUERY_SESSION`, `HERMES_CRON_SESSION`) change the session kind. So the chat-mode config copy sets `approvals.mode: manual` (no guardian model call) and `approvals.timeout: 1`: the card fails closed after one second, the tool result reads `BLOCKED: Command timed out without user response ... Silence is not consent`, and the turn goes on. The wrapper logs `approval: approvals.mode=manual approvals.timeout=1 (...)` in `gstack-register.log` for the manifest, with the limit: the card fails closed for an agent that does not write to the session's stdin. The FIFO is in a private 0700 directory inside the container, not on any mount, and fd 3 is closed in the session, so the agent's shell does not inherit it and the old `/he-logs/hermes-chat.fifo` path is not a pipe; a same-uid process can still open the pipe through `/proc/<pid>/fd` of the adapter, and `evidence.ts` treats a user row after the first assistant row as tampering. The preflight's flagged smoke plays that move (a background loop typing `y` at the old path and at the agent shell's fd 3) and asserts the card still reads `BLOCKED`. No clarify callback is wired.

**Test-run marker and fresh state.** `wrap_mark_test_run` in `harnesses/_gstack/wrapper-lib.sh`, called by both overlay adapters before registration, exports the variables gstack reads at pin bd8907d6 and nothing else: `GSTACK_SESSION_KIND=spawned` (`lib/install-verdict.ts`, `lib/autoplan-run.ts`, `bin/gstack-skill-start`), `GSTACK_EPHEMERAL=1` (`lib/autoplan-timing.ts`, `lib/approval-record.ts`: no analytics or approval records kept) and `GSTACK_STATE_ROOT=/harness-state/.gstack` (`lib/state-root.ts`, `bin/gstack-state-root.sh`: a fresh root per trial, so no shared `~/.gstack` and no sync spool; `artifacts_sync_mode` stays its default, off). `GSTACK_CAPY` is never set and is dropped if the image carried it (with it, spawned would be a hard kind that refuses without a Capy install verdict). `GSTACK_SYNC` is not a gstack variable at this pin and is not exported. The wrapper logs `marker: harnesses/_gstack/wrapper-lib.sh:<line> ...` naming the export line for the manifest, and `tests/gsta-135-adapters.test.ts` greps gstack's `lib/` and `bin/` for every exported name when a checkout at the pin is on the machine. The proof is the runtime smoke below: the harness's own shell tool prints its environment and the preflight reads it from the second request.

**Runtime check and preflight modes.** `wrap_runtime_check` logs `runtime: ok bun <v> (minimum <GSTACK_BUN_TESTED>)`, `runtime: degraded (<reason>)` when Bun is missing or below the minimum, or `runtime: unknown (<reason>)` when the pin has no `bin/gstack-bun-version.sh` or no `GSTACK_BUN_TESTED` line (nothing to check against; never degraded, so a candidate that moves the file is not zeroed), and goes on; a degraded start is the `infra:runtime` termination in the panel. `scripts/gsta-135/preflight.sh` runs, per harness and image: the plain exec probe; the runtime smoke, where the fake endpoint (`fake-anthropic.ts --script`) answers the first request with a `tool_use` for the harness's shell tool (OpenClaw `exec`, Hermes `terminal`) running the environment dump, `bun --version`, `gstack-harness status` and `gstack-skill-start --skill review --model claude`, and asserts on the tool result the harness sent back (the marker, no `GSTACK_CAPY`, the fresh state dir, a Bun version, `visible to harness: yes`, `SKILL_START_PROTO: 1`, `SESSION_KIND: spawned`, no `INSTALL: warn` or `fail` row, exit 0) and on `max_tokens` = the pin (`--max-tokens`, default 128000) in the first and the post-tool request; and the missing-Bun negative (the image run with PATH stripped of `/opt/bun/bin` must log `runtime: degraded` and exit 2 before any model request). With `--hermes-mode chat` it also asserts the interactive guidance and no one-shot block in the prompt dump, `HERMES_SINGLE_QUERY_SESSION` unset in the tool's view, the approval line, and runs the flagged-command smoke (exit 0 inside the budget, `BLOCKED` in the tool result, a complete transcript). A failed chat check prints `HERMES: not measured (<reason>)` and the panel runs OpenClaw only. Every run also writes `results/gsta-135/preflight/runtime-preflight.json`, a flat object keyed by the image tag it ran (`harness-eval/<h>:gstack-<pin8>`, `...-chat` for Hermes in chat mode) with `pass` or `fail`, merged over runs; `scripts/gsta-135/discovery.sh --runtime-preflight <that file>` reads it and records a failed image's cells as `infra:runtime` without dispatching them. The smoke found that Hermes's terminal tool takes its environment from a login shell and `/etc/profile` drops `/opt/bun/bin` from PATH, so the Hermes overlay image adds `/etc/profile.d/bun.sh`; without it no Bun-backed helper runs from the harness's own shell. Receipts: `results/gsta-135/preflight/` (gitignored), copied to the project's private drive under `handoffs/internal-task/gsta-135/panel-preflight/`.

**max_tokens.** Both harnesses send `max_tokens: 128000` at their pins (the Opus default in OpenClaw's catalog and in Hermes's `agent/anthropic_adapter.py`); Hermes v2026.9.24 has no CLI flag or config key that binds it (`cli_agent_setup_mixin.py` builds the agent without one), so the panel pins 128000 and the proxy's `--max-output-tokens` equals it. The preflight asserts the value the harness actually sent; no config row is written for it.

The 2026-10 discovery run was an uncounted diagnostic: one trial per cell, no preregistration, nothing under `docs/benchmarks/`. `scripts/gsta-135/evidence.ts` reads the harness's own transcript (OpenClaw's exec session store, Hermes's state.db) and reports tool-call events with file, locator and sha256; the wrapper's `gstack-register.log` never counts as evidence.

## Run one trial

Start the metering proxy on the Docker bridge address so containers reach it as `host.docker.internal` and nothing outside the machine can, then bind a slot for the trial with a random token (since 2026-10-28 a lease-mode proxy forwards nothing for an unbound slot, and nothing on a token-bound slot that does not present the token; the runner does this binding itself in a counted run):

```sh
control=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
suffix=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
cred="trial-token:<trial>.$suffix"
bun runner/proxy/metering-proxy.ts --listen 172.17.0.1:8787 --control-token "$control" \
  --budget-ledger .budget/ledger.sqlite --lease-usd 2 --run-id <run> --new-run \
  --allow-models anthropic:claude-sonnet-5-5 --usage-log .budget/<run>-usage.ndjson
curl -sf -X POST http://172.17.0.1:8787/__proxy/bind -H 'content-type: application/json' -H "x-proxy-control: $control" \
  -d "{\"slot\":\"<trial>\",\"key\":\"trial-token:<trial>\",\"token\":\"$cred\"}"
harnesses/run-trial.sh --harness hermes --task tasks/hello --trial-id <trial> \
  --base-url http://host.docker.internal:8787/<trial>/anthropic --api-key "$cred"
```

Hermes needs the proxy started with `--max-output-tokens 128000` (see its README). Results land under `results/smoke/<trial>/`. The real key stays in the proxy's environment; the container only ever sees the `trial-token:` dummy (`sk-trial-` before 2026-10-26), and the usage log meters the trial under `trial-token:<trial>` whatever the token's random suffix. Unbind the slot afterwards with `POST /__proxy/unbind {"slot":"<trial>"}` under the same control header. A proxy started without `--budget-ledger` (in-process mode) forwards without a binding.

## Run one serve-mode smoke

`serve-smoke.ts` starts a world in this process, runs the image in serve mode the way the runner does, drives three turns through the Slack mock and writes everything under `results/serve-smoke/<trial>/` (details in [docs/adapters.md](../docs/adapters.md), "Driver"):

```sh
bun harnesses/serve-smoke.ts --harness _fake --trial-id fake-serve-1
bun harnesses/serve-smoke.ts --harness hermes --trial-id hermes-serve-1 \
  --base-url http://host.docker.internal:8787/hermes-serve-1/anthropic --api-key "$cred"
```

The slot `hermes-serve-1` is bound with `$cred` first, as under "Run one trial"; the `_fake` harness makes no model call and needs no proxy. `--fake-upstream` answers model requests from a fake endpoint in the same process instead of a proxy, for harnesses that send non-streamed requests (Harness Zero): `bun harnesses/serve-smoke.ts --harness harness-zero --trial-id zero-smoke-1 --fake-upstream` needs no key.

## Changelog

### 2026-11-08: DeepSeek Harness (dsh)

Added the dsh row to the harness table and its build line. Why: harnesses/dsh is a new adapter for DeepSeek's open-source harness, checked keyless only (process-level tests and a serve smoke against a fake endpoint).

### 2026-11-04: plain names for internal roles

Mentions of the project's coordinating agent, its private drive and its agent threads now use those plain names instead of internal role names. No number, link or claim changes. Why: the page is published, and the public export blocks internal role names in prose.

### 2026-11-01: the start hook arm of the gstack overlay

"gstack overlay images" gains "Start hook arm": what `GSTACK_START_HOOK=on` builds, the `-hook` tags and label, the wrapper's hook, config-seed and pinned-tree checks, and the `--start-hook` options of `discovery.sh` and `preflight.sh`, with their build and preflight lines. Why: the start-hook panel runs on these images, and the page did not name them.

### 2026-10-31: the no-gstack arm of the gstack panel

"gstack overlay images" says how `GSTACK_COMMIT=none` builds the no-gstack overlay and how `discovery.sh --arms none,...` adds it as a third arm, with its build lines (OpenClaw, Hermes one-shot and Hermes chat). Why: the panel gained that arm, so the page's "two arms" was no longer the whole panel.

### 2026-10-31: Harness Zero

One row and one build line: `harness-zero`, proven keyless against fake endpoints through the real metering proxy. `serve-smoke.ts` gains `--fake-upstream`, a keyless model endpoint in the same process. Why: Harness Zero is the fully known control harness for the feature runs ([harness-zero/README.md](harness-zero/README.md)).

### 2026-10-30: QM re-pinned to main b6786d67

harness-evals v0.0.66. The `qm` row's pin. Why: internal-task's M1 measures QM at that commit ([qm/README.md](qm/README.md), "Re-pin to main b6786d67").

### 2026-10-29: Claude Code and Codex

harness-evals v0.0.42. Two rows and two build lines: `claude-code` and `codex`, proven keyless against fake endpoints through the real metering proxy. OpenClaw and Hermes gain an OpenAI branch (their READMEs, "OpenAI cells"). Why: Garry asked for both as harnesses; Codex runs on an OpenAI model because it speaks only the Responses API.

### 2026-10-22: serve for every harness (M1 lane C)

harness-evals v0.0.3. `serve` implemented in all four adapters, the Hermes image gains the `mcp` extra, QM's compose stack takes `HE_ENTRY` and a turns mount, `serve-smoke.ts` drives a serve-mode trial; live three-turn trials on OpenClaw, Hermes and QM.

### 2026-10-22: Three images and the fake harness

harness-evals v0.0.1. First images for OpenClaw, Hermes Agent and QM, each run once through `tasks/hello` against the metering proxy on Claude Sonnet 5.5.
