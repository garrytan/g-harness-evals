# Skills at scale: does each agent harness open the right skill as its skill catalog grows, with and without gbrain's resolver?

**Status: frozen at wave 1 (2026-11-23).** Wave 1 (set L, its labels, the judge check and the per-arm pilots) ran uncounted on 2026-11-23; its outputs are frozen below and in the 2026-11-23 dated changes. No counted trial runs until this file is on main.

## What we're testing

People who use agents a lot end up with hundreds or thousands of skills. Each harness has to fit that list into the model's prompt, and each does it differently: some cut descriptions, some drop skills, some paste everything. gbrain's resolver (`gbrain setup <harness> --skill-loading resolve`) instead puts a short block of the few skills that fit the current message into the request.

**Question:** on each harness, as the installed catalog grows from 100 to 351, 700 and 1,500 skills, does the model see, open and use the right skill more often with gbrain's resolver installed by `gbrain setup` than with the harness alone, and from what catalog size?

- Run id: `skills-at-scale-2026-11` (OpenClaw gets its own run id and preregistration, `skills-at-scale-openclaw-2026-11`).
- Dev only for set T; set L's test half stays sealed until the gbrain build is frozen.
- Plan history: the approved plan and every dated change are in the plan file kept with this run's handoff; the dated changes that bind this run are listed under "Dated changes" below.

## What the result changes

Garry makes each call with these numbers; a default flip is his decision.

- **Flip on above size S (per harness H):** S is the smallest rung at which every bar below holds, at that rung and every bigger one. Then `gbrain setup H` should default to `--skill-loading resolve` when the catalog has at least S skills.
  - Opened an acceptable skill: resolver minus native at least +5 points, with the 95% range above 0.
  - Opened a wrong skill (skill-needing requests) and opened any skill on a no-skill request: non-inferiority tests pooled over the rungs at or above S, holding on each model separately on two-model harnesses, at the margins in "Sample size".
  - Set T task success, pooled over setups at those rungs: the 95% range does not sit wholly below 0.
- **Null or loss at every rung:** the resolver stays opt-in on H, the result gets one "Why null?" pass (R48) and a verdict of KEEP, FIX-METHOD or CUT-CANDIDATE; a cut candidate goes to Garry in plain words.
- **Resolver blocks on more than 25% of no-skill requests at any rung:** FIX-METHOD for gbrain's gate (its 0.6 threshold was fitted on one 351-skill catalog). It blocks a flip only through the no-skill harm bar.
- **Pins:** if pinned targets are opened at least +10 points more often with pins than with the resolver alone, and unpinned requests lose nothing (95% range above -3 points), gbrain's setup output should suggest pinning daily skills. Otherwise pins stay a documented option.
- **QM (native only):** no gbrain default to flip. QM's curve shows whether its names-only listing loses the right skill as catalogs grow; that goes to QM's owners as a description-budget finding and tells gbrain whether a QM route is worth building.
- **For gstack:** the per-harness curve says whether a big skill pack can rely on the resolver to get its skills opened on that harness.

## Eval loop

- Size: counted run
- Paid budget: $3,800
- Model judge: GPT-6.2 Astra (scores Claude and particle-1 runs) and Claude Opus 5.5 (scores GPT-6.2 Sol runs)

## Arms

Within a pair the model, requests, tasks and catalog are the same.

