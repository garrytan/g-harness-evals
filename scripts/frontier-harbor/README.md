# Frontier Harbor path (internal-task)

**Harbor 0.24.0 runs six harnesses on the 52 pinned Terminal-Bench 2.1 tasks, every model call metered by our proxy, every task container behind an egress blocklist.**

- **Harnesses:** Claude Code, Codex, Hermes and OpenClaw wrap our own pinned settings; Pi and mini-swe-agent are Harbor's stock classes with the model's real limits added.
- **Models:** Opus 5.5 and Fable 5.1 (Anthropic), GPT-6.1 Sol and GPT-6 Astra (OpenAI), each at its real context window and max output, native effort high, hosted search off.
- **Keys:** a task container sees only a per-trial dummy token and the proxy URL. Harbor runs with a scrubbed environment. Only the metering proxy holds provider keys.
- **Proxy:** refuses hosted web tools, caps output at 128,000 tokens and writes every forwarded body to `<run>/jobs/<job>/<trial>/proxy-capture/` on the host, outside the task container, for the contamination audit.

## Files

| File | What it does |
|---|---|
| [pin.json](pin.json) | Harbor wheel and its hashed lock, TB2.1 commit, the 52 tasks with digests, the shared order, the kept sample, harness versions, model limits, the blocklist, licences |
| [harbor-requirements.txt](harbor-requirements.txt) | every package Harbor installs with, by version and sha256 (`uv pip install --require-hashes`) |
| [materialize.ts](materialize.ts) | copies the pinned tasks into a run root with each image pinned by digest |
| [plan.ts](plan.ts) | reads a `frontier-harbor/1` preregistration: cells, trial ids, shard leases, Harbor jobs |
| [frontier_settings.py](frontier_settings.py) | renders each harness's settings and its `harness_settings.json` record (no Harbor import) |
| [agents.py](agents.py) | the Harbor installed-agent classes |
| [broker.ts](broker.ts) | binds each trial's slot in the metering proxy with a fresh token |
| [egress.py](egress.py), [egress-sidecar/](egress-sidecar/) | Harbor's docker environment with a blocklist added to its egress sidecar |
| [vm-run.sh](vm-run.sh) | runs one shard |
| [to-trials.ts](to-trials.ts) | Harbor results into trial records, with requested and sent effort and infra classes |
| [fake-upstream.ts](fake-upstream.ts) | keyless model upstream for the install check |
| [install-check.sh](install-check.sh), [install-check.json](install-check.json) | the one-VM install check and its receipt |
| [install-check-prereg.json](install-check-prereg.json) | the install check's own preregistration (one cell per agent class and model) |
| [egress-probe/](egress-probe/) | a do-nothing task whose verifier checks the blocklist from inside a task container (install check step 3) |
| [audit.ts](audit.ts), [answer-keys/](answer-keys/) | the contamination audit over captured requests: the benchmark canary, Harness Leaderboard answer-key fingerprints (Apache-2.0, see its NOTICE.md), benchmark-fetch requests and gstack file reads |
| [analyze.ts](analyze.ts) | the harness x model analysis: pass rates with intervals, the noise view, paired comparisons and cost per solve (uses `runner/stats/frontier.ts`) |

## The preregistration (`frontier-harbor/1`)

```json
{ "schema": "frontier-harbor/1", "run_id": "<id>",
  "task_list": { "file": "scripts/frontier-harbor/pin.json", "sha256": "<optional>" },
  "shared_order_seed": "harn50-frontier-2026-11-07",
  "cap_usd": 0, "reserve_usd": 0, "concurrency": 4,
  "cells": [{ "id": "opus-cc", "model": "anthropic:claude-opus-5-5", "harness": "claude-code", "attempts": 1,
              "tasks": { "from": 0, "to": 52 }, "stage": "core", "priority": 1 }],
  "shards": [{ "name": "s1", "cells": ["opus-cc"], "lease_usd": 0 }] }
```

- **Task range:** positions `[from, to)` of the shared order (the task list sorted by sha256 of seed and id).
- **Leases:** the shard leases plus the reserve must fit the cap. Each lease must be at least concurrency x the worst-case reservation of one call.
- **Shards:** a cell runs on exactly one shard. vm-run.sh refuses a shard that is not in the preregistration, or a lease above the planned one.
- **Trial ids:** `<run_id>/<cell>/<task>/a<attempt>`. A stage never changes them.

### Stages

```json
"stages": [{ "name": "stage0", "trials": {
  "opus-cc":   { "attempts": [1], "tasks": { "from": 0, "to": 52 } },
  "opus-pi":   { "attempts": [1], "tasks": { "from": 0, "to": 6 } } } }]
```

- **What:** an optional list of named subsets of the planned trials. Each selection is some attempts and a task range of one cell.
- **Rules:** a selection must sit inside its cell's planned trials, and a trial belongs to at most one stage. plan.ts refuses anything else.
- **Running one:** `plan.ts jobs --stage <name>`, `plan.ts check-shard --stage <name>` and `vm-run.sh --stage <name>`. The Harbor job is `<cell>__a<n>__<stage>`; without `--stage` it is `<cell>__a<n>`.
- **Never twice:** jobs leaves out every trial already in the shard's `trials.jsonl` or in a `--done <trials.jsonl>` file, so the main stage skips what stage 0 recorded, on the same VM or another.
- **One lease per stage:** a stage runs under `<run_id>:<shard>:<stage>` and the main stage under `<run_id>:<shard>`. Its lease is the planned lease less what the shard's other stages recorded. A later stage refuses to start until every trial of the shard's earlier stages is in the results directory's `trials.jsonl` or a `--done` file.
- **Records:** each trial record carries its `stage`. A later stage keeps the first `attestation.json` and appends its own to `attestations.jsonl`.

