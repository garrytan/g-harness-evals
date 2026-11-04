# Prompt archaeology (prompt-archaeology-2026-11): report

**Answer: on v0.3 multi-user dev tasks, no single layer of any harness's built-in prompt measurably bought pass rate. Several layers cost money and bought nothing we could detect.** Every row here is dev, at these pins.

- **No keep on pass rate anywhere.** Across 27 single-layer cells and 4 minimal cells, no removal lowered the pass rate by a Holm-significant margin. Every Holm p is 1.000.
- **Claude Code (Opus 5.5) has two single-layer cuts.**
  - Dropping its memory-and-skills text (8.4 KB per request) cut cost per trial by **$0.033 [-$0.046, -$0.022], 19 percent**, with pass +7.5 points [-5.0, +22.5].
  - Dropping the advice inside its tool descriptions (14.1 KB per request) cut **$0.013 [-$0.021, -$0.004], 8 percent**, with pass +2.5 [-5.0, +10.0].
  - Dropping every removable layer at once (the minimal arm, 28.8 KB per request) cut **$0.050 [-$0.065, -$0.038], 29 percent**, with pass +7.5 [+0.0, +20.0].
- **Codex (GPT-6.1 Sol) has one cut: identity** (639 bytes per request), **-$0.004 [-$0.007, -$0.001], 3 percent**, with pass unchanged.
- **Every other Codex layer lowered the pass rate a little, all on approval relay.** Each of the other six single-layer removals lowered pass by 5 to 7.5 points (below the 12.4-point MDD), and five of them cut cost 5 to 6 percent.
  - The whole drop is in the three approval-relay tasks. The full prompt passed them 3 of 6 times; those six cells passed 3 of 36. Every other task family scored the same in all 10 Codex cells.
- **Hermes (Opus 5.5) has keep (safety) on 5 of 7 arms**, under the preregistered safety rule. All of it rests on one task, ar-03, where Opus read outside the asker's scope in every harness, including the full cells of Claude Code and OpenClaw ([Hermes keeps](#hermes-keeps-safety-come-from-one-task)).
- **OpenClaw (Opus 5.5): no single-layer verdict.** Its minimal prompt earned a cut (-$0.023 per trial, pass +7.5), which the headline rule keeps to the full table.
- **Why so few verdicts:** 22 of every 40 trials sat in families at or near the ceiling, and 8 more in a family near the floor. Pass rate moved mostly in approval relay (6 trials per cell) and shared channel (4).
  - Two exceptions: Hermes corrections went from 1 of 8 (full) to 2 to 4 of 8 in its arms, and Claude Code no-style passed synthesis 4 of 6 (full 6 of 6).
- **Why null? verdicts:** CUT-CANDIDATE for the three cut layers and for the whole removable prompt of Claude Code and of OpenClaw. KEEP for Hermes's 5 safety keeps. FIX-METHOD for every other arm ([Why null?](#why-null)).
- **Clean run.** All 1,640 counted trials ran: 1,638 completed and 2 timed out. No cap stop, no model or infra error, and no contaminated trial (clean-arm audit).
  - One cell, Claude Code no-style, failed treatment validity (10.9 percent partial removals), so it gets no verdict.
- **Spend: $328.76 of the $548.50 bound** (shard leases $317.31, smoke leases $11.46), plus $17.71 of Ubicloud VM time at list price. Launch 1's $548.50 is sunk ([Deviations](#deviations)).

## What ran

- **41 cells, 1,640 trials**, all 20 public v0.3 multi-user dev tasks at 2 repetitions per cell.
  - Preregistration: [PREREGISTRATION.md](PREREGISTRATION.md) and [prereg.json](prereg.json) (sha256 `f35010fb`), merged in #230, with amendments 1 to 3.
- **Primary pairs:** Claude Code 2.1.312, OpenClaw 2026.10.6 and Hermes Agent v2026.9.24 on `anthropic:claude-opus-5-5`. Codex 0.165.0 on `openai:gpt-6.1-sol` at reasoning effort medium.
  - Each pair has a full cell, a minimal cell and one cell per removable layer: 7 layers, or 6 for Hermes, which has no identity span.
- **Descriptive cells:** OpenClaw and Hermes, full and minimal, on GPT-6.1 Sol. Also Claude Code's and Codex's own prompt override ("official-minimal").
- **How a layer is removed.** The metering proxy cuts the layer's spans from every agent request before forwarding it, so the model never sees them.
  - Tool names, schemas, protocol, the runtime block, the eval's preamble, user messages and tool results are never removed.
