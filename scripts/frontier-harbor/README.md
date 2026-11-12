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
| [merge-stages.ts](merge-stages.ts) | merges a staged run's shard directories into one results directory, with the exclusion list and rerun records |
| [subset.ts](subset.ts) | a copy of merged results without some trials (tasks, a Harbor exception, first runs in a time window, or a trial list), or with one harness's infra errors on one task scored as fails, for the sensitivity lines |
| [refusals.ts](refusals.ts) | lists the trials with a provider safety refusal, read the same way in every harness from each harness's own refusal marker |
| [recognition.ts](recognition.ts) | the recognition and compaction scan of `fable-5-2-coding-cc322-2026-11`: per trial, Claude Code `unrecognized_model` lines, compaction points and peak context, read from finished results or a running shard's raw Harbor trials (`--jobs`); exits 1 on an unrecognized model, a compaction below `--min-pre-tokens`, an unreadable compaction record or a trial with no agent log |
| [fake-upstream.ts](fake-upstream.ts) | keyless model upstream for the install check |
| [install-check.sh](install-check.sh), [install-check.json](install-check.json) | the one-VM install check and its receipt |
| [install-check-prereg.json](install-check-prereg.json) | the install check's own preregistration (one cell per agent class and model) |
| [egress-probe/](egress-probe/) | a do-nothing task whose verifier checks the blocklist from inside a task container (install check step 3) |
| [audit.ts](audit.ts), [answer-keys/](answer-keys/) | the contamination audit over captured requests: the benchmark canary, Harness Leaderboard answer-key fingerprints (Apache-2.0, see its NOTICE.md), benchmark-fetch requests and gstack file reads |
| [../canary/gstack/](../canary/gstack/README.md) | the gstack regression canary rig: release arm builder, tier spec, exposure, install check and tier runner |
| [analyze.ts](analyze.ts) | the harness x model analysis: pass rates with intervals, the noise view, paired comparisons and cost per solve (uses `runner/stats/frontier.ts`), and per gstack arm the exposure counts, open rate per skill and token means |
| [gstack-arm.ts](gstack-arm.ts), [gstack-build.ts](gstack-build.ts), [gstack-builder/](gstack-builder/), [gstack-runtime.json](gstack-runtime.json) | the gstack arms (internal-task): spec parsing, the docker builder that installs pinned gstack the way a user does, the lock check, and each cell's install manifest |
| [gstack-names.ts](gstack-names.ts) | which skills a gstack lock holds and the name each host lists them under |
| [gstack-singles.ts](gstack-singles.ts), [gstack-catalog.json](gstack-catalog.json) | every single-skill removal per host at the pin, written to the run folder's `skills.json` |
| [gstack-check.sh](gstack-check.sh), [gstack-check.ts](gstack-check.ts), [install-check-gstack-prereg.json](install-check-gstack-prereg.json) | the keyless gstack install check (install-check.sh step 6) and its preregistration |
| [gstack-exposure.ts](gstack-exposure.ts) | gstack arms (internal-task): the skills each host listed in the first agent-loop request against the arm's lock, removed skills seen, skill opens and section reads, listing bytes and opened-body tokens, per trial |
| [ablation.ts](ablation.ts) | the frozen analysis of the gstack skill ablation (internal-task), read from [ablation-spec.json](../../docs/benchmarks/2026-11-10-gstack-skill-ablation/ablation-spec.json): `headroom` (stage 0, the none arm on each model's subset), `select` (stage 0, the minus arms and the diet from full-arm open rates) and `analyze` (main stage: per-arm rates, tokens and cost per solve, task-level pairs with Holm, pooled readings and the per-skill verdicts) |

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
- **Harness versions:** optional `"harness_versions": { "claude-code": "2.1.322" }` runs a harness at another release pin.json lists under `harnesses.<h>.releases`. Every job of that harness then names it, agents.py checks the installed binary against that release's sha256, and `plan.ts show` prints it. Without it, cells run pin.json's own version (2.1.312 for Claude Code). plan.ts refuses a version pin.json does not pin.

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

### Reruns and the staged merge

- **Ungraded trials:** a trial whose verifier output has no pytest summary line and shows a failed download from github.com is an `infra_error` with infra class `verifier_unavailable`, excluded pairwise and counted (amendments 4 and 6). `to-trials.ts scan-verifier` applies the same rule to records already written and writes the list; `--previous` names an earlier list and `--rerun-out` writes the trials it missed. A listed trial is rerun once with `vm-run.sh --rerun <list>` (`--rerun-stage rerun1-a<m>` for a later list), and a rerun that hits the rule again is never rerun.
- **Rerun:** `vm-run.sh --rerun <list.json>` (with `plan.ts check-shard --rerun` and `jobs --rerun`) runs the listed trials of a shard once more, in a fresh results directory, with their ids unchanged. Records carry `stage` `rerun1` and `rerun` 1, under the lease `<run_id>:<shard>:rerun1`. Every listed trial's first run must be in a `--done` file, and its spend counts against the planned lease.
- **Merge:** `merge-stages.ts --out <dir> --shard <name>:<label>=<dir> ... [--exclude <list.json> --rerun <name>:<label>=<dir> ...]` merges a shard's stage directories, which `merge-shards.ts` refuses. A listed trial takes its rerun record, or is written as excluded when it has none. A rerun its lease stopped (`lease_refused`) replaces nothing: its record keeps the first run's spend as `frontier.first_run_usd`, which `analyze.ts` counts in cost per solve. The shard directories are never rewritten.

### The kept sample

- **What:** 8 Terminal-Bench 2.1 tasks the board already solves (pooled pass rate at least 0.95), pinned in `pin.json` under `kept_selection` with each source digest, image digest and pooled rate.
- **Rule:** TB2.1 tasks at or above 0.95 on the same board data as the 52, sorted by sha256 of `"<seed>\0<id>"` (seed `harn50-frontier-2026-11-07`), first 8.
- **Cells:** a cell with `"stage": "kept"` draws its task range from the kept order, and needs `"kept_task_list": { "file": "scripts/frontier-harbor/pin.json" }` in the preregistration. A model and harness may have one core cell and one kept cell (for example `opus-cc` and `opus-cc-kept`); any other repeat is refused.

### Task subsets

```json
"tasks": { "subset": "docs/benchmarks/2026-11-10-gstack-skill-ablation/subsets.json", "key": "opus", "sha256": "<optional>" }
```

- **What:** a cell's `tasks` (or a stage selection's) may name a subset file instead of a range. The file is `{ "subsets": { "<key>": { "tasks": [ids] } } }`.
- **Order:** the listed ids run in the shared order, the same rule as a range.
- **Refused (HE-FRONTIER-005):** a missing file or key, a sha256 that does not match, or an id that is not a pinned task.
- **Stages:** a stage may select a subset (it must sit inside the cell's tasks) or positions `[from, to)` of the cell's own list. Trial ids, jobs, check-shard and never-twice work as for a range.

### gstack arms (internal-task)

```json
"gstack_pin": { "repo": "garrytan/gstack", "commit": "<40 hex>" },
"cells": [{ "id": "opus-cc-full", ..., "gstack": { "arm": "full", "spec": "full",
  "lock": "docs/benchmarks/<run>/locks/claude/full.lock.json", "spec_sha256": "<sha256 of the spec>" } }]
```

- **Arms:** `none` (nothing installed, checked absent), `full`, `minus-<skill>` (`full,-skill:<skill>`) and `diet` (several removals). Claude Code, Codex and Hermes only. One cell per model, harness and arm.
- **Install:** vm-run.sh step 1b builds each arm before any lease, in a docker builder at `gstack_pin`: the pinned checkout, `bun install --frozen-lockfile`, `./setup --host <h> --no-browser`, telemetry and update checks off, then gstack's own render of the spec. agents.py uploads the runtime and tree and checks every file against the lock.
- **Where:** Claude in `~/.claude/skills` (router at `gstack/SKILL.md`), Codex in `~/.gstack/arms/codex/.agents/skills`, Hermes in one `gstack` category. Harbor copies each to the folder the harness reads.
- **Refused:** HE-FRONTIER-009 when the render, the checkout or the container does not match the preregistered lock; HE-FRONTIER-008 when gstack refuses the render, the builder fails, a path the tree names would be missing, or the skills folder holds a SKILL.md the lock does not list.
- **Listing:** Claude Code does not list a skill whose frontmatter sets `disable-model-invocation: true` (land-and-deploy and modernize at 1.98.0.0). `skills.json` names them per host (`unlisted`), and each cell manifest carries `expected_listed`.
- **Check:** `gstack-check.sh` runs every host's none, full and minus-retro arms against the fake upstream and compares the first request's skill listing with the lock. It also runs gstack-skill-start in the task image with every packet captured, and probes the 52 pinned task images.
- **Fails closed:** the check passes only when `vm-run.sh` exits 0 and every step it depends on finishes and passes. Any failure, including a script that stops early, leaves `gstack-check.json` with `"pass": false` and a `reasons` list saying what failed. `install-check.sh` also fails when its own `vm-run.sh` or `gstack-check.sh` exits non-zero, whatever their reports say, and lists its failures under `reasons` in `install-check.json`.

`bun scripts/frontier-harbor/plan.ts show --prereg <file>` prints the cells, the trial count and each shard's lease.

## gstack arms (the regression canary)

- **What:** a Claude Code or Codex cell may carry `"gstack": { "sha", "version", "host", "tar", "tar_sha256" }`. Its agent class installs that gstack release into the task container after the harness and our settings are in place. A cell without it renders byte for byte what it did before (`tests/canary-gstack.test.ts` checks this against recorded goldens).
- **The tar:** [../canary/gstack/build-arm.sh](../canary/gstack/build-arm.sh) runs gstack's own `./setup --host claude` or `--host codex` with the browser off, in a keyless container, for the home layout in [../canary/gstack/arm.json](../canary/gstack/arm.json). Its sidecar `<tar>.json` records the commit, VERSION, skills, gstack's Claude settings and whether gstack's bin helpers run in the task image.
- **Where each host reads it:** Harbor's Claude Code class runs with `CLAUDE_CONFIG_DIR=/logs/agent/sessions` and copies `~/.claude/skills` there, so the skills go to `~/.claude/skills`. Claude Code does not read `~/.claude/settings.json` under that config dir, so gstack's hooks are merged into the `--settings` file Harbor passes: keys we lack are added, list entries appended, and ours kept on any clash. Harbor's Codex class runs with `CODEX_HOME=/tmp/codex-home` and only adds files there, so gstack's setup runs with that `CODEX_HOME` and its skills go to `/tmp/codex-home/skills`.
- **Checked at install:** the tar's sha256, the agent's HOME, no gstack there before, then the router, the skill count, VERSION and the checkout's commit against the sidecar (`install_checks.gstack` in `harness_settings.json`). A mismatch fails agent setup.
- **After a Claude Code run:** gstack's setup links each skill to the checkout by absolute path (`/root/gstack/...`), and Harbor's copy keeps those links in the trial's session dir on the host. Harbor's end-of-trial scrub stats them, gets a permission error on the host's `/root` and fails the job. So when the run ends, the agent class deletes every link under `/logs/agent/sessions/skills` from inside the container (the files are still the container user's until Harbor chowns the logs) and records the count as `install_checks.skill_links_dropped`.
- **Plan rules:** two cells may share a model and harness when their gstack arms differ. A cell may carry its own `task_list`. vm-run.sh `--canary-spec` runs a spec only after `scripts/canary/gstack/spec.ts check` renders it again from its recorded inputs byte for byte; it is never counted, and the attestation records the spec's sha256.
- **Exposure:** [../canary/gstack/exposure.ts](../canary/gstack/exposure.ts) adds each trial's `first_request_has_product` and `product_calls`, read from the captured bodies. audit.ts's `GSTACK_FILE` also matches prefixed gstack skill folders (`skills/gstack-review/`), the Codex layout.

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

