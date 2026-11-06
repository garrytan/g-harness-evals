# gstack on QM

**Raw gstack does not import into QM at `b6786d67`.** QM refuses the pack at its 32 MiB byte cap, so the plan's S1 probe uses gstack's paste-in router instead. The smoke, the staging run and the probe driver's dry run below are keyless and cost $0.

This folder holds five things:

- **internal-task overlay** (`Dockerfile`, `adapter.sh`): an image that runs `gstack-harness register qm` before the counted adapter. Unchanged here.
- **internal-task M1 step 6 scripts** (`smoke.ts`, `s1-stage.ts`, `qm-stack.ts`, `Dockerfile.skills`): the skill-pack smoke and the S1 probe fixture, with receipts in [receipts/](receipts/).
- **S1 probe driver** (`s1-probe.ts`, `s1-count.ts`, `s1-fixture.ts`): the two-arm probe, below.
- **S1 edition rerun driver** (`s1e-probe.ts`, `s1e-count.ts`): the internal-task rerun of S1 with a QM-native edition, at the end.
- **Edition fixtures, graders and analysis** (`edition-fixture.ts`, `edition-grade.ts`, `edition-analysis.ts`): the keyless task generator, graders and frozen analysis for that rerun, below.

## Smoke: register, catalog, import

**Outcome: registered, then refused.** QM recorded `pack exceeds max bytes (33554432)` in `lastImport.error` ([receipt](receipts/smoke-b6786d67.json)).

- gstack `1.91.345.0` at `21277291c850765052ea9f80f6be4ccf1f1eb191` (gstack main on 2026-10-31) has 4,413 regular files, 74.9 MiB. QM's caps are 5,000 files and 32 MiB (`src/skills/pack-fetcher.ts:156-157`). So the byte cap fires, not the file cap.
- The 60 s clone timeout (`pack-fetcher.ts:155`) did not fire. The register call took 29.5 s, clone and tree walk included.
- `POST /v1/admin/skill-packs` answers 200 with the pack. Its fetch failure lands in `lastImport` (`src/api/app-skills.ts`, `registerSkillPack`).
- `GET /v1/admin/skill-packs/:id/catalog` and `POST /v1/admin/skill-packs/:id/import` answer a bare 500 `internal server error`. The reason is only in core's log and in `lastImport.error`, which the smoke reads back from `GET /v1/admin/skill-packs`.
- The request body is the one gstack's own QM target sends (`lib/harness-qm.ts`): `{url: "https://github.com/garrytan/gstack", ref, config: {skillGlobs: ["*/SKILL.md"]}, trustTier: "third-party"}`. `skillGlobs` does not help: QM reads the whole tree before it applies globs.

Run it:

```bash
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/smoke.ts
```

| Input | Default | What it is |
|---|---|---|
| `--gstack` | `~/.local/share/gstack` | A git checkout of gstack, used to size the tree |
| `--ref` | the checkout's HEAD | The commit QM is asked to import; must exist on GitHub |
| `--out` | `<work>/smoke-b6786d67.json` | The receipt. Pass `--out harnesses/qm/gstack/receipts/smoke-b6786d67.json` to replace the committed one |
| `--work` | `~/.capy/work/qm-gstack-smoke` | Stack state, core log, fake model log |
| `--core-url`, `--secret-file` | none | Use a running throwaway core instead of starting one. The receipt then records the QM commit as `null`, and the registered pack stays on that core |
| `--core-port`, `--pg-port` | 58080, 55432 | Host ports for the rig stack |

- **Needs:** Docker, `harness-eval/qm:dev` built from [../Dockerfile](../Dockerfile), and GitHub reachable from core.
- **Starts:** Postgres and core from [../compose.yaml](../compose.yaml), with a dummy model key and the fake Anthropic endpoint (`scripts/gsta-135/fake-anthropic.ts`). The fake refuses any key that does not start with `sk-ant-capture-dummy`.
- **Writes:** every response, the outcome, `refusal_kind` (`bytes_cap`, `files_cap`, `clone_timeout`, `other`), core's skill-pack log lines and the fake's request count (0 here).
- **Tears down:** pg, core and only the sandboxes this run created: the `machineId` QM returns, or, when a create call returns none, only a new sandbox whose name carries the sandbox id that call returned (`attributeSandboxes`). Any other new sandbox stays in place, with a `qm-stack: left sandbox` line on stderr, so a concurrent run's sandbox is never removed. Ctrl-C or SIGTERM tears down too.
- **One run at a time:** a lock per work directory, project name and port refuses a second run while the first is alive. Don't run it on a host with live trials anyway: a trial's `capture.sh` collects every `harness-eval` sandbox it finds.
- **Exit:** 0 when the pack registered, whatever QM refused after that.

