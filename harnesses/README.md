# Harness images

One directory per harness, each a self-contained Docker image that implements the [adapter protocol](../docs/adapters.md). The runtime lives under `/opt/harness`, versions are pinned as build args and image labels, `pin.json` records the pin, the model configuration, the session keying and the world-MCP wiring, `config/` holds the non-interactive config written from it, and `adapter.sh` runs headless turns: `run` for one turn, `serve` for a multi-user trial.

| Harness | Pin | Topology | Image | M0 hello-world (`run`) | M1 serve smoke |
|---|---|---|---|---|---|
| [openclaw](openclaw/) | npm `openclaw@2026.10.6` | in-container | `harness-eval/openclaw:dev` | pass, see README | 3 turns completed, world-MCP calls logged, session carried; see README |
| [hermes](hermes/) | `NousResearch/hermes-agent` tag `v2026.9.24` (`f97608f`) | in-container | `harness-eval/hermes:dev` | pass, see README | 3 turns completed, world-MCP calls logged, session carried; see README |
| [qm](qm/) | `yc-software/qm` tag `v0.1.15` (`7417aa2`) | sidecar (compose: Postgres, core, task) | `harness-eval/qm:dev`, `harness-eval/qm-sandbox:dev` | pass, see README | 3 turns completed, world-MCP calls logged, session carried; see README |
| [_fake](_fake/) | none | in-container | `harness-eval/fake:dev` | protocol fixture for the conformance test | protocol fixture for the serve conformance tests |

## Build

```sh
docker build -t harness-eval/openclaw:dev harnesses/openclaw
docker build -t harness-eval/hermes:dev harnesses/hermes
docker build -t harness-eval/qm:dev harnesses/qm
docker build -f harnesses/qm/Dockerfile.sandbox -t harness-eval/qm-sandbox:dev harnesses/qm
docker build -t harness-eval/fake:dev harnesses/_fake
```

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

The slot `hermes-serve-1` is bound with `$cred` first, as under "Run one trial"; the `_fake` harness makes no model call and needs no proxy.

## Changelog

### 2026-10-22: serve for every harness (M1 lane C)

harness-evals v0.0.3. `serve` implemented in all four adapters, the Hermes image gains the `mcp` extra, QM's compose stack takes `HE_ENTRY` and a turns mount, `serve-smoke.ts` drives a serve-mode trial; live three-turn trials on OpenClaw, Hermes and QM.

### 2026-10-22: Three images and the fake harness

harness-evals v0.0.1. First images for OpenClaw, Hermes Agent and QM, each run once through `tasks/hello` against the metering proxy on Claude Sonnet 5.5.