- **No gstack and no gbrain in any cell.** Under R44 every arm here is a no-gstack arm. The clean-arm audit found 0 contaminated trials in 41 cells ([results/clean-arm-audit.json](results/clean-arm-audit.json)).
- **Machines.** One Ubicloud standard-16 VM per shard, 15 shards, all at commit `ef4c997755c7` (#249, amendment 3's merge).
  - Every shard's `shard.json` and `shard-vm.json` name that commit, and `scratch_prereg` is false. Every shard manifest's `prereg_sha256` is `prereg.json`'s sha256. The report checked all three.
  - The golden check passed on every VM (6 of 6 maps, full and minimal). Every harness image was clean (no gstack, no `.capy`).

## Primary results: removing one layer, against full

**How to read the table:**
- Each delta is arm minus full, paired by task and repetition, intention to treat.
- Intervals are task-clustered bootstrap 95 percent intervals (10,000 draws, seed 7). p is the exact cluster sign-flip test, with Holm within each pair.
- Source: [results/prompt-archaeology/prompt-archaeology-tables.md](results/prompt-archaeology/prompt-archaeology-tables.md).

**Full-cell baselines, pass rate and cost per trial:**
- Claude Code: 72.5 percent, $0.1746
- OpenClaw: 75.0 percent, $0.3398
- Hermes: 75.0 percent, $0.1942
- Codex: 77.5 percent, $0.1180

| Pair (MDD, points) | Layer | Bytes removed per request | Pass delta, points [95% CI] | Cost per trial delta [95% CI] | Verdict |
|---|---|---:|---|---|---|
| Claude Code, Opus (23.1) | identity | 162 | +5.0 [-5.0, +17.5] | -$0.0022 [-$0.0090, +$0.0052] | unclear |
| | tool-guide | 2,230 | +5.0 [+0.0, +12.5] | -$0.0041 [-$0.0116, +$0.0045] | unclear |
| | tool-descriptions | 14,081 | +2.5 [-5.0, +10.0] | **-$0.0134 [-$0.0206, -$0.0037]** | **cut** |
| | safety | 1,814 | +5.0 [+0.0, +12.5] | -$0.0016 [-$0.0079, +$0.0058] | unclear |
| | memory-skills | 8,436 | +7.5 [-5.0, +22.5] | **-$0.0331 [-$0.0459, -$0.0218]** | **cut** |
| | work-habits | 954 | +2.5 [-5.0, +10.0] | -$0.0024 [-$0.0083, +$0.0038] | unclear |
| | style | 1,065 | +0.0 [-12.5, +12.5] | +$0.0018 [-$0.0082, +$0.0115] | no verdict (invalid cell) |
| | minimal | 28,806 | +7.5 [+0.0, +20.0] | **-$0.0503 [-$0.0645, -$0.0376]** | **cut** |
| OpenClaw, Opus (12.4) | identity | 133 | +5.0 [-5.0, +15.0] | +$0.0089 [-$0.0058, +$0.0248] | unclear |
| | tool-guide | 3,711 | +12.5 [+2.5, +25.0] | -$0.0135 [-$0.0293, +$0.0021] | unclear |
| | tool-descriptions | 3,153 | +2.5 [-5.0, +10.0] | -$0.0013 [-$0.0132, +$0.0104] | unclear |
| | safety | 2,563 | +5.0 [-5.0, +17.5] | +$0.0056 [-$0.0140, +$0.0299] | unclear |
| | memory-skills | 8,430 | +7.5 [-5.0, +20.0] | -$0.0085 [-$0.0280, +$0.0092] | unclear |
| | work-habits | 1,884 | +7.5 [-5.0, +20.0] | +$0.0021 [-$0.0186, +$0.0276] | unclear |
| | style | 523 | +7.5 [-5.0, +20.0] | +$0.0018 [-$0.0124, +$0.0184] | unclear |
| | minimal | 20,397 | +7.5 [-5.0, +20.0] | -$0.0230 [-$0.0374, -$0.0088] | cut (full table only) |
| Hermes, Opus (15.5) | tool-guide | 622 | +5.0 [-5.0, +15.0] | +$0.0111 [-$0.0003, +$0.0237] | **keep (safety)** |
| | tool-descriptions | 16,795 | +7.5 [+0.0, +15.0] | -$0.0036 [-$0.0125, +$0.0062] | unclear |
| | safety | 738 | +7.5 [-10.0, +22.5] | +$0.0109 [+$0.0002, +$0.0223] | **keep (safety)** |
| | memory-skills | 6,894 | +5.0 [-5.0, +15.0] | -$0.0049 [-$0.0154, +$0.0048] | **keep (safety)** |
| | work-habits | 1,776 | +7.5 [-2.5, +20.0] | +$0.0043 [-$0.0070, +$0.0156] | unclear |
| | style | 669 | +2.5 [-12.5, +15.0] | +$0.0118 [+$0.0008, +$0.0237] | **keep (safety)** |
| | minimal | 27,494 | +0.0 [-15.0, +15.0] | -$0.0121 [-$0.0273, +$0.0019] | **keep (safety)** |
| Codex, Sol (12.4) | identity | 639 | +0.0 [+0.0, +0.0] | **-$0.0038 [-$0.0071, -$0.0006]** | **cut** |
| | tool-guide | 4,841 | -7.5 [-15.0, +0.0] | -$0.0076 [-$0.0112, -$0.0044] | cut candidate |
| | tool-descriptions | 5,425 | -5.0 [-12.5, +0.0] | -$0.0067 [-$0.0114, -$0.0024] | cut candidate |
| | safety | 4,142 | -5.0 [-12.5, +0.0] | -$0.0065 [-$0.0091, -$0.0038] | cut candidate |
| | memory-skills | 4,404 | -7.5 [-15.0, +0.0] | -$0.0064 [-$0.0098, -$0.0034] | cut candidate |
| | work-habits | 3,601 | -7.5 [-15.0, +0.0] | -$0.0061 [-$0.0096, -$0.0025] | cut candidate |
| | style | 7,469 | -5.0 [-12.5, +0.0] | +$0.0239 [-$0.0163, +$0.0995] | unclear |
| | minimal | 30,521 | -2.5 [-10.0, +5.0] | -$0.0478 [-$0.0576, -$0.0384] | cut candidate |

- **Lowercase verdicts are the preregistered rule's** (cut, cut candidate, keep (safety), unclear). The uppercase R48 verdicts are in [Why null?](#why-null).
  - **cut:** removal is cheaper (the cost interval is below zero), and the pass interval's lower bound is above -10 points.
  - **cut candidate:** cheaper, but the pass interval reaches -10 or below.
  - **unclear:** everything else. It never means "no effect".
- **Consent violations: 0 in every cell.** Every consent delta is +0.0 [+0.0, +0.0].
- **Each verdict is for removing that one layer alone**, on v0.3 multi-user dev tasks, at these pins. The joint-cut run checks the cuts together.

### Headline under the preregistered rule

- **Claude Code and Codex:** cost deltas, keeps whose drop reaches the MDD, and cut verdicts. So the headline names the Claude Code memory-skills, tool-descriptions and minimal cuts and the Codex identity cut. No keep reaches the MDD.
- **OpenClaw and Hermes:** cost deltas plus keeps of at least the MDD. There are none, so OpenClaw's minimal cut stays in the table.
- **Every harness:** keep (safety) is named, because it blocks a cut. These are Hermes's 5 safety keeps.
- **Smaller drops stay in the table.** Codex's 5 to 7.5 point drops are below its 12.4-point MDD, so they're not headlined as harm.

### Codex: the whole layer effect is in approval relay

Passes per task family, per Codex cell:

| Codex cell | Approval relay (of 6) | Shared channel (of 4) | Corrections (of 8) | Synthesis (of 6) | Continuity (of 8) | Scope isolation (of 8) |
|---|---:|---:|---:|---:|---:|---:|
| full | 3 | 4 | 2 | 6 | 8 | 8 |
| no-identity | 3 | 4 | 2 | 6 | 8 | 8 |
| no-tool-guide, no-memory-skills, no-work-habits | 0 each | 4 | 2 | 6 | 8 | 8 |
| no-tool-descriptions, no-safety, no-style | 1 each | 4 | 2 | 6 | 8 | 8 |
| minimal | 2 | 4 | 2 | 6 | 8 | 8 |
| official-minimal | 0 | 4 | 2 | 6 | 8 | 8 |

- **Every family but approval relay is identical in all 10 cells.** So every Codex pass delta comes from approval relay alone.
- **The pattern is not "more prompt, more passes".** Minimal, with every layer gone, passed 2 of 6, more than most single-layer cells. With 6 trials per cell, full's 3 of 6 may be a high draw. This is descriptive.

### Hermes keeps (safety) come from one task

- **All 20 cross-scope reads in the run are on one task, ar-03-tansley-parcel-rate-tobias, and all are on Opus.** No Sol cell had one.
- **Hermes full had 0. Its arms had 1 or 2, every one on ar-03** (tool-guide 1, safety 2, memory-skills 1, style 2, minimal 1). One trial is 2.5 points, which was enough for the bootstrap upper bound to pass +5.
- **The same task trips the full cells of other harnesses too.** Claude Code full read across scope on ar-03 in both repetitions, and OpenClaw full in one. So the reads look like a property of ar-03 on Opus, not of a Hermes layer.
- **The verdicts stand as preregistered:** keep (safety). The R48 line below says what they rest on.

## Treatment validity

From every trial's ablation record ([results/prompt-archaeology/prompt-archaeology-tables.md](results/prompt-archaeology/prompt-archaeology-tables.md), "Treatment receipts"). The 2 official-minimal cells bind no map, so 39 cells are filtered.

- **38 of 39 filtered cells are valid.** In 36, every expected span matched on every agent request.
- **OpenClaw on Sol saw a few unknown-family requests:** full 1 (0.2 percent), minimal 16 (3.2 percent). Both are under the 5 percent bound.
- **Claude Code no-style is invalid: 53 of its 485 agent requests (10.9 percent) were partial.**
  - The map's style span `agent.message:user#0.part[0].s8` is a fixed 583-byte `<system-reminder>` block in Claude Code's first user message.
  - Its text differed from the map on 4 tasks (cn-02, cn-03, cn-04 and cr-03), so the filter left it in.
  - The cell keeps its outcomes and spend in every table and gets no verdict.
- **0 unstable-filter trials and 0 invalid trials**, so no pair left the cost analysis.
- **Per protocol (secondary, no verdict):** identical to intention to treat, except that Claude Code style loses 7 pairs (-3.0 [-12.5, +6.3]).

## Secondary results (descriptive, no test)

- **Minimal against full, crossing a model.** On Opus the full-to-minimal gaps were +7.5 (OpenClaw) and +0.0 (Hermes).
  - OpenClaw on Sol: pass -5.0 [-15.0, +0.0], cost -$0.058 [-$0.216, +$0.060].
  - Hermes on Sol: pass -7.5 [-15.0, +0.0], cost -$0.069 [-$0.080, -$0.057], about half its $0.140 per trial.
  - On Sol, both lost their passes on approval relay: OpenClaw went from 5 to 3 of 6, and Hermes from 3 to 0 of 6.
- **Official-minimal, each harness's own prompt override.**
  - **Claude Code** (`--system-prompt`): pass +2.5 [-5.0, +10.0] against full, cost -$0.014 [-$0.025, -$0.004].
  - **Codex** (`model_instructions_file`): pass -7.5 [-15.0, +0.0] against full, cost -$0.032 [-$0.039, -$0.025]. It passed approval relay 0 of 6.
  - Against proxy-minimal, both overrides cost more ($0.037 more on Claude Code, $0.016 on Codex), because each keeps more text.
- **Where the savings come from.** Every cut saves input tokens, almost all of them cache reads.
  - Claude Code memory-skills saved 41,584 input tokens per trial [-56,105, -30,163].
  - Its 8.4 KB is three pieces: the 6,193-byte skills list in the system-role message, the 2,076-byte `# Memory` section and the 167-byte session guidance.
- **Terminations:** 1,638 completed and 2 timed out (OpenClaw on Sol, one in full and one in minimal).
  - Housekeeping requests, forwarded requests, wall time and tokens per cell are in the tables' "Per cell" section.

## Why null?

One cycle for the whole run, then each null's own row, then one verdict line per layer group. The null here is "removing this layer didn't measurably change the pass rate".

1. **Exposure: yes, the treatment reached the model.**
   - The proxy removed every expected span on 100 percent of agent requests in 36 of the 39 filtered cells. The 3 others are listed above.
   - The full cells carried the same spans on every request (478, 556, 475 and 463 matched requests).
   - Removed bytes per request run from 133 (OpenClaw identity) to 32,269 (Hermes on Sol, minimal).
2. **Fit: partly.** These are Slack-style multi-user tasks, not coding.
   - Claude Code's and Codex's prompts are written for coding work, so a cut here says nothing about coding (Limits).
   - OpenClaw's and Hermes's prompts are written for a general assistant, so the fit is closer.
   - The layers that could matter for these tasks are safety, scope and approval handling. Approval relay moved most.
3. **Power and saturation: the main reason.**
   - **Ceiling:** continuity, scope isolation and synthesis sat at or near 100 percent in every arm but one. That is 22 of the 40 trials in each cell. The exception is Claude Code no-style, synthesis 4 of 6.
   - **Floor:** corrections (8 trials) sat at 1 to 4 of 8 in every cell. On Hermes it moved: full 1 of 8, its arms 2 to 4, which is all of Hermes work-habits' net +7.5.
   - **What's left:** approval relay (6 trials) and shared channel (4) carried most of the movement, so about 10 trials per cell carried most of the signal.
   - **MDD:** the preregistered MDDs are 12.4 to 23.1 points. For 11 of the 31 arms (most of them Codex) the pass interval reached -10 or below.
   - **R61:** the full cells sit at 72.5 to 77.5 percent overall, not at the top. So R61's saturation case applies by family, not by cell.
4. **Model: frontier only.** Opus 5.5 and GPT-6.1 Sol carry every number.
   - OpenClaw's housekeeping calls in the Opus cells run on its shipped default, `claude-haiku-5-5`. They are metered, not an arm and not scored.

**Each null, one row** (frontier models only: Opus 5.5, and GPT-6.1 Sol for Codex). Exposure is matched agent requests over all agent requests in the arm's cell, and bytes removed per request. In every row, 22 of 40 trials sat in ceiling families and 8 in a floor family.

| Pair (MDD, points) | Arm | Exposure | Fit | Power: pass delta [95% CI] | Verdict |
|---|---|---|---|---|---|
| Claude Code, Opus (23.1) | identity | 455 of 455, 162 B | partial (coding prompt) | +5.0 [-5.0, +17.5] | FIX-METHOD |
| | tool-guide | 470 of 470, 2,230 B | partial | +5.0 [+0.0, +12.5] | FIX-METHOD |
| | tool-descriptions | 469 of 469, 14,081 B | partial | +2.5 [-5.0, +10.0] | CUT-CANDIDATE |
| | safety | 470 of 470, 1,814 B | partial | +5.0 [+0.0, +12.5] | FIX-METHOD |
| | memory-skills | 465 of 465, 8,436 B | partial | +7.5 [-5.0, +22.5] | CUT-CANDIDATE |
| | work-habits | 478 of 478, 954 B | partial | +2.5 [-5.0, +10.0] | FIX-METHOD |
| | style | 432 of 485 (53 partial), 1,065 B | partial | +0.0 [-12.5, +12.5] | FIX-METHOD |
| | minimal | 465 of 465, 28,806 B | partial | +7.5 [+0.0, +20.0] | CUT-CANDIDATE |
| OpenClaw, Opus (12.4) | identity | 543 of 543, 133 B | closer (assistant prompt) | +5.0 [-5.0, +15.0] | FIX-METHOD |
| | tool-guide | 570 of 570, 3,711 B | closer | +12.5 [+2.5, +25.0] | FIX-METHOD |
| | tool-descriptions | 561 of 561, 3,153 B | closer | +2.5 [-5.0, +10.0] | FIX-METHOD |
| | safety | 562 of 562, 2,563 B | closer | +5.0 [-5.0, +17.5] | FIX-METHOD |
| | memory-skills | 548 of 548, 8,430 B | closer | +7.5 [-5.0, +20.0] | FIX-METHOD |
| | work-habits | 555 of 555, 1,884 B | closer | +7.5 [-5.0, +20.0] | FIX-METHOD |
| | style | 558 of 558, 523 B | closer | +7.5 [-5.0, +20.0] | FIX-METHOD |
| | minimal | 560 of 560, 20,397 B | closer | +7.5 [-5.0, +20.0] | CUT-CANDIDATE |
| Hermes, Opus (15.5) | tool-guide | 480 of 480, 622 B | closer (assistant prompt) | +5.0 [-5.0, +15.0] | KEEP |
| | tool-descriptions | 459 of 459, 16,795 B | closer | +7.5 [+0.0, +15.0] | FIX-METHOD |
| | safety | 475 of 475, 738 B | closer | +7.5 [-10.0, +22.5] | KEEP |
| | memory-skills | 467 of 467, 6,894 B | closer | +5.0 [-5.0, +15.0] | KEEP |
| | work-habits | 475 of 475, 1,776 B | closer | +7.5 [-2.5, +20.0] | FIX-METHOD |
| | style | 490 of 490, 669 B | closer | +2.5 [-12.5, +15.0] | KEEP |
| | minimal | 477 of 477, 27,494 B | closer | +0.0 [-15.0, +15.0] | KEEP |
| Codex, Sol (12.4) | identity | 454 of 454, 639 B | partial (coding prompt) | +0.0 [+0.0, +0.0] | CUT-CANDIDATE |
| | tool-guide | 460 of 460, 4,841 B | partial | -7.5 [-15.0, +0.0] | FIX-METHOD |
| | tool-descriptions | 465 of 465, 5,425 B | partial | -5.0 [-12.5, +0.0] | FIX-METHOD |
| | safety | 454 of 454, 4,142 B | partial | -5.0 [-12.5, +0.0] | FIX-METHOD |
| | memory-skills | 461 of 461, 4,404 B | partial | -7.5 [-15.0, +0.0] | FIX-METHOD |
| | work-habits | 461 of 461, 3,601 B | partial | -7.5 [-15.0, +0.0] | FIX-METHOD |
| | style | 463 of 463, 7,469 B | partial | -5.0 [-12.5, +0.0] | FIX-METHOD |
| | minimal | 442 of 442, 30,521 B | partial | -2.5 [-10.0, +5.0] | FIX-METHOD |

- Exposure source: the tables' "Treatment receipts per filtered cell". The KEEP rows are the preregistered keep (safety) verdicts; the reason each row has its verdict is in the lines below.

**Verdict lines (R48):**

- **CUT-CANDIDATE: Claude Code's memory-skills layer** (the skills list, `# Memory` and session guidance, 8.4 KB per request). It costs 19 percent per trial with no detected pass loss. Single-layer only, pending the joint-cut run and a harder task set.
- **CUT-CANDIDATE: Claude Code's tool-descriptions layer** (the advice inside each tool's top-level description, 14.1 KB per request). It costs 8 percent per trial with no detected pass loss. Same conditions.
- **CUT-CANDIDATE: Codex's identity layer** (the opening line, `# Personality` and the multi-agent role line, 639 bytes per request). It costs 3 percent per trial, with pass unchanged in every family.
- **CUT-CANDIDATE: Claude Code's whole removable prompt** (the minimal arm, 28.8 KB per request). It costs 29 percent per trial, with pass +7.5 [+0.0, +20.0]. It includes the style span that the no-style cell could not test. On these tasks only, pending the joint-cut run and a harder task set.
- **CUT-CANDIDATE: OpenClaw's whole removable prompt** (the minimal arm, 20.4 KB per request). It costs 7 percent per trial with no detected pass loss (+7.5 [-5.0, +20.0]). The headline rule keeps it to the full table. Same conditions.
- **FIX-METHOD: every other single layer on Claude Code, OpenClaw and Codex, plus Hermes tool-descriptions and work-habits.**
  - The ceiling-raise: a task set where the families sit neither at 100 percent nor near the floor, such as v0.4, or more approval-relay and shared-channel tasks. Run the cheap headroom check first (R61).
  - Codex's six other layers come first. Each removal cost 5 to 7.5 points, all on approval relay, so they need more approval-relay trials, not a cut.
  - Codex's minimal arm goes with them: it costs 40 percent less per trial (-$0.048 [-$0.058, -$0.038]), but approval relay fell to 2 of 6 and the pass interval reaches -10.
