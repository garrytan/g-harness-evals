# gbrain install baseline: can an agent go from "install gbrain" to working memory by itself, and where does it get stuck?

Status: frozen 2026-11-17T06:14Z, before any counted trial. Run id `gbrain-install-2026-11`. Cells are in [prereg.json](prereg.json); the uncounted Fable 5.2 smoke is in [smoke/prereg-smoke.json](smoke/prereg-smoke.json); every pinned file and its sha256 is in [pins.sha256](pins.sha256). The trial driver is `runner/trial/install.ts`; scoring is `scripts/gbrain-install/` ([its README](../../../scripts/gbrain-install/README.md)).

**In one line:** we give a fresh agent on a clean Linux machine one instruction, either the bare "install gbrain" or gbrain's own README paste prompt, each followed by one line naming the gbrain release to install, and count a run as a success only when a brand-new conversation answers a made-up word through gbrain. We time each step and count every point where a person was needed.

- 16 cells, 200 counted runs, run cap $450 (the counted-run lease cap), expected model spend about $190.
- **Wave 1:** Claude Code with Opus 5.5 and Codex with GPT-6.1 Sol, 20 runs per arm.
- **Wave 2:** OpenClaw and Hermes, each with Opus 5.5, GPT-6.1 Sol and particle-1, 10 runs per arm.
- **Release:** gbrain v0.60.734.0 (`a278ddf45887e10f70e91e6c78e63d6822d4e492`), the newest release on gbrain's main branch at freeze. Both arms end with one line telling the agent to install that tag, because gbrain's docs install `#stable`, which can be days behind it.
- **No model judge.** The finish line, the step times and the person-needed counts are all read mechanically from transcripts, probes and logs.
- **Uncounted:** a Claude Code smoke with Claude Fable 5.2, 2 runs per arm, about $12, labelled a smoke with no claim.

## What the result changes

Each line names what we do differently for each way the result can land (R97). "Arm A" is the bare arm, "arm B" the paste arm. Every line uses the finish line **as scored**.

- **Which step gbrain's maintainers fix first:** the step with the most failed runs in arm A, pooled over harnesses and models. Ties go to the step with more "needed a person" events, then to the larger share of time. The failure table lists every step with counts, gbrain error codes and two example transcripts, and goes to gbrain's maintainers (internal-task) when the results merge.
- **Arm A much worse than arm B** (a gap larger than the detectable difference below): the problem is finding gbrain and its install path, so the first batch of fixes targets discovery (what a search, or a guess like `npm install gbrain` or `clawhub:gbrain`, lands on).
- **Both arms low and close:** the install flow itself is the problem, and the first batch fixes the worst step.
- **A "not supported yet" note:** when a harness reaches the finish line in under 20% of runs in both arms on two releases in a row, and its failures sit at the "harness wired" step, gbrain's maintainers add a "not supported yet, use X instead" note to that harness's install route until a working setup path for it lands.
- **Any gbrain provider request on the keyless path:** reported to gbrain's maintainers as a consent bug that goes ahead of every onboarding fix.
- **Fact saved to the harness's own memory instead of gbrain:** a miss, sent to gbrain's maintainers as a brain-first wiring fix.
- **particle-1 fails where Opus 5.5 and GPT-6.1 Sol pass on the same harness:** reported as a model limit, with no onboarding fix unless the failures carry a gbrain error code.
- **The Fable 5.2 smoke:** changes nothing. It is 4 runs, reported as a smoke with no claim.

### When the fix loop stops

After this baseline, each batch of gbrain fixes is rerun on gbrain's newest release at that time with the same cells, as a dated amendment that pins the release. The loop stops when arm A meets all of:

- the finish line in at least 90% of runs in each Wave 1 cell, and at least 80% in each Wave 2 Opus 5.5 and GPT-6.1 Sol cell;
- a median time to the finish line of at most 150 s on Claude Code, 210 s on Codex and 240 s on OpenClaw and Hermes;
- no "needed a person" event in at least 90% of runs.

