# Preregistration: does loading a standing rule at session start carry a correction into the next session in the other harness?

Status: **frozen** when this file reaches main, before any counted trial. Written 2026-11-27 from gbrain's approved plan (Garry's cost gate answered "Do it" on 2026-11-26, ask A yes and ask B no), changed the same day after both pilots (see [Changes after pilot 1](#changes-after-pilot-1)). The counted build is gbrain v0.60.779.0; gbrain's maintainers confirmed on 2026-11-27 12:22Z that no gbrain change lands before the counted run. Run id `c2-standing-rules-2026-12`. The counted cells are [prereg.json](prereg.json), written by `scripts/c2-standing-rules/prereg.ts`.

**In one line:** a user corrects their agent in one harness, the agent saves it as a standing rule and the owner approves it; a fresh session in the other harness then gets a task where the old mistake would show. We count how often the second session gets it right with gbrain's session-start standing-rules section switched on, against the same approved rule with the section switched off. Plain `remember` runs beside them for comparison. Claude Code runs Claude Opus 5.5 and Codex runs GPT-6.2 Sol, in both directions, plus a coding check that the section costs no solved tasks.

- **Decision it changes:** whether gbrain turns `rules.session_start` on by default. It stays off until this passes.
- **No model judge.** Every reply is scored by rule against planted values.
- **Paid budget:** $160 for model calls through the metering proxy, pilots included (pilot 1 $6.19, pilot 2 $5.23, the counted run and its reruns capped at $148). VMs $30. All-in stop $690, this thread's own model use included.

## Eval loop

- Size: counted run
- Paid budget: $160 (model calls through the metering proxy, pilot included)
- Model judge: none

## What the result changes

**Primary contrast, which decides:** the rules arm's applied rate minus the control arm's, pooled over both directions, paired by item and direction. The two arms send the same words and get the same owner approval; they differ only in whether `rules.session_start` is on in session 2. So this contrast measures the switch itself. gbrain's maintainers, who own the decision, approved this as the primary contrast on 2026-11-27.

**Headroom (stated before freeze).** Because the owner's approval fixes the fact in both arms, session 2 in the control arm can find the corrected fact by searching. In pilot 2 the control arm applied the correction in 5 of 6, missing only the way-of-working item. So the primary contrast may land near zero on role and value items, and the ways of working (25 of the 70 items), where there is no single fact to search for, are where the section should matter. The report gives the primary contrast by item type beside the pooled one, as a description that decides nothing; the decision rules read only the pooled contrast. Files are a second route to the same ceiling: both sessions share the project folder and HOME, so session 1 can write the correction into a file that session 2 reads. The route is open in every arm alike, so it does not tilt the contrasts, but it can lift every arm. The runner records the files session 1 wrote outside gbrain's store, the bun cache, tmp and the harnesses' own folders, plus Claude Code's CLAUDE.md and Codex's AGENTS.md, and the report gives the count per cell.

**Secondary contrast, descriptive only:** the rules arm minus the remember arm, with the same statistics. It shows how the whole standing-rules path compares with what a user gets from plain `remember` today. It decides nothing.

The stated difference is **15 points**. The decision interval is Newcombe's paired 95% interval; the item-cluster bootstrap interval is reported beside it. `scripts/c2-standing-rules/analyze.ts` applies these rules to the primary contrast in this order.

- **Run incomplete:** if fewer than all 140 planned pairs are scored or listed as dropped, the analysis makes no decision until the run is reconciled.
- **Coding check fails** in a harness (with the section on, it solves at least 3 fewer of the 15 paired coding tasks than with it off): the section stays off whatever the corrections show, and goes back to gbrain to be shortened.
- **Turn it on:** the pooled point estimate is at least 15 points, the exact McNemar two-sided p is at most 0.05, each direction's point estimate is above 0, and the coding check is complete and passes in both harnesses (complete means at least 12 of the 15 seeds scored in both states). A separate gbrain PR flips `rules.session_start` on by default, with a behavior-changes row, and goes to Garry as a default flip.
- **Worse:** the pooled interval lies wholly below 0. The section stays off and the regression goes to gbrain's maintainers.
- **Smaller gain:** a significant pooled gain above 0 that misses turn-on: under 15 points, a direction at or below 0 or missing, or a coding check that is incomplete in a harness. The section stays on request (`context_pack include_rules`, `compile-context --include-rules`), and gbrain's standing-rules guide says which harness it helped.
- **No measurable difference:** the pooled interval lies inside plus or minus 15 points. One Why-null cycle (did the section render and did the agent read it; did the approval already fix the fact so well that search alone found it; was the control arm already at the ceiling; were 140 pairs enough), then KEEP on request, FIX-METHOD or CUT-CANDIDATE, and Garry hears any cut candidate in plain words (R48). If the control arm is at the ceiling without the section, one honest attempt at harder probes comes before any cut (R61).
- **Anything else** (not significant, interval too wide to rule out 15 points): the section stays off, and the report says the run could not decide.
- **The verdict is final only after the scorer check** (below) passes. Below 36 of 40 the verdict is FIX-METHOD, whatever the numbers say.

## Arms and models

| Direction | Session 1 (the correction) | Session 2 (fresh, the probe) |
|---|---|---|
| cc->codex | Claude Code, Claude Opus 5.5 | Codex CLI, GPT-6.2 Sol |
| codex->cc | Codex CLI, GPT-6.2 Sol | Claude Code, Claude Opus 5.5 |

- **rules:** in session 1 the user asks a question that draws the planted mistake, then corrects it in fixed words ending "Keep this as a standing rule." Between sessions the runner approves, as the owner at a terminal, every rule session 1 saved that is not yet confirmed, whether active or proposed (`gbrain rules approve <id>@<revision>` under a pseudo-terminal with no agent marker; `scripts/c2-standing-rules/pty-answer.py` types the short code gbrain asks for). An agent's `correct` over MCP on a brain with no owner set only proposes the rule, and the owner's approval also fixes the fact (pilot 1). `rules.session_start` stays on for session 2.
- **control:** the rules arm exactly, then the owner switches `rules.session_start` off (`gbrain config set rules.session_start off`) before session 2. The approved rule and the fixed fact are still in the brain, so session 2 can still find them by searching; only the session-start section is missing.
- **remember (plain words):** the same session 1, with "Remember this." in place of "Keep this as a standing rule." No approval step. It measures what a user's plain words get on the shipped build, whatever tool the agent picks. In pilot 2 on v0.60.779.0 both harnesses called `correct` (6 of 6, never `remember`), the proposed rule was never approved, and session 2 applied the correction in 0 of 6. That is the shipped build's behaviour, and the report states it as such (the coordinating agent, 2026-11-27: kept as a descriptive arm rather than left out).
- **floor (pilot 1 only):** session 1 asks the question and sends no correction. It showed the planted mistake appears in session 2 (6 of 6), so the contrasts have room to move.
- **Held the same in every arm:** gbrain set up for both harnesses on one brain (`gbrain setup claude-code --surface starter --advertise verbs` and `gbrain setup codex --surface full`, each with `--history none --no-suggestion`), `rules.session_start on` before session 1, and the same item, words and order.
- **Why `--no-suggestion`:** gbrain's first-session suggestion shares the session-start section budget (2,048 bytes) and comes first, so on a fresh brain it could push the standing rules out. Switching it off in every arm keeps the measured thing the standing-rules section alone.
- **Harness versions:** Claude Code and Codex at the pins in `harnesses/claude-code/pin.json` and `harnesses/codex/pin.json` at the freeze commit, in install mode (the adapters wire no MCP server of their own), as in the time-to-first-wow eval. Session 2's model is the cell's one `utility_models` entry, so the metering proxy admits it; it is a model under test, not a housekeeping model.
- Not run: particle-1 and QM (Garry, ask B: no). No Sonnet, Haiku or Fable. No gstack in any arm, so R44's no-gstack arm does not apply; the clean-arm preflight still runs (no Capy drive, no gstack). The preflight reads the base images; the gbrain images add only gbrain's own source under `/opt/gbrain` (its `.gstack/` CI settings, its own plugin skills and source files that mention gstack), with no gstack skill anywhere a harness loads skills from (checked by hand on 7fdd1d09 on 2026-11-27, and again on the counted build before launch). No counted cell passes `--harness-env`.
- **gbrain build (R100):** gbrain's newest release on its main branch when the first counted trial starts, at or after v0.60.779.0 (`7d1850f63fbbb3e03d87181a89abfa1af9d575c4`, published 2026-11-27 10:55Z), the release carrying gbrain#10543. It lists `correct` in Claude Code's default registration (9 tools listed, checked on the built image on 2026-11-27) and tells agents to use `correct` only for an explicit correction or standing rule and `remember` for an ordinary "remember this". The build freezes when the first counted trial starts. Images: `harnesses/_first-wow/` (gbrain from its commit tarball with `bun install --frozen-lockfile`; the dependency-tree sha256 is recorded per image).
- **Fallback (the coordinating agent, 2026-11-27), not used:** v0.60.779.0 shipped before the deadline. Had no release carrying gbrain#10543 been on gbrain's main by 2026-11-29 12:00Z, every correction cell would have set `claude_code_advertise: "starter"`, so Claude Code's setup would run `--surface starter --advertise starter`, labelled everywhere as not the shipped default. The runner keeps the option (`claude_code_advertise`); no counted cell sets it.

## How one trial runs

`runner/trial/c2-rules.ts` (slice `gbrain-first-wow`, task `correction`). The trial's HOME is one state directory mounted at `/home/dev` in two containers in turn, so both harnesses share one brain, as one person's would.

1. Session 1's harness starts in install mode. The runner runs its gbrain setup, writes the item's page (`gbrain put`) and the wrong fact (`gbrain remember ... --content-origin user_said`) as the owner, then switches `rules.session_start` on.
2. Session 1: the question, then (rules, control and remember) the correction. If the last reply ends by asking for input, the runner answers once: "Yes, go ahead."
3. The runner records `gbrain rules list` and `gbrain recall <page>`, approves (rules and control), records the rules again, switches `rules.session_start` off (control only) and exports the brain. The container stops.
4. Session 2's harness starts fresh in the same HOME, the runner runs its gbrain setup, removes any `out.md` session 1 left, and session 2 is the probe, which asks for the answer in `out.md`. Only a regular file is read, never a link, and only while `src/notes` is still a folder inside the trial's HOME; if a session swapped it for a link, out.md counts as missing. If the reply ends by asking for input, the runner answers once: "I'm not sure, use your best judgement". The brain is exported again.

A setup, seed, registration or owner-step failure (listing the rules, an approval, the switch) stops the trial as a harness error before session 2 and before any model call it would waste; it drops the pair and is listed. The runner scrubs the trial token from the trial record as well as from the files, and the run stops if a provider key value is in either. The token is scrubbed and a canary scan runs, as in the install and time-to-first-wow evals.

## Items

70 counted items and 3 pilot items (101 to 103), fully synthetic (`alice-example`, `acme-example` and so on), in `scripts/c2-standing-rules/items.ts`. One item per trial: each trial's brain holds only its own item.

- 24 role or title facts (a person's title, team or employer).
- 21 values (a date, an amount, a count, a place).
- 25 ways of working ("put ticket ACME-2291 in the subject", "use metric units with globex-example").

Each item plants the wrong fact or practice on a brain page, scripts session 1's two user turns, and gives session 2's probe: a short writing task saved to `out.md` (an intro line, a status note, an email subject) where the mistake would show.

## Scoring (code only)

`scripts/c2-standing-rules/score.ts`:

- **Applied** (primary, per trial): `out.md` is there and not empty, matches every expect group (any one listed spelling), and has no reject entry outside a negation window. Matching is case-insensitive on whole words (a letter or digit at an entry's edge may not touch another letter or digit), with curly quotes straightened and thousands commas dropped ("$95,000" reads as "$95000"). The negation window is 6 words before a reject match holding `not`, `never`, `no longer`, `rather than`, `instead of`, `formerly`, `former`, `previously`, `n't` or `ex-`. A test checks that each item's own right answer scores applied and its planted wrong fact does not.
- **Part under test ran:** session 1's gbrain calls (MCP tools, and gbrain CLI commands in a shell; a call counts when it was made, so "called correct" includes calls that failed), whether a rule it saved is active after it, whether the approval left every rule it targeted active and confirmed (rules and control), and whether session 2's transcript holds the section's first line (`Standing rules (data:`): it should in the rules arm and should not in the control arm. Reported per cell. A trial where the save did not happen still counts: that is the arm's behaviour.
- **Scorer check:** after the counted run, 40 counted outputs drawn at random (seed 3827) are labelled applied or not from the item and `out.md` alone, blind to the scorer's verdict, by the agent that ran the eval (a model, not a person), and agreement is reported with every disagreement. Below 36 of 40 is FIX-METHOD. This checks string rules against a known right answer, so R124's blind person check does not apply.
- Secondary, deciding nothing: whether session 1's first reply used the planted wrong value (a reject entry outside a negation window; read for roles and values only, since a way-of-working question differs from its probe), whether session 2 searched the brain, whether session 1 wrote a file (as in the headroom note), dollars per trial, wall time.

## Coding check

The time-to-first-wow eval's 15 coding tasks (`scripts/gbrain-first-wow/coding.ts`, seeds 200 to 214), graded by hidden tests in a no-network container, in each harness with `rules.session_start` on against off. In both arms the owner first saves 30 standing rules at a terminal (`CODING_CHECK_RULES` in `items.ts`, confirmed at once), so the section, when on, is filled up to its 1,500-character cap. With it off, the build's default (off) is left as it is. The rules are about made-up people and companies, never about code. 15 paired tasks per harness, 60 trials. Setup is the defaults arm's (`--history none --no-suggestion`). A pair counts only when the section loaded in the section-on run and not in the section-off run; a pair that fails this check is listed and does not count toward the 12.

## Sample size and the stated difference

**Sized so the decision can move (R97; the coordinating agent, 2026-11-27).** The decision bar is 15 points, so the run must be able to detect 15 points: at 80% power, with a tenth of the pairs going the other way (the control arm right where the rules arm is wrong), the pooled minimum detectable difference must be at most 15 points. Exact McNemar, two-sided 0.05, pairs independent, enumerated on 2026-11-27: that needs at least 65 items (130 pairs, power 0.81 at 15 points). The plan uses **70 items** (140 pairs, power 0.84 at 15 points), so up to 7 dropped pairs still leave power at about 0.81. 70 items x 2 directions = 140 pairs pooled per contrast, 70 per direction. Pilot 2 measured about $0.23 a correction trial on the counted build, so the 420 correction trials fit the cap (Money).

| Pairs | Every discordant pair one way | 5% of pairs go the other way | 10% go the other way |
|---|---|---|---|
| 140, pooled | 5.6 points | 11.4 | 14.2 |
| 70, one direction | 11.1 | 18.1 | 22.6 |

So a 15-point pooled gain is likely to be detected unless more than about a tenth of the pairs go the control arm's way. The two directions of one item share its words, so pooled pairs are not fully independent: McNemar treats them as independent, and the bootstrap interval, which resamples items, is reported beside it to show how much that matters. Per-direction numbers are reported with intervals but never decide alone. An interval inside plus or minus 15 points reads "a difference smaller than about 15 points cannot be ruled out", never "no difference". Paid spend stays under $500, so no interim look (R113).

## Analysis

For each contrast (primary rules minus control, secondary rules minus remember), per direction and pooled, and for the primary contrast also by item type (descriptive only): the applied-rate difference over pairs, Newcombe's paired 95% interval, a 95% item-cluster bootstrap interval (10,000 draws, seed 3827; pooled, both directions of an item resample together) and the exact McNemar p. The coding check: paired solved counts per harness.

- **Drops and reruns:** a trial that ends `infra_error`, `model_error` or `exam_fault` is rerun, at most 3 attempts. A rerun runs as its own shard into a fresh results directory, and the analysis reads the directories in run order: the last attempt is the record, and every attempt is listed. A trial whose last attempt still ends that way, or that never reached session 2, drops its pair; so does a trial whose mate is missing. Every drop is listed. A harness error that still reached session 2 is scored as it stands. A safety-filter stop counts only on the attempt it happened in.
- **Cap stops are runner events.** A trial the metering proxy stopped because a request would have taken the shard past its lease (`cap_stop`) failed because our lease was too small, not because of the harness or the model. It is listed as a cap stop, never counted against the harness or model, and rerun under a fresh lease; cap-stop attempts do not count toward the 3. If reruns would take paid spend past $160, the run stops and goes to the coordinating agent.
- **Safety-filter stops** are reported as their own outcome and drop the pair (R95).

## Sharding and leases

Four shards on Ubicloud standard-4 VMs (16 vCPUs at once), whole cells, trials sequential within a shard, one lease per shard under the $160 cap: the two rules cells (140 trials), the two control cells (140), the two remember cells (140), and the four coding cells (60). Each shard holds a Claude Code cell and a Codex cell, so it builds both harnesses' gbrain images, which every correction trial needs. No cell is split across machines. The run launches from a commit on the results branch, the canary shard first.

The proxy reserves a request's worst case before it runs: about $2.1 for a GPT-6.2 Sol request and $2.9 for a Claude Opus 5.5 request at `--max-output-tokens 128000` in pilot 1. So each lease is the shard's projected spend plus at least three of the largest reservations (about $9), and never under $10: $42 for each correction shard (140 trials at pilot 2's $0.23, $32.30, plus the headroom) and $17 for the coding shard (60 trials at pilot 2's $0.13, $8, plus the headroom). The four leases total $143, inside the counted run's $148 cap, and reruns spend from what the leases have left, or from one rerun shard's lease within the last $5. If correction trials cost more than about $0.24 on the counted build, the shards will hit their leases before their reruns; the run then stops and goes to the coordinating agent rather than raising a lease past the cap. A correction shard takes about 3 hours (pilots: 1.3 to 1.4 minutes a trial).

## Pilot

The pilot shows, on each arm's own outputs, that the part under test ran and the tasks can be supplied (R111).

- **Pilot 1** (done, gbrain v0.60.778.0, run id `c2-standing-rules-pilot-1`, [pilot-1/](pilot-1/)): items 101 to 103 in the rules, remember and floor arms both ways, and coding seeds 101 and 103 with the section on and off in each harness. 26 trials on runner commit 13110a63, then 6 repeat attempts of the rules trials on 8ee17e3b (32 attempts). It found that Claude Code's default registration does not list `correct` (so the rules path never ran from Claude Code), that Codex calls `correct` when told "Remember this", and that $4 leases cap-stop every trial.
- **Pilot 2** (done, gbrain v0.60.779.0, run id `c2-standing-rules-pilot-2`, runner commit 676a1bf0, [pilot-2/](pilot-2/)): items 101 to 103 in the rules, control and remember arms both ways (18 trials), and coding seeds 101 and 103 with the section on and off in each harness (8 trials), on one shard under a $12 lease. $5.23, no cap stops. The rules and control arms' parts ran in 6 of 6 each, and the coding check passed. The remember arm's did not: both harnesses called `correct` when told "Remember this" (6 of 6), the proposed rule was never approved, and session 2 applied the correction in 0 of 6.

| Arm | Arm budget | Pilot cap | Pilot 1 spend | Pilot 2 spend |
|---|---|---|---|---|
| rules | $45 | $4.50 | $2.71 (including $1.27 of cap-stopped trials) | $1.39 |
| control | $40 | $4.00 | none | $1.33 |
| remember | $40 | $4.00 | $1.31 | $1.44 |
| floor | $11 | $1.10 | $1.07 | none |
| coding, section on | $12 | $1.20 | $0.52 | $0.54 (both states, $1.08) |
| coding, section off | $12 | $1.20 | $0.58 | $0.54 |

The rules arm's two pilots together spent $4.10 of its $4.50 tenth.

- **Part under test ran:** in at least 2 of 3 trials per direction, the rules arm saves with `correct`, the approval confirms it and the section appears in session 2; the control arm saves with `correct`, the approval confirms it and the section does not appear in session 2; the remember arm runs session 1 with the plain-words correction, whatever tool the agent calls (change 7: pilot 2 saved it with `correct` in 6 of 6, and the arm stays as a descriptive arm). In the coding check, the section appears with the switch on and not with it off.
- **Tasks can be supplied:** every probe leaves a scorable `out.md` or a scored miss, and every coding trial is graded.
- A failing arm is fixed by a dated change before freeze, or left out and reported as left out.

## Money

| Line | Projection | Cap |
|---|---|---|
| Counted correction trials, 420 (two sessions each) | $97 | three $42 leases |
| Coding check, 60 trials | $8 | one $17 lease |
| Pilot 1, 26 trials (spent) | $6.19 | $16 |
| Pilot 2, 26 trials (spent) | $5.23 | $12 |
| Reruns | | inside the counted run's $148 |
| **Paid model calls** (metering proxy) | **$116** | **$160** (the counted run $148, after the pilots' $11.42) |
| Ubicloud VMs | $10 | $30 |
| This thread's own model use | $250 | $500 |
| **All-in** | **$376** | **$690** |

## Changes after pilot 1

Dated 2026-11-27, before any counted trial, approved by the coordinating agent (and on the primary contrast by gbrain's maintainers):

1. Added the control arm and made rules minus control the primary contrast that decides; rules minus remember became secondary and descriptive. 60 more counted trials at 30 items.
2. The owner's approval covers proposed rules as well as active ones, because an agent's `correct` over MCP on a brain with no owner set only proposes.
3. The counted build moves to v0.60.779.0, the release carrying gbrain#10543 (the `--advertise starter` fallback was not needed).
4. Leases are sized from the proxy's per-request reservation, and a cap stop is a runner event, rerun under a fresh lease.
5. Pilot 2 replaces the floor arm with the control arm and reruns every other arm on the counted build.
6. 40 more counted items (31 to 70: 14 roles, 13 values, 13 ways of working), so the pooled contrast can detect the 15-point bar (Sample size). 420 correction trials instead of 180, inside the $160 cap.
7. After pilot 2: the remember arm stays as a descriptive plain-words arm though its part (a save with `remember`) ran in 0 of 6; the headroom note and the by-item-type report were added; the counted cap became $148 from both pilots' actual spend.
8. The counted run was to wait until 2026-11-28 12:00Z for any gbrain change to the remember path (the coordinating agent, 2026-11-27). gbrain's maintainers said no change is coming, so it runs on v0.60.779.0 as soon as this plan reaches main.
9. From the pre-merge review, before freeze: the runner records the files session 1 wrote outside gbrain (the headroom note) and reads out.md only while `src/notes` is still a folder in the trial's HOME. From the second-model review in the same pass: probes 23 and 61 give the meeting time in Pacific time, so they no longer name the time zone the correction asks for; the analysis makes no decision on an incomplete run; and a coding pair counts only when the section loaded as its switch says. Arms, the other items and scoring are unchanged.

## Not measured

Postgres brains (the runner uses the PGLite brain setup creates); more than one session later; team rules and other members (owner only); OpenClaw, Hermes and QM; real brains; more than one correction per brain.