## gstack arms: what reached the model

- **Cell block:** a cell may carry `"gstack": { "arm", "spec", "lock", "spec_sha256" }`; `lock` is the repository path of the arm's gstack lock file. A cell without it is a plain cell.
- **Exposure check, per trial:** to-trials.ts parses the first agent-loop request (the effort check's definition) for the host's skills listing: Claude Code's skill_listing system-reminder, Codex's `<skills_instructions>` catalog, Hermes's `<available_skills>` index. The listed gstack skills must equal the lock's skills, less the ones the host never lists (Claude Code drops skills with `disable-model-invocation`: land-and-deploy and modernize). A miss is an `infra_error`, infra class `gstack_exposure_mismatch` (HE-FRONTIER-010), excluded pairwise and counted. Harbor's own skills copy ends in `|| true`, so this check is the only guard.
- **Removed skills:** listing entries and `skills/<dir>/...` paths of a gstack skill outside the lock, in any request, go into `removed_seen`. Bare words such as review or verify never count.
- **Opens:** Claude Code Skill calls, Hermes skill_view, and any tool call naming a skill's SKILL.md (Read, Bash, Codex exec, Hermes read_file or terminal). For Codex's code-mode `exec`, the `output` fields inside the JSON lines it prints are read too, so a body that comes back escaped still counts; when one exec batches several reads and any returns a skill body, every skill path that exec names counts as opened. Reads of the files in a skill's `sections/` folder count apart, as `section_reads`.
- **Tokens:** `listing_bytes` is the gstack entries of the first agent-loop request. `opened_body_tokens` is the bytes of the tool results that returned a SKILL.md or section, each once, over the trial's bytes per token (captured bytes over the proxy's input tokens).
- **Audit:** the clean-arm check (`gstack_reads`) runs on plain cells and the `none` arm only. gstack arms show their exposure, removed skills and opens instead.

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