It also stops after two reruns in a row with no gain (the upper end of the 95% interval on arm A's pooled finish-line gain is below 5 points, and median time fell less than 15%), or after 4 reruns. A harness whose baseline already meets the targets is dropped from the reruns.

## Approval

- **Garry, 2026-11-15:** "Do it", on plan v2 of internal-task (the autoplan run `gst-2715-20261115010356`, gate_rev 1; the approved plan file has sha256 `022edb3ead2d36e1f752fa8b400db6ffba0bb45e1701404ca2f0f2841d44e6de`). The arms, design, decision lines, sample sizes, detectable differences, stop rule, cost and caps here are copied from it. Where this file differs from the plan, [Deviations](#deviations-from-the-plan) says why.
- **Changed on 2026-11-16, before any counted trial, by Garry's rule that every eval of gbrain runs on its newest release (R100):** the pin is the newest release on gbrain's main branch at freeze, not the release `#stable` serves; both arms end with one identical line naming that release; how often agents install something else is counted; the `#stable` hold window is dropped. See [Release pin](#release-pin).
- **Decided after the plan (coordinating agent, 2026-11-15 and 2026-11-16):** arm B is the README paste prompt and reads master's install doc; the named stalls; the Fable smoke; the branching install is not an arm; the two preconditions; the PATH design choice; keyword-only search; the accepted departures; the conversation-archive and head-or-tail audits; the sharding and concurrency; the spend ceilings; and the results order. Each is stated below.

## Arms

Both arms are keyless, with no human help, on a clean machine with the harness freshly set up.

| Arm | First message | File |
|---|---|---|
| **A, bare** | "install gbrain", then the version line | `tasks/gbrain-install/arms/bare.md`, sha256 `810d0b976ca4d5a44ce94284a0d450dc2112a55e27d3fd3887a42d6ab0b4a8d6` |
| **B, paste** | gbrain's README agent paste prompt, byte for byte: the body of the one ```` ```text ```` block in gbrain's README.md at the pinned commit, then the version line | `tasks/gbrain-install/arms/paste-0.60.734.0.md`, sha256 `1af1d5967c2203f9038914cab5c4fc3e86f68e296c888d3c70c928311e6846a8` |

Arm B's text:

```text
Add GBrain memory to this existing agent. Read and follow:
https://raw.githubusercontent.com/garrytan/gbrain/master/INSTALL_FOR_AGENTS.md
Keep my current identity and instructions, start keyless, and show me the
search-mode choice. Verify a remember/recall round trip with real GBrain calls.
```

**The version line.** After a blank line, both arms end with this line, word for word (`version_line` in `tasks/gbrain-install/task.json`; the runner adds it):

```text
Install gbrain release v0.60.734.0 (`github:garrytan/gbrain#v0.60.734.0`) wherever the docs say #stable.
```

- **Why it is there.** Both arms reach gbrain through its docs, which install `#stable`, and `#stable` can be up to 7 days behind the newest release. Evals of gbrain run on the newest release, so the line names it. This is a declared change to what "bare" means here: "install gbrain" plus this one line. We measure the newest docs on the newest build.
- **It is the same in both arms,** so the comparison between the arms is fair.
- **How often agents follow it is its own number.** It is counted from what was installed, never from the commands the agent typed. Per harness, model and arm, the verdict counts the runs whose **first** gbrain version on PATH was not the pin (the agent installed `#stable` or another build first), the runs whose **last** version was not the pin (it never reached the pin), and, on their own, the runs where **no** gbrain version was seen (`pin` in the verdict; [scripts/gbrain-install/README.md](../../../scripts/gbrain-install/README.md#the-rules), "Release pin"). The versions are what `gbrain --version` printed in the probe's records: the 1-second watcher and the end-of-turn probe. This shows how often an agent follows an instruction that contradicts the docs, and it is reported apart from the finish line.
- **Two limits of that count.** The watcher samples once a second, so a build replaced within a second can be missed. And the harness images must start with no gbrain on PATH; the runner checks each image before its first install trial and stops the run if one is found (HE-INSTALL-006).
- **The commands are kept, not counted.** Each run also records every install command with the gbrain ref it seems to name (`install_attempts`), as descriptive data only.
- **Arm B reads master's INSTALL_FOR_AGENTS.md, not the release's.** The prompt links `master`. That is what a person who pastes it gets, so arm B measures it as it is. At freeze master's copy had sha256 `8dc59910ff12d00a0dd3f52cce33d956403bc4ddcb1577584150a483329ad722` and the copy at the pinned commit `366308c598cf0e978879d8133b5ceddc3bd5d67b04d42bdeb6c6658f06e9e596`. Each run records the URL, git ref and sha256 of every INSTALL_FOR_AGENTS.md the agent fetched. The sha256 is filled when the tool output holds the document's body (curl or wget to stdout, or a printed sha256sum) and is null when the agent read it through a summarising tool such as WebFetch. **If master's sha256 changes during the wave, arm B is reported split by the hash the agent fetched**, with runs whose hash is null reported apart.
- **No "no gbrain" arm:** an install test has nothing to install without gbrain, so the comparisons are between instructions and between releases (the plan's reading of R44 for this eval).
- **No hosted gbrain.io arm:** its path needs a person to pick a plan in a browser. If an agent in either arm takes the hosted route, the egress proxy refuses gbrain.io, the run records the route and where it stopped, and the run goes on.

## One run, in order

The task file is `tasks/gbrain-install/task.json`. Each turn has 900 s (`time_budget_s`), plus a 60 s grace before the runner kills the harness; a turn past that is a timeout.

1. **Session 1, turn 1:** the arm's first message, ending with the version line.
2. **Scripted user, the same in every arm and harness:** whenever the agent ends a turn and the install probe does not pass, it gets one fixed reply, at most 3 times: "I don't have a preference. Use the defaults you recommend, keep it free with no API keys, and carry on without me." The trigger is the probe, never the agent's wording. Each reply counts as one "needed a person" event.
3. **Session 1, next turn:** "Remember that my sister's new cat is called {nonce}." The nonce is a made-up word drawn from the cell's seed and the trial id (`tasks/gbrain-install/nonce.ts`), so it can't be guessed.
4. **Session 2, a new conversation in the same harness** (a new process for Claude Code and Codex, a new session for OpenClaw and Hermes, the harness config as the agent and gbrain left it): "What's my sister's new cat called?"
5. **Session 3, only if session 2 missed:** "Check your gbrain memory: what's my sister's new cat called?" A descriptive line only, never the score. It separates "not wired into the harness" from "not saved".

**The install probe** (`harnesses/_install/probe.sh`) passes when gbrain's binary is on PATH, a brain exists, and the harness config registers gbrain by MCP, instructions or a hook.

**The finish line (the score).** All of:

- the session 2 reply holds the nonce as a whole word (case and punctuation ignored);
- gbrain served it: a gbrain MCP call, or one shell command whose command word is gbrain (optionally after `cd <dir> &&` and optionally piped into `head` or `tail`), succeeded in session 2 and its output holds the nonce, before the reply;
- the brain directory holds it;
- no file outside the brain holds it. Every harness state store, SQLite included, and the workspace are scanned after the run; transcripts and the harness's TMPDIR scratch files are excluded. A copy outside the brain is the outcome `harness-memory`, a miss whatever else held.

Outcomes: `recalled` (the finish line), `harness-memory`, `not-recalled` (installed, finish line missed), `not-installed` (no turn's probe passed).

## Release pin

- **Pin:** gbrain v0.60.734.0 at `a278ddf45887e10f70e91e6c78e63d6822d4e492`, the newest release on gbrain's main branch at freeze: the highest `v*` tag, and the version in master's VERSION file. Every cell's `install.tag` and `install.commit` are these, and arm B's paste file is cut from the README at this commit. The newest release is checked again when this pull request opens and before it merges; a newer release before merge means re-pinning.
- **Not the stable channel.** At freeze gbrain's `#stable` served v0.60.733.0 (`6ce7195b44a034f85aec811f11fbf862db376f50`), which is what a person following the docs that day would install. Our numbers describe the pinned release, not what `#stable` serves.
- **The build is frozen once counted runs start.** The runner checks before every trial that the tag still names the pinned commit (HE-INSTALL-001). A tag that moved stops the affected cells with no trial recorded; they resume only as a new wave under a dated amendment, reported per commit. An HE-INSTALL-001 stop because `git ls-remote` failed (the network, not a moved tag) needs no amendment: the cells resume with `--resume`, as docs/errors.md says. Newer gbrain releases during the run change nothing.
- **Each run records its installed gbrain version.** A run that ended on another version still counts as scored, because ignoring the version line is the agent's own behaviour, and it is counted in the pin numbers above. As a check, the finish line per cell and arm is also reported on the runs that ended on the pinned version alone.
- **No hold on `#stable`.** The plan asked gbrain's maintainers to hold `#stable` and their install-doc edits for 24 hours from launch. With the pin on a tag, that is not needed, and it was released on 2026-11-16. Their install-doc edits can land during the run; the hash rule for arm B above covers them.
- **A later README change** to the paste prompt is a named rerun with its own paste file.

**Where the pin sits.** The newest release on 2026-11-16 was v0.60.733.0, so the pin is v0.60.733.0 or later. That puts the baseline:

- **after both halves of gbrain's large-brain upgrade fix** (gbrain#9472 in v0.60.732.0, and gbrain#9487 with #9490 in v0.60.733.0). Both change only an upgrade from a brain made before v0.51, which a fresh install never runs;

- **after the Codex bun-PATH fix** (gbrain#9421, in v0.60.725.0, internal-task). Our install-mode PATH entries (below) are then redundant for Codex, but they stay for every harness;
- **after the conversation archive turned on by default** (v0.60.727.0). On personal brains the install prints a one-time notice, and gbrain's maintenance pass writes one redacted page per conversation per day under `conversations/` (`gbrain transcripts archive off` turns it off). The notice is not a stall unless it ends the turn on a question. Archive pages count toward the brain's page count. Recall served from an archive page is reported separately (see [Analysis](#analysis-and-exclusions-frozen));
- **after the personal and company branching install** (gbrain#9387, v0.60.724.0). It is not an arm here. If setup asks "personal or company" and the turn ends on that question, it is a named stall like any other question.

## Cells, shards and leases

Cells are named `<harness>-<model>-<arm>-gbrain-install`. Every cell is `slice: gbrain-install`, `split: dev`, `network: install` (docker mode), with nonce seed `gst2715`. Planning ceilings per turn are 80,000 input and 6,000 output tokens on every cell (the installer cells' ceilings; they only size the dry run's worst case).

**Sharding.** Ubicloud through `scripts/ubicloud/fanout.sh`, one standard-16 VM per shard, whole cells per shard and no cell split across machines, trials one at a time inside a shard, each shard under its own metering lease inside the run cap. The repository is pinned at this preregistration's merge commit, with images built there. Within a shard that holds two cells, `order: interleave-task` (seed 2715) runs both arms in every repetition, in a seeded random order, so a drift in the provider falls on both arms alike.

| Shard | Cells | Runs | Expected | Lease |
|---|---|---:|---:|---:|
| s01 (canary) | claude-code-opus-bare | 20 | $30 | $68 |
| s02 | claude-code-opus-paste | 20 | $30 | $68 |
| s03 | codex-sol-bare | 20 | $16 | $36 |
| s04 | codex-sol-paste | 20 | $16 | $36 |
| s05 | openclaw-opus-bare, openclaw-opus-paste | 20 | $30 | $68 |
| s06 | openclaw-sol-bare, openclaw-sol-paste | 20 | $16 | $36 |
| s07 | openclaw-particle-bare, openclaw-particle-paste | 20 | $3 | $8 |
| s08 | hermes-opus-bare, hermes-opus-paste | 20 | $30 | $68 |
| s09 | hermes-sol-bare, hermes-sol-paste | 20 | $16 | $36 |
| s10 | hermes-particle-bare, hermes-particle-paste | 20 | $3 | $8 |
| **Total** | 16 cells | 200 | $190 | $432 |

- **Expected cost** is the plan's estimate per run (Opus 5.5 $1.50, GPT-6.1 Sol $0.80, particle-1 $0.15), scaled from gbrain-evals Cat 41 by 2 to 3 times for finding gbrain unaided. It is an estimate, not a measurement. Leases are about 2.25 times it (particle-1 rounded up to $8) and sum to $432, leaving $18 of the $450 cap unplanned.
- **Concurrency.** The project keeps 48 vCPUs free (every ubi-runner call sets `UBI_QUOTA_VCPUS=464` and `UBI_QUOTA_WAIT`, so a launch waits for room instead of failing), and this team's evals share 208 vCPUs. This eval runs **at most 2 VMs at once** (32 vCPUs, `--max-vcpus 32`), always inside the 464 headroom. More only with the coordinating agent's approval. **The shard count and the shard map stay the same; only how many run at once changes.**
- **Launch order:** s01 first, as the canary. The others launch only after the canary has finished at least one scored trial and copied its results off the VM, Wave 1 shards (s02 to s04) before Wave 2.
- **Time per shard** does not depend on concurrency, since trials run one at a time inside a shard. Expected about 2.5 hours (the plan's 24 VM-hours over 10 shards, setup included); worst case about 38 hours (a run has up to 7 turns of 900 s plus the 60 s grace, about 1.9 hours, x 20, plus 1 hour of setup), which is past the shard timeout, so the canary rule below is what bounds it. UBI_TTL_HOURS is 12 with `--timeout-hours 11`; a VM waiting for quota is not yet created, so the wait doesn't count against its TTL. If the canary's measured wall time per run x 20 x 1.5, plus 1 hour, exceeds 11 hours, both are raised before the other shards launch, and the run log says so.
- **Calendar time:** 10 shards in batches of 2 is 5 rounds, about 12.5 hours expected and up to about 190 hours if every shard hit that worst case; in batches of 4 it is 3 rounds, about 7.5 and up to about 115 hours. Newer gbrain releases during the run change nothing, because every trial installs the pinned tag.
- **Results leave each VM during the run**, the VM-to-shard map is kept beside them, every VM is destroyed on exit, and `ubi-runner.sh list --mine` is empty at the end. UBI_OWNER is the running thread's code.
- A lease stop publishes that shard's cells as partial, labelled as such, and is never retried to change a verdict. No lease or cap is raised mid-run.

## Measures

**Speed.** Wall time and agent turns (the driver's turns up to and including the recall turn, `agent_turns`; model requests from the proxy log are reported beside them as `model_requests`) from the first message to the finish line, and to each step: binary installed, brain created, harness wired, fact saved, fact recalled. Install-step times are the earlier of a 1-second filesystem watcher in the container and the end-of-turn probe; save and recall times are the end of the turn that holds the first successful gbrain call. A cold download of bun and gbrain at the pinned tag is timed in a temporary HOME, once per harness image before its first install trial, and reported apart from agent time.

**Ease: "needed a person".** Counted mechanically, each event tagged with the step the probe was at:

- **Scripted reply:** every scripted reply sent.
- **Blocked step, a named stall:** an error line from a pinned list (`BLOCKED_LINES` in `scripts/gbrain-install/classify.ts`) appears in a tool output and the agent's text in the same turn repeats or explains it. The list: Bun's "Blocked 1 postinstall", reported as "One install step was blocked by Bun"; EACCES on a global install ("One install step was refused for file permissions (EACCES)"); gbrain installed where the shell can't find it ("gbrain was installed but the shell could not find it"); and bun missing ("Bun was not installed").
- **Question, a named stall:** any turn before the finish line that ends on a question to the user, at any step, save and recall turns included. Reported as "Stopped to ask a question at step X".
- **Not stalls:** keyless warnings from gbrain's setup that do not ask anything, such as "providers declined", the notice that search runs in conservative mode, and the conversation archive's one-time notice.

Also recorded per run, descriptively: question, browser and paste request types; failed and retried commands; the route chosen (bun from GitHub, npm, git clone, ClawHub, hosted, Codex plugin, curl script); the installed gbrain version; whether the save went to the harness's own memory instead of gbrain; the fetched INSTALL_FOR_AGENTS.md; and for each failed run the step it died at and the last gbrain error code (gbrain's JSON `code` field) in its tool outputs.

**Provider requests that are not the harness's own.** gbrain must make no provider request at all on the keyless path, billed or not.

- The harness gets its per-trial proxy token through a channel its tool subprocesses don't inherit (Claude Code's apiKeyHelper, Codex's env_key with its shell excluded, OpenClaw's config file, Hermes's .env), so no key or token sits in the agent's shell on any harness.
- Containers reach providers only through the metering proxy; the egress proxy refuses direct provider hosts and gbrain.io.
- On install slots the proxy records and refuses at $0 (HE-PROXY-010) every request that is not the harness's own model call: any request without the slot's token, an embeddings request, any route other than generation, count_tokens or a model list, and a generation for a model not bound to the slot. Harness startup probes that carry the token are refused at $0 and classed as probes, not as non-harness requests.
- The count of non-harness requests is reported per run, split by the proxy's request class. Startup probes a harness sends without the slot's token (class `probe`, the routes the probe-mix test lists) are reported as their own count per harness and model route, and are not a gbrain finding. In the real-image check at the pin, Hermes on the particle-1 route sent 20 of them in one trial (user agent python-httpx; GET `/api/v1/models`, `/api/tags`, `/props`, `/v1/props` and `/version`, 4 each), all refused at $0 (counted from that check's proxy usage log; preflight/real-image-check.json does not carry these counts). Hermes on the Anthropic and OpenAI routes and every other harness sent none. Any other non-harness request (classes generation, models, embeddings, count_tokens and other) goes to gbrain's maintainers as a consent bug, with its user agent.

**Embeddings.** Trials hold no provider key, so gbrain runs keyword-only (`init --no-embedding`, conservative search). The finish line, nonce recall served by gbrain, does not depend on semantic search.

## Sample sizes and what they can detect (stated in advance)

- Claude Code with Opus 5.5 and Codex with GPT-6.1 Sol: 20 runs per arm. OpenClaw and Hermes: 10 runs per arm per model. 200 counted runs per release, plus the 4 Fable smoke runs.
- Release N against N+1, at 80% power, two-sided 5%, near a 60% finish-line rate, the smallest detectable change in finish-line rate is about **20 points** for arm A pooled (100 runs per release), about **14 points** for both arms pooled (200), about **31 points** per Wave 1 harness (40 runs), about **43 points** per cell and arm with 20 runs and, for the cells with 10 runs, about **55 points**, and only as a drop (no rise from 60% is detectable with 10 runs).
- Comparisons are paired by harness, model, arm and repetition. Every difference gets a 95% interval: Newcombe for rates, bootstrap for log median time. Per cell and arm, the finish-line rate gets a Wilson 95% interval with n.

## Analysis and exclusions (frozen)

- `scripts/gbrain-install/verdict.ts` gives per cell and arm: n, the finish-line rate with its interval, median and IQR of time to finish, median agent turns, person-needed counts, the harness-memory count and the hinted recall line. `scripts/gbrain-install/failure-table.ts` gives one row per step (binary, brain, wired, saved, recalled): failed runs, person-needed events, top gbrain error codes and two example trials.
- **As scored and as read.** Every recall miss is also read by an independent agent reader from the other model family (GPT-6 Astra for Claude runs, Opus 5.5 for GPT and particle-1 runs), told what decision the result feeds. The report shows "as scored" and "as read" side by side. The reader is not a judge and is not validated, so the fix order and the stop rule use "as scored" only; the reader's notes sit beside each failure-table row.
- **Audit 1, recall from the conversation archive (pre-stated).** After the run, every recalled trial is classified by the brain page that served the recall and by where the brain holds the nonce. A recall served by a page under `conversations/` still counts as recall, because the archive is gbrain memory a user gets by default, but it is reported separately as "recalled from archive", with the count of recalled trials whose nonce sits only in archive pages. The "brain holds it" check in the code reads the whole brain directory; this audit is what separates an explicit save from an archived conversation.
- **Audit 2, `head` or `tail` with a bare number (pre-stated, the known limit of #479).** The gbrain-served check credits `gbrain ... | head N` or `| tail N` with a bare numeric argument, which `head` and `tail` read as a file name. A false credit needs a file named N in the working directory that holds the nonce. After the run, every recall credited through such a pipe is rechecked against the raw transcript and the trial's state, and the credit is withdrawn when a file with that name existed. The count is reported, even if it is zero.
- **Audit 3, the release-pin counts (pre-stated).** After the run, the first-version, last-version and no-version counts are recounted for every counted run from the raw watcher records (`install-watch.ndjson`) and the end-of-turn probes, and the recount is published next to the verdict's column with any difference explained. The code that makes the column had known edge cases at freeze; they are listed in harness-evals#483.
- **Counted runs** are all runs except those with termination `model_error`, `infra_error` or `exam_fault`, an adapter's HE-INSTALL-003 refusal and an infra classification (`scripts/gbrain-install/verdict.ts`). A timeout or another harness error counts as a run that missed the finish line. The excluded runs are listed apart with the reason.
- **INFRA:** a harness crash, a proxy 5xx, a VM loss, or GitHub answering 403 or 429 (seen in tool output or as a plain-HTTP status in the egress log). An INFRA run is rerun once on a fresh VM after a cool-down, and listed.
- **Driver outcomes** have their own codes in docs/errors.md: HE-INSTALL-001 (the release tag no longer names the pinned commit), HE-INSTALL-002 (the probe still failed after 3 scripted replies; scored, not an error), HE-INSTALL-003 (an adapter refused install mode), HE-INSTALL-004 (the watcher left no record; infra, rerun once), HE-INSTALL-005 (a token or key found in the trial directory; the run stops), HE-INSTALL-006 (a gbrain binary was already on PATH in a fresh HOME of the image; the run stops before any trial of that image).
- **Provider safety-filter stops** are their own outcome, reported apart from model failures (R38, R95).
- **Hermes findings to watch, not fix.** In single-query mode Hermes's guard blocks `python -c` and `bun -e`, and with its Tirith checker offline it blocks a literal `bun install -g github:...`. These are real outcomes a user would see, and they score as measured.

## Fixed now

- **Task:** `tasks/gbrain-install/` (task.json, both arm files, egress.json, nonce.ts) at the merge commit. One public task; no held-out split.
- **Runner:** the trial and scoring code at `166c93dad21a0a13944080bd5f8db4a4fc00dfea`, the merge of harness-evals#483 (the release pin by tag and the version line), on top of #479 (how install trials score recalls and handle network edge cases) and #471. Counted runs execute from this preregistration's merge commit; only the files in pins.sha256 are hash-pinned, and main is diffed against them before merge.
- **Harnesses** at the adapters' pins, freshly set up, in install mode ([docs/adapters.md, "Install mode"](../../adapters.md#install-mode-gst-2715)): Claude Code 2.1.312, Codex 0.165.0, OpenClaw 2026.10.6, Hermes v2026.9.24 (`f97608f1`). Signed in to the proxy with a per-trial token; no MCP servers, no memory files, no gstack and no Capy drive (the clean-arm rule). Each harness keeps its shipped default web tools: Claude Code runs without the adapter's web tool block (WebSearch and WebFetch on), Codex without the adapter's `web_search` and plugin overrides, and OpenClaw and Hermes with their defaults. The proxy prices hosted search fees on install slots.
- **Design choices from #479, named:**
  - **`skipWebFetchPreflight: true` in Claude Code's install mode.** WebFetch first asks api.anthropic.com whether a domain may be fetched, and the egress blocklist refuses that host, so without this WebFetch would fail on every page. It turns off only that domain check.
  - **Provider hosts stay on the blocklist,** so every model call goes through the metering proxy and a direct call (a key the agent found, or gbrain configured with one) is refused and logged.
  - **PATH.** In install mode each new harness session starts with the image PATH plus `$HOME/.bun/bin`, `$HOME/.npm-global/bin` and `$HOME/.local/bin`, the way a fresh terminal would after an installer edits the shell rc file. No rc file is sourced. Before gbrain#9421, Codex never started gbrain's MCP server without it, because that config launches a `#!/usr/bin/env bun` script and the image has no bun on PATH. At the pin it is redundant for Codex and kept for every harness.
- **Egress:** `network: install` is the run's internal network plus an open-egress proxy that admits every host except the pinned blocklist in `tasks/gbrain-install/egress.json`, and logs every connection. Since #469 the list is the frontier base list (Anthropic, OpenAI, Google, xAI, OpenRouter, Meta, Particle, Voyage and Cursor model hosts, play.googleapis.com and the benchmark hosts) plus gbrain.io, *.gbrain.io and gbrainio.terminalwire.sh. The proxy refuses decimal, hex and octal IP hosts and ports outside 1 to 65535.
- **Sol cells are not gated by `zdr-check.ts`.** That gate runs only for frontier-harbor shards (`scripts/ubicloud/run-shard.sh`), so nothing checks for previous_response_id chaining before Sol cells run. A provider refusal would show in the proxy log and in the run's termination, and is reported.

## Not measured

- **Permission prompts and plugin-marketplace prompts:** the adapters run with permissions bypassed.
- **Out of scope:** an arm that asks for a personal or company brain on purpose (a later wave); the hosted gbrain.io arm; macOS; Cursor; particle-1 on Claude Code and Codex, which have no route to it.

## Before the first counted trial

1. **The probe-mix test.** At the runner commit, `tests/proxy-install-slot.test.ts`, describe "harness startup probes on an install slot", case "with the token, every probe is refused 403 at $0, classed probe, and no non_harness count is above zero" passes, here and in CI. It sends Hermes's startup probes (POST `/api/show`; GET `/api/tags`, `/props`, `/v1/props`, `/version`, `/models`, `/api/v1/models`, on both the Anthropic and OpenAI routes) and Claude Code's HEAD `/api/hello`, each carrying the slot token, and requires zero non-harness requests. Hermes on the particle-1 route sends these probes without the token, so in a real trial they count as non-harness probes, reported apart under the count rule above.
2. **The real-image check.** `scripts/gbrain-install/real-image-check.sh` runs the four real install-mode images through the runner's own install trial, keyless, with a fake model upstream, on one fresh VM through the same SSH path the fan-out uses, from the runner commit `166c93dad21a0a13944080bd5f8db4a4fc00dfea` at the pinned release. Six cases: Claude Code with Opus 5.5, Codex with GPT-6.1 Sol, OpenClaw with Opus 5.5, and Hermes with Opus 5.5, GPT-6.1 Sol and particle-1. Each must pass (a) the model call went through the metering proxy with the trial token; (b) gbrain is wired and visible in a new session; (c) no token or provider key is in the agent's shell environment; (d) the brain path agrees across gbrain, the probe and the watcher. Result: passed all 7 cases at 2026-11-17T04:06:24.222Z, gbrain v0.60.734.0 (a278ddf45887): the six install cases on checks a to d, and the Claude Code WebFetch case, which installs nothing and fetched the install page ([preflight/real-image-check.json](preflight/real-image-check.json)).
3. **Paid smokes:** one run per cell shape, and the Fable 5.2 smoke ([smoke/prereg-smoke.json](smoke/prereg-smoke.json), run id `gbrain-install-smoke-2026-11`, 2 runs per arm, cap $20). They are uncounted. They are the first check of the OpenClaw and Hermes transcript parsers against real transcripts, and their records and the parser check are recorded by dated amendment before the canary launches.

## Deviations from the plan

**Accepted departures** (decided 2026-11-15):

1. `egress_blocklist.py` stays in `scripts/frontier-harbor/`, because the gstack-delivery run's pins.sha256 pins it there. The shared entry `scripts/egress/egress_blocklist.py` imports it.
2. The keyless oracle uses a fake gbrain CLI and stand-in harness CLIs. The real-image check covers the real path.
3. The OpenClaw and Hermes transcript parsers are unchecked against real transcripts until the paid smokes, which check them.
4. The agent can still read the token file under `/he-secret/` or the harness config. This is the token channel as planned: the token is kept out of the agent's shell environment, not out of its reach.
5. A GitHub 403 or 429 inside an HTTPS tunnel is invisible to the egress proxy. INFRA is detected from tool output and plain-HTTP status.
6. A process-mode Codex cell is blocked by the HE-NET-001 guard, so every cell runs in docker mode.
7. The cold download installs bun from npm, or from Bun's release zip through Python where the image has no npm, in a temporary HOME, because no harness image ships bun.

**Also different from the plan:**

- **Release:** the plan expected the baseline to wait for v0.60.722.0 on stable. It pins gbrain's newest release at freeze and tells both arms to install it, by the rule in [Release pin](#release-pin).
- **The version line** is not in the plan. It was added on 2026-11-16 under R100, as above.
- **Arm B's file:** the plan named `arms/agents-md-<release>.md` (the AGENTS.md install section). Arm B is the README paste prompt, `tasks/gbrain-install/arms/paste-0.60.734.0.md`.
- **The cold download** is timed once per harness image before its first install trial, not once per run.
- **GET /v1/models:** the plan said install slots refuse it. With the slot's token it is forwarded free and recorded as the harness's own (harnesses list models at startup); without the token it is refused at $0 and counted as non-harness. No second canary-token slot is used, because no trial needs a key in its shell.
- **A corrected inconsistency in the plan.** Its first R97 line says the fix order uses the finish line "as read", while its design section says the fix order and the stop rule both use "as scored", so an unvalidated reader never steers the fixes. The design section is the approved intent, so this file uses "as scored" for both.

**From docs/methodology.md:**

- **Item 10 (task-clustered intervals, at least 10 task clusters):** this eval has one task, run many times. Intervals are run-level (Wilson, Newcombe and bootstrap as above), and the calls it makes are between arms and between releases, never between harnesses as a ranking.
- **Item 4 (the harness receives one world MCP server):** install cells wire no world and no gbrain; the only gbrain wiring is what the agent makes.
- **Item 6 (default-deny egress):** install cells need open egress to download gbrain, so they use a pinned blocklist with every connection logged.

## Money

| Line | Baseline | Each rerun |
|---|---:|---:|
| Counted runs (80 Opus 5.5, 80 GPT-6.1 Sol, 40 particle-1) | $190 (lease cap $450) | $190 (cap $450) |
| Fable smoke and per-cell one-run smokes | $22 | $10 |
| Ubicloud VMs (about 24 VM-hours at $0.50) | $12 | $12 |
| Agent model use (build, preregistration, two ship passes, miss readers, report) | $520 | $110 |
| Proxy change as its own pull request under full review | $200 | $0 |
| **Total, expected** | **about $950** | **about $325** |
| **Ceiling** | **about $1,350** | **about $600** |

- Program total for the baseline plus up to 4 reruns: about $2,250 expected and $3,750 at the ceiling. A loop that stops early costs less.
- The run cap is $450, the counted-run lease cap. Caps are runaway protection.
- The coordinating agent hears before paid spend passes $3,500. Spend lines go in a spend file beside the report, not here.

## Commands

From a worktree pinned at this preregistration's merge commit, with `UBI_QUOTA_VCPUS=464`, `UBI_QUOTA_WAIT=<seconds>` and `UBI_OWNER` set on every call:

1. Fan-out: `scripts/ubicloud/fanout.sh --manifest <manifest> --parallel 2 --max-vcpus 32` with the shards above, canary first. Each shard runs `scripts/run-shard.sh --prereg docs/benchmarks/2026-11-17-gbrain-install/prereg.json --name <shard> --cells <cells> --lease-usd <lease>`.
2. Merge: `bun scripts/merge-shards.ts` over each shard's `<dest>/<shard>/results`.
3. Verdict: `bun scripts/gbrain-install/verdict.ts <run dir>` (and `--json`).
4. Failure table: `bun scripts/gbrain-install/failure-table.ts <run dir> --arm bare --md <file> --csv <file>`, and again with `--arm paste`.

## Pinned files

30 files, each with its sha256 in [pins.sha256](pins.sha256): the runner and scoring files at the runner commit `166c93dad21a0a13944080bd5f8db4a4fc00dfea`, and the paste file as this pull request adds it. From the repository root, `sha256sum -c docs/benchmarks/2026-11-17-gbrain-install/pins.sha256` checks them.

- `tasks/gbrain-install/task.json` `6c901b21ea9f`
- `tasks/gbrain-install/arms/bare.md` `810d0b976ca4`
- `tasks/gbrain-install/egress.json` `0d8c5b6f4865`
- `tasks/gbrain-install/nonce.ts` `8f79a65a25bc`
- `runner/trial/install.ts` `1cc2918e2bb5`
- `runner/trial/install-cell.ts` `de44d70495b5`
- `runner/trial/egress.ts` `b2f13560ff08`
- `runner/trial/proxy.ts` `d112b896cdde`
- `runner/proxy/metering-proxy.ts` `46ff5fe75f08`
- `harnesses/_install/probe.sh` `d8313c190de6`
- `harnesses/claude-code/adapter.sh` `6c9645965b50`
- `harnesses/codex/adapter.sh` `0d7bca32845e`
- `harnesses/openclaw/adapter.sh` `c1919604f80e`
- `harnesses/hermes/adapter.sh` `ab338ea449a0`
- `harnesses/claude-code/pin.json` `a3f2d0258e85`
- `harnesses/codex/pin.json` `526130669d9e`
- `harnesses/openclaw/pin.json` `3b4bbec8ed5e`
- `harnesses/hermes/pin.json` `43928f7ed3f4`
- `scripts/egress/egress_blocklist.py` `5adc4bdb5516`
- `scripts/frontier-harbor/egress_blocklist.py` `d7a774662210`
- `tests/proxy-install-slot.test.ts` `b97985811568`
- `scripts/gbrain-install/README.md` `83b3d833f9a2`
- `scripts/gbrain-install/classify.ts` `affeea05c596`
- `scripts/gbrain-install/failure-table.ts` `966ef0d50301`
- `scripts/gbrain-install/real-image-check.sh` `7911a89bdb4e`
- `scripts/gbrain-install/real-image-check.ts` `b40f20a9dbc3`
- `scripts/gbrain-install/steps.ts` `aaf802318f00`
- `scripts/gbrain-install/transcript.ts` `cb8f3d6e5105`
- `scripts/gbrain-install/verdict.ts` `b092f1926bd3`
- `tasks/gbrain-install/arms/paste-0.60.734.0.md` `1af1d5967c22`

Any change to a pinned file before the report is a dated amendment or a new run id.

## Receipts

Under `docs/benchmarks/2026-11-17-gbrain-install/results/`: per shard its trials, ledger, proxy usage, egress log, cold-download line, install stops and VM records; the merged trials; the verdict and failure tables; the two audits; the miss readers' notes. The real-image check's report is `preflight/real-image-check.json`. Transcripts pass the token canary scan and the public-safety scan before the results pull request.

**Order.** This preregistration and the results never share a pull request. This file merges to main before the first counted trial; the results and report come in a later pull request, and the per-step failure table goes to gbrain's maintainers (internal-task) when the results merge.

## Amendments

Each amendment is a dated commit before any cell it affects: the smoke records, any new wave after the release tag moves, and each rerun's release pin. A rerun on a release that changes the install's notices, pages or recall paths states how this file's rules apply to it.

## Outside terms

The scoring code ports gbrain-evals Cat 41 at commit `4f27313a` (MIT, same owner), with each file's source and sha256 in [scripts/gbrain-install/README.md](../../../scripts/gbrain-install/README.md). Harness licences are unchanged from the existing adapters. No user data: the fact is a made-up word.

## Disclosures

gbrain is Garry Tan's project. The report ends with the matching lines from the disclosures list, word for word.
