# Does a general-purpose skill resolver help agents open and use the right skill, in every harness? (internal-task)

Status: DRAFT, written 2026-11-08 (America/Los_Angeles) before any counted trial. Run id `skill-resolver-2026-11`. Items marked **PIN** were filled on 2026-11-09 from internal-task-a's tagged resolver release, gbrain v0.60.633.0 (relayed by internal-task-b; see Pin below and Deviations); items marked **PILOT** were filled on 2026-11-10 from the 40-pair uncounted pilot (see Pilot). No counted trial runs until this file is merged to main.

**In one line: with a 351-skill public catalog installed, does turning on GBrain's per-turn skill resolver make the agent open an acceptable skill more often than the harness's own skill loading, does the agent then follow the skill, and does the task succeed?**

**The public lesson we're after (R79):** if you give an agent hundreds of skills, should you add a per-turn skill resolver, or is your harness's own skill listing (or a plain names-only list) enough, and which harnesses drop skills before the model ever sees them?

- **Five harnesses, two frontier models, 8 cells:** OpenClaw 2026.10.6, Hermes v2026.9.24 and QM main@90e4ced7 (Pi engine) on both `anthropic:claude-opus-5-5` and `openai:gpt-6.1-sol`; Claude Code 2.1.312 on Opus 5.5 only; Codex 0.165.0 on GPT-6.1 Sol only.
- **One headline test:** resolver-on minus native on "opened an acceptable skill", pooled over the 8 cells, paired per request. The bar is 10 points and significant.
- **Free alternatives are tested too:** a names-only listing with each harness's limits raised, and (on set R) a usage-ordered top list. If they do as well, the report says the resolver is not needed for that harness.
- **Built to be able to fail:** acceptable skills come from judges who never see what the agent read; half of set P stayed sealed until the resolver was pinned; wrong suggestions count against the resolver.

## Approval

- Plan internal-task (autoplan run internal-task-20261108011946, plan hash 073200dfb1e3, gate_rev 1): Garry, 2026-11-07, "Do it" (every recommendation, decisions 1A to 4A). The plan's "Implementation plan" binds this run; departures are listed under Deviations from the plan.
- Spend: the R71 guideline is $4,000 for an eval with a GPT-6 Astra judge (Garry, 2026-11-08; it was $2,000). It is a planning guideline (Garry via internal-task-a and internal-task-b, "Eh don't cut corners to stay just under the limits we treat it as a guideline"). Lease caps here are runaway guards and bind the run that names them.
- QM pull arm: internal-task, 2026-11-08, option A (below).

## Question

For each harness at its pin, with the public catalog installed: in what share of skill-needing requests does the agent open an acceptable skill (Got the skill) under native loading, under the pinned resolver, and under the config-only alternatives? Then, on a graded task set, does the agent do the skill's distinctive step (Used it) and does the task pass (Success)? What does the resolver cost in context (tokens added at turns 1, 10 and 50) and in false suggestions?

## The catalog

- Built by `scripts/skill-resolver/build-catalog.ts` from `scripts/skill-resolver/packs.json`: gstack 64 (commit 914e7b6f), OpenClaw 2026.10.6 bundled 49, Hermes f97608f1 bundled and optional 208, QM 90e4ced7 seed 30. 351 skills, 38 renamed with a pack prefix on name collisions, 0 excluded. Every licence notice ships with the snapshot.
- **Catalog hash `b6d67f1f044fab694182a424719a40b13a6e63640d8e814c7fd7277d97123fb7`**, rebuilt identically on four machines. From git-pinned packs only tracked files are copied (an installed checkout's build output changed two skills' support files in an earlier build).
- The resolver's own catalog_hash (from its build receipt, covering id, name, description, triggers, routing rows, body hash, path, eligibility, namespace and precedence) is a different number, recorded per harness (each index sees the catalog at that harness's install path): OpenClaw `c690216e10907e6eb9c221e5a4b27e272d948a3b4e37b18997b0cb4fb198cfa8`, Claude Code `22953501ea96b502c011ccdfc2ff597ad5c9775c1ce6e978239d1ba0477e913e`, Codex `023474f53e80b2b713acf3b5b1dbc67d9b3f117d8d722484a982517acb0aeaa0`, Hermes `5272665ded9ea2fcf58368b8e9210186ec67a072fa403a11029a2fd8c231cb5d`, QM `f3d95da6ae5fb539eb1d5427db93951884ffebce959867f4541ca7aaa18d1c53`. Each index holds 349 of the 351 skills: the release leaves out `land-and-deploy` and `modernize`, whose frontmatter sets `disable-model-invocation: true` (Deviations).

## What each harness shows natively (Step 0, keyless, 2026-11-08)

Captured from the first model request against the fake endpoints, both providers where a harness runs both. Write-ups: handoffs/internal-task/step0/ in the coordinating agent's drive; scripts: `scripts/skill-resolver/step0/`.

| Harness | Listed of 351 | Descriptions | Why |
|---|---|---|---|
| OpenClaw 2026.10.6 | 141 | none (compact) | 351 folders pass `skills.limits.maxCandidatesPerRoot` (300), so only the first 200 by name load; the other 151 never exist for it, and the cut shows only on stderr. Then `maxSkillsInPrompt` 150 and `maxSkillsPromptChars` 18,000 keep 146 entries ("Skills truncated: included 146 of 198"). |
| Claude Code 2.1.312 | 349 | 238 with, 111 names only | Budget = context window x bytes per token x `skillListingBudgetFraction` 0.01 (about 29,550 characters) unless `SLASH_COMMAND_TOOL_CHAR_BUDGET` is set; descriptions fill greedily in name order. 2 skills set `disable-model-invocation`. |
| Codex 0.165.0 | 351 | cut to 8 to 12 characters | Budget 2 percent of the 272k context, 5,440 tokens; every description is cut evenly. Nothing logs the cut. |
| Hermes v2026.9.24 (one-shot) | 342 | cut at 60 characters | 9 hidden by the skills' own conditions. Hermes also lists 53 of its own bundled skills; 41 names appear twice. No count limit. |
| QM main@90e4ced7 | 343 | none | Descriptions would need 33,664 characters against a 12,000 budget, so QM drops them all; names alone fit (6,708). 8 connector skills are hidden unless their provider is configured. |

## Arms