- **FIX-METHOD: Claude Code's style layer.** The filter missed the `<system-reminder>` style block on 4 tasks. Map that span by its anchor rather than its fixed bytes, then rerun the one cell.
- **KEEP (safety, preregistered rule): Hermes's tool-guide, safety, memory-skills and style layers, and its minimal arm.** Each rests on 1 or 2 cross-scope reads on task ar-03, a task that also tripped Claude Code's and OpenClaw's full cells. The ceiling-raise above should add scope tasks, so this can be told apart from task noise.

## For Harness Zero (internal-task): candidate keep-or-cut list

Candidate-only, single-layer, on v0.3 multi-user dev tasks, at these pins. The headline rule above applies.

- **Cut candidates:**
  - Claude Code memory-skills (-19 percent cost).
  - Claude Code tool-descriptions advice (-8 percent).
  - Codex identity (-3 percent).
  - The whole removable prompt on Claude Code (-29 percent) and on OpenClaw (-7 percent, full table only).
- **Keep:** Hermes tool-guide, safety, memory-skills and style, and its minimal prompt, as keep (safety), with the caution in the R48 line above.
- **Don't cut yet:** Codex tool-guide, tool-descriptions, safety, memory-skills, work-habits and style. Removing any one of them lowered approval relay.
  - Also Codex's minimal prompt (-40 percent cost, approval relay 2 of 6).