## Bun in QM's production sandbox

**No.** Nothing that builds a QM sandbox image at `b6786d67` installs Bun.

- `deploy/e2b/e2b.Dockerfile` is the E2B sandbox's only source (`docs/e2b-template.md:33-35`, fed to the Template SDK by `scripts/e2b-build-template.ts:20`). It installs:
  - apt packages, none of them Bun (lines 4-8);
  - Claude Code 2.1.210 and Codex 0.144.4 through npm (lines 11-15);
  - gh (17-24), AWS CLI (26-33), a Python venv (35-38) and `x-api` (40-41).
- `fly/Dockerfile`, `local/Dockerfile`, `cli/templates/aws/microvm-agent/Dockerfile`, `deploy/do-managed-agents/Dockerfile` and `superserve/templates/qm-agent.ts` have no `bun` either. In `src/`, `deploy/` and `skills-seed/` the word appears only in the vendored `src/deploy/vendor/devbar.js`.
- Built and checked on 2026-10-31: `command -v bun` finds nothing in an image built from `e2b.Dockerfile` at `b6786d67`, nor in the rig's `harness-eval/qm-sandbox:dev`.
- Not checked: E2B's published `qm-sandbox:v1.0.0` template, which needs an E2B key. Its docs say it has the same tools as `fly/Dockerfile` (`docs/e2b-template.md:5-7`).

## S1 probe staging

**Outcome: one keyless complete skill read.** The model asked for `careful/SKILL.md` and got all 4,727 characters back, byte for byte ([receipt](receipts/s1-staging-b6786d67.json)).

### What gets staged

- **Skill texts:** the 62 `SKILL.md` paths the router names, plus gstack's root `SKILL.md` that its context block names. The 62 are 61 skills plus `connect-chrome/SKILL.md`, a symlink that gstack's setup creates as an alias of `open-gstack-browser` and that is not in git. A QM built from the gstack tree alone would answer that path with no file. Each is read with `git show 21277291c:<path>`, and the script refuses a checkout that differs from that commit.
- **Where:** `/root/workspace/gstack/<skill>/SKILL.md`, inside the sandbox workspace. QM's `files` tool reads only workspace paths (`src/tools/primitives.ts:972-973`), so paths outside it would be a wrapper refusal.
- **How:** [Dockerfile.skills](Dockerfile.skills) builds `harness-eval/qm-sandbox:gstack-21277291` from the rig sandbox image. Docker copies the image's `/root` into each new scope volume, so every sandbox QM creates starts with the files.
- **One fixture fix:** `connect-chrome` is a symlink gstack's setup creates (to `open-gstack-browser`), not a file in git. The router lists it, so staging follows the symlink rather than leaving a missing file.
- **Sandbox:** a member's scope has no default sandbox until one is created ([../smoke-b6786d67.json](../smoke-b6786d67.json) `first_try`). The fixture creates one and sets it as default through `POST /v1/admin/sandboxes/personal:U1`, so a missing sandbox cannot pass as zero use.

### Where the router goes: the org SOUL

**Pick: `PUT /v1/admin/scopes/org:<org>/soul {content}`.** The router is the output of `gstack-harness register generic --print` from the installed gstack, with every path pointed at the staged copies ([receipts/s1-router-21277291.md](receipts/s1-router-21277291.md), 12,186 characters).

- **Why the SOUL:** it is QM's org-wide instructions field, set by an org admin. QM puts it at the top of every turn's system prompt as `## Organization instructions` (`src/resolution/resolution-service.ts:25-34`), in every scope. It holds up to 100,000 characters (`src/api/routes/admin-resources.ts:137`). The receipt shows the router in the first model request's system prompt.
- **Not a surface briefing:** `surfaceBriefing.instructions` caps at 8,000 characters (`src/api/routes/turns.ts:60-69`), and the client surface sends it with each turn. An operator does not set it, and the router does not fit.
- **Not org floor rules:** at `b6786d67` the org floor is the command policy and security posture (`src/policy/command-policy.ts:27`, `src/security/security-posture.ts:43`). They gate commands and take no prose.
- **Not a QM skill:** org skills come only from pack import (refused above) or promotion, and a skill cannot be created directly in an org scope (`src/api/app-skills.ts:399`, `createOwnedSkill`). That is the S1 edition's route, built only if the probe shows opens.
- **Cost of the pick:** the router rides in every request of every turn, about 3,000 tokens at 4 characters per token. The paid probe should report it.
- **Paths are backend-specific:** the rig's local backend works in `/root/workspace`. E2B sandboxes use `/home/user/workspace` (`docs/e2b-template.md:47-48`), so a production router must point there.