- **native**: shipped loading with the catalog installed. The resolver runs in shadow mode every turn (logs its suggestions and block, injects nothing), so false suggestions are paired.
- **resolver-on**: the pinned resolver's block pushed every turn through the harness's hook. OpenClaw: plugin `before_prompt_build`. Claude Code and Codex: their own `UserPromptSubmit` lane, separate from the gbrain turn-rule hook. Hermes: `pre_llm_call` shell hook with its allowlist entry. QM: two arms, below. Native loading is unchanged.
- **QM pull via sandbox tool (QM refuses private-address MCP)**: a deployment-layer tool (`tools/<id>/tool.json`) whose command runs `gbrain skills resolve --input-json - --json --fail-open --expect-catalog <hash>`, called by the model through `execute`. Not MCP: at 90e4ced7 QM's MCP client connects only over HTTP to a URL with no stdio transport (src/mcp/mcp-client.ts:99-125) and every connection goes through `publicFetch`, which refuses private addresses from a fixed list with no allowlist (src/util/network.ts:7-39). A keyless check must show the tool is visible, a call returns the schema_version 1 object, and the fail-open path returns an empty block; if it fails, this arm is dropped and the reason recorded here (internal-task, 2026-11-08). **Check passed 2026-11-08 on both providers, keyless, against a stand-in binary at the same command line** (`scripts/skill-resolver/step0/qm/pull/qm-pull-check.ts`): the tool hint sits in the system prompt under "## Deployment tool hints" (src/core/orchestrator.ts:1232-1234); a scripted `execute` call reached the binary with the exact argv and `GBRAIN_SKILLS_NO_AUTOREBUILD` set; the next request carried the printed object byte for byte; an index error returned exit 0 and an empty block. QM's local sandbox backend never installs a layer tool's files (src/wiring.ts:791-795, unlike the other backends at :809 and :887) and the layer carries UTF-8 text only (src/deployment/load-layer.ts:210-219), so the shim, the catalog pin and the gbrain binary are baked into the sandbox image; `tool.json` still declares them. The check reruns with the pinned gbrain: done 2026-11-09 with v0.60.633.0 (`qm-pull-check.ts --gbrain`), all four cells pass, and qm-arms-check's pull cells pass on both models.
- **QM emulated push**: the adapter prepends the resolver block to the turn message (QM has no per-turn context hook at this pin: src/decisions/hooks.ts; Pi runs with `noExtensions`, `noSkills`, src/agent/agent-run.ts:633-641). Labelled "emulated hook".
- **names-only**: each description set to the skill's name, plus each harness's limit raises: OpenClaw `maxCandidatesPerRoot`, `maxSkillsLoadedPerSource`, `maxSkillsInPrompt` 1000 and `maxSkillsPromptChars` 1,000,000 (313 listed, 36 gated by missing binaries or env, 2 `disable-model-invocation`); Claude Code `SLASH_COMMAND_TOOL_CHAR_BUDGET=100000` (349); Codex `[skills] max_context_tokens = 10000` (351); Hermes has no limit setting (342, catalog transform only). Skipped on QM: it lists the same 343 names in the same order with or without descriptions.
- **usage-ordered top list** (set R only): the private catalog ordered by SKILL.md reads across all sessions on the box (2,887 reads over 206 skill-and-root entries. By skill name that is 187 skills: 172 are in the 734-skill catalog and 15 are no longer in it. The arm installs the top 150, OpenClaw's own `maxSkillsInPrompt` default, and ties are broken by name order. The set R private preregistration gives the list's hash). Only 11 reads are from the owner DM, too few to rank anything, so the all-session counts are used.
- **no-catalog** (task phase): no catalog, bundled loading off where config allows (OpenClaw `allowBundled`, Claude Code `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, Codex `[skills.bundled] enabled = false`, Hermes `HERMES_HOME/.no-bundled-skills`, QM `SKILLS_SEED_DIR` missing and `PLUGIN_SKILLS_DIRS=false`). Remaining bundled or system skills are recorded. This is the fit floor (R48) and the no-gstack analogue (R44).
- **QM housekeeping (every QM cell, Phase B and task phase):** QM's own session-title call keeps its shipped default and is listed in the cell's `utility_models`, as earlier QM cells do (2026-11-03-qm-c4-told-live): `anthropic:claude-haiku-5-5` on Opus cells, `openai:gpt-5.6-luna` on Sol cells. The proxy forwards and meters it under `usage.by_model`; it is labelled "harness housekeeping, shipped default" and never scored. The allowlist admits that model for any request, not the title call alone: no existing mechanism restricts it to one call.

## Resolver contract (internal-task, rounds 1 and 2)

- Index in `<GBRAIN_HOME>/skill-index/`, written only by `gbrain skills index build`, never by `gbrain setup`, so gbrain/build-install.ts's exact file lists and HE-GBRAIN-007 are not tripped.
- Every call: `--fail-open` (library `failOpen: true`), `--expect-catalog <receipt catalog_hash>`, `GBRAIN_SKILLS_NO_AUTOREBUILD=1`. Dedupe is session-wide (a skill suggested once in a session is not suggested again). top_k and the ranker are frozen by the pin. Usage errors exit 2 and the wrapper absorbs them.
- **INFRA, reported, intention-to-treat:** any turn with `meta.index_stale: true`, a CATALOG_MISMATCH, or an `index_hash` or `gbrain_version` that differs from the build receipt (a mid-run gbrain upgrade changes the index without changing catalog_hash), or a block whose bytes are not in the captured request.
- **Ranking, gateless (internal-task, schema_version 1, after round 2):** BM25F over name, description and the first 4 KB of the body, in D and T variants with constants frozen by the release; `ranker` is {id, version, variant, k}. There is no score gate: `no_skill` is true only for a known acknowledgement ("ack") or when nothing matches ("no_match"). So the resolver is expected to suggest on most no_skill_needed turns, and false suggestions are a headline secondary (Endpoints).
- **Block budget:** 2,000 tokens per session. After that the block is empty and `budget_exhausted: true` until compaction. `budget_exhausted` and `no_skill` (with its reason) are recorded on every turn's status line; a turn with an empty block because of the budget is not INFRA.
- **Paced budget:** k drops from 5 to 3 once half the 2,000 tokens is spent and to 1 at 80 percent. After the halfway point only turns with a name, trigger or routing match spend budget. A skill can be suggested again on a strong top-1 match 10 or more turns after it was last suggested, and an explicit skill name bypasses no-repeat. Every turn's status line records k, the block's reason and the budget phase (under half, half to 80 percent, over 80 percent, exhausted), so footprint and false-suggestion numbers are also reported split by budget phase.
- **Shadow mode** keeps its own state namespace and commits under the same delivery rule as on mode. **Preflight (keyless, on the pinned build, every shard):** one fixed transcript replayed in shadow and in on mode must give byte-identical block sequences; a mismatch makes that shard's resolver and native cells INFRA until fixed.
- Block lines carry the load selector `id`, plus the path for Codex (the kit's catalog copy under `/opt/skill-resolver`, see Deviations). The footprint check is sized on the blocks the pinned build emits.
- internal-task still had one eng review of this delta open on 2026-11-08, so details can change until the pin; the pinned release's receipt governs, and any difference from this section is listed under Deviations before the first counted trial.
- **Pin (2026-11-09):** gbrain release tag `v0.60.633.0` (also `latest-stable`), commit `5ad4345f56a13e275ba5d1ca3e7faabcd890cf13` (gbrain#8839), `VERSION` 0.60.633.0. Built from that commit with `bun install --frozen-lockfile` (bun.lock `5ecc6accf6dda33032af7c423817434d83bc4e3f267749a3f3481f3c0fe085dc`) and `bun build --compile --no-compile-autoload-bunfig src/cli.ts src/core/skills/resolver/hook-worker.ts` on bun 1.4.4. The release declares `"engines": {"bun": ">=1.4.4"}` in package.json and its CI builds with 1.4.4, so it was not rebuilt with this repository's bun 1.4.3 (package.json `packageManager`), which is below the release's own floor. Binaries: glibc `868b52bda6088133f4d54bdf20236e962f23030a2443b3c45b97f07079aefefa` (the four push harnesses' kit and QM's sandbox), musl `ed6a1490911a312bd1836d531b72c0fc69578b42d6c175508b4a823f62b4be19` (QM's Alpine core image). The compile is not byte-reproducible (a second build of the same tree gave `9d8159f8...`), so these hashes pin this run's binaries, and the commit and lockfile pin what they were built from. The release's library bundle (`gbrain skills library --out`, run from source) is `a0997d8e38f107470256ef6dcf00e8846ea84a19a0490dc2acab8e8bed9b57e7`, the hash internal-task announced.
- Ranker {id, version, variant, k}: {`bm25f-a5`, 1, `D`, 5}; params k1 1.6, b 0.75, field weights name 2, description 1, triggers 0, routing 0, body 0.2; tokenizer `gbrain-skill-lex-v1` (from the build receipt). Block budget: 2,000 tokens per session (config.ts:18 `DEFAULT_SESSION_TOKEN_BUDGET`), at most 400 tokens per block (block.ts:14). Calibration-data hash: `calibration_split_sha256` `7b39cb156940ea522d0d7053c67a550c40ef18170df4499f2961cf163742ba76` (index-format.ts:47; the ranker constants were frozen on gbrain-evals' Step 1 dev split, not on any set here).
- Build receipt sha256 (`.gbrain/skill-index/he-skills/receipt.json` in each harness's index): OpenClaw `261490211e1c2e55ee5ced17dd2db93c9ab61a3b50e23dc127565c89a08d74ab`, Claude Code `05c255f29075621bcc03ed756a99fb345d6fa1039bed48222e5f6956f416e1ef`, Codex `b9741a75e52e6d0ef4b4cf81f89b4bdfa6d0d88e0dc26797d4e7c8b6473f0600`, Hermes `4117fc5673d325b46c92339210050437ddcaf7402a51cb9ffe9632a8bf8176ad` (OpenClaw and Claude Code indexed over their own skills root, Codex and Hermes over the kit's read-only catalog copy; see Deviations); QM's is built inside its arm images: core `f559145f1e498360d6d51c9385ccd4f553c3cfe0a46748a9ee0462828027e026` (musl build), pull sandbox `a12f2a8ab89d5df6856dc3a298d7d1f16a0fe7cd260381ed4d859d8de8735886` (glibc build), with the same catalog_hash and index_hash `88a22ffa430734af394ad9ace148134ec844137b25d4a96b9cf9703bb73acb51`. The kit's kit.json records the four push harnesses' receipts, with their index_hash values.
- The resolver kit is pinned here separately from `gbrain/pin.json`, which stays at 0.60.547.0 for the gbrain sidecar arms of other runs.

## Request sets and labels

- **Set P (public, synthetic):** 290 requests (230 skill-needing, 60 no_skill_needed) written by GPT-6.1 Sol from situations in skill bodies, never shown the skill's name or description (`scripts/skill-resolver/gen-set-p.ts`, $1.16). Split 50/50 by seed before labelling ended: dev 147, test 143. **The test half was committed by hash only** (setp-test.jsonl `b000aa09...b560`, labels-test.jsonl `4c88169b...a6ad`) and kept out of every shared location until the pin; only the dev half was used to build and check anything. Labelled synthetic in every table.
- **Set R (private, decision 1A):** 300 of Garry's own Wintermute DMs from one Telegram session (2026-09-17 to 2026-11-07) and the box's 734-skill catalog. Frozen by hash only (DELETE-AFTER `2a376120...`, catalog.jsonl `c7822bcf...`, setR.jsonl `38664f32...`, skill-reads.tsv `dde89758...`, skills-index.tsv `dbc706c0...`, stats.json `282d769f...`, MANIFEST `9a6813a8...`). The files never enter the repository. Reported as one user's real-turn check, not a sample of users; aggregates only.
- **Labels** (`scripts/skill-resolver/label-set.ts`): a judge sees one request and the catalog (every name and description), never what any agent read. Pass 1 gives no_skill_needed or up to 8 candidates; pass 2 sees the candidates' SKILL.md (first 4,000 characters) and returns the acceptable set. Set P: Opus 5.5 and GPT-6.1 Sol, a third Opus pass where they disagree (flag agreement 99.7 percent, mean Jaccard 0.82, 95 reconciled); 289 of 290 labelled (p-s-169: Opus returned an empty response twice; dropped and reported). Set R: Opus only, descriptions only (no bodies exported); 300 labelled, 26 no_skill_needed, mean 2.2 acceptable skills. Set P also has GPT-6 Astra labels, which score every Claude cell (see Judge).
- Hashes of every set file and label file are in [SETS.md](SETS.md).
- **Set T (graded tasks, public):** 48 tasks under `tasks/skill-resolver/T/` (format in its README), each targeting one distinct catalog skill (hermes 28, gstack 9, openclaw 7, qm 4, in proportion to the packs) with the target's SKILL.md sha256 recorded. Checks are declarative (exists, regex, order, json, frontmatter); Used it is the set of checks that carry the skill's own marker words, which the request never contains. `scripts/skill-resolver/check-set-t.ts --catalog <dir>` prints `SETT_OK n=48 hash=15e68064eac3ab0d44671506e3eb47ff0b96c28e10fbb18b0632c625325d40f2`: every oracle passes; doing nothing fails Used it; a hand-written obvious attempt without the skill fails Used it and passes every other check, so it is a fair attempt. Request overlap with the target's name and description (bins none 0, low up to 0.05, mid up to 0.12, high above): 13, 20, 14, 1. Results are stratified by that bin, with body coverage (share of request words in the skill body, up to 0.75) reported beside it.
- **Set T limits, flagged before the run:** the distinctive step may be guessable without the skill in t09, t23, t26, t35, t40 and t46; Used it is strict enough to fail a correct non-skill method in t22, t38, t42 and t48; t32's skill asks the user before writing and t34's saves under home by default, so both can stall or miss in a one-shot harness. These tasks stay in and are reported as a group; the no-catalog arm's pass rate on them is the check.

## Endpoints

- **Got the skill:** the trial opened an acceptable skill (OpenClaw `skills_read` or a SKILL.md read; Claude Code Skill tool or SKILL.md read; Codex a SKILL.md read or `$name`; Hermes `skill_view` or a SKILL.md read; QM `skills` read or a SKILL.md read), from the request capture and tool trace. Phase B trials stop at 6 model requests.
- **Denominator per harness:** skill-needing requests with at least one acceptable skill reachable in that harness ([reachable.json](reachable.json), built by `scripts/skill-resolver/reachable.ts` from the Step 0 summaries: every catalog skill the harness loaded and did not hide). Resolver arms share the native set, because the index holds only what the harness installed; names-only uses its own set and is also reported on the native set. Reachable counts: OpenClaw 186 native and 313 names-only, Claude Code 349, Codex 351, Hermes 342, QM 343. Excluded requests are counted per harness, and the share of skill-needing requests with no reachable acceptable skill is reported as a cost of each harness's native loading (OpenClaw's discovery cut lands here: the resolver cannot suggest a skill OpenClaw never loaded).
- **Primary (one test):** resolver-on minus native on Got the skill, pooled over the 8 cells, paired per request, clustered by request (`runner/stats/paired.ts` clusteredPairedDelta, and exact McNemar on discordant pairs), two-sided alpha 0.05; significant means both the clustered sign-flip p and the exact McNemar p are at most 0.05 (`scripts/skill-resolver/analyze.ts`, seed 20261108, 10,000 draws). Claim: at least 10 points and significant. The primary runs on set P; set R is reported separately as one user's check. **QM's resolver-on arm in the primary is the emulated push**, the arm that matches the other harnesses' per-turn block; the pull arm is reported on its own. Sensitivity: the same contrast on the sealed test half only.
- **Duplicate requests:** set P has 8 groups of rows with identical request text (20 rows; 6 groups cross the dev and test halves), found after it was sealed. The set is unchanged. Each group is one cluster (`request_duplicate_groups` in prereg.json, passed to analyze.ts with `--duplicate-groups`), so the sign-flip p and the interval do not count a repeated text twice. McNemar still counts pairs, so it is slightly anti-conservative on these rows. Set R has 11 such groups (46 rows); they sit in its private preregistration by id and are clustered the same way. A cross-half duplicate means the test half is not fully unseen by anything tuned on dev; nothing in this design is tuned on set P dev rows except the footprint transcript, which measures size, not accuracy.
- **Secondary (Holm over 5 harnesses, on the clustered sign-flip p):** per harness, pooled over its models. Per cell: descriptive, with intervals.
- **Against names-only and usage-ordered:** TOST equivalence, margin 10 points, pooled per harness. Without equivalence the report says "could not tell apart", never "not needed".
- **False suggestions (headline secondary, per arm):** for every arm where the resolver runs (resolver-on, QM emulated push, QM pull when called, and native's shadow log), (a) the share of no_skill_needed requests that get a non-empty block, with a Clopper-Pearson interval, pooled, per harness and per budget phase, on and off (shadow) side by side, and (b) reads of a suggested skill outside the acceptable set per turn with a block. Preregistered bars: (b) at most 1 in 10; (a) at most 25 percent. The gateless contract makes (a) likely to fail; the result is reported as measured, never softened, and it feeds internal-task.
- **Task phase:** native vs resolver-on vs no-catalog on set T (48 tasks, 1 repetition, all 8 cells): Used it and Success, pooled paired; per cell descriptive. Resolver-on vs native on Success is a TOST at a 10-point margin. That margin is below this phase's planning MDD once tasks are treated as clusters (14 to 19 points, see Power), so the TOST is likely to read "could not tell apart". **internal-task's bar (task pass with the resolver at least the pass without it minus 2 points) is out of reach here:** a 2-point margin needs about 18 times as many pairs (roughly 7,000), so this run cannot certify it either way and the report says so. internal-task accepted this design on 2026-11-08: false-suggestion rates on and off, the task-pass difference with its interval, and the TOST at the margin this run's power supports.
- **Context footprint:** tokens added per session at turns 1, 10 and 50 per arm and harness, keyless on the fakes, then one paid 50-turn Opus session per harness on resolver-on. The 2,000-token session budget is expected to show as a cap by turn 50; the turn where `budget_exhausted` first becomes true is reported per harness.
- A null or negative result gets a "Why null?" section and a KEEP, FIX-METHOD or CUT-CANDIDATE line (R48, R61).
- **Every comparison (R78):** paired, with its 95% interval, the number of pairs, the number that got worse, and the minimum detectable difference at 80% power from its own interval. An interval that includes zero reads "no measurable difference".

## Judge (R78, as amended by Garry on 2026-11-08: "Use Astra vs opus")

- **What is judged:** Got the skill and the false-suggestion rates are scored against judge labels (the acceptable set and the no_skill_needed flag). Set T's Success and Used it are declarative checks (`check-set-t.ts`) and need no judge. Offline hit@k and the resolver receipt checks are mechanical.
- **Cross-family labels:** a cell is scored with labels from the other family. **Claude cells (every Opus cell) use the GPT-6 Astra labels; GPT cells (every Sol cell) use the Opus 5.5 labels.** No cell is scored by its own model family. The Opus-plus-Sol panel labels (above) are reported as a sensitivity row.
- **Astra labels:** `label-set.ts --judges astra`, the same two passes and prompt as the Opus and Sol labels, on all 289 labelled set P rows, both halves (run `harn52-setp-astra-1`, reasoning effort low, responses cached, the catalog listing sent as an explicit prompt-cache prefix). 290 rows labelled (p-s-169 included; it has no Opus or Sol label, so it stays out of every scored set), 60 no_skill_needed, mean 2.27 acceptable skills. Against the other labels on the 289 shared rows: Sol flag agreement 100 percent and mean Jaccard 0.95; Opus 99.7 percent and 0.80; panel 99.7 percent and 0.84. Astra's sets sit much closer to the other GPT judge than to Opus, which is the family effect this rule guards against. Hash in [SETS.md](SETS.md); the test half's Astra labels stay out of every shared location until the pin, like the other test-half labels.
- **Judge check, before any judged number counts** (`scripts/skill-resolver/judge-check.ts`): 120 outputs, each one (request, skill) pair meaning "an agent opened this skill for this request", from set P dev rows only. The pilot's opened pairs go first, then a seeded draw (seed 20261108) split evenly over skills a label accepts, candidates a judge rejected, and the resolver's top suggestion on rows every label source calls no_skill_needed (from the trial records' pushed blocks and shadow logs; amended 2026-11-10, see Pilot). GPT-6 Astra and Opus 5.5 each grade every pair from the request and that one SKILL.md (first 8,000 characters). **A pair is gold only when both agree.** Each label source (Astra, Opus, Sol, panel) is scored against gold: catch rate on bad outputs, false-fail rate on good outputs, Cohen's kappa. These three numbers are printed next to every judged result.
- **Gate:** Got the skill and the false-suggestion bars gate a verdict only if the check has at least 40 gold outputs and every label source the primary uses (Astra for Claude cells, Opus for GPT cells) has kappa at least 0.6. Otherwise those numbers are reported as descriptive and the claim is not met, whatever the p-values say.
- **Limit, said up front:** the two graders are the same models as two of the label sources, with a different prompt (one skill and its full body, no catalog listing). Garry labels a sample only if this eval becomes a public post.
- **Set R:** its text goes to Anthropic only (decision 1A), so Opus labels score Opus cells. Every set R number is descriptive, one user's real-turn check, and never gates a verdict. No set R text goes to Astra or any other provider.
- **Recorded on every result:** analysis.json carries the label source model per cell family, the judge-check figures and whether they gate the verdict. Model ids are the provider ids sent (`openai:gpt-6-astra`, `anthropic:claude-opus-5-5`), with the run's price file date.
- **Also adopted:** a held-out split no tuning sees (set P's test half, sealed by hash); cached judge calls (every label and grade response is cached by prompt hash); pass^k: set T runs one repetition per task unless the pilot sets more, and with k of 2 or more, pass^k (all k repetitions pass) is reported per cell as descriptive.

## Offline phase (Phase A, keyless rankers)

`scripts/skill-resolver/offline-rankers.ts`, hit@k and MRR against the frozen acceptable sets. Dev half of set P and set R are done; the test half and the pinned resolver arm run after the pin.

| Arm | P dev hit@5 (n=115) | R hit@5 (n=274) |
|---|---|---|
| name order (OpenClaw and QM no-query order) | 0.01 | 0.06 |
| OpenClaw skills_search scoring (imported from its dist) | 0.77 | 0.43 |
| QM word-overlap search | 0.31 | 0.30 |
| BM25 name and description | 0.31 | 0.46 |
| BM25F name, description, body | 0.68 | 0.41 |
| bge-small-en-v1.5 embeddings | 0.49 | 0.36 |
| BM25 plus embeddings (RRF) | 0.48 | 0.49 |
| pinned GBrain resolver (v0.60.633.0) | 0.78 | not yet run (set R's private run) |

internal-task's own offline result (gbrain-evals#388, theirs, not this run's): BM25F beat the best static list by 15, 24 and 40 points of hit@5 at 250, 750 and 1,500 skills, and their lexical no-skill gate failed, which is why the release is gateless.

**Set R column regenerated (2026-11-10, before any counted trial).** The first set R column ranked each turn's message alone, but the labels judged the previous message plus the current one. The rankers now rank the same composed text the runner and the judge use. Rerunning the old request-only rankers on the same inputs reproduced the old column exactly, so these shifts come from the text change alone: OpenClaw scoring 0.42 to 0.43, QM search 0.29 to 0.30, BM25 0.39 to 0.46, BM25F 0.37 to 0.41, embeddings 0.39 to 0.36, RRF 0.45 to 0.49, name order unchanged. Set P's column is unchanged. No cell, lease, endpoint or bar changed.

Set P's requests were written from skill bodies, so arms that read bodies (OpenClaw scoring, BM25F) may be favoured there; set R has no such link.

The resolver row (2026-11-09) is the pinned binary's own turn output: one fresh call per dev request (no session, so no pacing or dedupe), `--top-k 8`, on the Claude Code index, ranked by its suggestions. Set P dev: hit@1 0.50, hit@3 0.74, hit@5 0.78, hit@8 0.82, MRR 0.61, n=115; 143 of the 147 calls returned 8 suggestions (3 returned 1 and 1 returned 3). The other rows were recomputed in the same run and did not change.

## Pilot (uncounted, 2026-11-10)

Run id `skill-resolver-pilot-2026-11`, config `pilot.json` (80fafe7b14). It covered 40 set P dev rows in each of 4 cells: OpenClaw on Opus 5.5 and Hermes on GPT-6.1 Sol, each native and resolver-on, 160 trials in all. It ran on gbrain v0.60.633.0 on one Capy machine, with the two harnesses running in parallel, and the smoke ran p-s-202 first, out of manifest order. No pilot number counts toward a verdict.

- **INFRA:** 0 of 160.
  - index_stale was false on every trial, and the index_hash and gbrain_version matched the kit receipts.
  - Every pushed block was found in a captured model request, and no shadow block leaked. That check was added to the runner after the pilot showed it was missing (28a58ea818).
  - 4 upstream requests failed (3 connection resets, 1 HTTP 520 with no usage), all in resolver-on trials. The harness retried each one, but each failure still used one of the 6 allowed requests. None is INFRA by this file's definition.
- **Opened an acceptable skill.** Opus cells are scored with Astra labels and Sol cells with Opus labels. The OpenClaw denominator follows the reachable rule: 7 of the 32 skill-needing rows have no acceptable skill OpenClaw loads, so they are dropped.

  | Cell | n | Native | Resolver-on | Better | Worse |
  |---|---|---|---|---|---|
  | OpenClaw Opus | 25 | 40.0% | 40.0% | 5 | 5 |
  | Hermes Sol | 32 | 50.0% | 65.6% | 5 | 0 |

  Pooled, resolver-on minus native is +8.8 points [-1.6, +18.9].
- **False suggestions:** the resolver produced a block on 8 of 8 no_skill_needed rows in every cell, pushed and shadow. That fails the 25 percent bar, as the gateless design predicted. The counted run keeps the pinned gateless default (internal-task-a, 2026-11-10). The numbers went to internal-task-b, marked uncounted, for gbrain's min_match default.
- **Off-target reads of a suggested skill:** 1 of 40 block turns in each resolver-on cell (bar: 10 percent).
- **Cost per trial (ledger mean):**

  | Cell | Native | Resolver-on | Resolver-on, net of kept reservations |
  |---|---|---|---|
  | OpenClaw Opus | $0.122 | $0.277 | $0.133 |
  | Hermes Sol | $0.087 | $0.172 | $0.086 |

  Kept reservations were $9.19 in all: $5.76 on OpenClaw and $3.43 on Hermes. Mean input per trial was 146k to 159k tokens, and the most in any trial was 236k. Mean output was 473 to 1,665 tokens, and the most in any trial was 12,894. That is above the 6,000-token planning ceiling, which only prices the manifest's ceiling and stops nothing.
- **Leases:**
  - Lease 1 ($250) was opened without `--max-output-tokens`, so the proxy's 32,768 output cap was recorded with it. OpenClaw states 128,000 on every Opus call, so both OpenClaw smoke calls were refused before they were forwarded. A lease can be rejoined only with its recorded cap, so it was closed after $0.1527 (all Hermes smoke calls). No ledger record was edited.
  - Lease 2 ($249.84, 128,000 cap) carried the pilot and both judge-check passes: $31.3661 committed.
- **Judge check (`judge-check.ts`, 120 pairs):** 30 opened by agents, 45 accepted and 45 rejected candidates. There were 102 gold pairs, and the grader agreement kappa was 0.70.

  | Label source | Kappa | Catch rate | False-fail rate |
  |---|---|---|---|
  | Astra | 0.715 | 79.1% | 8.5% |
  | Opus | 0.768 | 100% | 20.3% |
  | Sol (sensitivity) | 0.780 | 88.4% | 10.2% |
  | Panel (sensitivity) | 0.843 | 100% | 13.6% |

  The gate is met: at least 40 gold pairs, and kappa of at least 0.6 for both sources the primary uses. The first pass drew 0 pairs from the "top candidate on no_skill_needed rows" pool, because labels carry no candidates on those rows, so its 40 slots went to the accepted and rejected pools. The sampler now takes the resolver's top suggestion on rows every label source calls no_skill_needed, from pushed blocks and shadow logs, deduplicated by (request, skill), with the same seed (f3bcab5d41). A second pass graded only that pool: 8 pairs, because the resolver's top pick was the same in all 4 cells, at $0.2485. Both graders called all 8 wrong, and every source caught 8 of 8. That pool alone can't measure a false-fail rate, and its kappa is degenerate. The first pass's files were unchanged (sha256 checked).

  Both passes together (128 pairs, 110 gold: 59 good, 51 bad; grader kappa 0.722):

  | Label source | Kappa | Catch rate | False-fail rate |
  |---|---|---|---|
  | Astra | 0.743 | 82.4% | 8.5% |
  | Opus | 0.784 | 100% | 20.3% |
  | Sol (sensitivity) | 0.799 | 90.2% | 10.2% |
  | Panel (sensitivity) | 0.855 | 100% | 13.6% |
- **Clean arm:** the preflight found gstack in the images only inside the eval's own catalog copy (14 paths per image), and no Capy drive or gstack install in any trial mount. The pilot skipped the post-run audit, because the runner deletes the agent traces it reads. Counted trials record their own count of gstack reads outside the catalog before the traces go (e45a6c0896): `skill_request.clean_arm` carries gstack_reads, paths and contaminated, and any non-zero count marks the trial contaminated. **Limit:** on OpenClaw, Hermes and QM, the count misses a last tool call whose next request the 6-request cap refused. Refused requests aren't collected, and those harnesses' traces aren't parsed for tool calls.

## Power

Filled in from the uncounted pilot (2026-11-10, see Pilot). The minimum detectable difference at 80 percent power is MDD = z x sqrt(d x f / n), where:

- z is 2.80 at two-sided 0.05, or 3.42 at the Holm-adjusted 0.01 used for per-harness and one-cell rows;
- d is the pilot's discordance (the share of requests where the two arms disagree): OpenClaw Opus 0.40 (n=25), Hermes Sol 0.156 (n=32), mean 0.278;
- n is the number of request clusters, with duplicates merged;
- f is 1 for one cell, (1+rho)/2 for a two-model harness and (1+7 rho)/8 for the pooled 8 cells. rho is the within-request correlation of the cells' differences, 0.3 to 0.7 as planned. The pilot's own estimate of rho, -0.52 from 25 shared requests, is too noisy to use.

| Contrast | Clusters | Alpha | MDD (points) |
|---|---|---|---|
| Primary, set P, 8 cells pooled | 221 skill-needing requests | 0.05 | 6 to 9 |
| Sensitivity, test half, pooled | 113 | 0.05 | 9 to 12 |
| OpenClaw (two models) | about 178 with an OpenClaw-reachable acceptable skill | Holm 0.01 | 13 to 15 |
| Hermes, QM (two models), Hermes-like discordance | 221 | Holm 0.01 | 7 to 8 |
| Claude Code, Codex (one cell) | 221 | Holm 0.01 | 9 to 15 (discordance 0.156 to 0.40) |
| Task success, set T, 8 cells | 48 tasks | 0.05 | 14 to 19 (planning figure; the pilot ran no set T trial) |

**What this means:**
- The pooled primary can detect the 10-point bar.
- OpenClaw's per-harness row cannot detect 10 points. Its 40 percent discordance and its smaller reachable denominator put its MDD at 13 to 15 points, above the planning range of 8 to 13.
- Set P is fixed, so n does not grow. The report gives each contrast's own MDD from its interval (analyze.ts `mdd80`), and an interval that includes zero reads "no measurable difference".
- The set T TOST at 10 points still sits below that phase's MDD, so it is likely to read "could not tell apart".

## Run, sharding and order

- **Where:** every public cell runs on Ubicloud through `scripts/ubicloud/fanout.sh`, one standard-16 VM per shard, from a worktree pinned at this file's merge commit. No cell is split across machines, and trials run one at a time within a shard. The three set R cells run on one private machine from the set R private preregistration, with a results root outside the repository, never through fan-out or merge-shards.
- **Shards (25 public):**

  | Shards | What each holds | Lease each |
  |---|---|---|
  | 4 | Opus native and resolver-on pairs: oc, qm, he, cc | $140 |
  | 4 | Sol native and resolver-on pairs: oc, qm, he, cx | $110 |
  | 3 | Opus names-only cells: oc, he, cc | $70 |
  | 3 | Sol names-only cells: oc, he, cx | $55 |
  | 2 | qm-pull cells | $70 (Opus), $55 (Sol) |
  | 1 | Set T canary: st-oc-opus-native | $32 |
  | 8 | The other 23 set T cells, grouped by harness and model: st-oc-opus resolver-on and no-catalog, then 7 triples | $32 per cell until the canary resizes them |

  A pair shard runs its two cells interleaved by request, in this file's `order`, so both arms of a pair see the same upstream conditions.
- **Output cap:** every shard runs with `--max-output-tokens 128000`, run-shard.sh's default. Every harness here states 128,000 output tokens on every model call: OpenClaw, Hermes, Claude Code, Codex and QM, in both providers' Step 0 captures. So each harness's own maximum is 128,000. A direct `runner/run.ts run` without the flag gets the proxy's 32,768 and every call is refused, which is what happened to the pilot's first lease.
- **Stages, in decision 4's order:**
  1. The canary shard, the oc Opus pair. It must finish at least one scored trial and copy its results off the VM.
  2. The other primary pairs.
  3. The names-only and qm-pull shards.
  4. The set T canary.
  5. The other set T shards.
- **Set T resizing:** after the set T canary, each set T cell's lease becomes 48 x (the canary's mean cost per trial + $0.057 kept-reservation allowance) x 1.3. The set T shards' grouping and VM time-to-live come from the canary's mean wall time (time-to-live: expected wall time x 1.5).
- **Stop rule:** if the resized projection puts the all-in total (spent so far + every lease + VMs + thread use) past $3,500, nothing more launches until internal-task has the number.
- **VM time-to-live:** each VM sets UBI_TTL_HOURS above its expected wall time plus margin. The pilot's mean wall time per trial was 80 s for OpenClaw Opus and 42 s for Hermes Sol, so an oc Opus pair takes about 13 hours and gets 18.
- **A shard that runs out of lease** stops incomplete. Its cells are reported incomplete with their n. No lease is reopened.

## Privacy

- Set R text goes only to Anthropic (Opus judge and Opus cells). Only skill names, ranks and counts leave the run; published numbers on set R are aggregates.
- `scripts/skill-resolver/leak-scan.ts` (message sha256, exact text, 8-word shingles of set R) runs over results, trials and proxy logs before every commit and in the results PR; it prints ids and paths only.

## Money

- Spent before this file: set P writing $1.16; labelling set P $31.5 and set R $109.39. About $110 of that was a fixed catalog prefix sent uncached (set R about $96.5: an 87k-token listing on 296 pass-1 calls, about $6.9 with caching; set P about $13.9: Opus had no cache marker and GPT-6.1 Sol wrote a cache entry per call under implicit breakpoints and almost never read one). Fixed in 04b8d8524d (Anthropic `cache_control`; OpenAI explicit breakpoint and `prompt_cache_key`); every later judge call uses it.
- Step 0 probes: keyless; the proxy priced the fakes' scripted usage at about $0.05 in total and no request reached a provider.
- Judge (R78): Astra labels on set P cost $13.89 ($13.39 for 494 calls, 26 response-cache hits, plus a $0.50 six-row smoke). The judge check is priced in the pilot projection (120 pairs, Astra at $10 in and $50 out per million tokens, Opus at $4 and $20; about $10 at planning token counts, responses cached).
- Pilot (uncounted): $31.52, made up of lease 1 at $0.1527 (closed, see Pilot) and lease 2 at $31.3661: trials $26.3211 (Opus $15.9864, Sol $10.3346), the judge check $4.7965 (Astra $2.9993, Opus $1.7973) and its no-skill pass $0.2485.
- **Leases (internal-task, 2026-11-10): $2,487 in total.**
  - Public shards: $2,268 (the table under Run, sharding and order). This is `spend_cap_usd`.
  - Set R's three cells: $219 ($73 each), in its private preregistration.
  - Each lease is (measured net cost per trial + $0.057 per trial for kept reservations) x trials x 1.3. The net cost per trial is $0.13 for Opus cells and $0.09 for Sol cells, from the pilot. Set T is $0.45 per trial, a guess until the canary.
  - Expected paid spend is $1,915.
- **Kept reservations are their own line.** When an upstream request fails with no usage, the ledger keeps its full reservation: input plus 128,000 output tokens, about $3 for Opus. In the pilot that was 4 failures, $9.19, 35 percent of trial spend. The report gives kept reservations as a separate line, never inside cost per trial or cost per solve.
- **All-in projection:** about $2,835 expected and about $3,407 at the lease caps. That counts about $470 spent before the counted run (paid $187.21, own model use about $283), about $150 of VMs and about $300 of remaining thread use. It is under the $3,500 internal-task trigger and the R71 guideline of $4,000. The $11,014 `spend_cap_usd` of earlier drafts was a worst-case bound, never a lease size.

## Deviations from the plan

- QM's pull arm is a sandbox tool, not MCP, and does not set `skills.resolver.mcp` or `--publish-mcp` (gbrain v1 ships no MCP resolve tool; QM refuses private-address MCP).
- Set P's test half is committed by hash and held privately rather than sealed through `scripts/seal-heldout.ts`, which handles task trees, not request sets.
- Plan table facts corrected by Step 0: OpenClaw's discovery cut (above); Hermes cuts at 60 characters, not 57; Claude Code's budget formula; Codex's cap measured.
- QM's catalog is staged with `DEPLOYMENT_LAYER=<dir>` at boot: `PUT /v1/deployment-layer` refuses it with 413 because core caps request bodies at 1,000,000 bytes (src/api/http.ts:93), and `qm up` refuses over 1 MB too.
- Set T on QM pre-creates a default sandbox, unlike other QM cells, so QM's graded workspace matches the other harnesses. For skill-tasks cells only, the runner bakes the task's start/ and instruction.md into a sandbox image at `/root/workspace` (`harnesses/qm/Dockerfile.sett`), and the adapter creates the member's sandbox from it and makes it the default through the admin API before the turn, as the gstack S1 fixture does. Each trial records `set_t.qm_default_sandbox`.

- QM runs through its adapter's run entry, one request per trial: its serve entry cannot register the world MCP server at 90e4ced7 (the same private-address guard, HE-ADAPTER-002), so QM has no multi-turn session here and its resolver sees no previous message. QM's skill-arm configs refuse serve with exit 2. In Phase B the other four harnesses get each request as one member DM on their serve entry (fresh harness, v0.1 world, the default multi-user preamble); QM gets the request alone on its run entry, with no world and no preamble. Every Phase B trial stops at 6 model requests for the cell's model (an opt-in proxy cap; `termination: request_cap`); harness housekeeping calls do not count.
- Set R trials send the same text the judge saw: "Previous message from the same user: ..." followed by "Current message: ..." when a previous message exists, so the agent, the resolver and the label share one context. Private trial records hold request ids only, no hash of any request; the run manifest records the set file's sha256.

**Pin swap, 2026-11-09 (internal-task).** The stand-in resolver (`scripts/skill-resolver/gbrain-stub.ts`) is replaced by gbrain v0.60.633.0 everywhere a cell calls the resolver: the four push harnesses' kit, QM's arm images and QM's pull sandbox. The stand-in stays in the repository for the wrapper tests and for the `-shared` fault image, which checks that the shadow replay catches a shared namespace. Differences from this file and from the plan:

- **Status-line fields the release does not print.** The release's turn output has `ranker.k`, `block_tokens`, `budget_exhausted`, `no_skill_reason` and `deduped`, but no session total, phase or block reason. The wrappers derive them (`scripts/skill-resolver/result-fields.ts`):
  - `k` is `ranker.k`.
  - `session_block_tokens` is the running sum of delivered `block_tokens` kept in trial state (`<status dir>/session-tokens.json` per mode and session for the push harnesses; the previous status line for QM). Shadow turns keep their own sum, as the release keeps its own shadow namespace.
  - `budget_phase` is `exhausted` once the release has said `budget_exhausted` or the sum has reached 2,000 in the session (it then stays `exhausted`); otherwise the phase of the sum before the turn (`under_half`, `half_to_80`, `over_80`), which is what sets the release's k.
  - `block_reason` is `error`, `ack`, `no_match`, `match` (a non-empty block) and `budget_exhausted` straight from the output. An empty block with a non-empty `deduped` is `deduped`. Any other empty block is `below_pace` when half the budget was spent before the turn (past that point the release suggests nothing when its top match has no name, trigger or routing hit, resolve.ts:326-327) and `empty` otherwise. `below_pace` is inferred: the output has no field that names pacing.
- **Shadow output.** In `--shadow` the release prints a quiet result (empty block, no suggestions) and appends the would-be result to `--shadow-log`. The wrappers pass `--shadow-log <log dir>/skill-resolver/shadow.ndjson` and read the shadow result from there, so native cells still record what the resolver would have pushed.
- **Input on stdin.** Every call passes the turn as `--input-json -` on stdin. A resolver that exits without reading stdin is judged by its exit code and stdout, not by the write error (EPIPE).
- **Freshness by stat.** The release marks a result `meta.index_stale` when any directory mtime or any SKILL.md size or mtime under the indexed root differs from the build. Copies and exported images do not keep sub-second mtimes, so the kit sets every catalog entry to 2026-11-08 00:00 UTC before the index is built (kit.json `catalog_mtime_s`), each push adapter resets the installed tree to that time after its copy, and QM's arm and pull images do the same before their in-image build.
- **Skills left out of the index.** The release skips skills whose frontmatter sets `disable-model-invocation: true` (receipt `skipped`, reason `not_model_invocable`): `land-and-deploy` and `modernize`. They stay installed in every arm, so native loading still sees them, but the resolver never suggests them. kit.json lists them per harness, and build-kit and qm-arms-check accept exactly these skips.
- **Index file modes.** The release writes the index owner-only (0700 directories, 0600 files). The kit opens it to 0755 and 0644 so the harness user in each image can copy it into the trial's state directory.
- **No budget switch.** The stand-in's `stub-budget-exhausted` switch does not exist in the release, so the per-harness budget cell is the long-transcript replay (`shadow-replay-check.ts --until-exhausted`) instead of a one-turn capture, on all five harnesses.
- **Release behaviour that differs from this file (to report to internal-task).** After the session budget is spent, an acknowledgement turn returns `budget_exhausted: false` with `no_skill_reason: "ack"`: resolve.ts:290 returns before the exhaustion check at resolve.ts:346. This file says `budget_exhausted` stays true until compaction. The block is still empty, so no tokens leak, but the replay as first written failed on that one turn on every harness (BUDGET_REPLAY_FAIL, `turn N: after the budget ran out the block is not empty with budget_exhausted`). Status lines record the release's value and that turn's `block_reason` is `ack`; the derived `budget_phase` stays `exhausted`, because the wrappers keep whether the session's budget ran out alongside its token total. The until-exhausted replay (`shadow-replay-check.ts`) was amended on 2026-11-09 to accept an acknowledgement after exhaustion with an empty block whatever its `budget_exhausted` says; any non-empty block after exhaustion still fails, as does a non-acknowledgement turn without `budget_exhausted: true`.
- **Receipt commit.** The compiled binary writes `gbrain_commit: null` into its build receipts (build.ts:70-80 looks for a `.git` directory next to the running source). The commit is pinned above by tag and by the binaries' sha256 instead.
- **Codex and Hermes index the kit's read-only catalog copy (2026-11-09).** In the first keyless arm captures every Codex and Hermes resolver turn said `index_stale: true` (INFRA), while OpenClaw, Claude Code and QM were fresh. Both harnesses write their own entries into their skills root during a session: Codex installs its system skills under `$CODEX_HOME/skills/.system` at its first `codex exec`, and Hermes writes `.hub` and `.bundled_manifest` there (its code also writes `.usage.json`, `.archive` and `.curator_*`). Any new entry changes the root directory's mtime, which the release's stat check counts as a catalog change (resolve.ts:190-199, build.ts:315-324). Reproduced on the codex image: adding one directory under the root flips a fresh index to stale, and resetting the root's mtime makes it fresh again. This is real product behaviour for Codex and Hermes users of this release: an index built over the harness's own skills root goes stale at the harness's first session, and with autorebuild off every later turn is stale. **Method used here:** the Codex and Hermes indexes are built over the kit's own catalog copy, `/opt/skill-resolver/catalog/skills`, which no harness writes to (build-kit.ts `INDEX_DIR`). The catalog is still installed in each harness's own skills root as before, and native loading reads it there. OpenClaw, Claude Code and QM keep indexes built over their own skills root, which their sessions do not write to. **Checks on this kit:** (1) Codex and Hermes native and resolver arm captures: every turn code OK with `index_stale: false`, after Codex wrote `.system/` and Hermes wrote `.hub` and `.bundled_manifest` in the same session; all six cells per harness pass. (2) Codex blocks print the kit copy's path (`/opt/skill-resolver/catalog/skills/<name>/SKILL.md`); its files are mode 0644 with the catalog's fixed mtime in the image, readable by any user, and `scripts/skill-resolver/got-skill.ts` counts a read of `<name>/SKILL.md` under either root as opening that skill, because it matches the `<name>/SKILL.md` suffix. (3) Hermes blocks carry ids only; `skill_view` loads each suggested id from `$HERMES_HOME/skills` (five ids from a capture, all `success: true`). (4) Ranking on set P dev: at top-k 5, the arm setting, the kit-copy and in-root Codex indexes give identical lists for all 147 requests, and Hermes lists are identical at top-k 8 as well; resolver hit@5 is 0.7826 either way. At top-k 8 the Codex kit-copy block holds one suggestion fewer in 42 of 147 lists, because each printed path is 6 characters longer and the 400-token block cap is reached sooner; hit@8 is unchanged at 0.8. Codex blocks average 1,167 characters against 1,133 in-root. **Hashes:** Codex and Hermes kit-copy builds share catalog_hash `368ed8a1d4b9232745cedeac8545ed645bf7450857055c709daca1a898ac0c8b` and index_hash `24e7d91b5db2a1764369a1528cf1edbace90fa1e7c8bbac9a3e8ff58ee7ace21` (same catalog, same root; `--harness` does not enter the index). The in-root builds they replace: Codex catalog_hash `023474f53e80b2b713acf3b5b1dbc67d9b3f117d8d722484a982517acb0aeaa0`, index_hash `7b622b80b2cc1e826f5c2483e6f7645ab5ee1aa1d7446ddfa2fd366a5add33e7`; Hermes catalog_hash `5272665ded9ea2fcf58368b8e9210186ec67a072fa403a11029a2fd8c231cb5d`, index_hash `8ede62c0a5b6910a32f404a6d42c41604ad46d26aecec57a0820d13381cd0209`. kit.json records both per harness (`index_dir`, `in_root_build`). **Not used: an index built from JSON** (`gbrain skills index build --from-json -`, which the release does not stat-check). A JSON snapshot cannot reproduce the directory build's catalog_hash at this release: the most faithful Codex snapshot (every field the JSON schema takes, from the release's own directory reader, full file text as body) is `b1a844873c0a0893bcbd8a6de3ac646a6eaf780220d8aaf1a420f6789b89212f`, and the release's `catalogHash` over the directory records gives that value only once `dynamic-workflow`'s `when_to_use` text and the two `not_model_invocable` skip records, which the schema cannot carry, are removed. On set P dev that snapshot index changed 8 of 147 top-8 lists and resolver hit@5 from 0.7826 to 0.7739 (one request).

## Results PR

A separate pull request after this one merges and the run ends (R77). The report opens with 2 or 3 bullets of the form "We learned X. You should do X." (R79), each tied to a number in this file's endpoints. The finding file ends with the R55 disclosure lines word for word for OpenClaw, OpenAI, Hermes, QM, gstack and gbrain.

## Amendments

None.