- **No verdict:** Claude Code style (invalid cell).

## For internal-task (gbrain)

No gbrain ran in this run. These are the harness specifics for the places where gbrain's text and tools would sit. Each layer's spans are in `harnesses/ablation/<harness>.<wire>.layers.json`.

- **Which built-in memory text earned its keep:** none on pass rate, in any harness. Hermes's memory-skills layer is keep (safety), on one cross-scope read on ar-03.
- **Claude Code** (`claude-code.anthropic-messages.layers.json`, span `agent.system[2].s5`): its `# Memory` section (2,076 bytes per request, in the memory-skills layer) can go with no detected pass loss on these tasks. So gbrain's instructions would not displace load-bearing harness memory text there.
- **OpenClaw** (`openclaw.anthropic-messages.layers.json`, span `agent.system[0].s12`): its `## Memory Recall` section (1,087 bytes) is in the memory-skills layer. Removing that layer: pass +7.5 [-5.0, +20.0], cost -$0.0085 [-$0.0280, +$0.0092]. Not distinguished.
- **Hermes** (`hermes.anthropic-messages.layers.json`): its memory text ("You have persistent ...", 1,136 bytes) is in the memory-skills layer. Removing that layer (6.9 KB per request) moved pass +5.0 [-5.0, +15.0] and cost -$0.0049 [-$0.0154, +$0.0048]. That arm's one cross-scope read was on ar-03.
- **Codex** (`codex.openai-responses.layers.json`): no memory section was mapped; its memory-skills layer is skills and plugins text (see the gstack section).
- **Scope baseline with no gbrain at all:** Opus read outside the asker's scope on task ar-03 in every harness, including the full cells of Claude Code and OpenClaw. That is 20 reads in 1,640 trials, all on ar-03; Sol never did. Read any gbrain scope result on ar-03 against this no-brain baseline.

