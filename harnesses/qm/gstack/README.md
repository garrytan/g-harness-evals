# gstack on QM

**Raw gstack does not import into QM at `b6786d67`.** QM refuses the pack at its 32 MiB byte cap, so the plan's S1 probe uses gstack's paste-in router instead. Both runs below are keyless and cost $0.

This folder holds two things:

- **internal-task overlay** (`Dockerfile`, `adapter.sh`): an image that runs `gstack-harness register qm` before the counted adapter. Unchanged here.
- **internal-task M1 step 6 scripts** (`smoke.ts`, `s1-stage.ts`, `qm-stack.ts`, `Dockerfile.skills`): the skill-pack smoke and the S1 probe fixture, with receipts in [receipts/](receipts/).

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

### Proposed paid probe (not run)

internal-task preregisters and runs this under its $3 cap. This setup has QM-Pi on `claude-haiku-5-5`, the router in the org SOUL, the staged sandbox image, and a default sandbox per member. Each request below is a new DM thread.

| # | Member request (invented) | Matching skill | Characters | Fits inline |
|---|---|---|---|---|
| 1 | "Something in my branch broke the login test since yesterday. Can you find out why before I touch anything?" | `investigate` | 29,581 | no |
| 2 | "Before I merge, can you review the diff on my feature branch for anything risky?" | `review` | 58,767 | no |
| 3 | "I'm about to run a cleanup script on the prod database box. Be extra careful with anything destructive while we work." | `careful` | 4,727 | yes |
| 4 | "Write up release notes for what changed since the last tag." | `document-release` | 16,942 | no |
| 5 | "Save what we learned today about the flaky retry test so you remember it next time." | `learn` | 8,351 | yes |

- **Requests 1, 2 and 4** need a repository. Stage a small git repo in the workspace, or count only opens for them.
- **Size:** 5 requests times 3 repetitions is 15 turns. M1 serve smoke turns on Sonnet cost $0.009 to $0.058 each ([../README.md](../README.md)), so 15 Haiku turns should sit well under $3. The meter decides.

How to count, from each turn's stored session (`GET /v1/admin/sessions/:id?scope=personal:<member>`):

- **Open:** a `tool_result` entry with `action: read` whose `path` is a staged `/root/workspace/gstack/*/SKILL.md`. An `execute` call that reads such a path (`cat`, `sed`, `head`) also counts.
- **Matched open:** the opened skill is the preregistered one for that request.
- **Complete read, inline:** the entry has no `output` field and `bytes` equals the staged file's characters.
- **Complete read, cut:** the entry has `output.shownChars < output.chars`. It is complete only if later reads (the parked `tool-output/` copy, then `execute` pieces) cover every line.
- **Start:** after the open, the agent takes the skill's first step. Preregister one observable marker per skill, such as a `git log` or test run for `investigate`, or `git diff` for `review`.
- **Fixture fault, not zero use:** `[no such file`, `[not in the computer's workspace`, `this scope has no default sandbox`, or the router missing from the system prompt. Rerun the trial; never count it as no open.
- **Report:** opens, matched opens, complete reads and starts, each over 15 turns with its denominator. S1 goes ahead only if members open skills (plan v3, Big decision 5).