### The keyless read

One DM turn as member `U1`. The fake was scripted to read two staged files, and its first step waited for a system prompt containing the router's `careful` line.

- **`careful` (4,727 characters): complete.** The `tool_result` the model got equals the staged file (same SHA-256 `f3dfed24...`). The stored turn (`GET /v1/admin/sessions/:id?scope=personal:U1`, entry 2) holds the same 4,727 characters.
- **`investigate` (29,581 characters): cut.** QM showed the first 8,192 and last 8,192 characters with an `[output cut: ...]` marker, and parked the full text (stored blob SHA-256 equals the staged file's).
- **Why the cut matters:** QM inlines at most 4,096 tokens times 4 characters, 16,384 characters, per tool result (`src/sessions/tool-output.ts:10-11`, `cutToolOutput`). Only 17 of the 63 staged files fit. `review`, `ship`, `investigate`, `qa` and gstack's root `SKILL.md` do not.
- **No admin route raises it:** the budget is the `tool_result_inline_tokens` row in `qm_settings`, read at `src/sessions/tool-output.ts:108`.
- **How a model gets the rest:** reading the marker's `tool-output/md5/<id>` path copies the full text onto the computer, and QM then says to read it in parts with `execute` (`src/tools/primitives.ts:952-968`).

Run it:

```bash
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/s1-stage.ts
```

| Input | Default | What it is |
|---|---|---|
| `--gstack` | `~/.local/share/gstack` | Installed gstack checkout; runs its `bin/gstack-harness` |
| `--ref` | the checkout's HEAD | Commit the texts are staged from |
| `--skill` | `careful` | The skill for the complete read; must fit 16,384 characters |
| `--over-cap-skill` | `investigate` | A second read that shows QM's cut |
| `--work` | `~/.capy/work/qm-gstack-s1` | Build context, stack state, fake log, stored session |
| `--out` | `<work>/s1-staging-b6786d67.json` | The receipt; the router goes beside it as `s1-router-<ref8>.md`. Pass `--out harnesses/qm/gstack/receipts/s1-staging-b6786d67.json` to replace the committed one |

- **Needs:** Docker and both rig images built from [../Dockerfile](../Dockerfile) and [../Dockerfile.sandbox](../Dockerfile.sandbox).
- **Writes:** the staging manifest (path, source, bytes, characters, SHA-256, fits inline), the image id, the SOUL and sandbox responses, the turn, and the read evidence from the fake's log and the stored session.
- **Exit:** 0 only when the router reached the system prompt and the complete read matched byte for byte.

## S1 probe driver

**What it is:** `s1-probe.ts` runs the S1 probe preregistered under `docs/benchmarks/2026-11-03-qm-s1-gstack-probe/`. It asks QM five ordinary requests that match gstack skills, three times each, with and without gstack, on Opus 5.5 and on GPT-6.1 Sol, and counts how often QM opens and starts the matching skill. That is 4 cells of 15 turns. It is the probe's gate 3. The paid run, `qm-s1-gstack-probe-2026-11` (60 turns, 2026-11-04), is reported in [its report](../../../docs/benchmarks/2026-11-03-qm-s1-gstack-probe/report.md).

- **Two arms, one Dockerfile.** `gstack-router` puts the router in the org SOUL and runs on `harness-eval/qm-sandbox:s1-gstack-21277291` (the 63 staged files). `no-gstack` leaves the SOUL alone and runs on `harness-eval/qm-sandbox:s1-no-gstack`. Both come from [Dockerfile.skills](Dockerfile.skills); `STAGE_GSTACK=0` leaves gstack out of every layer.
- **Same fixture in both.** `s1-fixture.ts` writes a small invented Node repository at `/root/workspace/repo`: a tag, work after it, and a feature branch whose last commit breaks the login test. Its objects are written from fixed text, so the head is `9db8fa50` on every machine.
- **One turn = one fresh stack.** Each turn gets its own proxy slot and trial token, Postgres and core, a default sandbox, one new DM, then teardown of only what it created. Every turn runs under one metering lease.
- **Models:** `anthropic:claude-opus-5-5` and `openai:gpt-6.1-sol`. Each turn's slot also allows QM's housekeeping model for that provider (harness housekeeping, shipped default): `claude-haiku-5-5` beside Opus, `gpt-5.6-luna` beside Sol. Every turn record names it and counts its requests.
- **Sol wiring:** a Sol turn starts core with [../compose.openai.yaml](../compose.openai.yaml) over `compose.yaml`, as the runner does, so core reaches OpenAI through the proxy's `/openai` route with the trial token.

**Preflight before any paid call** (CREW.md, "Clean no-gstack and no-brain arms"). A failed check exits 3 before the proxy starts.

- **Host:** no `~/.capy/drive`, `~/.local/share/gstack` or `~/.claude/skills`. A dry run records these but does not enforce them.
- **Images:** every `SKILL.md` and gstack path in the core image and both arm images, listed as root. Core and `no-gstack` must have none. `gstack-router` must have exactly the 63 staged files, with the manifest's sha256.
- **Fixture:** the same tree sha256 and refs in both arm images.
- **SOUL:** one keyless stack per arm. `gstack-router` reads back the 12,186-character router; `no-gstack` reads back QM's own default SOUL (192 characters), with no gstack in it.

**Counting** (`s1-count.ts`, pure functions over the stored session):

- **Open:** a `files` read of a staged `<skill>/SKILL.md` that QM answered with the file, or a clean `cat`, `sed` or `head` of one. The root `SKILL.md` is counted apart.
- **Complete read:** inline (one uncut read, `bytes` equal to the staged characters), or cut (the cut read plus later reads of the path or the parked `tool-output/` copy deliver every line).
- **Start:** the skill's own gstack command (preamble) or first-step command, only after a matched open.
- **Progress:** each request's preregistered marker, inside the fixture repository; a memory `add` or `edit` for request 5.
- **Audit:** any call naming `gstack` or `SKILL.md`. In `no-gstack` it marks the turn contaminated.
- **Fixture faults:** a staged path answered with no file, `this scope has no default sandbox`, or the router missing from the first model request's system prompt (read from `GET /v1/admin/sessions/:id/llm?turnSeq=0`). Faulted turns are named and left out of the counts.

**Keyless dry run, $0.** The proxy runs in capture mode in front of `scripts/gsta-135/fake-anthropic.ts` (Opus) and `tests/fixtures/fake-responses.ts` (Sol), scripted to open the matched skill and run its start command in `gstack-router` only. `--inject-fault` adds one turn whose default sandbox is removed before the DM. The run exits 0 only when every check in `summary.json` holds.

```bash
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/s1-probe.ts --dry-run --inject-fault
```

The paid run takes the ledger and the lease instead (`--ledger <file> --lease-usd 20`), from a VM with no Capy drive.

| Input | Default | What it is |
|---|---|---|
| `--work` | `~/.capy/work/qm-s1-probe` | Build context, per-turn stack state and logs, the dry run's ledger |
| `--out` | `<work>/results`; a dry run gets a fresh `<work>/dry-run-results-<time>` | `preflight.json` (a later invocation writes `preflight-<time>.json`), `turns.jsonl`, `turns/<id>/` (turn record, stored session, first-turn model requests), `summary.json` (built from every record, latest attempt per turn), proxy usage log. A restart resumes: turns with a record are skipped, and records of another run id refuse the directory |
| `--gstack` | `<work>/gstack-src` | A gstack git directory holding `21277291c`; fetched by sha when missing |
| `--skip-build` | off | Use the existing `harness-eval/qm:dev` and `harness-eval/qm-sandbox:dev`; the arm images are always rebuilt |
| `--reps`, `--only`, `--repair` | 3, all, none | Repetitions; named turns only; a rerun after a named repair (the turn's next attempt, `-r<n>`) |
| `--ledger`, `--lease-usd`, `--new-run` | none, 20 | Paid run only; the lease is capped at $20 (coordinating agent's decision F1) |

- **Order:** request by request and repetition by repetition, each model's `gstack-router` turn and then its `no-gstack` turn. A cap stop ends the run as incomplete; nothing is rerun. A paid run exits 1 when it is incomplete (`complete` in `summary.json`).
- **Tears down:** each turn's pg, core and the sandboxes it created. `summary.json` lists any container, volume or network the run left behind.

## Edition fixtures, graders and analysis (internal-task)

**What it is:** the keyless half of the qm-s1-edition rerun (internal-task): the task generator, the graders that score a reply against its key, and the frozen analysis that turns turn records into KEEP or CUT. All of it runs offline and costs $0.

- **The real task bank is private.** It stays in a private drive folder until the amendment that pins the edition publishes it. The repository ships only [a test-only bank](../../../tests/fixtures/qm-s1-edition/test-only-bank.json): six invented templates, every id starting with `test-`, never used in a counted run.
- **Tests:** `tests/qm-s1-edition-fixture.test.ts`, `tests/qm-s1-edition-grade.test.ts`, `tests/qm-s1-edition-analysis.test.ts`.

### Generator: `edition-fixture.ts`

```bash
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/edition-fixture.ts --bank <bank.json> --seed <seed> --out <empty dir>
```

- **Writes:** `tasks.json` (the driver's records: `id`, `family`, `request`, `repo_dir`, `first_step.skill`), `keys.json` (read only by the graders, never by the driver), `fixtures.json` (each repository's head, refs and tree sha256, plus the sha256 of the bank file and of the seed) and `repos/<id>/`, one git repository per task.
- **Ids:** `inv-01`, `rev-01`, `plan-01` and so on, numbered per family in bank order.
- **Same bank and seed, same bytes.** Objects are written with `git hash-object` from fixed text (the helpers come from `s1-fixture.ts`), with one fixed author and one commit per day from 2026-10-20. The seed only picks each template's variable values. `tasks.json` also holds the absolute `repo_dir`, so it matches byte for byte only for the same `--out`.
- **Refusals:** a bank that is not test-only may not be written inside this checkout, and the output directory must be empty. A key that does not fit its repository (a missing file, a review spot outside the diff, too few hunks) stops the run.
- **No recursive delete needed.** Fixtures hold plain Node files and `node --test` tests, with no build step and nothing to clean up, so QM's org floor rule on recursive `rm` never comes up. The tests check that a test run leaves `git status --ignored` empty.

### Bank schema: `qm-s1-edition-bank/1`

```json
{
  "schema": "qm-s1-edition-bank/1",
  "bank_id": "qm-s1-edition-test-only-1",
  "test_only": true,
  "templates": [
    {
      "id": "test-inv-pagination",
      "family": "investigate",
      "request": "The pagination tests in {{project}} started failing ... what broke.",
      "vars": { "project": ["ledger-ui", "shelf-api"] },
      "commits": [
        { "branch": "main", "message": "Add pagination helpers", "files": { "src/paginate.js": "..." } },
        { "branch": "feature/x", "from": "main", "message": "...", "files": { "...": "..." }, "remove": ["old.js"], "tag": "v1.0.0" }
      ],
      "checkout": "main",
      "key": { "cause": { "file": "src/paginate.js", "aliases": ["pageCount"], "mechanism": ["Math.floor", "rounds down", "truncat*"] },
               "decoys": [ { "file": "src/config.js", "mechanism": ["default page size"] } ] }
    }
  ]
}
```

| Field | Rule |
|---|---|
| `test_only` | `true` only for test banks; then every template id starts with `test-` |
| `vars` | Optional. Each `{{name}}` in the request, files, paths, messages or key is replaced by one value the seed picks. One-line values only |
| `commits` | Oldest first. Each lists only the files it changes or removes. A branch's first commit names `from`; later ones continue the branch |
| `checkout` | The branch the repository is left on |
| investigate `key` | `cause` and at least one decoy, each `{file, aliases?, mechanism}`, decoys in other files. The planted test fails because of the cause |
| review `key` | `base` (the branch to diff against), `defect` `{file, lines, symbols?, mechanism}` and exactly two decoys `{file, lines, symbols?}`: spots that look odd but are correct. Lines are in the checked-out file. Each spot sits in its own diff hunk, and at least 4 hunks are not decoys. The generator adds `diff_files` and `hunks` |
| plan `key` | Exactly 3 `constraints` and at least 4 `distractors`, each `{id, description, all_of}`. `all_of` is a list of phrase groups: the item is named when every group has one phrase in the reply. Distractors are the other files and flags a plan could mention |

Phrases match case-insensitively at word edges; a phrase ending in `*` matches as a prefix (`truncat*`). A file always matches by its path and its basename.

### Graders: `edition-grade.ts`

```bash
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/edition-grade.ts --turns turns.jsonl --keys keys.json --tasks tasks.json [--judge judge.ts] --out grades.jsonl
```

**One extraction step for every arm.** The reply splits into sections at its headings (`#`, setext, a bold-only line or a `Label:` line). Heading lines are dropped, markdown markers are stripped, and trailing follow-up sections (next steps, questions, options) and courtesy lines ("Want me to fix it?") are cut. So a reply that is only headings scores nothing, and gstack-style headings never reach the judge.

- **Clearing.** A clause that exonerates a candidate ("is fine", "not the cause", "ruled out", "intentional", "leave it", "isn't a problem") does not name it. Decoys are also cleared by hedges ("might", "I first suspected"), but not by plain negation, so "does not validate the token, this is a bug" flags a decoy. A section headed "Ruled out" or "Looks odd but is fine" names nothing.
- **Clauses.** A later clause clears the one before it only when it points back ("but it is fine", "which is intentional"), not when it is about something else ("but the rest is fine"). "Instead of X" clears X only when X names a candidate, so "should use Math.ceil instead of Math.floor" still names Math.floor.
- **Headings.** A heading that names a file counts for the text under it, so "## src/price.js:17" locates the finding below it.
- **investigate:** success only when the last section that names a suspect names the cause (file and mechanism) and no decoy, and no later unit concludes on another file. A hypothesis list that concludes wrong fails, so does one that never concludes, and so does a correct hypothesis followed by "the real cause is ... in src/other.js".
- **review:** success when a paragraph or list item flags the defect with its location (file plus a nearby line or a symbol) and a mechanism phrase, no decoy is flagged, and at most 3 distinct issues are flagged. Issues are counted by diff hunk, only from units that raise a problem, so an every-hunk review fails and a file overview doesn't count. A line reference counts for the nearest spot in its file.
- **plan:** success when at least 2 of the 3 constraints are named and respected and at most 6 constraint-like items are named in total. The judge is a pluggable, arm-blind interface (`PlanJudge`: it gets the request, the extracted text and the constraint descriptions, never the arm or model), loaded with `--judge <module>` (its default export). Its model and prompt are pinned in the main amendment. Without `--judge`, `aliasJudge` grades: it counts named constraints plus named distractors and can't check respecting, so its grades are a declared fallback that leaves plan out of the verdict. Every grade's `grader` field names the judge.
- **Every grade** records `reply_chars` and `final_chars`.
- **Red team in the tests**, each failing its grader: an all-files-and-flags plan built from the repository alone, an every-hunk-but-the-decoys review, a hypothesis list that concludes wrong, padding and heading-only replies. Hand-written good replies, structured and in prose, pass.

### Frozen analysis: `edition-analysis.ts`

```bash
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/edition-analysis.ts --turns turns.jsonl --grades grades.jsonl --tasks 72 --reps 6 --out <dir>
```

- **Outcome:** `model_error` and `infra_error` are excluded; `context_length`, `timeout` and `turn_error` are failures; an `ok` trial takes its grade. A cell's first record counts unless it ended `infra_error`, and then its one rerun counts. Any other rerun doesn't count and is listed as a problem. Cost counts every attempt.
- **Primary:** edition minus plain on task success. Per model, task means over valid trials paired by task (unequal repetitions are fine). Pooled, each task's difference averaged over the models. Two-sided sign-flip p over tasks and a task-clustered bootstrap 95 percent interval, 10,000 draws, seed 7.
- **Verdict:** INCOMPLETE when any model lacks a counted record for a task in either rule arm at the design's repetition count (`--tasks`, `--reps`). Otherwise KEEP only if the pooled difference is above 0 with p below 0.05 and each model's point estimate is at least 0, and CUT if not. Cost is reported, never part of the verdict. The graders used are listed, and plan results are labelled "named" when the alias judge graded them. Then the primary comparison leaves the plan tasks out and pools the investigate and review tasks only.
- **Descriptive:** opens, complete reads, first steps, approvals answered, contamination, forced arm against plain and against edition, success by family, cost per task and per success, tokens, reply length, wall time, and exclusion rate per arm, with a gap above 5 points between edition and plain flagged.
- **Frozen surface:** `FROZEN_PATHS` in the file (the generator, graders, counters, driver, analysis and the two stats modules), pinned by the preregistration's merge commit.


## S1 edition rerun driver (internal-task)

**What it is:** `s1e-probe.ts` reruns S1 with gstack's QM edition (internal-task, gstack `eaf1701d`): three QM skills, `gstack-investigate`, `gstack-review` and `gstack-plan`, against plain QM, on Opus 5.5 and GPT-6.1 Sol. One trial per (task, arm, model, repetition) from a `tasks.json`, in a seeded order that interleaves the arms. Each trial writes one line of `turns.jsonl` in the shared turn-record shape, and its evidence under `trials/<id>/`. The counters are pure functions in `s1e-count.ts`. The S1 files are unchanged; the new files import from them.

**Three arms, one sandbox image per task.**

- **plain:** QM as shipped. Default SOUL, no deployment layer.
- **edition:** the edition as a deployment layer, with QM's default SOUL and nothing staged under `/root/workspace/gstack`.
- **forced:** edition, plus the matched skill's whole SKILL.md body (frontmatter removed) as the org SOUL, the route S1 used for the router.
- **Repository:** each task's `repo_dir`, and nothing else, is baked into its own sandbox image at `/root/workspace/repo` with [Dockerfile.skills](Dockerfile.skills) (`STAGE_GSTACK=0`). The arms differ only in what the driver sends core before the DM.

**How the edition goes in: the deploy dir and `qm up`, by hand.** Our stack has no QM deploy config, so the driver does what `qm up` does for the layer:

1. It reads `qm/edition.json` from a gstack checkout at `eaf1701d` (fetched by sha unless `--edition` names one) and copies only the folders it lists, the three `gstack-*` folders, into `<work>/deploy/sandbox/skills/`. `edition.json` and `README.md` stay out.
2. It reads that folder back the way QM's CLI does at `850599e9`: the deploy dir is the config dir's `sandbox/` (`cli/src/cli.ts:206`), each regular text file under `sandbox/skills/` becomes `{path: "skills/<id>/<file>", content, executable?}` with junk names skipped (`cli/src/deployment-layer.ts:37-51,59-73,76-101`), sorted and normalised (`:103-133`).
3. It sends that body to our core with `PUT /v1/deployment-layer`, signed as the source with no admin actor, as the CLI does (`cli/src/deployment-layer.ts:135-150,243-257`; `qm up` reaches it through the hosting backend's `up`, `cli/src/cli.ts:524-535` and `cli/src/backends/registry.ts:133`; the route is `src/api/routes/deployment-layer.ts:84`).

- **Receipt:** QM's own `deploymentLayerBody` (850599e9) over the deploy dir and the driver's body are byte-identical, sha256 `d7b9a938...` ([receipt](receipts/s1e-dry-run-b6786d67.json)).
- **Where it lands:** the store checks the bundle (`src/deployment/deployment-layer-store.ts:94-125`), parses each SKILL.md as a seed skill (`:168-212`) and installs it in the org scope (`src/wiring.ts:658-664`). Removing the folders and sending again archives them. The driver reads the layer back with `GET /v1/deployment-layer` (`:83`).

**Other QM routes used** (main `850599e9`; the rig runs `b6786d67`, lines given where they differ):

- **Index and loading:** a `## Skills` block in the system prompt with one line per skill (`src/skills/materialize.ts:143-169`, set at `src/core/orchestrator.ts:1212`; `b6786d67` `:1236`). The skill tool (`skill` at main, `src/agent/agent-tools/workspace.ts:61-118`; `skills` with action `read` at `b6786d67`, `src/agent/agent-tools.ts:3966`) is stored as `{tool: "skills", action: "read", name}` at both.
- **Sync and path rewrite:** a skill that ships files besides SKILL.md is synced to `/root/workspace/.agent-skills/<thread>/<version>/<id>/` on read (`src/core/orchestrator/sandboxes.ts:263,278-290`; `b6786d67` `:257,272`), and `skills/<id>/` in its text is rewritten to that folder (`src/skills/materialize.ts:22-33`, the same at both). A SKILL.md-only skill is answered from the store and syncs nothing.
- **Command approval:** the org floor rules (`src/policy/command-policy.ts:7-21`) are added under every scope (`composePolicy`, `:27`). A pending command is answered with `POST /v1/turns` carrying the same turn plus `approval: {requestId, approved: true, scope: "once"}` (`src/api/routes/turns.ts:334`, field `src/types.ts:417`; `b6786d67` `:316` and `:730`), handled at `src/core/orchestrator.ts:2024-2173` (`b6786d67` `:2004-2169`). Slack's approve button sends the same request (`src/slack/approvals.ts:272-276`).

**Per trial:**

- **Fresh stack:** own proxy slot and trial token, Postgres and core, volumes removed at teardown. Before each trial the driver checks no container, volume or network from an earlier trial remains; if one does, the run stops.
- **Approvals:** every `pending_approval` is approved once per command, the same way in every arm, up to 5 per trial. A repeat or a sixth is a `turn_error`. `counts.approvals_answered` records them.
- **Clean-arm check** (`cleanArm`, sets `counts.contaminated`). It reads the stored layer, the org SOUL, the first model request's system prompt and the sandbox's `.agent-skills` listing.
  - plain is contaminated by any layer skill, edition index line, body in the SOUL or prompt, synced edition file, or edition body in a tool answer.
  - edition and forced are contaminated when the layer, an index line or a whole description is missing, or the SOUL is wrong (forced: the body; edition: QM's default). A synced tree is required only after a load of a skill that ships files (today `gstack-review`).
  - Evidence that could not be read counts as contaminated in every arm.

**Counting** (`s1e-count.ts`, over the stored session):

- **open_matched, open_any:** a skill tool call naming the matched (or any) `gstack-<family>` skill that QM answered with its SKILL.md. Reads of the synced SKILL.md with `read` or `cat` are kept in the trial detail, not counted as opens.
- **complete_read:** the whole matched body reached the model: in the first system prompt (forced), in one uncut load, or a cut load plus reads of its parked copy. The detail adds `read_whole` (one skill answer, uncut, no park marker) and `path_rewrite` (QM replaced `skills/<id>/` with the synced folder).
- **first_step:** an executed command matching the skill's `first_step_marker` from `qm/edition.json`, run after the call that completed the complete read (from the start when the body is in the system prompt). The detail keeps `first_step_anywhere`, the plain arm's baseline, and each matching command's exit code and output.
- **status:** a cap stop is `model_error` and ends the run, as in `runner/trial/trial.ts`. A stack failure is `infra_error`. A finished turn is `ok` even when the evidence read-back failed (the failure is the status reason). An unfinished turn is `context_length` or `timeout` when its answer says so, `model_error` when its last provider call failed, else `turn_error`. An attempt with metered calls but no record (the driver died) is written as `infra_error` when the driver next starts.

**Keyless dry run, $0.** The S1 fakes behind the proxy in capture mode, three test-only tasks built from `s1-fixture.ts`, and the real edition at `eaf1701d`. The scripted fake makes the skill call in edition, runs a first step that matches the edition's marker in edition and forced (in edition review, the synced `diff-base.sh`), and runs one recursive delete in every arm, so each trial answers one approval. `--inject-fault` adds a plain trial with the layer installed, which must count as contaminated. Exit 0 only when every check in `summary.json` holds, internal-task's two claims included:

- **Claim 0, QM loads the edition:** each skill is in the index with its whole description, and a skill call returns the body whole.
- **Claim 1, the path rewrite:** the review answer names the synced folder and no `skills/gstack-review/` is left, and the synced `diff-base.sh` runs and prints a merge base.
- **git on PATH** in every task image.

```bash
env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/s1e-probe.ts --dry-run --inject-fault
```

| Input | Default | What it is |
|---|---|---|
| `--tasks` | test-only tasks in a dry run; required otherwise | The task records |
| `--edition` | gstack `eaf1701d` fetched into `<work>/gstack-edition` | A gstack checkout; a paid run needs it at `eaf1701d` with `qm/` unchanged |
| `--arms`, `--models`, `--reps`, `--seed` | `plain,edition` (all three in a dry run), `opus,sol`, 1, required (1514 in a dry run) | What runs, and the seed of its order |
| `--work`, `--out` | `~/.capy/work/qm-s1e-probe`, `<work>/results` | `run.json` (a resume with another design is refused), `preflight.json`, `turns.jsonl`, `trials/<id>/`, `summary.json` |
| `--stage`, `--shards`, `--ledger`, `--lease-usd`, `--new-run`, `--run-id` | none | Paid run only: needs the merged `docs/benchmarks/2026-11-06-qm-s1-edition/design.json`. The lease times the shard count must fit the stage's cap (headroom $45, pilot $10, main $520, forced $45) |
| `--only`, `--repair`, `--skip-build` | all, none, off | Named trials; their next attempt after a named repair; reuse the rig images (task images are always rebuilt) |

- **Preflight before any paid call:** no Capy drive or gstack install on the host (enforced on a paid run); each task image holds its repository, `git` on PATH, and no gstack path or edition file; each edition file fits QM's 16,384-character inline budget; each task's skill has a marker.
- **QM version:** the dry run runs at the rig's pin, `b6786d67`, because `prepare.sh` refuses images of any other commit than `pin.json`. Moving the rig to the commit the edition targets is a separate rig change for the pilot amendment.
- **Task generator and graders:** `edition-fixture.ts` and `edition-grade.ts`, with the frozen analysis in `edition-analysis.ts` (see Edition fixtures, graders and analysis above).
