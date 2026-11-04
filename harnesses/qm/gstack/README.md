# gstack on QM

**Raw gstack does not import into QM at `b6786d67`.** QM refuses the pack at its 32 MiB byte cap, so the plan's S1 probe uses gstack's paste-in router instead. The smoke, the staging run and the probe driver's dry run below are keyless and cost $0.

This folder holds two things:

- **internal-task overlay** (`Dockerfile`, `adapter.sh`): an image that runs `gstack-harness register qm` before the counted adapter. Unchanged here.
- **internal-task M1 step 6 scripts** (`smoke.ts`, `s1-stage.ts`, `qm-stack.ts`, `Dockerfile.skills`): the skill-pack smoke and the S1 probe fixture, with receipts in [receipts/](receipts/).
- **S1 probe driver** (`s1-probe.ts`, `s1-count.ts`, `s1-fixture.ts`): the two-arm probe, below.

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

**What it is:** `s1-probe.ts` runs the S1 probe preregistered under `docs/benchmarks/2026-11-03-qm-s1-gstack-probe/`. It asks QM five ordinary requests that match gstack skills, three times each, with and without gstack, on Opus 5.5 and on GPT-6.1 Sol, and counts how often QM opens and starts the matching skill. That is 4 cells of 15 turns. It is the probe's gate 3; no paid turn has run.

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
| `--ledger`, `--lease-usd`, `--new-run` | none, 20 | Paid run only; the lease is capped at $20 (Captain F1) |

- **Order:** request by request and repetition by repetition, each model's `gstack-router` turn and then its `no-gstack` turn. A cap stop ends the run as incomplete; nothing is rerun. A paid run exits 1 when it is incomplete (`complete` in `summary.json`).
- **Tears down:** each turn's pg, core and the sandboxes it created. `summary.json` lists any container, volume or network the run left behind.
