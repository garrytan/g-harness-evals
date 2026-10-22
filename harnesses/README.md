# Harness images

One directory per harness, each a self-contained Docker image that implements the [adapter protocol](../docs/adapters.md). The runtime lives under `/opt/harness`, versions are pinned as build args and image labels, `pin.json` records the pin and the model configuration, `config/` holds the non-interactive config written from it, and `adapter.sh` runs one headless turn.

| Harness | Pin | Topology | Image | M0 hello-world |
|---|---|---|---|---|
| [openclaw](openclaw/) | npm `openclaw@2026.10.6` | in-container | `harness-eval/openclaw:dev` | pass, see README |
| [hermes](hermes/) | `NousResearch/hermes-agent` tag `v2026.9.24` (`f97608f`) | in-container | `harness-eval/hermes:dev` | pass, see README |
| [qm](qm/) | `yc-software/qm` tag `v0.1.15` (`7417aa2`) | sidecar (compose: Postgres, core, task) | `harness-eval/qm:dev`, `harness-eval/qm-sandbox:dev` | pass, see README |
| [_fake](_fake/) | none | in-container | `harness-eval/fake:dev` | protocol fixture for the conformance test |

## Build

```sh
docker build -t harness-eval/openclaw:dev harnesses/openclaw
docker build -t harness-eval/hermes:dev harnesses/hermes
docker build -t harness-eval/qm:dev harnesses/qm
docker build -f harnesses/qm/Dockerfile.sandbox -t harness-eval/qm-sandbox:dev harnesses/qm
docker build -t harness-eval/fake:dev harnesses/_fake
```

## Run one trial

Start the metering proxy on the Docker bridge address so containers reach it as `host.docker.internal` and nothing outside the machine can:

```sh
bun runner/proxy/metering-proxy.ts --listen 172.17.0.1:8787 \
  --budget-ledger .budget/ledger.sqlite --lease-usd 2 --run-id <run> --new-run \
  --allow-models anthropic:claude-sonnet-5-5 --usage-log .budget/<run>-usage.ndjson
harnesses/run-trial.sh --harness hermes --task tasks/hello --trial-id <trial> \
  --base-url http://host.docker.internal:8787/anthropic --api-key sk-trial-<trial>
```

Hermes needs the proxy started with `--max-output-tokens 128000` (see its README). Results land under `results/smoke/<trial>/`. The real key stays in the proxy's environment; the container only ever sees the `sk-trial-` token.

## Changelog

### 2026-10-22: Three images and the fake harness

harness-evals v0.0.1. First images for OpenClaw, Hermes Agent and QM, each run once through `tasks/hello` against the metering proxy on Claude Sonnet 5.5.