1. **Native (the no-gbrain arm, R44):** the harness with the catalog installed in its own skills folder and nothing from gbrain. Clean-arm preflight per #449's rule c: no gstack outside the catalog copy, no Capy drive mounted.
2. **Resolver:** native plus `gbrain setup <harness> --skill-loading resolve` (Pi: the extension), on gbrain v0.60.766.0, installed by its commit ae4bef02cea6f7f2bb5c3a8565a9927de08162dc (the newest release on gbrain's main when the pilots started; R100), with its defaults. The build is frozen once counted gbrain runs start. No adapter of ours sits in the path: the cell image runs the installer, and `gbrain doctor --only skill_resolver` must pass.
3. **Resolver plus pins:** arm 2 plus `gbrain skills pin add` for the 20 pre-drawn pins. 1,500 rung only; Hermes and Pi only.

## Harnesses and models

| Harness | Model(s) | Arms | Pin |
|---|---|---|---|
| Claude Code | Claude Opus 5.5 | native, resolver | 2.1.312 |
| Codex CLI | GPT-6.2 Sol | native, resolver | 0.165.0 (the pilot ran GPT-6.2 Sol on it) |
| Hermes Agent | Claude Opus 5.5, particle-1 | native, resolver, resolver plus pins | v2026.9.24 (f97608f1) |
| Pi | Claude Opus 5.5, particle-1 | native, resolver, resolver plus pins | 1.5.0 |
| QM | Claude Opus 5.5, particle-1 | native | not in this run's counted cells yet (dated change, 2026-11-23) |

- R110: Sol runs in Codex CLI and Opus in Claude Code; this eval also runs Opus in Hermes, Pi and QM because it tests the harnesses themselves.
- R116: no gpt-4o or older-generation model in any role we choose. Harness housekeeping models (QM's session titles, Hermes's and Pi's own utility calls) stay at their shipped defaults, are metered, labelled "harness housekeeping, shipped default" and never scored. Claude Code's adapter pins ANTHROPIC_SMALL_FAST_MODEL to the cell model, a declared deviation kept from published runs.
- A model under test is never swapped: refusals and safety-filter stops are their own outcome (R95).
- OpenClaw runs under its own run id (above). Gemini CLI has a keyless listing measurement only.

## Catalogs

The four rungs are nested: 100 ⊂ 351 ⊂ 700 ⊂ 1,500. `bun scripts/skills-at-scale/build-ladder.ts --src <packs> --out <snapshot> --gitleaks --check` rebuilds them from 26 pinned packs (scripts/skills-at-scale/packs-ladder.json) and prints `LADDER_OK`.

| Rung | Catalog hash (shard-kit catalogHashOf) | What it holds |
|---|---|---|
| 100 | 54231dec… | the 100 target skills, drawn from the 351 rung, stratified by pack and spread across the 1,500 names |
| 351 | b6d67f1f… | #449's skill-resolver catalog, unchanged |
| 700 | 1132d126… | plus vendor packs |
| 1,500 | 144aae6f… | plus community packs |

Records: tasks/skills-at-scale/catalog/ (hashes.json pins the uncommitted manifest.json at 4477b949… and safety-scan.json at 8af3ed5a…). Full hashes go in prereg.json.

## Requests and tasks

- **Set L, 420 requests:** 300 skill-needing (3 per target, low, mid and high word overlap with the skill's own text) written by Gemini 4 Carbon, a third model family, and 120 no-skill requests. Dev half in tasks/skills-at-scale/L/; the test half sealed by digest. Final set (2026-11-23): 410 rows, 290 skill-needing and 120 no-skill, dev 207 and test 203; 10 planned rows were dropped (tasks/skills-at-scale/L/README.md says which and why). Hashes are in prereg.json inputs: setl.jsonl 77224ccf…, dev half d5ad1362…, test half 3721b6d0…. Each request runs once per arm, rung and setup, as the user turn alone (no task preamble; the hooks rank the user turn), stopped at 6 model requests.
- **Set T, 48 graded tasks:** native and resolver arms at the 351 and 1,500 rungs, one try each, with the preamble where each harness allows it.
- **Labels:** each request gets an acceptable-skill set over the full 1,500 catalog from two judges (scripts/skills-at-scale/label-l.ts); smaller rungs take its intersection. A no-skill request that either judge gives an acceptable skill leaves the no-skill bars at the rungs that hold that skill. Before unblinding, every opened skill outside its acceptable set is adjudicated with the arm hidden (adjudicate.ts). Labels are frozen by digest: labels-l.jsonl, sha256 f8357b20…, 410 rows with no labelling errors, kept outside git because it names the sealed half's accepted skills. The two judges agree on 99.3% of the rows' no-skill flags, with a mean Jaccard overlap of 0.837 between their acceptable sets.

## Outcomes (all paired, with 95% ranges)

1. **Saw the right skill:** an acceptable skill in the model's captured request, with a description (at least 40 characters of it, or a resolver block line) or by name only (runner/trial/run.ts writes saw-skill.json; scripts/skills-at-scale/saw.ts).
2. **Opened the right skill:** got-skill.ts on the trace.
3. **Opened a wrong skill:** any opened skill outside the acceptable set, on skill-needing requests.
4. **Suggested a skill when none was needed:** (a) a resolver block on a no-skill request (resolver arms, against the 25% bar); (b) any skill opened on a no-skill request, paired across arms.
5. **Task succeeded:** set T's deterministic checks, pooled over setups.
6. **Reported, not a bar:** input tokens and dollars per request.

Every outcome is also broken out by where the target sat in the native listing. Analysis: scripts/skills-at-scale/analyze.ts.

## Flagged trials

A trial is flagged, and settled by two readers from its stored traces, when its verdict rests only on a path joined to an earlier cd, on a failed-cd probe, on a Hermes JSON result carrying a permission error, or on Python's Errno 13 (scripts/skills-at-scale/flags.ts). A trial with no flag record counts as flagged. Flagged trials are reported per arm. The pilot reports the flag rate per harness; above 2% on a harness, a fix PR comes before that harness's counted run.

## Sample size and the smallest detectable difference

Pairs cluster by target skill (3 requests each); a sign-flip test and a cluster bootstrap, design effect 1.2, 80% power, two-sided 5%, one-sided 2.5% for non-inferiority (scripts/skills-at-scale/power.ts, power-design.json).

- Opened the right skill, per harness and rung: about 8.9 points on one-model harnesses (Claude Code, Codex), about 6.3 points on two-model harnesses.
- Non-inferiority margins per harness, from the pilot's discordant shares so each test has 80% power when the true harm is zero (power.ts --from-analysis on the set L pilot; the largest over a harness's models, with floors of 2.0 points for wrong skill and 3.5 for no-skill open; margins.json): Claude Code 3.7 and 3.5 points (wrong skill, then no-skill open), Codex 11.3 and 3.5, Hermes 7.6 and 9.7, Pi 3.8 and 3.5. Codex's wrong-skill margin is wide because 40.9% of its 22 pilot pairs were discordant; Hermes's two come from particle-1. Every margin rests on a small pilot.
- The pilot's discordance gives a smallest detectable difference for opening the right skill of 8.3 points on Claude Code, 8.5 on Codex and 6.5 on the two-model harnesses, in line with the plan above.
- Fixed testing order per harness: 1,500 first, then 700, 351 and 100; S is the last rung passed.

## Pilot

Per R111, each arm's pilot costs at most a tenth of its arm budget, and runs on the arm's own outputs. Each arm budget is the pilot-priced projection of the arm's counted cells (plan-cost-receipt.json) plus 20%, rounded up to $5; each cap is a tenth of it. Pilot spent is what the arm's wave 1 pilots cost: set L (8 trials per cell), the resolver rerun (4 per cell), set T (5 per cell) and, on Pi particle-1 resolver, the 17-request extension. Every arm is under its cap. The pilot plans, gate records and flag summaries are in pilot/.

| Arm | Arm budget | Pilot cap | Pilot spent |
|---|---|---|---|
| Claude Code, Claude Opus 5.5, native | $400 | $40.00 | $8.51 |
| Claude Code, Claude Opus 5.5, resolver | $405 | $40.50 | $11.52 |
| Codex CLI, GPT-6.2 Sol, native | $135 | $13.50 | $3.22 |
| Codex CLI, GPT-6.2 Sol, resolver | $145 | $14.50 | $4.57 |
| Hermes Agent, Claude Opus 5.5, native | $480 | $48.00 | $11.50 |
| Hermes Agent, Claude Opus 5.5, resolver | $450 | $45.00 | $13.22 |
| Hermes Agent, Claude Opus 5.5, resolver plus pins | $190 | $19.00 | $3.81 |
| Hermes Agent, particle-1, native | $30 | $3.00 | $0.85 |
| Hermes Agent, particle-1, resolver | $30 | $3.00 | $0.92 |
| Hermes Agent, particle-1, resolver plus pins | $10 | $1.00 | $0.20 |
| Pi, Claude Opus 5.5, native | $405 | $40.50 | $9.63 |
| Pi, Claude Opus 5.5, resolver | $465 | $46.50 | $14.69 |
| Pi, Claude Opus 5.5, resolver plus pins | $280 | $28.00 | $6.84 |
| Pi, particle-1, native | $45 | $4.50 | $1.26 |
| Pi, particle-1, resolver | $40 | $4.00 | $1.50 |
| Pi, particle-1, resolver plus pins | $20 | $2.00 | $0.41 |

- Part under test ran: native, the catalog listing in the captured request; resolver, a resolver block ranked on the request's own text (scripts/skills-at-scale/pilot-gate.ts). Result: the native listing was captured on all 192 native set L pilot trials. The first set L pilot's saw-skill.json did not record resolver blocks, so every resolver and pins cell was piloted again after that fix (dated change, 2026-11-23): a block on 83 of 84 skill-request trials, and on every trial of 27 of the 28 cells. Pi particle-1 at 351 skills got a block on 2 of 3. It was given 17 more skill requests under a rule written before they ran (below 19 of 20, the arm is left out at that rung) and reached 18 of 20, so pi-p1-resolver-351 is left out and has no counted cell (R111; reported as left out, not a dropped arm under R71). On both misses no block came on any of the 6 requests, and the kept files can't tell whether the resolver ran and chose no skill or did not run.
- Tasks can be supplied: requests reach the model at the planned rate, and Codex's session record and proxy requests name gpt-6.2-sol with no service_tier or prompt_cache_retention. Result: every pilot cell reached the model on all its planned trials (set L 416, rerun 112, set T 120, extension 17). On Codex 0.165.0 the proxy records gpt-6.2-sol with medium reasoning on every request (68 answered); the kept proxy logs hold no service_tier or prompt_cache_retention field, so the counted run's first Codex shard re-reads its session record before the rest launch.
- Flag rate: 2 of 416 set L pilot trials flagged, both on Hermes (2 of 144, 1.4%, under the 2% bar); 0 of 112 in the rerun and 0 of 17 in the extension. Set T trials write no flag record, because the runner writes skill-flags.json only on skill-request trials; set T is graded by its deterministic checks, not by the opened-skill reading the flags guard, so the flag rule does not apply to it.
- Judge passes R78: the separate judge stage below.

## Judge check

Set L's judge check is its own stage in wave 1 (the standing reading of R111), and passes before any counted session: each judge reaches Cohen's kappa of at least 0.6 on at least 100 adjudicated gold pairs, half of them near-duplicate cases at the 1,500 rung (R78 for plans frozen from 2026-11-22).

| Arm | Labelled outputs | Kappa bar |
|---|---|---|
| Claude Code, Claude Opus 5.5, native | 139 | 0.6 |
| Claude Code, Claude Opus 5.5, resolver | 139 | 0.6 |
| Codex CLI, GPT-6.2 Sol, native | 139 | 0.6 |
| Codex CLI, GPT-6.2 Sol, resolver | 139 | 0.6 |
| Hermes Agent, Claude Opus 5.5, native | 139 | 0.6 |
| Hermes Agent, Claude Opus 5.5, resolver | 139 | 0.6 |
| Hermes Agent, Claude Opus 5.5, resolver plus pins | 139 | 0.6 |
| Hermes Agent, particle-1, native | 139 | 0.6 |
| Hermes Agent, particle-1, resolver | 139 | 0.6 |
| Hermes Agent, particle-1, resolver plus pins | 139 | 0.6 |
| Pi, Claude Opus 5.5, native | 139 | 0.6 |
| Pi, Claude Opus 5.5, resolver | 139 | 0.6 |
| Pi, Claude Opus 5.5, resolver plus pins | 139 | 0.6 |
| Pi, particle-1, native | 139 | 0.6 |
| Pi, particle-1, resolver | 139 | 0.6 |
| Pi, particle-1, resolver plus pins | 139 | 0.6 |

Every arm's outputs are graded by one of two judges (GPT-6.2 Astra for Claude Opus 5.5 and particle-1, Claude Opus 5.5 for GPT-6.2 Sol), so each row is that judge's read of the same gold set. Result: both graders read 150 queued dev pairs (95 near-duplicates, the target's nearest TF-IDF look-alike at 1,500; 30 targets; 25 no-skill top matches), and the 141 pairs they agreed on are gold (gold.jsonl). On the 139 the check scores (judge-check.json): GPT-6.2 Astra kappa 0.934 (0.871 on near-duplicates), Claude Opus 5.5 kappa 0.901 (0.801 on near-duplicates). Both pass. Caveat: the graders are the same two models as the label sources, with a different prompt, which is #449's method.

## Interim look

- Look at: 109 of 219 units, on each harness at the 1,500 rung (49 of the 99 target skills that still have requests and 60 of the 120 no-skill requests, in the seeded order analyze.ts interimUnits gives)
- Stop bounds: O'Brien-Fleming two-look bounds at each test's own alpha: 2.80 and 1.98 for the two-sided primary; the same z for the one-sided 0.025 harm bars. Efficacy at the interim also needs the 1,500 rung's harm bars to pass; futility when conditional power under the planned effect is below 10%. No other look counts.

## Cost projection

- Spend stop: $4,300, all-in: paid calls, VMs and model use by the threads running the eval, priced by scripts/plan-cost.ts
- Pilot-priced projection: $3,492.94, all-in; the counted cells $2,907 (95% upper bound $4,564), VMs about $107, and $479 already spent ($166 paid in wave 1 and $313 of thread model use). The upper bound passes the stop, so the stop can end the run early
- Projection receipt: plan-cost-receipt.json

## How the money is metered

Every harness trial goes through the metering proxy under a ledger lease. Exception (the coordinating agent's ruling, 2026-11-19): judge and labeller calls go through the provider batch APIs under a ledger lease reserved at twice the expected spend, with each batch's usage receipt kept beside the ledger and reconciled in the report, because the proxy has no batch endpoints (scripts/skills-at-scale/batch.ts).

## Dated changes

- 2026-11-19, R111 and R113: per-arm pilots, a separate judge stage, and one interim look (above).
- 2026-11-19, the batch exception (above).
- 2026-11-19, cd flags and the 2% gate (above).
- 2026-11-19, set L requests go to the harness as the user turn alone, because the hooks rank only the user turn; set T keeps its preamble where the harness allows it.
- 2026-11-19, R110, and QM as a native-only harness.
- 2026-11-20, Sol arms move to GPT-6.2 Sol (R54); the Codex pin is checked in the pilot.
- 2026-11-21, R116: judges and labellers move to GPT-6.2 Astra; Opus 5.5 stays.
- 2026-11-22, R78: the judge check needs 100 labelled outputs.
- 2026-11-23, gbrain v0.60.765.0 is the default build; the run uses the newest release when wave 1 starts (R100).
- 2026-11-23, gbrain v0.60.766.0 at commit ae4bef02cea6f7f2bb5c3a8565a9927de08162dc, the newest release on gbrain's main when the pilots started, replaces v0.60.765.0 (R100); the image installs it by commit.
- 2026-11-23, each cell image carries its catalog's hash as a label, and run preflight refuses an image whose label does not match the cell's catalog (HE-ADAPTER-005). The check reads the image tag, so each shard records the image id it ran.
- 2026-11-23, set L is final at 410 rows, not 420. Two skill requests had no usable text from the writer; eight could not be labelled because a judge's provider refused them (tasks/skills-at-scale/L/README.md). One target, godmode, lost all three requests, so 99 targets remain.
- 2026-11-23, 14 gstack targets had their shared gstack preamble cut from the text the writer read, so requests come from what the skill does, not the boilerplate every gstack skill shares.
- 2026-11-23, the overlap spread was not met: of 290 skill rows, 266 landed in the low stratum, 24 in mid and none in high, against an asked 98, 96 and 96. Overlap is reported descriptively, with no per-stratum claim.
- 2026-11-23, labels, gold and the judge check are frozen by digest (above).
- 2026-11-23, the runner takes a rung key on skill-arm cells, so the analysis can read each trial's rung, and saw.ts records each trial's resolver blocks in saw-skill.json. The first set L pilot ran before that record existed, so its resolver cells were piloted again.
- 2026-11-23, Codex CLI stays at 0.165.0: the pilot ran GPT-6.2 Sol on it.
- 2026-11-23, R111 result: pi-p1-resolver-351 is left out, as above. Pi particle-1 then has no resolver comparison at 351 skills, so its fixed sequence ends at 700, and Pi's S cannot go below 700 on particle-1.
- 2026-11-23, QM is out of this run's counted cells until it has its own pilot. Its decision line above stays; it gets a dated change before any QM cell runs.
- 2026-11-23, the paid budget rises from $2,870 to $3,800 and the spend stop is $4,300 all-in, from the pilot-priced projection (above).
- 2026-11-23, the pilot ran from commit f8896b14 with one file changed on the run machine for the rerun and the extension, scripts/skills-at-scale/saw.ts, as committed on this branch. Pilot trials are uncounted.

## What we already know

- #449 (gbrain v0.60.633.0, our own hook, 351 skills) measured +15 and +20 points on Claude Code and Codex for opening the right skill with the resolver.
- gbrain's own offline check reports 7 of 61 no-skill requests got a block with the gate on at 351 skills. gbrain's team also reported a 750-skill no-skill count of 93 of 112 with the gate on, from its own offline check. We have re-measured neither.
