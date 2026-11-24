# MCP tools at scale: does each agent still pick the right tool as you connect more and more MCP servers?

**We learned that today's agents don't lose track of tools as you connect more MCP servers.** From 30 to 300 tools, every harness and model we tested kept calling the right tool on about 93% to 99% of requests at 300 tools, and no harness slipped by the preregistered test. **You don't need to prune MCP servers for accuracy on Claude Code, Codex, Hermes, OpenClaw or Pi.**

**We also learned that sending every tool's full description on every request is the costly way to scale, and on Claude Code it also costs accuracy.** Claude Code with its tool search switched off fell from 96.6% to 85.4% right at 300 tools and cost twice as much per request as with search on. Pi sending every tool cost 7 times more per request at 300 tools than at 30. **Leave your harness's tool search or deferred loading switched on.**

**For gbrain, only the full 173-tool surface worked on every harness.** The smaller starter and verbs surfaces make the model ask gbrain for more tools, and Codex and OpenClaw almost never got a widened tool called. The preregistered test ends without a final pick, and 55 of the 120 gbrain requests could not be passed by anyone (see [What the gbrain test could not measure](#what-the-gbrain-test-could-not-measure)), but every reading points the same way. **If you use gbrain with Codex or OpenClaw, serve the full surface.**

Run `mcp-at-scale-2026-11`, preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) with five dated amendments in [AMENDMENTS.md](AMENDMENTS.md). 21,392 counted trials (10,594 in phase 1 and 10,798 in phase 2), 25 of them INFRA (runner or provider faults, counted and never scored). Each agent was connected to the same fake but realistic MCP servers, rebuilt from 30 real open-source servers' tool lists, at about 30, 75, 150 and 300 tools ("rungs"). It got the same small requests at every size. A script read which tool it called from the fake servers' own logs; no model graded anything. Analysis: [results/analysis/analysis.md](results/analysis/analysis.md).

A **setup** below is one harness with one model. "Right tool" means the agent called an acceptable tool with the arguments the request asked for. Every difference is in percentage points with its 95% range in brackets.

## What works

- **Picking the right tool holds from 30 to 300 tools on every setup.** Right tool at 30 and 300 tools, 240 requests that need a tool:

  | Setup | 30 tools | 300 tools | Difference (300 minus 30) |
  |---|---:|---:|---|
  | Claude Code × Opus 5.5 | 94.6% | 92.9% | -1.3 [-3.4, 0.8] |
  | Codex × GPT-6.2 Sol | 97.5% | 95.4% | -2.1 [-4.6, 0.0] |
  | Hermes × Opus 5.5 | 99.2% | 99.2% | 0.0 [0.0, 0.0] |
  | Hermes × particle-1 | 96.2% | 97.1% | 0.8 [-1.3, 3.3] |
  | OpenClaw × Opus 5.5 | 98.3% | 98.8% | 0.4 [0.0, 1.2] |
  | OpenClaw × particle-1 | 97.1% | 98.3% | 1.2 [-1.2, 3.8] |
  | Pi × Opus 5.5 | 96.2% | 97.5% | 1.2 [0.0, 2.9] |
  | Pi × particle-1 | 97.1% | 96.2% | -0.8 [-3.3, 2.1] |

  - The preregistered test pools each harness's models. Every harness "holds through 300": its lower 95% limit for 300 minus 30 is above -7 points (Claude Code -1.3 [-3.4, 0.8], Codex -2.1 [-4.6, 0.0], Hermes 0.4 [-0.6, 1.7], OpenClaw 0.8 [-0.4, 2.3], Pi 0.2 [-1.3, 1.7]). None slipped, so 150 and 75 were never tested.
  - **Hermes, OpenClaw and Pi are named as holding through 300.** Claude Code holds too but isn't named, because at 300 tools it sits below the mean of the Opus harnesses (-4.2 [-8.4, -0.5]). Codex runs a different model, so it is reported beside the Opus harnesses and not compared with them.
  - Calling a tool when none was needed (80 requests that need no tool) stayed at 0% to 1.3% on every setup and rung.
- **Chained tasks held too.** On 32 tasks that need 2 to 4 tool calls in a row, graded by the fake servers' end state, success at 300 tools against 30 was -0.8 points [-2.7, 1.6] over 256 pairs, all setups together. Per setup that is 32 tasks each, so it is too small to read alone; the biggest move was Codex, 30 of 32 at 30 tools and 26 of 32 at 300.
- **Cost per request grows slowly in every harness's default setup.** Dollars per request at 30 and 300 tools: Claude Code $0.076 and $0.117 (+54%), Codex $0.051 and $0.053, Hermes × Opus $0.044 and $0.048, OpenClaw × Opus $0.119 and $0.125, Pi × Opus $0.037 and $0.036. No harness reached twice its 30-tool cost, so the preregistered advice is about accuracy only: **pruning isn't needed on these harnesses**.
- **A harness's own tool search is at least as accurate as sending everything, and cheaper.**
  - **Pi:** its default (`codemode` exposure) and its `deferred` mode (a tool-search tool) were within 7 points of sending every schema (`direct`) at every size, the preregistered bar for "non-inferior". Sending everything was a little ahead at 30 tools (+2.5 [0.0, 5.8]) and never beat search by the 5 points that would count. It cost $0.13 per request at 30 tools and $0.93 at 300, against $0.04 for the default.
  - **Claude Code:** with tool search on, it was non-inferior to search off at 30 and 75 tools and cheaper. At 150 tools the range was too wide to call (search off minus search on 1.3 [-4.6, 8.8]).

## What didn't work

- **Claude Code with tool search off loses accuracy at 300 tools.** It got 85.4% right against 92.9% with search on, and cost $0.240 per request against $0.117.
  - The interim look stopped this comparison early for futility (search off minus search on -11.8 [-21.8, -2.5] on the first half), so it decides nothing more. On all the data the difference is -7.5 [-14.6, -1.7], descriptive only and possibly overstated, because the comparison stopped early.
  - In the Claude Code version we tested, tool search was on by default (it searched at every size), so most users already get the better mode. Forcing `ENABLE_TOOL_SEARCH=false` is what loses.
- **gbrain's starter and verbs surfaces fall apart on Codex and OpenClaw.** On the 65 gbrain requests that could be passed (next section):

  | Surface | Claude Code | Codex | Hermes | OpenClaw | Pi |
  |---|---:|---:|---:|---:|---:|
  | full (173 tools), starter-half requests | 62/64 | 62/64 | 62/64 | 64/64 | 62/64 |
  | full, full-only requests | 66/66 | 66/66 | 66/66 | 66/66 | 66/66 |
  | starter (36 tools, widened by asking), starter-half requests | 56/64 | 59/64 | 56/64 | 57/64 | 58/64 |
  | starter, full-only requests | 42/66 | 4/65 | 49/66 | 0/66 | 54/66 |
  | verbs (8 tools), starter-half requests | 61/64 | 11/64 | 54/64 | 10/64 | 62/64 |
  | verbs, full-only requests | 63/65 | 9/66 | 64/66 | 0/65 | 66/66 |
  | registered (what `gbrain setup` installs), starter-half | 55/64 | 12/64 | - | - | - |
  | registered, full-only | 66/66 | 8/66 | - | - | - |

  - Codex and OpenClaw do call gbrain's `request_tools` to widen the surface (Codex 337 times in its 130 verbs trials on these requests), but they rarely go on to use what it unlocked. On the full-only requests, OpenClaw never called the right unlocked tool (0 of 131 starter and verbs trials), and Codex did in 13 of 131 (4 on starter, 9 on verbs), each time in a trial that had called `request_tools`. Otherwise they fall back to the tools they already had, such as `recall`, `context_pack` and `entity`. We didn't check why. The trial records say which tools were called, not the full order of steps, so they can't tell a tool list that isn't reloaded mid-session from other causes.
  - Over each harness's starter-surface trials (239 or 240), the share that called `request_tools` at least once was Claude Code 32.5%, Codex 50.6%, Hermes 33.3%, OpenClaw 22.9% and Pi 41.3% ([widening.json](results/exploratory/widening.json)).

## gbrain's surface: the preregistered result

A surface passes when, pooled over the 5 setups, it is within 10 points of full on each half of the 120 gbrain requests (60 that starter's tools can answer and 60 that need a full-only tool) and costs the 160 non-gbrain requests no more than 10 points.

| Surface | Starter half against full | Full-only half against full | Cost to other requests | Passes |
|---|---|---|---|---|
| full | reference | reference | -0.8 [-1.4, -0.1] | yes |
| starter | -4.3 [-9.5, -0.3] | stopped for futility at the interim look (-27.0 [-38.0, -16.7]); all data -30.1 [-38.6, -22.2], descriptive | -1.0 [-2.3, -0.1] | not decided |
| verbs | stopped for futility (-21.1 [-30.8, -11.8]); all data -19.0 [-26.2, -12.0], descriptive | stopped for futility (-20.7 [-28.4, -13.4]); all data -21.1 [-26.3, -15.9], descriptive | -1.4 [-2.7, -0.3] | not decided |
| registered | -23.8 [-32.6, -15.5] | -24.2 [-30.0, -18.3] | -1.3 [-3.1, 0.3] | no |

**The preregistered decision is "no final recommendation"**, because the plan says a comparison stopped at the interim look decides nothing at the end. The `request_tools` verdict is "no final decision" for the same reason. Only full passed.

## What the gbrain test could not measure

**55 of the 120 gbrain requests could not be passed by any surface or harness.** The grader counts a gbrain call as right only when gbrain itself reports success, and on these requests the brain in the trial container refused the correct call every time. Agents made 1,548 calls with the right tool and the right arguments on them; none succeeded.

- 35 name an object, id, cursor or revision that isn't in the synthetic brain, or don't fit its state (a fact, page revision, write request, published skill, job, upload session or file the brain never had).
- 12 are writes the brain refused inside the container ("The physical checkout identity changed or belongs to another owner", or a write that ended with `recovery_required`).
- 8 need something the rig doesn't run: an LLM for `synthesize`, an OAuth client, an authenticated or owner principal, a remote-caller permission, the secret store, or retrieval feedback switched on.

They split 28 starter-half and 27 full-only. The list, with each request's class, is in [dead-items.json](results/exploratory/gbrain-confirmable/dead-items.json).

**What it does to the result.** These requests score 0 on every surface, so they add pairs with no difference and shrink every gap toward zero by roughly half. The 10-point margin then behaves like a wider one. Full's own score is 52% on the starter half and 55% on the full-only half only because of this; on the other 65 requests it is 97.5% and 100%.

**Exploratory reading on the 65 passable requests, not preregistered.** The same analysis code in its exploratory mode, on only those requests, gives: starter -8.1 [-18.2, -0.6] on its own half and -54.7 [-63.2, -46.7] on the full-only half; verbs -35.6 [-42.4, -27.5] and -38.4 [-41.9, -35.4]; registered -44.5 [-53.9, -35.2] and -43.9 [-47.0, -40.2]. Only full passes, and verbs' full-only half is far below 70% on Codex (13.6%) and OpenClaw, which the plan's rule would mark FIX-METHOD for `request_tools` ([analysis.md](results/exploratory/gbrain-confirmable/analysis.md)). The passable set was chosen after seeing the data, by whether gbrain ever confirmed a correct call, so read this as a check on direction, not a test.

## What this changes

- **Settled:** gstack's prune advice stays as it is: pruning MCP servers isn't needed for accuracy up to about 300 tools on these five harnesses (KEEP). gbrain's default surface is not settled: the preregistered reading is no final recommendation, and set G is rebuilt before any re-run.
- **Which harness to use with many MCP tools:** any of the five holds up to 300 tools. Hermes, OpenClaw and Pi are named as holding through 300 on Opus 5.5. Claude Code also holds, a few points below the other Opus harnesses at 300.
- **gstack's prune advice:** gstack can tell users that pruning MCP servers isn't needed for accuracy on these harnesses, up to about 300 tools.
- **Search against sending everything:** search is non-inferior and cheaper on Pi at every size, and on Claude Code at 30 and 75 tools. Nothing beat search by 5 points.
- **gbrain's default surface:** the preregistered reading is no final recommendation. Every reading we have, preregistered and exploratory, has only full passing, and starter and verbs failing outright on Codex and OpenClaw. The evidence and the failing traces go to gbrain's maintainers. Before any re-run, set G needs rebuilding so that every request's correct call can succeed in the synthetic brain.

## Why null?

**Tool count (no setup slipped).**

- *Did the agents search at all?* Yes where they can: Claude Code and Pi × Opus made about one search call before the right call, and Pi × particle-1 about two. Hermes and OpenClaw × Opus made almost no search calls.
- *Were the requests too easy?* Possibly. Right tool at 30 tools was already 94.6% to 99.2%, so there was little room to fall. The requests name the needed values in the text, and near-twin tools were spread through them, but a single short request is easier than a long working session.
- *Were there enough pairs?* Yes for the size of drop that matters: 238 to 240 pairs per setup and rung, and the plan's 5-point slip bar sat well outside every range but Codex's (-2.1 [-4.6, 0.0]).
- *Does the model already find tools unaided?* At this scale, yes.
- **Verdict: KEEP** the "no pruning needed" advice for single requests up to 300 tools. Raising the ceiling, with longer sessions and harder near-twins, is in [Next time](#next-time).

**gbrain's smaller surfaces.** Starter and verbs lose to full; the losses are real on Codex and OpenClaw, and the measurement is diluted by the 55 unpassable requests. **Verdict: FIX-METHOD**: rebuild set G so every request can succeed in the synthetic brain, and treat widening through `request_tools` on Codex and OpenClaw as the thing to fix before a smaller surface can be the default there.

## A behaviour finding

In phase 2, OpenClaw × particle-1 on request r-011 at 300 tools (shard s09, trial `openclaw-p1-r300__a1__r300-r-011`) wrote a Python script that probed the fake catalog server directly with made-up HTTP headers: `X-Rung` and `X-Trial` set to the trial's own name, `X-Session: agent:main:main`, and `Authorization: Bearer <the trial's name>`. It reached no other service, since trials can reach only the metering proxy and the catalog host, and the trial still scored a right tool. The key scan flagged the Bearer line; [Amendment 5](AMENDMENTS.md) records the review that cleared it as the trial's own name, not a key. An agent inventing credentials to poke at a server it was only meant to call through MCP is worth knowing about if you run agents near real endpoints.

## What didn't run

- **QM** joins by a later dated amendment, as the plan says. Its rows will be reported beside these with the build they ran on.
- particle-1 on the tool-search and gbrain comparisons, harness versions newer than the frozen ones, and Gemini CLI (it runs only Gemini models, so it has a listing map and no paid row).

## How to read the numbers

- Each comparison is paired by setup, request and repetition, with 95% ranges clustered by the tool the request targets.
- **One interim look** at half the units (118 of 237) could stop a comparison early. It stopped four, all for futility: starter's full-only half (z -3.02), verbs' starter half (z -2.17), verbs' full-only half (z -2.70) and Claude Code's search-off comparison at 300 (z -2.23). A stopped comparison keeps the look's verdict; numbers that use phase 2 are labelled descriptive and may overstate the gap. The look's record is [results/look/interim.json](results/look/interim.json).
- Comparisons that continued were judged at the end with the z bound 1.977 as well as their 95% ranges.
- 25 INFRA trials are counted and never scored: 10 where the trial runner failed before a verdict (network errors, timeouts, a container that didn't start, or an agent exit), 9 provider failures, 3 where the grader wrote no outcomes, and 3 where a catalog server didn't connect (all on Pi's gbrain cells at 150 tools). The full table is at the end of [analysis.md](results/analysis/analysis.md).
- Cost per request is from the metering proxy. Wall time is not compared, because each VM ran three trials at once.

## Next time

### What we'd change if we ran this again

- Check every gbrain request against the synthetic brain before freezing: make the right call once and require a success, so no request is unpassable by construction.
- Run the gbrain container with a stable checkout identity, so writes commit.
- Keep the per-harness widening check from the pilot as a gate: a harness that never calls an unlocked tool can't test starter or verbs.

### Ideas to improve the eval

- Multi-turn sessions where tools pile up over a long conversation, not one short request.
- Harder near-twins, and requests that don't name the service.
- Tool counts past 300, where Claude Code's own search and Pi's default may start to differ.

## How the run went

- **Twelve shards on Ubicloud VMs, two phases each,** every runner at commit `39d2efef18ce` (Amendment 1). Per-shard records, launch claims (each phase's VM and start time), VM cleanup records, key scans and their reviews are under [results/shards/](results/shards/), summed up in [shards.json](results/shards.json).
- **Deviations before the look** (a controller restart with no trial lost, wrappers run from the branch checkout, six failed or late launches relaunched cleanly, and one final pull that ended with a tar EOF but whose counts match) are in [AMENDMENTS.md](AMENDMENTS.md#deviations-recorded-before-the-interim-look-2026-11-23).
- **Deviations after the look:**
  - **Six shard phases were finished by hand** after the runner stopped on key-scan hits that were not keys. Exempted hit files: s12 phase 1 (8), s09 phase 1 (2), s11 phase 1 (7), s12 phase 2 (4), s09 phase 2 (2) and s11 phase 2 (1). Each was cleared by [key-review.ts](../../../scripts/mcp-at-scale/key-review.ts) from the amendment commit named in shards.json (`b3bf2462`, `cfaa678e`, `5aca3993` or `f982dd1ca1cd`), then `run.ts phase-complete` and, for phase 2, `merge-phases`, all at `39d2efef18ce`. Every exempted hit's file and class is in that phase's `key-scan-review.json`. Each of those files says `amendment: 2`, the amendment that started these reviews, also when it used a class a later amendment added (`x-placeholder` from Amendment 4, `trial-name` from Amendment 5); the commit named in shards.json says which version of the script ran. No exact key value was found anywhere.
  - **The final analysis ran from `f982dd1ca1cd`**, the commit with Amendments 3 to 5. Amendment 3 changed how a stopped comparison is reported and was dated before the look; the analysis code is otherwise as frozen.
  - **One trial file instead of 36.** The plan lists each shard's and phase's trials and the merged trials. They are committed once, as [results/trials.jsonl](results/trials.jsonl) (every row carries its shard and phase), with the sha256 of each shard's phase files and merged file in shards.json and the files themselves in the raw archive.
  - **Set R's sealed half is published** in [results/sets/set-r.jsonl](results/sets/set-r.jsonl), with sets T and G as the plan says. All 160 sealed rows match the per-row sha256 committed in [set-r-sealed.json](set-r-sealed.json) before the run. The QM cells that come later will run on a set that is public by then.
  - **The gbrain measurement problem** above was found while writing these results, not before.
- No VM was left running, and every phase's meter drained.

## Disclosures

gbrain is Garry Tan's own project.

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
