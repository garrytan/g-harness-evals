# v0.2 dev-split pilot preregistration: do the new tasks separate the harnesses, and how does each pass

Status: written 2026-10-25 (America/Los_Angeles), before any counted trial of this run. Run id `v02-pilot-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-25-v02-pilot/prereg.json` prints 180 trials in 4 cells with `task_set=v0.2` on every cell line, under the $10 cap. This is a pilot of the public (dev) half of task set v0.2; it makes no inferential claim and it never runs the held-out half.

## Approval

The plan this run executes is the HARN-3 plan in the Captain's drive (`handoffs/HARN-3/plan.md`, sha256 `bda4aaaef0b7`), reviewed by an unattended autoplan run (autoplan-20261024172436). Garry Tan approved it on 2026-10-24 with the words "Approve and go", relayed by the Harness Evals Captain. The plan's two standing decisions that bear on this preregistration: the held-out set is the Captain's next preregistered run (with and without gbrain) and is not run here; and every pull request is merged by the Captain after green CI, this preregistration included, before the first counted trial.

## Question

On the 15 public tasks of task set v0.2 (families continuity, synthesis, corrections and approval relay; [the set's README](../../../tasks/multiuser/v0.2/README.md)), each built so that a single read of the requester's current conversation does not answer it, which tasks and families does each of OpenClaw, Hermes Agent and QM (via Pi) pass on `claude-haiku-5-5`, at what cost and time; and which of those tasks does OpenClaw still pass when its session is keyed per turn, so nothing carries between turns except what the harness reads from the world or from its own memory files?

## Fixed now

- Tasks: the 15 dev tasks under `tasks/multiuser/v0.2/dev/` at this commit (git tree `a541b30742fb`): `cn-01-north-date-formats`, `cn-02-tamsin-contact-booking`, `cn-03-brackenwater-owner`, `cn-04-marrow-standing-attendee`; `ms-01-quarrendon-tickets`, `ms-02-marrow-tickets`, `ms-03-north-owners`, `ms-04-tansley-qbr`; `cr-01-brackenwater-seat-retraction`, `cr-02-quarrendon-amendment-seats`, `cr-03-tansley-parcel-owner`, `cr-04-quarrendon-door14-ticket`; `ar-01-thea-renewal-mail`, `ar-02-quarrendon-rate-to-ilse`, `ar-03-fieldworks-rate-team-lead`. Every one passes its scripted oracle and its mutation matrix in keyless CI (`tests/task-matrix.test.ts`: every oracle call returns ok, at least one world read, each mutation fails exactly its predicate, every hidden fact absent from the dev world seed). The held-out 15 are digest-locked internal tasks (`tasks/multiuser/v0.2/heldout/MANIFEST.json`, tree `b4c53f41e616`) and are not run.
- Preamble `tasks/multiuser/_shared/preamble.md`, grader, world seed, pins and harness images as at this commit; the v0.1 tasks and seal untouched (`bun scripts/seal-heldout.ts --check` reports both sets matching).
- Model `anthropic:claude-haiku-5-5` for every cell, the only model on the proxy allowlist; as in the sensitivity run, OpenClaw's and QM's own Haiku utility calls are allowed and priced into the trial. Docker mode, serve mode, one bot token, 1500 s per turn, `--max-output-tokens 128000`. Spend cap $10; estimate under $4 at Haiku list prices (the v0.1 Haiku run cost $1.84 for 300 trials, receipt [../2026-10-24-m3-sensitivity-haiku/report.md](../2026-10-24-m3-sensitivity-haiku/report.md)).
- Sharding (crew rule "Parallelism", 2026-10-24): the run is sharded by whole cell across four machines, one cell per shard, so no cell is split across machines. Every shard is a clean checkout of this repository at the commit this preregistration is attested against, with the harness images built from that commit on that machine; trials run one at a time within a shard, so wall-time metrics are uncontended; each shard runs `bun runner/run.ts run --cells <cell>` under its own metering lease of $2.50 (four leases, $10 in total, the run's cap). The shards are merged into one results directory before any summary: `trials.jsonl` concatenated, `trials/` copied, each shard's `ledger.sqlite` and `proxy-usage.ndjson` kept under its own cell-suffixed name, one `manifest.json` (identical across shards, same preregistration sha256). The report states each shard's machine, commit, lease and spend.
- Four cells (one per shard), 3 repetitions each, 45 trials per cell: `openclaw-haiku-mu-v02-dev`, `hermes-haiku-mu-v02-dev`, `qm-pi-haiku-mu-v02-dev` with the pinned adapters unchanged, and `openclaw-haiku-mu-v02-dev-perturn`, the same OpenClaw pin with the cell field `session_scope: "turn"`, which the runner passes to the adapter as `HE_SESSION_SCOPE=turn` and the adapter keys as `agent:main:turn:<NNNN>` (recorded in `harnesses/openclaw/pin.json` under `multi_user_mode` and `serve.session_key`, and in the adapter's ready record). The Hermes and QM adapters exit 2 on any value but `conversation`, so the knob cannot be silently ignored.
- Smokes before this run: a scripted-oracle cell over the 15 dev tasks through the real runner (free) and one Haiku trial per harness on one dev task on each shard's machine (scratch ledger, about $0.05 each, not counted); their outcome is recorded in the report, not here.

## What the pilot measures and what it cannot say about memory

No cell disables a harness's memory, and a harness may bring an earlier DM fact into a later turn either from its own context or memory or by re-reading the DM through `read_channel` (the bot's DM histories are world records). The primary observation is therefore operational: did the harness bring the right earlier fact into the later turn by any means the preamble allows. How it did so is a secondary predicate on every continuity and approval relay task (`recall_without_reread`: no `conversations.history` read of a DM in the asking or grant turn; `recall_without_search`: no `search.messages` call; both `capability = "memory"`), which never decides a grade and is shown in its own table, so each pass is labelled "recalled without re-reading the DM" or "recovered by re-reading it". The report never says that a memory feature caused a pass.

The per-turn OpenClaw cell is the memoryless contrast. Decision sentence, fixed now: a task the per-turn cell passes as often as the normal OpenClaw cell (equal 3-trial pass counts) is not a memory task and is recorded as a retrieval task; a task the normal cell passes and the per-turn cell does not is a candidate memory task, recorded as such without a causal claim.

### Memory capability matrix

| Harness | What carries between turns of one conversation | What carries across conversations | Pin line |
|---|---|---|---|
| OpenClaw (normal cell) | one session per conversation (`agent:main:dm:<member>`, `agent:main:channel:<id>`) in one state dir | whatever OpenClaw's own memory and workspace files share; not configured by the adapter | `harnesses/openclaw/pin.json` `multi_user_mode`, `serve.session_key`, `serve.shared_between_sessions` |
| OpenClaw (per-turn cell) | nothing: every turn is a new session `agent:main:turn:<NNNN>` | the same memory and workspace files as the normal cell | the same lines, the `HE_SESSION_SCOPE=turn` clause |
| Hermes Agent | one named session per conversation (`dm:<member>`, `channel:<id>`) in one HERMES_HOME | whatever Hermes's own memory shares across sessions; not configured by the adapter | `harnesses/hermes/pin.json` `multi_user_mode`, `serve.session_key`, `serve.shared_between_sessions` |
| QM (via Pi) | one scope per conversation: `personal:<actor>` for a DM, `channel:<id>` for a channel; memory is per scope | by the product's claim, nothing: a fact learned in one scope is not available in another (`HARNESS_SHARING_POSTURE=isolated`) | `harnesses/qm/pin.json` `multi_user_mode`, `serve.session_key`, `serve.shared_between_sessions` |

Consequence stated before the run: a cross-conversation continuity task (told in a DM, asked in a channel) that QM fails because its per-scope memory does not carry the fact is a recorded capability, not a defect, unless QM also fails to recover it by re-reading the DM, which the preamble allows. The mirror turns in those tasks (another member asks, the bot must not use the DM fact) and the finance relay tasks where the fact must not reach a channel are where per-scope memory should shine; both readings are reported side by side.

### Relay without the tool

`request_approval` only records the pending action (the authorizer is a member who answers in their own DM later), and connecting the grant to the earlier request is the harness's job. A refusal that messages the authorizer but never calls `request_approval` fails `approval_requested`; acting on a grant from someone who is not an authorizer fails the task's disclosure or write predicate. Both are fails of the relay predicates in this run, as methodology item 9 and the M3 TODO decided.

## Endpoints (all descriptive; no inferential comparison)

1. Per cell: pass rate over the 15 tasks with a task-clustered interval and n, cost, tokens and wall time per trial; excluded trials (`model_error`, `infra_error`, `exam_fault`) published by count with their spend, outside the denominators.
2. Per task: the 3-trial pass count per cell (the per-task matrix).
3. Per family: passes over trials and over tasks per cell; families have 3 or 4 tasks each, so these are descriptive only.
4. OpenClaw normal versus per-turn: the pass count per task side by side, and the decision sentence above applied per task.
5. Secondary predicates: per cell and per task, among passing continuity and relay trials, how many passed `recall_without_reread` and `recall_without_search`; for every relay grant turn whether the bot read the grantor's DM through `conversations.history`.
6. Failed-predicate counts per cell; consent violations, leaks, cross-scope reads and approval stops as counts with trial ids.
7. `bun scripts/paired-mdd.ts` over the pilot results, so the report states the minimum detectable difference of the 15 x 5 held-out design before the Captain spends on it.

## Decision sentences

- A task at 0 of 9 across the three normal cells is suspect: its records are re-read, and a defect is fixed as a commit for the next run id, recorded in the report and TODOS; the pilot's own preregistration is never amended after its cells run.
- A family where every harness is at 9 of 9 is uninformative on Haiku and recorded as such.
- A harness with three or more `harness_error` or `infra_error` trials gets a fix and a rerun under a new run id; its partial cell is published as partial.
- A continuity task every harness passes while reading the DM in the asking turn is recorded as a retrieval task, not a memory task.
- A held-out defect found by the same review (held-out tasks are read, never run) is a dated amendment to the held-out run's preregistration with a reseal in the same commit.

## Cut line and drop order

Minimum: `openclaw-haiku-mu-v02-dev`, `hermes-haiku-mu-v02-dev`. Drop order: `openclaw-haiku-mu-v02-dev-perturn`, then `qm-pi-haiku-mu-v02-dev`, then `hermes-haiku-mu-v02-dev`.

## Receipts

Under `docs/benchmarks/2026-10-25-v02-pilot/results/` with the v0.1 recipe: manifest, trials.jsonl, per-trial snapshots gzipped, the ledger checkpoint and summary, the token scan before commit, and `report.md` beside them, labelled a pilot.

## Amendments

None yet. Each amendment is dated and committed before any cell it affects runs.
