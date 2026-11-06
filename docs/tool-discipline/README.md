# Tool discipline: invented tools, bad arguments, wrong names, broken helper calls and skipped skill starts

internal-task-a, free mining over committed receipts. Plan: internal-task-b.

- **Held-out receipts are included.** The mined runs include the published results of the spent v0.1 and v0.2 held-out sets (405 of the 764 hand-checked items). This is descriptive mining, so it makes no held-out claim.
- **That is an exposure.** labels.jsonl and the examples below name held-out tasks and their failing calls, so both sets' MANIFEST.json ledgers record it (methodology item 14, R4).

## The answer first

- **Opus 5.5 almost never runs gstack's start step.** It read a gstack skill and then skipped the start helper in **28 of 29** chances: OpenClaw 20/21 (95% interval 77% to 99%), Hermes 8/8 (68% to 100%). Source: the two internal-task panels and the discovery run.
- **The one start it made was piped through `head -40`,** so the helper's own exit code was lost and the scorer could not tell whether the start worked.
- **On OpenClaw the skill sometimes never arrived.** In 4 trials of the first panel's candidate arm, OpenClaw answered the SKILL.md read with "Skill instructions cannot be partially served": the document was larger than one read could return. Those 4 reads are not counted as chances to start.
- **Invented tools are rare and come from one harness.** All 5 were `skills_read` on OpenClaw ("Tool skills_read not found"), in 5 of 205 Opus calls (1.1% to 5.6%). Hermes had none in 185.
- **OpenClaw's own prompt causes them.** Its system prompt tells the model to "use `skills_read` with its exact name", but the tool is deferred, so a direct call fails and the reply gives no hint to go through `tool_call` ([replies.md](replies.md)).
- **Harnesses answer bad calls very differently.** Hermes never sets is_error but lists every real tool. Claude Code and OpenClaw set is_error but name no real tool. QM-Pi marks world errors as success. Details per harness: [replies.md](replies.md).
- **Wrong names are the most common failed world call.** On the older Haiku and Sonnet receipts, about 0.1% to 1% of world calls name a channel, file or person that does not exist. The commonest causes are a person's handle used where a DM channel id is needed, and a guessed file path.
- **Bad arguments show up only for gbrain.** The world server rejects a malformed call before it writes its log, so the logs cannot see malformed world calls at all. Every malformed call they do see is a gbrain call, for example `gbrain.search` with a `match` argument it does not take.

**What this means for gstack:** the start step is skipped, not broken. Better description text has not changed that (internal-task-a). internal-task-b's route run (#147) found that a per-turn hook gets an instruction followed 97% to 100% of the time. That is the route to test next.

## Rates for frontier models (Opus 5.5)

Source: internal-task's three runs (132 Opus trials), committed under [receipts/gsta-135/](receipts/gsta-135/). Per-call kinds count model calls. Skipped starts count chances: a trial that got a gstack SKILL.md back.

| Harness | Kind | Count | Rate | Wilson 95% |
|---|---|---:|---:|---|
| OpenClaw | invented tool | 5 / 205 (+16 unknown) | 2.4% | 1.1% to 5.6% |
| OpenClaw | broken helper call | 1 / 205 | 0.49% | 0.09% to 2.7% |
| OpenClaw | skipped start | 20 / 21 | 95% | 77% to 99% |
| Hermes | invented tool | 0 / 185 | 0% | 0% to 2.0% |
| Hermes | broken helper call | 0 / 185 | 0% | 0% to 2.0% |
| Hermes | skipped start | 8 / 8 | 100% | 68% to 100% |

- "Unknown" means the call's result line was missing from the receipt: the discovery run's OpenClaw excerpts have none. The count is then a lower bound.
- These calls cluster in only 2 tasks, so a task-level bootstrap interval says almost nothing here. Read the Wilson interval.
- Hermes opens a skill with `skill_view {"name": "gstack-review"}`, not by reading a file path. That counts as getting the skill.

## Examples

Each example has a locator: the receipt file, then `#` and the call's sequence number.

**Invented tool**
- OpenClaw, Opus: `skills_read {"name": ...}` answered "Tool skills_read not found". [receipts/gsta-135/panel-run/evidence/gsta135-openclaw-t1-candidate-2.txt](receipts/gsta-135/panel-run/evidence/gsta135-openclaw-t1-candidate-2.txt) #9762a4b2:6.0.