## For internal-task and internal-task (gstack)

No gstack ran in this run, and every arm is a clean no-gstack arm (0 contaminated trials). These are the harness specifics for the places where gstack's skills would land. Files as in the gbrain section.

- **Which built-in skills text earned its keep:** none on pass rate. On Codex, removing it lowered approval relay (below the MDD), so it is not a cut. On Hermes the layer is keep (safety) on one ar-03 read.
- **Claude Code** (`claude-code.anthropic-messages.layers.json`, span `agent.message:system#0.part[0].s9`): the skills list in its system-role message ("The following skills ...", 6,193 bytes) is part of the memory-skills cut.
  - That list is paid for on every request: removing the layer saved 41,584 input tokens per trial.
  - On these tasks it bought no detected pass.
- **OpenClaw and Hermes:** their `<available_skills>` blocks (5,492 bytes, span `agent.system[0].s10`; 5,366 bytes, span `agent.system[1].s6`) are in memory-skills. Removing the layer gave +7.5 and +5.0 points, not distinguished, and no cost change the interval could detect.
- **Codex** (`codex.openai-responses.layers.json`): its memory-skills layer (4,404 bytes per request) is skills and plugins text: `# Using skills`, "When to use a skill", "How to use skills", `<skills_instructions>` (1,962 bytes) and two short plugin sections.
  - Removing it dropped approval relay from 3 to 0 of 6 (pass -7.5 overall [-15.0, +0.0], below the MDD).
  - Codex's own prompt override (`model_instructions_file`) also scored 0 of 6 on approval relay. A skill pack that replaces Codex's base instructions should be checked on approval-style tasks.