### The kept sample

- **What:** 8 Terminal-Bench 2.1 tasks the board already solves (pooled pass rate at least 0.95), pinned in `pin.json` under `kept_selection` with each source digest, image digest and pooled rate.
- **Rule:** TB2.1 tasks at or above 0.95 on the same board data as the 52, sorted by sha256 of `"<seed>\0<id>"` (seed `harn50-frontier-2026-11-07`), first 8.
- **Cells:** a cell with `"stage": "kept"` draws its task range from the kept order, and needs `"kept_task_list": { "file": "scripts/frontier-harbor/pin.json" }` in the preregistration. A model and harness may have one core cell and one kept cell (for example `opus-cc` and `opus-cc-kept`); any other repeat is refused.

`bun scripts/frontier-harbor/plan.ts show --prereg <file>` prints the cells, the trial count and each shard's lease.

## Effort

- **Asked:** effort high on every cell (`output_config.effort` on Anthropic, `reasoning_effort` on OpenAI).
- **Never rewritten:** the proxy records what each request sends and changes nothing.
- **Checked per trial:** to-trials.ts reads the captured bodies. Agent-loop requests are the ones on the cell model that declare at least one tool (all cell-model requests when none do). Records carry `efforts_agent_loop` (`requests`, `matching`, `sent`) and `effort_flag`.
- **A miss is excluded:** a trial whose agent loop sent any other effort is an `infra_error` with infra class `effort_mismatch`, excluded pairwise and counted. It is not a `harness_error`, because methodology item 9 counts a `harness_error` against the harness, and here our settings, not the harness, failed to reach the model.
- **Housekeeping calls don't count:** a request on another model, or one that declares no tool, is not agent loop. Hermes's session title is one (next section).
- **Pi:** Harbor's Pi provider block skips Pi's model catalog, so Pi 1.5.0 sent budget thinking (`thinking.type: enabled`). frontier_settings.py adds `compat: { forceAdaptiveThinking: true }` to each Anthropic model entry, the flag Pi's own catalog sets for these models (`packages/ai/catalog/families/anthropic.ts:112`; models.json accepts it, `packages/coding-agent/src/core/model-config.ts`). Pi then sends adaptive thinking with `output_config.effort: high`.

### Hermes housekeeping

- **Session title:** Hermes names each session with one call on the cell model, reasoning off (`agent/title_generator.py`, `generate_title`: `reasoning_config {"enabled": false}`, 512 tokens). On GPT-6.1 Sol that call sends `reasoning_effort: none`. It declares no tool, so it is housekeeping: metered, labelled, not agent loop.
- **Local-server probes:** at start Hermes probes the base URL for LM Studio, Ollama, llama.cpp and vLLM (`agent/model_metadata.py`, `detect_local_server_type`: GET `/api/v1/models`, `/api/tags`, `/v1/props`, `/props`, `/version`, plus POST `/api/show`). The proxy refuses them (403, not allowlisted). Hermes reads any non-200 as "not a local server", the same verdict it reaches on api.openai.com and api.anthropic.com, where it skips the probes. So refusing them changes nothing, and they stay refused.
- **Seen in the install check:** hermes-opus had 9 refused requests and hermes-sol 7, all of these probes and model-list GETs, and both went on to their agent loop (install-check.json, `requests_refused`).
- **Anthropic SDK:** Hermes imports the `anthropic` package lazily, and its install.sh does not install the extra. agents.py runs `uv sync --locked --extra all --extra anthropic` in Hermes's source tree and checks `anthropic` is pin.json's 0.87.0.

## Egress

- **How:** Harbor's sidecar (gost and nftables) only knows allowlists. Ours adds a blocklist service; public mode sends every TCP connection through it. gost matches the TLS SNI or the HTTP Host.
- **Blocked:** the Terminal-Bench site and the Harbor hub, the leaderboard Space, the Hugging Face dataset viewer API, `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` and the Vertex AI hosts.
- **Limit:** a host-name list cannot block one path of a shared host. github.com, raw.githubusercontent.com and huggingface.co stay open because tasks download from them; the audit of captured requests covers fetches of benchmark sources there.

## Known gaps

- **Prices:** plan.ts prices every cell from runner/pricing; a model with no row there cannot be planned.
- **OpenClaw:** Harbor's class names Node 22, which OpenClaw 2026.10.6 refuses, so agents.py runs it on Node 24 (newest 24.x at install, recorded per trial).
- **mini-swe-agent:** Harbor installs the newest LiteLLM unpinned; agents.py pins `litellm[mcp]==1.108.2`, because that LiteLLM's Anthropic path imports `mcp` without declaring it.
- **Codex window: 872,000, not 1,050,000.** Codex 0.165.0 takes the smaller of `model_context_window` and the catalog's `max_context_window` (`codex-rs/models-manager/src/model_info.rs:19-27`), which is 872,000 for GPT-6.1 Sol and GPT-6 Astra (`codex-rs/models-manager/models.json`). Only a custom `model_catalog_json` lifts it, and a custom catalog also changes Codex's prompt, so we keep the shipped catalog and set 872,000 (pin.json `harnesses.codex.max_context_window`). Codex sends no output cap, so the proxy injects 128,000.
- **Harbor's dependencies:** pinned by version and hash in harbor-requirements.txt (uv 0.13.4, Python 3.12, wheels only). vm-run.sh checks the file's sha256 against pin.json before installing.
- **QM:** no installed-agent class. QM's Pi loop runs in QM core with its own sandbox containers, not in the task container (install-check.json, `qm`).
