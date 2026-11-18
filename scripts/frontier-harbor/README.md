# Frontier Harbor path (internal-task)

**Harbor 0.24.0 runs seven harnesses on the 52 pinned Terminal-Bench 2.1 tasks, every model call metered by our proxy, every task container behind an egress blocklist. An eighth, Cursor, calls Cursor's own servers.**

- **Harnesses:** Claude Code, Codex, Hermes and OpenClaw wrap our own pinned settings; Pi and mini-swe-agent are Harbor's stock classes with the model's real limits added. DeepSeek Harness (dsh) has no Harbor class, so agents.py has its own, on our multi-user profile. See [DeepSeek Harness](#deepseek-harness-dsh).
- **Models:** Opus 5.5 and Fable 5.1 (Anthropic), GPT-6.1 Sol and GPT-6 Astra (OpenAI), each at its real context window and max output, native effort high.
- **Web tools off:** no harness can search or fetch the web, and a check on the smoke's captured requests proves it before any counted trial. See [Web tools off](#web-tools-off).
- **Cursor:** the clean-room Cursor CLI on Opus 5.5 only. It calls Cursor's servers with `CURSOR_API_KEY`, so it has no proxy slot, and its cost is unreconciled and left out of the rankings. See [Cursor](#cursor).
- **Particle-1:** runs on Hermes, OpenClaw, Pi and dsh only, through the proxy's Particle route (Chat Completions). Same harness settings as the frontier cells; only the model changes. See [Particle-1](#particle-1).
- **DeepSeek V4.1 Flash 1017:** runs on Hermes, OpenClaw, Pi and dsh only, through the proxy's OpenRouter route, pinned to DeepSeek's own endpoint. Same harness settings as the frontier cells; only the model and its route change. See [DeepSeek V4.1 Flash 1017](#deepseek-v41-flash-1017).
- **Keys:** a task container sees only a per-trial dummy token and the proxy URL. Harbor runs with a scrubbed environment. Only the metering proxy holds provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PARTICLE_API_KEY`, `OPENROUTER_API_KEY`). The one exception is a Cursor cell: its task container receives `CURSOR_API_KEY` as a file, because the Cursor CLI calls Cursor's servers itself ([Cursor](#cursor)).
- **Proxy:** refuses hosted web tools, caps output at 128,000 tokens and writes every forwarded body to `<run>/jobs/<job>/<trial>/proxy-capture/` on the host, outside the task container, for the contamination audit.

## Files

| File | What it does |
|---|---|
| [pin.json](pin.json) | Harbor wheel and its hashed lock, TB2.1 commit, the 52 tasks with digests, the shared order, the kept sample, harness versions, model limits, the blocklist, licences |
| [harbor-requirements.txt](harbor-requirements.txt) | every package Harbor installs with, by version and sha256 (`uv pip install --require-hashes`) |
| [materialize.ts](materialize.ts) | copies the pinned tasks into a run root with each image pinned by digest (`tb21`, or `swerebench` for the second source); `repo` copies a gstack-native repo task split instead ([Repo tasks and delivery arms](#repo-tasks-and-delivery-arms-harn-61)) |
| [pin-swe-rebench-07-2026.json](pin-swe-rebench-07-2026.json) | the second task source: 111 SWE-rebench July 2026 tasks with digests, base images by digest and size, the Harbor hub dataset version, its blocklist and licences |
| [swe_rebench_fetch.py](swe_rebench_fetch.py) | fetches the second source's tasks from the Harbor hub by content hash and checks them |
| [egress_blocklist.py](egress_blocklist.py) | a source's blocklist (pin.json's plus the source's hosts) and the sidecar build context with it |
| [swe-rebench-oracle-check.sh](swe-rebench-oracle-check.sh) | the one-VM oracle and nop check of the second source behind its blocklist, with the history audit of every image |
| [swe-rebench-history-audit.sh](swe-rebench-history-audit.sh) | whether the repository inside one task image holds anything past the task's base commit |
| [plan.ts](plan.ts) | reads a `frontier-harbor/1` preregistration: cells, trial ids, shard leases, Harbor jobs |
| [frontier_settings.py](frontier_settings.py) | renders each harness's settings and its `harness_settings.json` record (no Harbor import) |
| [agents.py](agents.py) | the Harbor installed-agent classes |
| [cursor-tool-hook.sh](cursor-tool-hook.sh) | the Cursor cell's tool-audit hook (POSIX sh): one line per tool call, `tool_name` only |
| [cursor-smoke-prereg.json](cursor-smoke-prereg.json) | the keyed one-trial Cursor smoke's preregistration (uncounted, [Cursor](#cursor)) |
| [broker.ts](broker.ts) | binds each trial's slot in the metering proxy with a fresh token |
| [egress.py](egress.py), [egress-sidecar/](egress-sidecar/) | Harbor's docker environment with a blocklist added to its egress sidecar |
| [vm-run.sh](vm-run.sh) | runs one shard |
| [to-trials.ts](to-trials.ts) | Harbor results into trial records, with requested and sent effort and infra classes; the mid-run journal and the recovery from a mirror ([A lost VM](#a-lost-vm)) |
| [merge-stages.ts](merge-stages.ts) | merges a staged run's shard directories into one results directory, with the exclusion list and rerun records |
| [subset.ts](subset.ts) | a copy of merged results without some trials (tasks, a Harbor exception, first runs in a time window, or a trial list), or with one harness's infra errors on one task scored as fails, for the sensitivity lines |
| [diagnosis-label.ts](diagnosis-label.ts) | labels each SWE-rebench task "needs diagnosis" or "pointed" by whether its instruction names a file the reference fix changes; `--check` recomputes every label from the downloaded dataset (`fable-diagnosis-2026-11`) |
| [feature-split.ts](feature-split.ts) | the paired split of two arms by a task label: each group's difference with a task bootstrap interval, the interaction, cost per solve, the cost ratio and the extra cost per extra solve (`fable-diagnosis-2026-11`) |
| [release-fetch-audit.ts](release-fetch-audit.ts) | counts the trials whose transcript shows a fetch of the task repository's own code at a ref other than its base commit (registries, module proxies, CDNs, git remotes), as attempted or fetched (`fable-diagnosis-2026-11` amendment 1) |
| [refusals.ts](refusals.ts) | lists the trials with a provider safety refusal, read the same way in every harness from each harness's own refusal marker |
| [recognition.ts](recognition.ts) | the recognition and compaction scan of `fable-5-2-coding-cc322-2026-11`: per trial, Claude Code `unrecognized_model` lines, compaction points and peak context, read from finished results or a running shard's raw Harbor trials (`--jobs`); exits 1 on an unrecognized model, a compaction below `--min-pre-tokens`, an unreadable compaction record or a trial with no agent log |
| [fake-upstream.ts](fake-upstream.ts) | keyless model upstream for the install check and, with `--tool-call`, the delivery smoke |
| [web-tools-check.ts](web-tools-check.ts) | after the smoke, before any counted trial: fails the shard (exit 4) when a cell's captured tool list holds a web search or web fetch tool ([Web tools off](#web-tools-off)) |
| [install-check.sh](install-check.sh), [install-check.json](install-check.json) | the one-VM install check and its receipt |
| [install-check-prereg.json](install-check-prereg.json) | the install check's own preregistration (one cell per agent class and model) |
| [egress-probe/](egress-probe/) | a do-nothing task whose verifier checks the blocklist from inside a task container (install check step 3) |
| [audit.ts](audit.ts), [answer-keys/](answer-keys/) | the contamination audit over captured requests: the benchmark canary, Harness Leaderboard answer-key fingerprints (Apache-2.0, see its NOTICE.md), benchmark-fetch requests and gstack file reads |
| [../canary/gstack/](../canary/gstack/README.md) | the gstack regression canary rig: release arm builder, tier spec, exposure, install check and tier runner |
| [delivery.py](delivery.py), [delivery-pin.json](delivery-pin.json), [delivery/](delivery/) | the internal-task delivery arms (none, skill, hook, startup, placebo): each arm's files, commands and before-ready health checks per harness, and the hook, plugin and extension files they install |
| [delivery-smoke.sh](delivery-smoke.sh), [delivery_smoke.py](delivery_smoke.py) | the keyless smoke of every harness and arm on a repo task, and its checks |
| [analyze.ts](analyze.ts) | the harness x model analysis: pass rates with intervals, the noise view, paired comparisons and cost per solve (uses `runner/stats/frontier.ts`), the particle-1 against frontier model-swap contrast when the spec has a `model_swap` block ([../model-swap.ts](../model-swap.ts)), and per gstack arm the exposure counts, open rate per skill and token means |
| [gstack-arm.ts](gstack-arm.ts), [gstack-build.ts](gstack-build.ts), [gstack-builder/](gstack-builder/), [gstack-runtime.json](gstack-runtime.json) | the gstack arms (internal-task): spec parsing, the docker builder that installs pinned gstack the way a user does, the lock check, and each cell's install manifest |
| [gstack-names.ts](gstack-names.ts) | which skills a gstack lock holds and the name each host lists them under |
| [gstack-singles.ts](gstack-singles.ts), [gstack-catalog.json](gstack-catalog.json) | every single-skill removal per host at the pin, written to the run folder's `skills.json`; `gstack-arm.ts locks --arm <id>=<spec>` renders named arms (the stage 0 amendment's minus and diet arms) the same way and writes `locks/<host>/<id>.lock.json` |
| [gstack-check.sh](gstack-check.sh), [gstack-check.ts](gstack-check.ts), [install-check-gstack-prereg.json](install-check-gstack-prereg.json) | the keyless gstack install check (install-check.sh step 6) and its preregistration |
| [gstack-exposure.ts](gstack-exposure.ts) | gstack arms (internal-task): the skills each host listed in the first agent-loop request against the arm's lock, removed skills seen, skill opens and section reads, listing bytes and opened-body tokens, per trial |
| [ablation.ts](ablation.ts) | the frozen analysis of the gstack skill ablation (internal-task), read from [ablation-spec.json](../../docs/benchmarks/2026-11-10-gstack-skill-ablation/ablation-spec.json): `headroom` (stage 0, the none arm on each model's subset), `select` (stage 0, the minus arms and the diet from full-arm open rates), `opens` (amendment 2: re-measures each gstack record's opens from its unchanged capture, for `select --opens`) and `analyze` (main stage: per-arm rates, tokens and cost per solve, task-level pairs with Holm, pooled readings and the per-skill verdicts). `--stages` takes `plan.ts show --stages-out`, so a rerun record counts in the stage that planned its trial |

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
- **Merge:** `merge-stages.ts --out <dir> --shard <name>:<label>=<dir> ... [--exclude <list.json> --rerun <name>:<label>=<dir> ...]` merges a shard's stage directories, which `merge-shards.ts` refuses. A listed trial takes its rerun record, or is written as excluded when it has none. A rerun its lease stopped (`lease_refused`) replaces nothing: its record keeps the first run's spend as `frontier.first_run_usd`, which `analyze.ts` counts in cost per solve. Each shard's tasks tree is left out of the run-plan comparison, because a run with per-model subsets gives each model's shards their own tree; the directories of one shard must share a tree, shards whose records cover the same tasks must share one too, and the merged manifest lists each shard's under `tasks_tree_sha256_by_shard` when they differ. The shard directories are never rewritten.

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
- **Check:** `gstack-check.sh` runs every host's none, full and minus-retro arms against the fake upstream and compares the first request's skill listing with the lock. A harness whose none arm captured no request fails each of its gstack arms with "no none-baseline request for <harness>". It also runs gstack-skill-start in the task image with every packet captured, and probes the 52 pinned task images.
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

## Particle-1

**`particle:particle-1` runs on Hermes, OpenClaw, Pi and dsh with the settings those harnesses use for Opus 5.5 and GPT-6.1 Sol. Only the model and its route change.**

- **Route:** `<proxy>/<trial>/particle/v1`. Particle speaks only OpenAI Chat Completions, and the proxy forwards only `POST /v1/chat/completions` there.
- **Limits:** window 1,048,576 tokens. Output cap 128,000, the cap every other model here runs under (Particle's own default is 32,000 and it clamps above 131,072).
- **Effort:** `reasoning_effort` high. Particle serves medium and high at the same effort, and high is its default (docs.particle.ai/reasoning). Our multi-user Particle configs send medium; `harness_settings.json` lists that as a difference.
- **Hermes:** `--provider custom:particle`, the `custom_providers` entry of [config.particle.yaml](../../harnesses/hermes/config/config.particle.yaml). Hermes sends no effort or cap of its own on a custom endpoint, so `extra_body` adds `reasoning_effort: high` and `max_completion_tokens: 128000`.
- **OpenClaw:** provider `particle` on api `openai-completions`, as [openclaw.particle.json](../../harnesses/openclaw/config/openclaw.particle.json): `utilityModel` is the cell model and memory search is off (Particle has no embeddings route).
- **Pi:** Harbor resolves a custom endpoint only for providers it knows, and it knows no Particle. So agents.py writes Pi's `models.json` itself: provider `harbor-endpoint`, api `openai-completions`, the model's real limits.
- **dsh:** its multi-user Particle route rows, [route.particle.patch.yml](../../harnesses/dsh/config/route.particle.patch.yml): provider `he-particle` on api `openai-completions`, `reasoning_effort` high, `max_completion_tokens` 128,000, the system role, no `store`. The token is `HE_MODEL_API_KEY` ([DeepSeek Harness](#deepseek-harness-dsh)).
- **Keys:** the container gets `OPENAI_BASE_URL` (the Particle route) and `OPENAI_API_KEY` (the per-trial token), the names each harness's provider block reads. No container variable is named `PARTICLE_*`. `PARTICLE_API_KEY` reaches the proxy's process only.
- **Refused:** a Particle cell on Claude Code, Codex or mini-swe-agent stops with HE-FRONTIER-012 ([docs/errors.md](../../docs/errors.md)) in plan.ts and at class setup. Their pin.json model row lists the four harnesses that have a route (dsh's is its multi-user Particle route, [DeepSeek Harness](#deepseek-harness-dsh)).
- **Cost:** priced from runner/pricing ($0.25 input, $0.03 cached, $1.00 output per million tokens, peak rates). One call reserves about $0.48, so a shard of four concurrent Particle trials needs a lease of at least $1.92.
- **Install check:** install-check-prereg.json has four Particle cells, and fake-upstream.ts answers the Particle route the way Particle does (`reasoning_content` first, the model echoed as `particle-ai/particle-1`). The committed install-check.json, from uncounted smoke 7 on 2026-11-10, includes them (`hermes-particle`, `openclaw-particle`, `pi-particle`, `dsh-particle`).
- **Not checked keyless:** whether Particle accepts every field each harness sends (Pi's `store: false` and `developer` role, for example). The first paid smoke trial shows it.

## DeepSeek V4.1 Flash 1017

**`openrouter:deepseek/deepseek-v4.1-flash-1017` runs on Hermes, OpenClaw and Pi with the settings those harnesses use for Opus 5.5 and GPT-6.1 Sol. It is the same model id the multi-user path uses.** dsh runs it too; see [DeepSeek Harness (dsh)](#deepseek-harness-dsh).

- **Route:** `<proxy>/<trial>/openrouter/v1`, Chat Completions only. The proxy code is the multi-user path's: every request goes to DeepSeek's own endpoint (`provider.only [deepseek]`, no fallbacks, `max_price` at the price row). A models array, `route`, `plugins`, an `openrouter:` server tool, `web_search_options` (either runs a web search on OpenRouter's servers) and the `:online`, `:nitro` and `:floor` suffixes are refused (HE-PROXY-008).
- **Served elsewhere:** a response OpenRouter says another provider served is HE-PROXY-009. to-trials.ts marks that trial infra, class `served_elsewhere`.
- **Limits:** window 1,048,576 tokens, from OpenRouter's endpoint list for the DeepSeek endpoint (read 2026-11-09). Output cap 128,000, the cap every other model here runs under (the endpoint allows 393,216).
- **Effort:** high, as OpenRouter's `reasoning {effort: high}`. The model offers none, low, high and max.
- **Reasoning passed back:** DeepSeek thinking mode refuses a tool-call turn replayed without its reasoning. Each harness passes it back:
  - **Pi:** `reasoning_details`.
  - **Hermes:** `reasoning_content` (OpenRouter takes it as an alias).
  - **OpenClaw:** `reasoning`.
  - `harness_settings.json` records the field per harness, and each trial record has `frontier.reasoning_replay`.
- **Hermes:** `--provider custom:openrouter-proxy`, as [config.openrouter.yaml](../../harnesses/hermes/config/config.openrouter.yaml). `extra_body` adds `reasoning {effort: high}` and `max_completion_tokens: 128000`. `agent.reasoning_effort: high` also sends top-level `reasoning_effort: high`. Its session-title call sends reasoning off and the proxy fills the cap (harness housekeeping, shipped default).
- **OpenClaw:** provider `openrouter-proxy` on api `openai-completions`, as [openclaw.openrouter.json](../../harnesses/openclaw/config/openclaw.openrouter.json), with `compat.thinkingFormat: openrouter`. The id is not `openrouter`, so OpenClaw's bundled OpenRouter provider (live catalog, openrouter.ai-only request shaping) never runs against the proxy.
- **Pi:** Harbor would point Pi's openrouter provider at `OPENROUTER_BASE_URL` with `OPENROUTER_API_KEY`, names no container holds. So agents.py writes Pi's `models.json` as for Particle, plus Pi 1.5.0's own catalog row for this model (`thinkingFormat: openrouter`, reasoning on assistant turns, `max_completion_tokens`).
- **dsh:** the pin.json model row lists dsh. Its Harbor class is `FrontierDsh` ([DeepSeek Harness (dsh)](#deepseek-harness-dsh)).
- **Keys:** the container gets `OPENAI_BASE_URL` (the OpenRouter route) and `OPENAI_API_KEY` (the per-trial token). `OPENROUTER_API_KEY` reaches the proxy's process only, and vm-run.sh strips it from everything else.
- **Refused:** a DeepSeek cell on Claude Code, Codex or mini-swe-agent stops with HE-FRONTIER-012.
- **Cost:** priced from the runner/pricing row ($0.30 input, $0.006 cached, $1.20 output per million tokens, the endpoint's peak rates). One call reserves about $0.57, so a shard of four concurrent DeepSeek trials needs a lease of at least $2.30.
- **Install check:** install-check-prereg.json has three DeepSeek cells (`pi-deepseek`, `hermes-deepseek`, `openclaw-deepseek`). fake-upstream.ts answers the OpenRouter route like DeepSeek does, including the refusal of a tool-call turn replayed without reasoning. install-check.sh fails a DeepSeek cell that replays no reasoning. The committed install-check.json, from uncounted smoke 7 on 2026-11-10, includes them.
- **Checked keyless with the real binaries:** `tests/frontier-harbor-deepseek.test.ts` runs Pi, Hermes and OpenClaw (set `HE_TEST_PI_BIN`, `HE_TEST_HERMES_BIN`, `HE_TEST_OPENCLAW_BIN`) through the proxy to fake-upstream.ts. Each sent effort high and the 128,000 cap and passed reasoning back.
- **Not checked keyless:** whether OpenRouter's DeepSeek endpoint accepts every field each harness sends (Pi's `store: false`, OpenClaw's `tool_choice`). The first paid smoke trial shows it.

## Web tools off

**No harness in a codegen cell may search or fetch the web (ruling of 2026-11-09).** A check found Hermes's default keyless web search returned a TB2.1 task's solve.sh and test file, and a particle-1 trial passed with them. The host blocklist did not catch it, because the search runs through public free tiers of search vendors.

| Harness | Setting on this path | Source |
|---|---|---|
| Hermes v2026.9.24 | `web.keyless_fallback: false` and `agent.disabled_toolsets: [web, browser]` in the config agents.py writes | `website/docs/user-guide/features/web-search.md` (keyless ring, also turns `keyless_rescue` off) and `configuration.md` "Global Toolset Disable" at the pinned commit; `plugins/web/keyless_mcp.py` is the Exa, Parallel and Keenable route |
| OpenClaw 2026.10.6 | `tools.deny` gets `group:web` (web_search, x_search, web_fetch) and `browser`; `tools.web.search.enabled` and `tools.web.fetch.enabled` false; Harbor's `disable_web_search` kept | `docs/gateway/config-tools/tool-policy.md`, `docs/tools/web.md`, `docs/tools/web-fetch.md` in the npm package |
| Claude Code 2.1.312 | `--disallowedTools WebSearch,WebFetch` and `permissions.deny [WebSearch, WebFetch]` (unchanged) | Harbor `disallowed_tools`; [settings.json](../../harnesses/claude-code/config/settings.json) |
| Codex 0.165.0 | `web_search = "disabled"`, `tools.web_search = false`, `external_web_access = false` (unchanged) | Harbor `web_search`; [config.toml](../../harnesses/codex/config/config.toml) |
| Pi 1.5.0 | nothing to turn off: it ships no web tool (`dist/core/tools`: read, bash, edit, write, grep, find, ls, powershell) | the npm package |
| mini-swe-agent | nothing to turn off: one bash tool | Harbor's stock class |
| DeepSeek Harness 0.2.2-rc.1 | the multi-user adapter's rows in the profile agents.py writes: `web`, `web-search-deepseek`, `web-deepseek-api`, `web-fetch-http` and `tool-web` disabled; setup refuses a composed profile (`dsh --dump-config`) where one is on. The 22 native tools left hold no web tool (`tests/fixtures/frontier-harbor/dsh-tools.json`); with the rows taken out, `web_fetch` comes back and the check catches it | [base.patch.yml](../../harnesses/dsh/config/base.patch.yml), `tests/frontier-harbor-dsh.test.ts` |
| Cursor | FrontierCursor (agents.py). Web fetch is denied (`permissions.deny WebFetch(*)`); **web search has no documented off switch**, so it is the documented exception and the F1 audit applies | [harnesses/cursor/README.md](../../harnesses/cursor/README.md), "Web tools" and "Clean-room rebuild" |

The browser tools count as web fetch: they load any URL the model names.

### The check

- **When:** `scripts/ubicloud/vm-shard.sh` runs it after the smoke and before vm-run.sh: `bun scripts/frontier-harbor/web-tools-check.ts --smoke ~/shard/smoke/results --prereg <prereg> --name <shard>`.
- **What it reads:** for each cell of the shard, the smoke trial of the same harness and model (else harness and provider), and every tool its captured requests offered the model (`<smoke>/agents/run/jobs/<job>/<trial>/proxy-capture/proxy-requests.ndjson`). Codex declares its tools in a Responses `additional_tools` input item, not `tools`, and the check reads both.
- **A web tool:** a name or hosted type with a web word (web, browser, url, http, exa, parallel, keenable, tavily and the like), a description that names a web tool or a web vendor, or a first sentence that says it searches the web, fetches a URL or drives a web browser.
- **Fails (exit 4, HE-FRONTIER-011):** a web tool in any cell, or a cell with no captured tool list. Each line names the cell and the tool. So a counted shard needs its smoke: `--no-smoke` stops it here.
- **Writes:** `~/shard/smoke/results/web-tools.json`, the tool names per cell. No body or description.
- **Cursor:** its row reads "web tools not disableable (documented), audit applies". It does not fail the shard and does not pass silently.
- **Checked against real captures:** every tool in the committed anatomy captures of Claude Code, Codex, OpenClaw, QM and Harness Zero passes. The multi-user Hermes captures fail on `web_search`, `web_extract`, the browser tools and `execute_code`, whose description offers `web_search` (`tests/frontier-harbor-web-tools.test.ts`).
- **Not seen by it:** a tool a harness keeps behind its own tool search and never lists in a request (Claude Code's ToolSearch, OpenClaw's tool_search). The config switches above remove those from the catalog too. The Capy shard path (vm-run.sh by hand) does not run the check; run it on the smoke yourself first.

## Zero data retention

Since 2026-11-14 the OpenAI organization behind the shared key enforces zero data retention. A Responses request that chains on `previous_response_id` gets HTTP 400 ("Previous response cannot be used for this organization due to Zero Data Retention"), so a harness that chains would lose every OpenAI trial at its second turn.

- **The probe:** in the install check, `fake-upstream.ts` answers a Responses request that declares a function tool with one call of that tool (its required arguments filled with placeholders), or a custom tool with one call whose input is `true`, so the harness runs it and sends a second turn. It finds tools inside namespaces too: pinned Codex 0.165.0 declares all of its tools that way, led by the custom JavaScript tool `functions.exec`. It refuses a chained request with the same 400.
- **The check:** `bun scripts/frontier-harbor/zdr-check.ts --smoke <install check out dir> --prereg <prereg> --cells a,b`. For each OpenAI cell it reads the install check trial of the same harness and model. A cell passes when no request chained and one Responses request carried the tool's output (`function_call_output`); Chat Completions only passes too, since there is nothing to chain. Anything else fails (exit 4, HE-FRONTIER-013). It writes `zdr.json`, counts only.
- **In the install check:** every OpenAI cell of Codex, Hermes, OpenClaw, Pi and dsh, in `install-check.json` under `zdr`. mini-swe-agent declares no tools, so the probe can't drive it to a second turn; no counted cell runs it.
- **The gate:** `scripts/ubicloud/run-shard.sh --zdr-gate <install check results dir>` runs the check for the shard's OpenAI cells before any VM, and refuses the shard when it fails, when no gate is given, or when the install check ran at a commit whose `pin.json`, `frontier_settings.py`, `agents.py` or `harnesses/<harness>/` differ from the shard's.

## DeepSeek Harness (dsh)

**dsh 0.2.2-rc.1 runs through `FrontierDsh`, an installed-agent class of our own, with the headless profile our multi-user adapter writes. Only the permission preset and the window differ.**

- **No Harbor class to subclass:** Harbor 0.24.0's agent list (`harbor.models.agent.name.AgentName`, 47 agents) has no dsh or DeepSeek Harness. DeepSeek appears there only as a model provider of deerflow, eve and mcode. So `FrontierDsh` is a `BaseInstalledAgent` in the style of Harbor's Pi class.
- **Install, at agent setup:** Node 24 through nvm, then `npm ci --strict-allow-scripts` of [harnesses/dsh/package.json](../../harnesses/dsh/package.json) and its lock. Both are checked by sha256 against pin.json. dsh and every plugin its profile names come from that lock. Nothing is installed when the agent runs: no `dsh plugin add`, no package manager.
- **Profile:** `$DSH_HOME/profiles/headless/cordis.patch.yml` is the multi-user adapter's `route.<provider>.patch.yml` and `base.patch.yml`, rendered the way adapter.sh renders them (`frontier_settings.dsh_profile_patch`). One row is added: `contextWindow` on the model entry (the adapter states none, so dsh falls back to 1,000,000). DSH_HOME and DSH_AGENTS_HOME are fresh under `/tmp/frontier-dsh`.
- **Setup checks:** `dsh --version` must be the pin. `dsh --profile headless --dump-config` must show the web, DeepSeek-hosted and instruction-file plugins off, telemetry `DISABLED` and the default model on the proxy route. The composed tree is kept as `agent/dsh-config.yml`.
- **Run:** `dsh --profile headless --json --permission-mode danger-full-access --approval-policy never -`, the instruction on stdin, in the task's working directory. Events go to `agent/dsh.jsonl`.
- **Container env:** `HE_MODEL_API_KEY` (the per-trial token, which the profile names by `apiKeyEnv`), `DSH_HOME`, `DSH_AGENTS_HOME` and `DSH_TELEMETRY_MODE=DISABLED`. No other key name.

| Setting | Value | Source |
|---|---|---|
| Version | `@deepseek-ai/dsh@0.2.2-rc.1`, npm integrity and lock sha256 in pin.json | [harnesses/dsh/pin.json](../../harnesses/dsh/pin.json) |
| Profile | `headless` | dsh's one-shot profile, as the multi-user adapter |
| Permissions | `danger-full-access`, approvals `never` | Harbor's equivalent: Harbor runs Codex with `--dangerously-bypass-approvals-and-sandbox`, Claude Code with `bypassPermissions`, Hermes with `--yolo`. dsh's `workspace-write` confines shell writes to the working directory and /tmp under Landlock (seen keyless: a write elsewhere was denied), and TB2.1 tasks write outside it. The multi-user pin keeps `workspace-write` |
| Effort | `reasoning: high`, model `reasoningEfforts {high: high}` | route patches. Sent as `output_config.effort` (Anthropic), `reasoning.effort` (OpenAI, OpenRouter) or `reasoning_effort` (Particle) |
| Output cap | `maxTokens` 128,000 | route patches, the multi-user cap |
| Window | `contextWindow` = pin.json model row | added here |
| Compaction | dsh-compaction-basic default, `floor(min(0.8 W, W - O - 65,536))`, 800,000 on Opus 5.5 | shipped default |
| Web plugins | off | base.patch.yml |
| Instruction files | none auto-loaded: `agent-instructions` off. Setup records the AGENTS.md / CLAUDE.md files on disk and any skill directory (`install_checks.instruction_files`) | base.patch.yml |
| Housekeeping model | the session-title call (no tools, 4,096 cap) on the cell's own route and model: dsh's shipped default, which runs on every route, so it stays. Metered, never agent loop | harnesses/dsh/pin.json `housekeeping_model` |
| Reasoning replay | signed thinking block (Anthropic), encrypted reasoning item (OpenAI), `reasoning_content` (Particle), `reasoning_details` (OpenRouter), each sent back on the tool-call turn | dsh's pi-ai layer; checked keyless in the container test |

- **Cells:** Opus 5.5, GPT-6.1 Sol, particle-1 and DeepSeek-V4.1-Flash-1017 (native). pin.json's particle-1 and DeepSeek rows list dsh.
- **DeepSeek-V4.1-Flash-1017:** runs on the proxy's OpenRouter route (`<proxy>/<trial>/openrouter/v1`, Chat Completions), pinned to DeepSeek's own endpoint as in [DeepSeek V4.1 Flash 1017](#deepseek-v41-flash-1017). pin.json's row `openrouter:deepseek/deepseek-v4.1-flash-1017` lists dsh, and frontier_settings.py and plan.ts accept the `openrouter` provider for dsh.
- **Install check:** four dsh cells (`dsh-opus`, `dsh-sol`, `dsh-particle`, `dsh-deepseek`), on the fake upstream's Anthropic, OpenAI, Particle and OpenRouter routes.
- **Tests:** `tests/frontier-harbor-dsh.test.ts`. Keyless layers: the pin and plan, the rendered settings, the dump check on a real `--dump-config` (`tests/fixtures/frontier-harbor/dsh-dump-config.yml`), the class against a stub of Harbor, and the web-tools check on dsh's real tool list. With docker, the real dsh in harnesses/dsh's image runs one tool turn per route against `tests/fixtures/dsh/fake-upstream.ts`.
- **Not checked keyless:** whether OpenRouter's DeepSeek endpoint accepts the replayed `reasoning_details`. The first paid smoke trial shows it.
## gstack arms: what reached the model

- **Cell block:** a cell may carry `"gstack": { "arm", "spec", "lock", "spec_sha256" }`; `lock` is the repository path of the arm's gstack lock file. A cell without it is a plain cell.
- **Exposure check, per trial:** to-trials.ts parses the first agent-loop request (the effort check's definition) for the host's skills listing: Claude Code's skill_listing system-reminder, Codex's `<skills_instructions>` catalog, Hermes's `<available_skills>` index. The listed gstack skills must equal the lock's skills, less the ones the host never lists (Claude Code drops skills with `disable-model-invocation`: land-and-deploy and modernize). A miss is an `infra_error`, infra class `gstack_exposure_mismatch` (HE-FRONTIER-010), excluded pairwise and counted. Harbor's own skills copy ends in `|| true`, so this check is the only guard.
- **Removed skills:** listing entries and `skills/<dir>/...` paths of a gstack skill outside the lock, in any request, go into `removed_seen`. Bare words such as review or verify never count.
- **Opens:** Claude Code Skill calls, Hermes skill_view, and any tool call naming a skill's SKILL.md (Read, Bash, Codex exec, Hermes read_file or terminal). For Codex's code-mode `exec`, the `output` fields inside the JSON lines it prints are read too, so a body that comes back escaped still counts; when one exec batches several reads and any returns a skill body, every skill path that exec names counts as opened. Reads of the files in a skill's `sections/` folder count apart, as `section_reads`.
- **Tokens:** `listing_bytes` is the gstack entries of the first agent-loop request. `opened_body_tokens` is the bytes of the tool results that returned a SKILL.md or section, each once, over the trial's bytes per token (captured bytes over the proxy's input tokens).
- **Audit:** the clean-arm check (`gstack_reads`) runs on plain cells and the `none` arm only. gstack arms show their exposure, removed skills and opens instead.

## Egress

- **How:** Harbor's sidecar (gost and nftables) only knows allowlists. Ours adds a blocklist service; public mode sends every TCP connection through it. gost matches the TLS SNI or the HTTP Host.
- **Blocked:** the Terminal-Bench site and the Harbor hub, the leaderboard Space, the Hugging Face dataset viewer API, `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` and the Vertex AI hosts, `cursor.sh`, `*.cursor.sh` and `downloads.cursor.com`. Cursor cells get their own list ([Cursor](#cursor)).
- **Limit:** a host-name list cannot block one path of a shared host. github.com, raw.githubusercontent.com and huggingface.co stay open because tasks download from them; the audit of captured requests covers fetches of benchmark sources there.

## Repo tasks and delivery arms (internal-task)

**The five harnesses run gstack-native repo tasks through agents.py, and a job's `delivery` kwarg picks one delivery arm per cell. A job without the kwarg runs exactly as before.**

- **Repo tasks:** `bun scripts/frontier-harbor/materialize.ts repo --src tasks/repo/<set>/dev --out <run>` reuses gstack-laneb's native materialization (separate offline verifier, `/work` restored as the artifact) without the Lane B runtime layer, and writes `kinds.json` for the kwarg.
- **The preregistration:** `repo_tasks` (`dir`, `cards` with a review and a ship card, and optional `card_sha256`, `placebo` and `placebo_sha256`) in place of `task_list`. Every cell names its `arm`, a model and harness may have one cell per arm, a cell's `tasks` may be `{ "ids": [...] }` (such a cell can't be in a stage), and there is no kept sample. plan.ts writes the kwarg into each Harbor job from it and the run root's `kinds.json`, and vm-run.sh runs `materialize.ts repo` in place of `tb21`, so `--tb21` is not needed.
- **The kwarg:** `{"arm": "hook", "cards": {"review": "harnesses/routes/gstack-cards/review.md", "ship": "harnesses/routes/gstack-cards/ship.md"}, "card_sha256": {...}, "placebo": "harnesses/routes/placebo.md", "kinds": <kinds.json>}`. The cards, the gstack line each one quotes and their extractor: [harnesses/routes/gstack-cards/](../../harnesses/routes/gstack-cards/README.md).
- **Arms:** none (nothing written; gstack must be absent), skill (gstack's own install at the pinned commit, unattended, plus one told sentence per host; Pi's is "manual install, not a gstack route"), hook (the card on request 1 and every tool follow-up), startup (the card in the harness's global startup file), placebo (the hook route carrying placebo.md).
- **Outside /work:** every delivery and skill file. A route that could only write into the workspace is refused: OpenClaw startup is "can't run" (HE-DELIVERY-004).
- **Before ready:** each route's health checks run at setup or right before the agent command, and a failure stops the trial before the agent starts (HE-DELIVERY-005). A gstack skill file in a control arm refuses the trial (HE-DELIVERY-006).
- **Per harness:** `python3 scripts/frontier-harbor/delivery.py plan <harness> <arm> <kind> <card>` prints the plan with the pinned file and line each route rests on; `delivery.py cant-run` prints the refusals.
- **Keyless smoke:** `bash scripts/frontier-harbor/delivery-smoke.sh <out> [--local]` runs every harness and arm against `fake-upstream.ts --tool-call`, which answers the first agent request with one shell tool call so each session sends a follow-up. `--local` is for a machine without nftables fib inet support (agent phase only, verifier off).

## A lost VM

**A shard's finished trials survive losing its VM and its controller together: each one's record is in the mirror before `finish()` runs.**

- **The journal:** while Harbor runs, `vm-run.sh` runs `to-trials.ts journal` every 60 s. It appends one row per newly finished trial to `<out>/trials.journal.jsonl`: the record `convert` would write (cell, task, attempt, grade, reward, timings, meter id and usage, the effort check read from the capture), the time, and the usage log's running total. A trial waits for a later pass until the usage log holds a line for every request it captured; once it finished more than the proxy's 15-minute upstream deadline ago it is journaled anyway, flagged with `frontier.unmetered_requests`, and `convert` flags it the same way. A trial whose capture hit the proxy's 256 MiB cap stops counting requests at the cap, so it always waits for that deadline. `finish()` stops it and writes `trials.jsonl` as before.
- **The mirror** (`run-shard.sh --replicate-to`, every 20 minutes) leaves out every `proxy-capture/` directory (request bodies) and `results/run/` (Harbor's job tree), and carries the journal, `proxy-usage.ndjson`, the ledger and `attestation.json`. It is packed: `<replicate-to>/<shard>/results.tar.zst` and `smoke.tar.zst` (`.tar.gz` without zstd), each renamed into place whole, beside `shard-vm.json` and the logs. Inside it, each finished trial's `work/repo` and `work/remote.git` are replaced by `harbor/artifacts/work-git/` ([work-git.sh](work-git.sh) `pack`): git bundles of the new commits against the task's `environment/work.tar`, the refs, HEAD and reflogs, and one binary diff of what was left uncommitted, checked by a rebuild before it is written. A trial whose trees cannot be packed keeps its raw trees, with a line in `lane.log`. To get a trial's trees back: `bash scripts/frontier-harbor/work-git.sh rebuild <trial>/harbor/artifacts/work-git tasks/repo/<suite>/<split>/<task>/environment/work.tar <out>` (its `base.sha256` names the base and refuses any other); files git ignores, such as `__pycache__`, are listed in `repo.ignored`, not kept.
- **Size:** about 1.7 KB a journal row, 0.3 MB for a 3 x 52 shard. The shard's whole mid-run mirror stays under 5 MB plus the smoke's 3.3 MB (internal-task's main-stage shards held at most 27 KB a trial outside `trials/`).
- **Recover:** `bun scripts/frontier-harbor/to-trials.ts recover --mirror <replicate-to>/<shard> --out <new dir>`. It writes `trials.jsonl` (one record per journaled trial that the mirror's `trials.jsonl` does not already hold, each with `frontier.recovered: { from: "mirror", journaled_at }` and `paths: {}`) and `recovery.json` (counts, and the usage log's spend against the recovered records' spend). It needs nothing from the VM or `--dest`, and unpacks `results.tar.zst` or `.tar.gz` itself; to read the replica by hand, `tar -C <dir> --zstd -xf <replicate-to>/<shard>/results.tar.zst`.
- **Then:** `ubi-runner.sh down <vm>` (from `vm-map.jsonl`), and rerun the shard with `--done <new dir>/trials.jsonl` (and the mirror's `trials.jsonl` when an earlier stage wrote one). Those trials do not run again, and their spend counts against the rerun's lease.
- **Not recovered:** a trial still running at the last mirror, or one that finished less than a minute before it or was still waiting for a usage line. Its spend is in the mirror's usage log and ledger, and `recovery.json` reports it as spend in no recovered record. A recovered record has no Harbor directory or capture, so the contamination audit cannot read that trial.

## Cursor

**One clean-room Cursor CLI cell on Opus 5.5: the pinned package installed in the task container, one headless turn, every Cursor value from public sources.**

- **Class:** `FrontierCursor` (agents.py) on Harbor's `BaseInstalledAgent`. Harbor 0.24.0's own `cursor_cli.CursorCli` is not used or subclassed: it installs from the moving `curl cursor.com/install`, reads `CURSOR_API_KEY` from Harbor's environment and parses stream records our clean-room rebuild removed.
- **Sources:** only harnesses/cursor's `pin.json`, `cli-help.txt` and `config/cli-config.json`, whose sources are Cursor's public docs, the CLI's `--help` and `--version`, and what the CLI did at run time with no key ([harnesses/cursor/README.md](../../harnesses/cursor/README.md), "Clean-room rebuild" and "Harbor codegen cell"). Nothing comes from the CLI's JavaScript.
- **Install:** as root: curl the pinned package from `downloads.cursor.com`, check its sha256, unpack to `/opt/frontier-cursor`, check the launcher's sha256, then `agent --version` must print `2026.11.05-86047df` (HE-FRONTIER-002).
- **Turn:** `agent -p --output-format stream-json --force --trust --workspace "$PWD" --model 'claude-opus-5-5[effort=high,fast=false]' --disable-auto-update -- "$instruction"`, HOME `/tmp/frontier-cursor/home` holding our `cli-config.json` and a `hooks.json` (`postToolUse`, `postToolUseFailure`).
- **Before the turn:** the instruction files Cursor's docs say it loads (`AGENTS.md`, `CLAUDE.md`, `.cursor`, `.agents`, `.claude`, `.codex`, `.cursorignore`) are listed. One in the fresh HOME stops the trial (HE-CURSOR-004). One in the task's own tree is recorded, since every harness sees the task's files.
- **Key:** `vm-run.sh` keeps `CURSOR_API_KEY` as an unexported shell variable and writes it to a 0600 file under `~/.frontier-harbor`, outside `--out`. Only Cursor jobs get its path (`cursor_key_file`). FrontierCursor uploads it into the task container, and the turn's shell reads and deletes it before the CLI starts. It is never in argv, a job config or Harbor's environment. stdout and stderr are redacted line by line, and after the records are written `scripts/cursor/key-scan.ts` scans `--out` (exit 5, HE-CURSOR-003).
- **No key:** a counted Cursor shard without `CURSOR_API_KEY` exits 2 before installing anything. With `--fake-upstream` no key file is written, so each Cursor trial stops at agent setup with HE-CURSOR-002 before any agent command runs in its container.
- **Shards:** a counted shard with Cursor cells holds Cursor cells only (exit 2 otherwise). A Cursor-only shard starts no proxy, broker or lease.
- **Egress:** `egress:CursorBlocklistDockerEnvironment` with `egress-sidecar/blocklist-cursor.txt` (pin.json `egress.cursor_cells`): the base list without `cursor.sh`, `*.cursor.sh` and `downloads.cursor.com`, plus Cursor's Tab and codebase-search hosts (`api3`, `api4`, `*.gcpp`, `repo42`). Reachable: `api2.cursor.sh`, the `api5.cursor.sh` agent hosts and `downloads.cursor.com`.
- **Records:** `to-trials.ts` reads `agent/cursor-status.json` (the documented stream-json records: init model, tool calls, result). Usage is null, `effort_flag` is `unchecked` (no capture, no effort field in the stream), and `frontier.cursor` keeps the cost label and the turn's own window. `started_at` and `ended_at` are the Harbor trial window that `scripts/cursor/usage-export.ts` attributes the usage export by.
- **Cost:** per cell, from the account's usage export, unreconciled, never in the rankings.
- **Web tools:** web fetch is denied (`WebFetch(*)`), web search has no documented off switch. `web-tools-check.ts` reports "web tools not disableable (documented), audit applies". `audit.ts` reads `agent/cursor-stream.jsonl` (capture `cursor-stream`), and `bun scripts/cursor/web-tool-audit.ts <results>/trials.jsonl` reads the hook log.

### Checks

- **Keyless:** `install-check.sh` runs a `cursor-opus` cell. It passes when the trial stopped with HE-CURSOR-002, recorded `cursor_api_key: absent` and ran no agent command (no `cursor_version`, no `container_logs_entries`). Its `effort_flag: "unchecked"` does not fail the check; any other effort flag, on any cell, does. Nothing contacts Cursor.
- **Keyed one-trial smoke** (paid on Cursor's side, not run by this PR): on a bootstrapped Ubicloud VM, with `CURSOR_API_KEY` set in that shell only:

  ```
  bash scripts/frontier-harbor/vm-run.sh --prereg scripts/frontier-harbor/cursor-smoke-prereg.json --name cursor-smoke \
    --lease-usd 1 --out ~/cursor-smoke --tb21 ~/terminal-bench-2-1 --uncounted "internal-task Cursor keyed one-trial smoke"
  bun scripts/cursor/web-tool-audit.ts ~/cursor-smoke/trials.jsonl
  bun scripts/frontier-harbor/audit.ts --results ~/cursor-smoke
  ```

  Pass: exit 0, the key scan prints clean, the trial's `cursor-status.json` has `model_ok: true` and `success: true`. The lease is nominal: no Cursor call goes through the proxy.

### Gaps

- **Hosts per trial:** the Harbor sidecar logs no host decision, so the hosts a keyed trial reached aren't recorded per trial.
- **Mid-run mirror:** the key scan runs after the records, so a mirror taken mid-run is not scanned. stdout and stderr are redacted at the source.
- **Context window and max output:** set by Cursor's backend, not visible without a proxy capture. Declared in `harness_settings.json`.

## A second task source: SWE-rebench July 2026

- **What:** the 111 tasks of the Harbor dataset `ibragim-badertdinov/swe-rebench-07-2026@2026-07`: real GitHub issues from July 2026 in Go, Java, Python, Rust and TypeScript, each graded by the repository's own tests.
- **Pin:** [pin-swe-rebench-07-2026.json](pin-swe-rebench-07-2026.json). The dataset lives in the Harbor hub's package registry, not a git repository, so the pin records the dataset version's content hash and each task's (which equals its `treeDigest`), each Dockerfile's base image by registry digest with its compressed size, the shared order (seed `fable52-diagnosis-2026-11-14`) and the licences (CC BY 4.0 for the dataset; each repository keeps its own).
- **Choosing it:** a preregistration whose top-level `task_list` names the pin runs these tasks. Cell ranges index its order. Kept cells are refused, and every cell's own `task_list` must name the same source. Harness pins, model limits and the blocklist mechanics still come from pin.json.
- **On the VM:** `vm-run.sh --tasks-src <dir>` (vm-shard.sh passes `~/swe-rebench-07-2026`) fetches the shard's tasks with `swe_rebench_fetch.py` by content hash, or checks a copy already there, then `materialize.ts swerebench` pins each Dockerfile `FROM` line to its digest, appends the pin's `image_build` steps and sets the verifier env. A changed task, image or step is refused.
- **Python prefetch:** 44 of the 111 images have no `python3`, so the verifier's log parser runs under `uv run`, and uv tries to download CPython 3.13.5 from github.com, which the blocklist refuses. For those 44, the pin's `python_prefetch` step installs that exact CPython with the task's own uv 0.7.13 at image build time, when the network is open. Every verifier runs with `UV_PYTHON_DOWNLOADS=never`, so a verifier that still tries to download fails loudly. The blocklist stays on for the agent and the verifier.
- **History scrub:** the images ship with the repository at the base commit, but each keeps `.git/ORIG_HEAD` naming a later upstream commit. The pin's `history_scrub` step (pinned by sha256, run after the prefetch) checks out the base commit detached, removes every remote, ref, tag and stash, `ORIG_HEAD`, `FETCH_HEAD` and the reflog, and runs `git gc --prune=now --aggressive`. The build fails unless HEAD is the base commit and nothing outside its history is reachable. `swe-rebench-history-audit.sh` checks an image: refs, reflog, objects outside the base commit's history, and whether one added line of the reference fix is anywhere in the object store.
- **Blocklist:** jobs run in `egress:SourceBlocklistDockerEnvironment` with `{ "task_source": "swe-rebench-07-2026" }`. It is the same sidecar with pin.json's list plus GitHub, Hugging Face, swe-rebench.com and the Harbor hub's storage host, each with its reason in the pin. Package registries stay reachable.

## Known gaps

- **Prices:** plan.ts prices every cell from runner/pricing; a model with no row there cannot be planned.
- **OpenClaw:** Harbor's class names Node 22, which OpenClaw 2026.10.6 refuses, so agents.py runs it on Node 24 (newest 24.x at install, recorded per trial).
- **mini-swe-agent:** Harbor installs the newest LiteLLM unpinned; agents.py pins `litellm[mcp]==1.108.2`, because that LiteLLM's Anthropic path imports `mcp` without declaring it.
- **Codex window: 872,000, not 1,050,000.** Codex 0.165.0 takes the smaller of `model_context_window` and the catalog's `max_context_window` (`codex-rs/models-manager/src/model_info.rs:19-27`), which is 872,000 for GPT-6.1 Sol and GPT-6 Astra (`codex-rs/models-manager/models.json`). Only a custom `model_catalog_json` lifts it, and a custom catalog also changes Codex's prompt, so we keep the shipped catalog and set 872,000 (pin.json `harnesses.codex.max_context_window`). Codex sends no output cap, so the proxy injects 128,000.
- **Harbor's dependencies:** pinned by version and hash in harbor-requirements.txt (uv 0.13.4, Python 3.12, wheels only). vm-run.sh checks the file's sha256 against pin.json before installing.
- **Particle host:** the egress blocklist does not list `api.particle.ai`. A container holds no Particle key, so a direct call has no credential, but it would not be refused by the sidecar. Adding the host changes the blocklist every cell runs under, so it is left for its own pin change.
- **OpenRouter host:** the same holds for `openrouter.ai`. No container holds an OpenRouter key.
- **QM:** no installed-agent class. QM's Pi loop runs in QM core with its own sandbox containers, not in the task container (install-check.json, `qm`).