**Broken helper call**
- OpenClaw, Opus: `"$GSTACK_ROOT/bin/gstack-skill-start" --skill "investigate" --model "claude" 2>&1 | head -40`. The exit code belongs to `head`. [receipts/gsta-135/panel-run-3610/evidence/gsta135-openclaw-t2-candidate-4.txt](receipts/gsta-135/panel-run-3610/evidence/gsta135-openclaw-t2-candidate-4.txt) #c084e0a4:13.0. The excerpt clips the command; the extractor's `exit_belongs: false` in that run's cells.jsonl settles it.

**Skipped start**
- OpenClaw, Opus: got the gstack SKILL.md back, then worked the task with no start call. [receipts/gsta-135/panel-run/evidence/gsta135-openclaw-t1-baseline-1.txt](receipts/gsta-135/panel-run/evidence/gsta135-openclaw-t1-baseline-1.txt).
- Hermes, Opus: `skill_view gstack-review` succeeded, then no start call. [receipts/gsta-135/panel-run-3610/evidence/gsta135-hermes-t1-candidate-1.txt](receipts/gsta-135/panel-run-3610/evidence/gsta135-hermes-t1-candidate-1.txt).

**Skill not served**
- OpenClaw, Opus: "Skill instructions cannot be partially served: the whole document exceeds this call's read ...". [receipts/gsta-135/panel-run/evidence/gsta135-openclaw-t1-candidate-1.txt](receipts/gsta-135/panel-run/evidence/gsta135-openclaw-t1-candidate-1.txt), line 5.

**Wrong name** (older Haiku and Sonnet receipts)
- Hermes, Sonnet: `files.read` on a folder or a guessed path, `file_not_found`. [../benchmarks/2026-10-23-m2-pilot/results/trials/hermes-sonnet-mu-dev/os-02-tansley-rate/r3/events.jsonl](../benchmarks/2026-10-23-m2-pilot/results/trials/hermes-sonnet-mu-dev/os-02-tansley-rate/r3/events.jsonl) #10.
- OpenClaw, Haiku: `chat.postMessage` to `dm:<handle>` instead of a DM id, `channel_not_found`. [../benchmarks/2026-10-24-gbrain-arm/results/trials/openclaw-haiku-gbrain-mu-heldout/os-03-hartford-mail-odile/r4/events.jsonl](../benchmarks/2026-10-24-gbrain-arm/results/trials/openclaw-haiku-gbrain-mu-heldout/os-03-hartford-mail-odile/r4/events.jsonl) #11.
- QM-Pi, Haiku: `chat.postMessage` to a person's handle. [../benchmarks/2026-10-24-m3-sensitivity-haiku/results/trials/qm-pi-haiku-mu-heldout/os-03-hartford-mail-odile/r2/events.jsonl](../benchmarks/2026-10-24-m3-sensitivity-haiku/results/trials/qm-pi-haiku-mu-heldout/os-03-hartford-mail-odile/r2/events.jsonl) #7.

**Bad arguments** (gbrain only)
- Hermes, Haiku: `gbrain.get_page` with `section`, `invalid_params`. [../benchmarks/2026-10-25-company-brain/results/trials/hermes-haiku-company-scoped-mu-heldout/sd-04-strategic-brief/r2/events.jsonl](../benchmarks/2026-10-25-company-brain/results/trials/hermes-haiku-company-scoped-mu-heldout/sd-04-strategic-brief/r2/events.jsonl) #24.
- Hermes, Haiku: `gbrain.remember` with `items` and `provenance`, `invalid_params`. [../benchmarks/2026-10-29-v03-pilot/results/trials/hermes-haiku-gbrain-told-scoped-mu-v03-dev/cn-01-tamsin-cold-chain-site/r5/events.jsonl](../benchmarks/2026-10-29-v03-pilot/results/trials/hermes-haiku-gbrain-told-scoped-mu-v03-dev/cn-01-tamsin-cold-chain-site/r5/events.jsonl) #6.

## What each source can see

| Source | Invented tool | Bad arguments | Wrong name | Denied | Broken helper | Skipped start |
|---|---|---|---|---|---|---|
| World and gbrain event logs (docs/benchmarks) | no | gbrain only | yes | yes | no | no |
| internal-task evidence excerpts | yes | yes | yes | yes | yes, unless clipped | yes |

- **The logs miss whole kinds.** A call to a tool the harness does not offer never reaches the world or gbrain log, and the world server rejects bad arguments with zod before its logging handler runs (world/world-mcp/tools.ts:50). So most receipts in this repository cannot measure tool discipline. A future prereg that wants these rates has to keep each harness's own session transcript.
- **The excerpts are clipped** at about 240 characters, so a long helper command can hide its tail.

## How sure are the labels

Two blind labellers, Opus 5.5 and GPT-6.1 Sol, labelled 764 sampled items against written rules without seeing the classifier's answers. The sample holds every classifier positive, a near-miss stratum (any failed call, any "not found" or "unknown" text, any `skills_*` name, any helper call) and a random stratum. Details: [agreement.md](agreement.md).