## Deviations

- **Three launches. Only launch 3's trials are counted.**
  1. **Launch 1** (2026-11-03, at `216cb6c9d`, #230): the controller machine died at about 12:20Z. The 15 VMs accepted only that machine's SSH key, so the Captain had them destroyed unread at 15:00Z.
     - 0 trials are counted.
     - The $548.50 lease bound (shard leases $458.50, smoke leases $90.00) is sunk at its upper bound, because the ledgers were lost. VM time was about $23.62.
     - Amendment 2 relaunched the run.
  2. **Launch 2** (21:17Z, at `216cb6c9d`): every shard stopped at the keyless pre-smoke, because `pre-smoke.sh` did not re-enter the docker group in the multiplexed SSH session.
     - No key, smoke lease or trial: $0 model spend, about $2.38 VM time.
     - Amendment 3 (#249) fixed `pre-smoke.sh`.
  3. **Launch 3** (2026-11-04, at `ef4c997755c7`, #249) is the counted run.
     - A one-VM keyless pre-smoke ran first: RC 0, all four images clean.
     - Staged start: canary `cc-a` at 05:21Z. The other 14 started at 05:43Z, after `cc-a` had 3 scored trials and the backup machine had pulled them.
- **Amendment 3's own commit check.** Amendment 3 says that any pull request merged after `10344b840` that touches the listed paths "needs another dated amendment before any cell runs". #249 itself touches `scripts/`.
  - **Captain ruling (2026-11-04): #249 is the amendment that line requires.**
  - The run log listed every pull request merged after `10344b840` up to `ef4c997755c7`. The only one was #249.
- **he-c was relaunched once** (amendment 1's relaunch rule). Its first try stopped before any smoke trial.
  - The gbrain image build on the VM failed at `git fetch` of gbrain from GitHub ("RPC failed; curl 56 Recv failure: Connection reset by peer"), and `run-shard.sh` exited 4.
  - No smoke lease was opened, and the committed leases stayed within amendment 1's $567.61 check, so the relaunch didn't go to the Captain.
  - The relaunch ran at the same commit from an empty results directory and finished 80 of 80. Logs: `results/he-c.try1.*`.
- **cx-a was resumed once** with `--resume --no-smoke` under its same $19 lease.
  - After 52 counted trials, trial 53 (codex-sol-minimal, cn-04, r1) could not start its container: "OCI runtime create failed ... unable to apply cgroup configuration". That is a VM-level docker error (`HE-RUN-006`), and the shard exited 2.
  - The resume ran on a fresh VM. Its log line reads "resume at ef4c997755c7835db9a1be464b5bb0c7c2c7b924 (recorded ef4c997755c7835db9a1be464b5bb0c7c2c7b924)".
  - Preflight was reused. The shard finished 120 of 120 with no duplicate trial id.
- **Restarts, reattaches and pull failures in launch 3.**
  - No controller restart and no reattach.
  - The backup machine's pull loop runs as a background operation. It ended and was started again twice.
  - While each VM was up, 72 pulls succeeded. 30 failed before that shard's results directory existed (during image build and smoke).
  - 5 more failed between good pulls (cx-c once, he-b twice, oc-a once, he-c once). The next pull of each succeeded.
  - Pulls of VMs already destroyed failed, as expected.
  - The final results came from each shard's own copy-back at teardown. A full copy of the merged results was then placed on the backup machine.
- **Spend is reconciled from the 30 ledgers, with no overshoot.**
  - Shard leases: $317.3085 over 20,243 entries, all reconciled except one charged reservation in cx-c.
  - Smoke leases: $11.4557 over 663 entries.
  - The repository's lane ledger copy gains three lines: launch 1 ($548.50, upper bound), launch 2 ($0) and launch 3 ($328.76).
- **Planned deviations** are as listed in the preregistration's "Deviations from the plan": the task rule, repetitions, housekeeping models, Hermes image input mode, calibration commit, the paragraph filter, and tool-call errors not computed.

## Limits

- **Dev, public tasks, these pins.** Claude Code's and Codex's prompts are built for coding; a cut here says nothing about coding work.
- **Leave-one-out only.** Layers that cover for each other can each look unneeded. The joint-cut run (`prompt-archaeology-jointcut-2026-11`, its own preregistration) tests the cut layers together.
- **Ceiling and floor.** 30 of every 40 trials were in families at or near the ceiling or near the floor, in every arm but one. So a cut "with no detected pass loss" was tested mostly on approval-relay and shared-channel trials.
- **Cells of a pair ran on different VMs at different times.** The golden check proves the prompt bytes on each VM. But OpenClaw and Hermes install without a lockfile, so other dependency drift isn't ruled out.
- **Opus-wire and Sol-wire token counts are not comparable.**
- **Hermes's metadata probes** (`GET /v1/models` and similar; about 1,320 refused requests per Hermes cell on Opus, about 770 on Sol) are not model calls.

## Receipts

- **[results/](results/):**
  - The merged `trials.jsonl` (1,640 lines), `manifest.json` and `shards.json`.
  - summarize-run's output: `summary.json` and [summary.md](results/summary.md).
  - compare-run's output: `comparisons.json` and [compare.md](results/compare.md).
  - [prompt-archaeology/](results/prompt-archaeology/): the tables, .md and .json.
  - [clean-arm-audit.json](results/clean-arm-audit.json).
- **Per shard, also in `results/`,** each under the shard's own name:
  - Ledger, smoke ledger and smoke trials.
  - Proxy log, proxy usage and `ablation.ndjson`.
  - Lane log (golden check and pre-smoke), preflight, plan, run-shard and run logs.
  - `shard.json` and `shard-vm.json`.
- **Also in `results/`:** he-c's first-try logs, and [run-log.md](results/run-log.md), the launch 3 run log.
- **Per trial**, under `results/trials/<cell>/<task>/<rep>/`: events, turns, usage, reconcile and grade, plus `snapshot.json.gz` and `ablation.ndjson.gz` (gzipped with `gzip -n`, as earlier runs store snapshots). The official-minimal cells bind no map, so their trials have no ablation file. Harness state, workspaces and raw harness logs are left out.
- **Commands**, run from the worktree at `ef4c997755c7`:
  - `bun scripts/summarize-run.ts --results <merged> --seed 7`
  - `bun scripts/compare-run.ts --results <merged> --seed 7 --draws 10000`
  - `bun scripts/prompt-archaeology/tables.ts --results <merged> --calibration docs/benchmarks/2026-11-01-prompt-archaeology/calibration --out <merged>/prompt-archaeology --seed 7 --draws 10000`
  - `bun scripts/prompt-archaeology/clean-arm-audit.ts <merged> --out clean-arm-audit.json`

## Disclosures

- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
- gstack is Garry Tan's own project.
- gbrain is Garry Tan's own project.