- **Agreement:** Cohen's kappa 1.0 for invented tools, bad arguments and denials; 0.994 for wrong names. The labellers split on 2 items.
- **Classifier against the labellers' shared answer:** no false positives and no misses on any kind, where both labellers gave a definite answer.
- **One fix came from the hand check.** The first classifier counted OpenClaw's refused reads as chances to start. It no longer does, and a test covers it.
- **Caveats:**
  - On the event logs, the labellers see the same error codes the classifier reads, so high agreement there checks the rules more than the data.
  - Recall for kinds the logs cannot see is not measured. Those rates are left out, not reported as zero.

## Older models (appendix)

These rates come from Haiku 5.5, Sonnet 5.5 and GPT-6 luna receipts. CREW.md keeps smaller models out of headline claims, so they are context only. Each line is count / calls, then the Wilson 95% interval.

| Harness | Model | Wrong name | Bad arguments (gbrain) | Denied |
|---|---|---|---|---|
| OpenClaw | Haiku 5.5 | 202 / 19,302 (0.91% to 1.20%) | 36 (0.13% to 0.26%) | 7 (0.02% to 0.08%) |
| OpenClaw | Sonnet 5.5 | 9 / 5,354 (0.09% to 0.32%) | 3 (0.02% to 0.16%) | 0 |
| Hermes | Haiku 5.5 | 207 / 31,014 (0.58% to 0.76%) | 20 (0.04% to 0.10%) | 22 (0.05% to 0.11%) |
| Hermes | Sonnet 5.5 | 35 / 6,387 (0.39% to 0.76%) | 0 | 0 |
| QM-Pi | Haiku 5.5 | 25 / 6,509 (0.26% to 0.57%) | 1 | 3 |
| QM-Pi | Sonnet 5.5 | 2 / 3,968 (0.01% to 0.18%) | 0 | 0 |
| Claude Code | Haiku 5.5 | 3 / 1,793 (0.06% to 0.49%) | 1 | 0 |
| Codex | GPT-6 luna | 0 / 1,019 (0% to 0.38%) | 0 | 0 |

- **Commonest wrong names:** `files.read` on a folder or extensionless path (133); `chat.postMessage` to a handle, `@handle` or `dm:handle` instead of a channel id (201 together, 115 of the bare-handle ones on Hermes); `conversations.open` with a display name (43).
- **Commonest bad gbrain arguments:** `gbrain.search` with `match` or `keyword` (29, all OpenClaw Haiku); `gbrain.remember` with `items`, `facts`, `content` or `provenance` (18 on Hermes Haiku, a few on OpenClaw).

<details><summary>Method</summary>

- **Code:** scripts/tool-discipline/normalize.ts reads receipts into one row per call. classify.ts labels each row and each trial. rates.ts computes rates with Wilson and task-bootstrap intervals (2,000 draws, seed 18). sample.ts draws the hand-check sample. reply-probe.ts records each harness's reply to a bad call ([replies.md](replies.md)). panel-score.ts computes the start-hook panel's verdict ([tool-discipline-start-2026-11](../benchmarks/2026-11-01-tool-discipline-start/PREREGISTRATION.md)). panel-score-r2.ts computes the Hermes rerun's verdict with panel-score.ts's rules unchanged ([tool-discipline-start-hermes-r2-2026-11](../benchmarks/2026-11-01-tool-discipline-start/PREREGISTRATION-hermes-r2.md)); for that run, clean-arm-preflight.sh checks each arm's image before trial 1, tirith-fence-check.sh checks that the image's pinned Tirith allows the candidate's start fence, and clean-arm-audit.ts counts gstack skill reads per arm after the last trial. Tests: tests/tool-discipline.test.ts, tests/tool-discipline-probe.test.ts, tests/tool-discipline-receipts.test.ts, tests/tool-discipline-panel-score.test.ts and tests/tool-discipline-r2.test.ts.
- **Inclusion:** assistant rows of every docs/benchmarks run whose directory holds no sealed material, plus internal-task's discovery and two panel runs. Trials that ended in model_error, infra_error, exam_fault, infra:* or not_run:* (46) are left out. The sealed v0.3 set and the custody branch were never read.
- **"Denied"** means a permission or scope refusal for something that exists. The world logs mark a missing identifier as outcome "denied" too (world/services/world.ts:184), and those count as wrong names, not denials.
- **Definitions** of each kind are in the head comment of classify.ts and in [LABEL-RULES.md](LABEL-RULES.md).

</details>

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
