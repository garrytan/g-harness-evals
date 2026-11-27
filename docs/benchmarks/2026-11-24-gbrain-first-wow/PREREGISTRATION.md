# gbrain time to first wow: does importing a new user's history get them a correct, cited answer from it, per harness?

Status: **frozen 2026-11-25** by the dated change under [Freeze](#freeze-2026-11-25), binding once it merges to main. Written 2026-11-24, before any trial and before gbrain's history-import change (called PR 1 here) had landed; both pilots ran on 2026-11-25. No counted trial has run. Run id `gbrain-first-wow-2026-12`. The counted cells are [prereg.json](prereg.json), written by `scripts/gbrain-first-wow/prereg.ts`; [design.json](design.json) is the design in brief.

**In one line:** a new user who has already used Claude Code and Codex installs gbrain, and then, in a fresh session where nobody mentions gbrain, asks three questions whose answers exist only in their old sessions. We count how often the answer is right and cites a record the user can check, and how long it takes, with gbrain as it ships today, with PR 1's history import, with PR 1 plus PR 2's first-session suggestion, and with no gbrain at all.

- **Harnesses and models:** Claude Code with Opus 5.5 and Codex with GPT-6.2 Sol, 4 arms, 100 paired trials per arm ([Freeze](#freeze-2026-11-25)). QM with Opus 5.5, with GPT-6.2 Sol and with particle-1 (the named low-cost model), gbrain as QM's memory against plain QM, 100 pairs each (gbrain has no installer for QM; see [QM](#qm)). The planned OpenClaw cell with particle-1 is left out, because gbrain's import does not run in OpenClaw ([particle-1](#particle-1)).
- **No model judge.** Every answer is scored by rule against values planted in made-up histories.
- **Planning projection, before any pilot:** about $580 to $1,260 all-in, of which $300 to $600 is paid model use ([Cost projection](#cost-projection)).

## The question and the decision

**Question.** Does gbrain's new setup history import (PR 1), and later its first-session suggestion (PR 2), get a new user to a correct, cited answer from their own history more often and faster than today's defaults, per harness? And does a plain agent given the same files do as well?

**Approval.** Garry approved the eval on 2026-11-24 ("Do it", decision G1) on gbrain's onboarding plan, plan v2. The two sections that bind this eval, "Eval pilot" and "The time-to-first-wow eval", and the plan's two round-2 lines uc8 and uc10, were copied unedited into the org drive's handoffs/harness-evals/time-to-first-wow.md the same day. The decision rules and the two round-2 lines below are quoted from that copy word for word.

## What the result changes

The plan's five decision rules, word for word:

> Decision rules: (1) the candidate beats today's defaults on a harness by more than the stated difference: its defaults turn on for that harness; (2) no difference: one Why-null cycle, then KEEP, FIX-METHOD or CUT-CANDIDATE, and Garry hears any cut (R48); (3) worse on a harness: that harness keeps today's setup; (4) the plain-agent arm matches gbrain: the proof page says so; (5) the eval can't decide a harness: defaults stay off there.

The two round-2 lines that also bind it, word for word:

> uc8: landing the code is separate from turning on defaults per harness. Each harness has an activation knob and a rollback knob. OpenClaw's default moves only after a native OpenClaw acceptance check passes. In the eval, the import and suggestion contrasts hold the registration fixed: the defaults arm pins `--surface starter --advertise verbs`, and any registration effect is read from its own pinned contrast.

> uc10: where imported records support it, test a cited answer in one harness from a record written in the other. The no-history case is scored separately (correct abstention plus the import fallback) and never averaged into the rollout verdict. The same rule goes in the preregistration.

How each rule is read, per harness, on the primary contrast (full candidate minus today's defaults, finish-line rate, paired by fixture seed). "The stated difference" is the smallest detectable difference fixed at freeze ([Sample size](#sample-size-and-the-smallest-detectable-difference)).

- **Rule 1, defaults turn on for that harness:** the point estimate is at least the stated difference, and the exact McNemar test clears the final bound (two-sided p at or below 0.049), or the interim look stopped with the candidate ahead.
- **Rule 3, that harness keeps today's setup:** the 95% interval lies wholly below zero, or the interim look stopped with the candidate behind.
- **Rule 2, one Why-null cycle:** the 95% interval lies wholly inside plus or minus the stated difference. The cycle asks whether the agent used gbrain, whether the questions fit, whether 100 pairs were enough, and whether the model already answers unaided; it ends in KEEP, FIX-METHOD or CUT-CANDIDATE, and a cut candidate goes to Garry in plain words.
- **Rule 5, defaults stay off there:** anything else, including a gain that is significant but smaller than the stated difference. Where that gain's interval also lies inside plus or minus the stated difference, rule 5 wins over rule 2, because rule 5 names the case (Freeze).
- **Rule 4, the proof page says the plain agent matched:** on the full candidate minus plain agent contrast, the point estimate is below the stated difference and the 95% interval includes zero. The proof page then says, for that harness, that an agent with the same files did as well.
- **QM:** QM has no gbrain installer, so no setup default can turn on. QM with gbrain as its memory beating plain QM by the stated difference goes to gbrain's and QM's maintainers as the case for a QM install path that imports history; no difference or a loss means no such work is started on this evidence. The QM particle-1 cell is reported beside the Opus 5.5 and GPT-6.2 Sol cells and never carries this call alone.
- **The import alone (PR 1 minus defaults) and the suggestion alone (full minus PR 1):** these set which part gets the credit. If the full candidate wins but the suggestion adds nothing measurable, PR 2's suggestion is reported as not shown to help, and gets its own Why-null cycle.
- **No-history persona:** reported apart (correct abstention, and the import fallback in the gbrain arms), never averaged in. Proposed in this draft, not in gbrain's plan: a gbrain arm that states a made-up value on a no-history question in more than 2 of its 10 trials is reported to gbrain's maintainers as a blocker for that harness's default, whatever the history verdict says.
- **Coding check with the suggestion on** (proposed in this draft, not in gbrain's plan)**:** if the full candidate passes at least 3 fewer of the 15 paired coding tasks than today's defaults in a harness, the suggestion is sent back as a regression before that harness's default turns on.

## Arms

All gbrain arms run one gbrain build: gbrain's newest release on its main branch when the counted run starts, which must contain both PR 1 and PR 2 (R100). Setup is run by the runner, scripted, before the question session; the agent never installs anything. The registration is held fixed across the gbrain arms (uc8): every gbrain arm's MCP entry must read `serve --surface starter --advertise verbs` in Claude Code and `serve --surface full` in Codex (decision G), checked in the harness's config before each trial, and a trial whose entry differs stops as a setup error.

| Arm | What is set up before the question session |
|---|---|
| **defaults** | gbrain set up for the harness as it ships, with PR 1's history import and PR 2's suggestion switched off, registration pinned as above. |
| **pr1** | The same, plus PR 1's explicit, bounded history import of the persona's Claude Code and Codex sessions; suggestion off. |
| **full** | The full candidate: PR 1's import and PR 2's first-session suggestion as they would ship on. |
| **plain** | No gbrain. The same HOME and files, and the harness's own file tools and native memory as shipped (R44). |

The exact setup commands, flags and bound come from gbrain's build and are pinned at freeze ([What we need from gbrain](#what-we-need-from-gbrain)). As landed in gbrain#10249 (PR 1, `87277dd2`, checked against its draft `dd7b936a`: the flags and the two-accept offer are unchanged) and gbrain#10248 (PR 0, `37a2eae8`), every gbrain arm runs `gbrain setup claude-code --surface starter --advertise verbs --json` or `gbrain setup codex --surface full --json` (decision G) on a fresh HOME with no brain, plus:

- **defaults:** `--history none`.
- **pr1:** `--history 30`, the bounded explicit import, which covers every fixture session.
- **full:** no history flag. The scripted person accepts setup's offer the way a person would. Off a terminal, the first `setup_history` decision in the `--json` first-run bundle imports the newest session only; the setup run that accepts it (`--history-decision <id>`) then offers the 30-day range as a second decision, which the person also accepts with a second setup run. Two accepts, as at a terminal.

Setup's `history` JSON is kept with the trial: `status`, `stages`, `sessions_found`, `sessions_imported`, `no_history` and `exit`. The import has one 20-second budget; a run past it reports `partial` and is counted as it stands, and the pilot reports how often that happens. After an import, setup prints a card with three questions built from the person's own decision lines. The planted facts are written as decisions, so the card may quote them; it goes to the runner's log, not to the question session, unless PR 2 puts it there. If PR 2 puts brain text into the session start, the scorer counts that block as a gbrain read when the harness transcript records it. Pinned at freeze from pilot 2: the brain text PR 2's section carries is its "Recent pages" list (each line a quoted page title and its slug), and a list line counts as a gbrain read of the page it names. Clean-arm rule: no Capy drive, no gstack and no gbrain in the plain arm's image, checked by the preflight; any read of a gstack or gbrain file in a plain trial marks it contaminated.

**Codex's registration (decision G, 2026-11-25).** PR 0 (gbrain#10248, `37a2eae8`, gbrain decision I1) changed what Codex setup registers by default: Codex now gets gbrain's full tool set, and Claude Code keeps `--surface starter --advertise verbs`. So Codex's gbrain arms are pinned to `serve --surface full`, held the same across defaults, pr1 and full, and Claude Code's keep starter with verbs. The import and suggestion contrasts still hold the registration fixed within each harness. The Codex cells are reported as measured on the full registration, and no number here compares the two registrations.

### QM

gbrain has no `gbrain setup qm` (checked at gbrain master `d7278e4c`, v0.60.769.0: setup targets claude-code, codex, openclaw, hermes, cursor and pi). Its QM route is the memory provider, set up on the brain host by an operator ([gbrain's docs/guides/qm.md](https://github.com/garrytan/gbrain/blob/master/docs/guides/qm.md)). So QM runs two arms only:

- **qm-native:** QM's `pi-memory-provider` config (harnesses/qm/README.md), with the brain filled before the session by PR 1's import run by hand on the brain host (`gbrain transcripts archive setup-import preview`, then `run`, over the last 30 days), because setup's import is offered only by `gbrain setup claude-code` and `codex`. An import labels nothing for a member: on a personal brain the archive pages name no readers, and when a second member makes the brain shared, gbrain keeps every archive folder to the owner and replaces any wider rule on it. So the QM member who asks is made the brain's owner (`gbrain access member add`, `gbrain access owner set`), and QM's token is bound to them (`gbrain auth rescope --token <QM token> --member <member>`). Before the session, `gbrain access check --token <QM token>` must show the imported pages readable, so a `not_found` in the trial is never a hidden page. This is the route that fits gbrain's design (archive pages are owner-only, and gbrain#10228's guard keeps them so through audience changes). Pilot 1 ran it and added three steps (dated 2026-11-25, [Pilot 1](#pilot-1-ran-2026-11-25)): the import is preceded by the receipt setup would write (`gbrain transcripts archive setup-import receipt --harness claude-code --created-by-setup`), because gbrain refuses an import into a brain made by `gbrain init` alone; the member is linked to QM's actor (`gbrain access member link <member> --qm <QM actor id>`), without which every provider call is refused; and QM's provider reads with `query`, not `recall`, because `recall` returns saved facts only and an import writes pages.
- **plain:** QM's `pi` config, with the same session files in the scope's sandbox workspace. From the freeze, qm-native's sandbox holds the same files too, so both arms have the same file access (Freeze).

QM runs both arms with Opus 5.5, GPT-6.2 Sol and particle-1. particle-1 reaches QM through the custom provider the adapter registers (harnesses/qm/README.md, "QM can run Particle-1", written at an older QM pin); the QM pilot checks it at the current pin.

The QM turn is sent as `origin: {kind: "human"}`, the way QM's own chat surfaces send a person's message. QM's transcripts are parsed by `parseQmTurn` in scripts/gbrain-install/transcript.ts, written and checked against the QM pilot's real transcripts.

### particle-1

**Left out (2026-11-24), before any trial.** The brief planned particle-1 on the full candidate against today's defaults, 60 trials. particle-1 has no route in Claude Code or Codex (the gbrain install eval found the same), so the cell was moved to OpenClaw (decision C). gbrain's maintainers then confirmed from gbrain#10249's code at `dd7b936a` that setup offers the history import only in `gbrain setup claude-code` and `codex`, that its readers are those two transcript formats, and that PR 2 gives OpenClaw the setup card only. So no harness that particle-1 can run in has a full candidate as it would ship, and there is no route that matches what ships. This is an arm left out for a failed precondition (R111), not a dropped arm; particle-1 has no result in this eval outside QM, where it runs as described below.

## Fixtures

Fully synthetic. `scripts/gbrain-first-wow/fixtures.ts` builds one HOME per trial from its seed: project folders, and Claude Code and Codex session files in the folders and line formats those harnesses write (`~/.claude/projects/<encoded cwd>/<session>.jsonl`, `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<session>.jsonl`). Names, values, dates and positions all come from the seed, so no answer repeats across seeds and nothing comes from a real person. Sessions fall in the 28 days before the trial starts, inside gbrain's 30-day import window. The import admits a file by its modification time and dates each message by its own timestamp, so each session file's modification time is set to its last message. The files sit where the harnesses keep them, so the import reads them from the same paths it would on a real machine (no `--history-dir`).

- **history-rich (coding-heavy):** two projects, 22 sessions of ordinary coding chores.
- **messy multi-project:** five projects, 40 sessions; the port was changed once (the old value is in an older session), and each question's kind of fact also appears for another project or feature as a decoy.
- **no-history:** one project and no sessions at all.

Three facts are planted in session text only, never in a project file (checked for every fixture): a feature-flag name, a staging port and a chosen provider, all for one target project. Questions 1 and 2 sit in the home harness's own history; question 3 sits in the other harness's history, so in Claude Code and Codex every trial carries one cross-harness question (uc10). QM trials use the claude-code home, so their question 3 sits in Codex history.

Seeds 0 to 99 are the verdict trials (0 to 29 until the freeze), alternating history-rich (even) and messy (odd); seeds 9000 to 9009 are the no-history trials. The same seed gives the same HOME in every arm of a harness, which is what pairs a trial with its partner.

**The question session** is one fresh session started in the target project's folder with this prompt (`questionPrompt`), which names no tool, memory or file:

```text
I am picking things back up after a break and want to check a few things from my past work.

1. What did we decide to name the feature flag for the <feature> work in <project>?
2. Which port does the <project> staging <service> listen on now?
3. Which provider did I pick for <need> in <project>?

Answer each one as a numbered list in the same order, and for each say exactly where you found it, so I can check it myself. If you cannot find something, say so.
```

The fixture formats are modelled on Claude Code 2.1.312 and Codex 0.165.0. That PR 1's importer reads them is shown by the pilot, not assumed.

## Scoring

Mechanical, in `scripts/gbrain-first-wow/score.ts`. Tool events come from the harness transcripts through the parsers in `scripts/gbrain-install/transcript.ts`.

- **A question passes** when its numbered answer names the planted value, its first line that names the value or a decoy names the value and no decoy (from the freeze; before it, no decoy anywhere), and it cites an auditable reference:
  - a file the HOME holds that contains the value, which a tool call in the session read (the call's output held the value, and its input or output named the file); or
  - a gbrain page the end-state brain holds with the value, which a gbrain call in the session returned (the call's output held the value, and its input or output named the page), or which PR 2's first-session list named with the value. The end-state brain is `gbrain export --dir <fresh dir>` run after the session (`readBrainExport`); an export whose `.gbrain-export-status` does not end in `COMPLETE` makes the trial an `infra_error`.
  - Naming the old port beside the new one is allowed; the old port alone is wrong.
- **The finish line** (primary, binary per trial): all three questions pass.
- **Reference rule:** under the plan's reading, either kind of reference counts in every arm, because the question is what the user gets; the share of passes served by gbrain is reported beside it. The strict reading (a gbrain arm must cite a gbrain page) is scored too and reported as a secondary, never as the verdict ([decision A](#method-decisions-2026-11-24)).
- **Unnumbered replies** are scored as one block for all three questions and counted as unsegmented.
- **No-history:** each answer must state that no record was found (`ABSTAIN_RE`) and must not state a flag or port of the planted shape (`SHAPE_RE`); a trial abstains correctly when all three do. In the gbrain arms, the import fallback counts as shown when the setup output or the session holds one of the fallback markers pinned from gbrain's build.
- **Secondary measures,** per arm and as paired differences: question-session time with a timeout counted at the 600 s cap; end-to-end time including the scripted setup (zero setup in the plain arm); commands run (tool events); person-needed events (the reply ends by asking for input, scored with `asksForInput`, and its last line holds a question mark (pilot 1); the runner answers once with "I'm not sure, use your best judgement" and counts it, and the scored reply is the first numbered reply of the session, else its last reply); questions passed out of three; cross-harness question pass rate.
- **The coding check:** with the suggestion on (full) and off (defaults), 15 paired coding tasks per harness in Claude Code and Codex, in a fresh session that is the first session after setup. Each task is a small fix in the persona's project, graded by its tests. The tasks are written and pinned at the second pilot, once PR 2's suggestion exists.
- **Counted trials:** every trial except `model_error`, `infra_error` and `exam_fault`, which drop their pair from every contrast and are listed with the reason. A timeout or another harness error is a miss; a trial whose harness timed out or failed skips the end-of-trial export and stays a miss, never an `infra_error`. Provider safety-filter stops are their own outcome, reported apart, and drop their pair. A plain trial whose tool calls name a gstack or gbrain path is contaminated, listed and drops its pair. No trial restarts a harness mid-trial.

## Sample size and the smallest detectable difference

100 pairs per arm per harness (30 until the freeze), and 10 no-history trials per arm per harness on top ([decision B](#method-decisions-2026-11-24)). For a paired binary outcome, the smallest difference this design detects with 80% power at the final bound is about 2.81 times the square root of (discordant share / pairs) (`mddFromDiscordance`):

| Discordant share | 20 pairs | 30 pairs | 40 pairs |
|---|---|---|---|
| 0.2 | 28.1 | 22.9 | 19.9 |
| 0.3 | 34.4 | 28.1 | 24.3 |
| 0.4 | 39.7 | 32.4 | 28.1 |
| 0.5 | 44.4 | 36.3 | 31.4 |

Points of finish-line rate. The planning figure is 28 points (30% discordant, 30 pairs). The stated difference is fixed at freeze from the first pilot's discordance between the defaults and pr1 arms, and compared, as the eval-loop practices ask, with the upper end of the pilot effect's interval and with the smallest effect that would change the decision. If 30 pairs can detect neither, the plan is resized or stopped before it freezes. At freeze it was resized to 100 pairs; the stated differences are under [Freeze](#freeze-2026-11-25).

## Analysis

`scripts/gbrain-first-wow/analyze.ts` reads the merged results and applies `scripts/gbrain-first-wow/verdict.ts`. Per harness, each contrast is the paired difference in finish-line rate (b minus a), with a 95% cluster-bootstrap interval (10,000 draws, each seed its own cluster), the exact McNemar test, and the same for time, commands and person-needed events. Preregistered contrasts: full minus defaults (primary), pr1 minus defaults, full minus pr1, full minus plain, pr1 minus plain, and on QM qm-native minus plain. Only the primary contrast carries rules 1, 2, 3 and 5, and full minus plain carries rule 4; the rest are reported with intervals and no verdict. Harnesses are never pooled.

## Interim look

- Look at: 50 of 100 units (the first 50 verdict seeds of the run's trial order, `INTERIM_SEEDS` in scripts/gbrain-first-wow/prereg.ts: 0, 3, 4, 6, 9, 14, 15, 17, 18, 20, 21, 24, 25, 28, 29, 31, 33, 34, 42, 43, 45, 47, 48, 49, 50, 51, 53, 54, 60, 61, 62, 63, 65, 67, 69, 70, 71, 72, 73, 75, 78, 79, 83, 87, 88, 91, 93, 96, 97 and 99; taken per harness once every arm of those seeds has finished, and trials run seed by seed in that order, so they finish first)
- Stop bounds: O'Brien-Fleming for one look at half the information, two-sided alpha 0.05. At the look, a harness stops early when the primary contrast's exact McNemar p is at or below 0.003: candidate ahead is rule 1, candidate behind is rule 3. Otherwise it runs to 100, and the final test uses p at or below 0.049. No other look is taken, and a stopped harness keeps its no-history and coding trials.
- How (from the freeze): the look is `bun scripts/gbrain-first-wow/analyze.ts <dest>/*/results --interim`, over every shard's mid-run copy (scripts/ubicloud/run-shard.sh pulls each VM's results every 20 minutes while it runs), which reads only those 50 seeds and refuses while any question cell lacks a record for one of them. Shards keep running while the look is pending and after it, because stopping a harness's remaining trials saves only a few dollars at pilot prices and the runner has no per-seed stop. A stopped harness is decided by its interim call; its later verdict pairs are reported as description only and never tested again.

## Eval loop

- Size: counted run
- Paid budget: $700 (model calls through the metering proxy, pilots and smokes included)
- Model judge: none

## Pilot

Two pilots, each at most a tenth of its arms' budgets. Pilot 1 runs on PR 1's build once it lands, on gbrain's newest release at that time (R100), on the coding-heavy (history-rich) and no-history personas in Claude Code and Codex: 5 trials per arm (3 history-rich, 2 no-history). It also runs QM's two arms, 5 trials each per model (Opus 5.5, GPT-6.2 Sol and particle-1). Pilot 2 runs once PR 2 lands: the full candidate in Claude Code and Codex, and 3 coding-check pairs per harness. PR 2's shape is set from what pilot 1 shows, as gbrain's plan says.

| Arm | Arm budget | Pilot cap |
|---|---|---|
| defaults | $140 | $14 |
| pr1 | $105 | $10 |
| full | $140 | $14 |
| plain | $105 | $10 |
| qm-native | $90 | $9 |
| plain (QM) | $90 | $9 |

The remaining $30 of the paid budget covers the smokes (one trial per cell shape) and one rerun each of infrastructure failures.

### Pilot 1 (ran 2026-11-25)

On gbrain `87277dd2`, every arm's checks passed in Claude Code, Codex and QM: [pilot-1/README.md](pilot-1/README.md). Claude Code and Codex ran 40 trials twice ($5.50 and $5.46 paid), QM 30 trials with QM at `77024e79` ($2.01 with its smokes and the rerun of seven trials that stopped on runner setup errors before any model call), and 9 more QM trials with `recall` ($0.23). It also ran the full arm, which until PR 2 lands is PR 1's offer accepted twice. The trial runner is `runner/trial/first-wow.ts` (slice `gbrain-first-wow`), with the adapters in install mode. The HOME is `/home/dev`, and the runner links `~/.claude` and `~/.codex` to the adapters' own state directories, so the history sits where a person has it. The first 40 trials ran with an adapter variable, `HE_STATE_LAYOUT=home`, that put the state there directly. It was withdrawn because published runs pin the two adapters byte for byte, and the same cells reran as `gbrain-first-wow-pilot-1b` on the links; that rerun is the record. QM runs through `runner/trial/first-wow-qm.ts` on the default bridge. The gbrain arms use `harness-eval/<harness>-gbrain:<commit>` (`harnesses/_first-wow/`), and plain uses the harness image unchanged. Changes it made, dated 2026-11-25, before any counted trial:

1. The scored reply is the first numbered reply of the session, else its last reply, and the runner sends its one reply only when the reply's last line also holds a question mark. Four Claude Code hedges or offers had triggered it, and the follow-ups dropped the numbered list.
2. `ABSTAIN_RE` accepts "couldn't verify", "couldn't confirm" and "couldn't locate".
3. The proxy's output cap is 128,000 tokens (`--max-output-tokens 128000`), because Claude Code as shipped asks for that much a call.
4. qm-native's provider reads with `query` (decision H). With `recall`, QM answered none of the 27 questions in 9 trials: gbrain's `recall` returns saved facts, never page text (gbrain's docs/guides/qm.md), and an import writes pages. `query` is one of the personal tools in gbrain's QM contract v3. The QM operator steps gain the receipt and the member link described under [QM](#qm), and the access check runs with `--token`.
5. The QM access check asks for the conversations source only when sessions were imported, since gbrain creates that source on import, and the QM runner waits up to 60 s for QM core's host port before each trial. Both stopped trials before any model call and were rerun.

What it found for the counted run: with an import, every history-rich trial finished in every harness and model (12 of 12 in Claude Code and Codex, 9 of 9 in QM). Without one, Codex finished 4 of 6 defaults trials over the two runs and Claude Code 1 of 6; QM plain finished 1 of 3 with Opus, 3 of 3 with GPT-6.2 Sol and 2 of 3 with particle-1. So Codex's and QM-with-Sol's contrasts may sit near the ceiling on the any-reference rule, and the strict rule and time measures carry more of them. pr1 against defaults was discordant in 5 of 6 pairs in Claude Code and 2 of 6 in Codex. A trial costs about $0.14 paid in Claude Code and Codex and $0.06 in QM, below the planning rates.

### Pilot 2 (ran 2026-11-25)

On gbrain `2b4cc26f` (package 0.60.774.0, PR 1 and PR 2, gbrain#10346), 42 trials, $6.15 paid, plus $1.05 of smokes: [pilot-2/README.md](pilot-2/README.md). defaults and pr1 now set up with `--no-suggestion` (setup reported `state: off` in all 20), and full leaves the suggestion on as it ships. The runner records setup's `suggestion` marker, `gbrain onboarding status --json` after the session, and whether the session's own transcript holds the section's first line (`[gbrain] First sessions on this brain`); that last check is the suggestion's part-under-test marker. The coding check is `scripts/gbrain-first-wow/coding.ts`: 15 tasks, graded by hidden tests in a no-network container, seeds mapped by seed mod 15, the counted run on seeds 200 to 214.

What it found:

1. **Claude Code passes.** The section reached the first session in 5 of 5 full trials, and the replies offered the next import in 4 of 5, against 1 of 5 in pr1.
2. **Codex fails the part-under-test check.** gbrain recorded the section as delivered in 5 of 5 full trials, but no Codex transcript holds it, so Codex's full arm measured PR 1 alone. Under the pilot rule the Codex full arm is fixed or left out before freeze; it is reported to gbrain's maintainers, and the Codex full and coding cells rerun on a build that fixes it.
3. **The coding check runs.** All 12 coding trials passed (3 tasks × defaults and full × 2 harnesses), so 3 tasks show no regression and no headroom yet.

- Part under test ran: in pr1 and full, setup's machine-readable result reports a non-zero count of imported sessions, and the end-state brain holds pages for the planted sessions; in full, the suggestion's marker appears in the first session; in defaults, setup reports no import and the brain holds no session pages; in every gbrain arm the registration check passes. In qm-native, QM's provider calls reach the brain and return an imported page. In plain, the preflight shows no gbrain and no gstack on the image.
- Tasks can be supplied: every pilot fixture builds with no fixture problem, the importer reads it (pilot 1), the scorer scores every pilot reply (segmented or not), and each arm's pilot finishes within its cap.

A failing arm is fixed or left out, and reported as left out. The pilot's records, its discordance rate and the stated difference go into this plan by dated change before it freezes, together with the plan-cost receipt.

### Pilot 3 (ran 2026-11-25)

A dated pre-freeze change, after gbrain#10370 and #10375 landed: on gbrain `c341d40d` (package 0.60.774.0), 23 trials, $3.74 paid: [pilot-3/README.md](pilot-3/README.md). Codex full and Claude Code full on seeds 100 to 104, Codex's coding check on seeds 100, 102 and 104, one trial of every other gbrain cell on seed 105, and one qm-native trial per QM model, with the session files in its sandbox.

What it found:

1. **Codex passes now.** The section reached the first session in 5 of 5 Codex full trials, each listing 3 recent pages, and all 5 reached the finish line. Codex full is back in the counted run (decision K).
2. **Claude Code still passes,** and its section now lists 3 recent pages (the imported conversations) where pilot 2's list was empty: 5 of 5 seen, 5 of 5 at the finish line.
3. **Codex's coding check runs:** 6 of 6 passed, with the section seen in all 3 full sessions, under a $20 lease that stopped nothing.
4. **Every other gbrain cell ran on the new build:** one trial each of Claude Code and Codex defaults and pr1, and of qm-native with Opus 5.5, GPT-6.2 Sol and particle-1, all completed and scored.

## Cost projection

- Spend stop: $760 (paid model calls $700 and VMs $60; this thread's own model use is tracked apart in the crew's tally)
- Pilot-priced projection: $214.54
- Projection receipt: plan-cost-receipt.json

**Planning projection, before any pilot** (`bun scripts/gbrain-first-wow/projection.ts`; rates read off the closest measured runs and named in that file):

| Part | Trials | Low | High |
|---|---|---|---|
| Counted trials: Claude Code 160, Codex 160, QM 240 (three models), coding check 60 | 620 | $255 | $510 |
| Pilots and smokes | 96 | $44 | $87 |
| VMs (about 5 minutes a trial, sequential within a shard) | | $30 | $60 |
| This thread's own model use (build, pilots, freeze, run, results, two /ship passes) | | $250 | $600 |
| **All-in** | | **$578** | **$1,257** |

- gbrain's plan estimated about $1,400 of paid model use at "the install eval's measured rate of about $4.75 a trial". The install eval's counted runs spent $143.96 over 200 trials, about $0.72 a trial paid, so this projection's paid part is well below that estimate, and the all-in total is below the plan's $2,000 to $2,300. Own model use is set from what recent evals here spent ($157 to about $335 each). The question session here is longer than an install's recall turn, which is why the rates above sit between that run and the longest Opus 5.5 runs.
- **VMs:** at most 16 vCPU at once for this eval. The counted run and pilots are about 60 VM-hours of trials: four standard-4 shards (about 15 hours) if the pilot shows a standard-4 holds one trial, else one standard-16 (about 60 hours). At freeze: four standard-4 shards, about 30 trial-hours in all ([Freeze](#freeze-2026-11-25)). Each shard runs its trials one at a time, so time to answer is never measured under contention, and no cell is split across machines.

## Freeze (2026-11-25)

Decided by the coordinating agent on 2026-11-25, after the pilots and before any counted trial. The build and decision K below were changed the same day, still before any counted trial, when gbrain's Codex fix landed (pilot 3).

- **Build.** Every gbrain arm runs gbrain `c341d40de3e5f7cacecb064825655ce926d877f8` (package 0.60.774.0; PR 0, PR 1 and PR 2, plus gbrain#10370, which gives Codex sessions gbrain's session-start context, and gbrain#10375, which fills the first-session section's Recent pages list with the imported conversations). It replaced `2b4cc26f`, the build of pilot 2, by this dated change (R100: the newest build on gbrain's main branch before counted runs start); pilot 3 ran every gbrain cell on it. If a newer release lands on gbrain's main branch before the first counted trial, a dated amendment moves every arm to it (R100) after a one-trial smoke per cell. QM runs at main `77024e79`.
- **Size (decision I).** 100 verdict pairs per arm per harness, 10 no-history trials per arm on top, and the coding check's 15 pairs on seeds 200 to 214: 1,600 trials. Why: at pilot prices a pair costs cents, and at 30 pairs Codex could not resolve a 20-point gain, the smallest gain that would turn a default on (R71: size for the question).
- **Stated difference, per harness:** the smallest detectable difference at 100 pairs from the pilots' discordance on the primary contrast, rounded to a point and never below 20 points (`STATED_DIFFERENCE` in scripts/gbrain-first-wow/prereg.ts). This changes the source named under [Sample size](#sample-size-and-the-smallest-detectable-difference), the first pilot's discordance between the defaults and pr1 arms: the primary contrast is the one the rules read, and the pooled pilots give more pairs than pilot 1 alone.

| Harness | Pilot pairs | Discordant | Pilot effect | Stated difference |
|---|---:|---:|---:|---:|
| Claude Code (full minus defaults) | 8 | 7 | +88 points | 26 points |
| Codex (full minus defaults) | 5 | 2 | +40 points | 20 points |
| QM, Opus 5.5 (qm-native minus plain) | 5 | 2 | +40 points | 20 points |
| QM, GPT-6.2 Sol | 5 | 0 | 0 points | 20 points |
| QM, particle-1 | 5 | 2 | +40 points | 20 points |

  The pilot pairs pool pilot 1's record run, pilot 2 and pilot 2's messy-persona run on history-rich and messy seeds. Codex's pairs are pilot 3's full arm on seeds 100 to 104 against pilot 2's defaults on the same seeds: the first build on which the section reaches Codex, paired across two builds, which is good enough to size the run and nothing more.
- **Codex's full arm (decision J, then K).** J: on `2b4cc26f` gbrain records the first-session section as delivered in Codex but no Codex transcript holds it (pilot 2), so Codex full and Codex's coding check were left out. K, the same day: gbrain#10370 landed, and on `c341d40d` the section reached all 5 Codex full sessions in pilot 3, so Codex full and Codex's coding check are back in the counted run, and Codex reads full minus defaults like Claude Code.
- **Order and shards.** Trials run in the runner's `interleave-task` order (seed 1125): seed by seed, each seed's cells interleaved, and a shard keeps that order for its own cells. Six standard-4 Ubicloud shards, one trial at a time each, whole cells per shard and none split: (1) `qm-opus-native`, `qm-sol-native`, `qm-opus-plain`; (2) `qm-particle-native`, `qm-sol-plain`, `qm-particle-plain`; (3) `cc-opus-defaults`, `cc-opus-full`, `cc-opus-defaults-coding`, `cc-opus-full-coding`; (4) `cc-opus-pr1`, `cc-opus-plain`; (5) `codex-sol-defaults`, `codex-sol-full`, `codex-sol-defaults-coding`, `codex-sol-full-coding`; (6) `codex-sol-pr1`, `codex-sol-plain`. About 4 to 7.5 hours each at pilot wall times plus 25 seconds of start-up a trial, about 35 trial-hours in all. Each shard's lease is at least $20, because Codex reserves heavily and a $4 lease stopped two Codex coding trials in pilot 2. QM shards run on the default bridge and the others on the internal network, which is why no shard mixes them.
- **Price.** `scripts/plan-cost.ts` from the pilots: $214.54 in all, and $246.63 when every cell takes the upper end of its own 95% bootstrap range (a sum of per-cell bounds, not a joint bound): $28.66 already spent on pilots and smokes, $174.59 of counted trials and about $11 of VMs ([plan-cost-receipt.json](plan-cost-receipt.json)). The VM figure is plan-cost's standard-16 hourly price times the pilots' trial times; six standard-4 VMs for about 35 hours in all cost about $5 at list price, so the figure is high.
- **Scoring change from pilot 2's messy runs.** An answer passes the value check when its first line that names the value or a decoy names the value and no decoy; a decoy named later, to tell the two apart, no longer fails it. Pilots 1 and 2 re-scored under it change no trial.
- **Fixes from the second-model read (2026-11-25, before any counted trial).** A GPT-6.2 Sol reader checked this plan against the counted-run code. What changed:
  - Rule 4's code now needs its interval to hold zero, as the rule says; it had checked only the lower end.
  - Rules 2 and 5 overlap for a gain that clears the final bound but is smaller than the stated difference, with its interval inside plus or minus that difference. Rule 5 names that case, so it wins (`decide` in verdict.ts).
  - A gbrain page reference now needs the gbrain call that returned the value to name that page in its input or output, as a file reference already needed for its file; before, any gbrain call holding the value counted. PR 2's first-session list counts as a gbrain read of the pages it lists (Arms). Pilots 1 and 2 re-scored under both change no trial.
  - qm-native's sandbox now holds the same session files as plain's, so the QM contrast adds gbrain's memory and nothing else. The pilots before pilot 3 ran qm-native with an empty sandbox; pilot 3 ran it with the files, one trial per QM model, and all 3 reached the finish line.
  - A trial whose harness timed out or failed no longer exports the brain from a stopped container, which had turned a planned miss into an `infra_error`.
  - `scripts/gbrain-first-wow/analyze.ts` is the counted-run analysis: it re-scores each trial with the frozen scorer, applies the exclusions under Scoring (safety-filter stops from the proxy's usage lines, contaminated plain trials), counts timeouts at the cap, adds paired intervals for end-to-end time, commands and person-needed events, the no-history and coding checks, and takes the interim look. Before the freeze only the stand-in dry run called verdict.ts.
- **Fixes from the pre-merge review (2026-11-26, before any counted trial).** The code review before merge found more gaps between this plan and the code. Re-scoring pilots 1 to 3 under these changes changes no trial. What changed:
  - The analysis reads each trial from the results directory it is given, so it works on merged shard results whose recorded paths point at the shard VMs. It also takes several results directories at once, so the interim look can read each shard's mid-run copy.
  - A turn that ends with the adapter's own timeout or error (exit 124 or 2) now also skips the end-of-trial export, in QM too, so the trial stays a miss and never becomes an `infra_error`. The fix above covered only a runner-side kill.
  - A final analysis with planned trials missing gives the affected harness no decision and says how many are missing. A harness the interim look stopped keeps its interim call, and its later pairs are printed as description only, with no test.
  - A provider safety-filter stop is reported as itself even when the trial also ended in an error, and the made-up-value check counts only the no-history trials the summary admits.
  - PR 2's first-session list counts for a page only when one line of it names both the page and the value.
  - The coding grade copies the project with the agent's symbolic links, so the hidden test is now written only into a regular file inside the copy. A test folder or test file linked outside the project fails the task.
- **Amendment, 2026-11-26, before any counted trial: gbrain's dependencies are pinned.** The coordinating agent asked for this when it approved the launch. The gbrain-arm images used to install gbrain with bun's global install from its GitHub commit, which picks gbrain's dependency versions fresh at every build, so shard images built hours apart could differ. `harnesses/_first-wow/Dockerfile.gbrain` now installs the source of commit `c341d40d` with `bun install --frozen-lockfile` from its own `bun.lock`, and `/opt/first-wow/image.json` records the sha256 of `bun.lock` and of the installed dependency tree. Every trial record carries that file; every shard writes `first-wow-images.ndjson` with each gbrain image's id and file; `analyze.ts` prints the dependency trees it saw, and the counted run needs exactly one. Two builds on different base images gave the same tree (`041772cb2594`). On the new images a smoke of Claude Code full, Codex full and qm-native completed 3 of 3 with every part under test running ($0.74 paid, including a first attempt run without the 128,000-token output cap below).
- **Amendment, 2026-11-26, before any counted trial: each finished trial's home is packed.** A gbrain trial leaves about 100 MB in its home: gbrain's raw PGLite database (about 68 MB) and bun's package download cache (about 31 MB). Over about 1,200 gbrain trials that is more than the shard pulls can bring back. After its token scrub and canary scan, each trial now packs the raw database into `.gbrain/brain.pglite.tgz` (about 8 MB) and removes the bun cache (`packRawBrain` in `runner/trial/first-wow-cell.ts`). Nothing scored reads either one: scoring reads the brain export, the transcripts and the agent's text files. Re-scoring the lockfile smoke's trials after packing gives the same summary byte for byte.

## Before the first counted trial

1. gbrain PR 0 (the per-harness registration pin, which adds the setup flag for `--surface starter --advertise verbs`), PR 1 and PR 2 have landed, and the newest release on gbrain's main branch holds all three. PR 0 landed as `37a2eae8` (gbrain#10248) and PR 1 as `87277dd2` (gbrain#10249) and PR 2 as `2b4cc26f` (gbrain#10346), all on 2026-11-25.
2. The archive audience question (whether imported conversation pages are readable by anyone besides the owner) is settled on gbrain's side, and the import's labels are pinned here. Settled 2026-11-24: the guard landed on gbrain master as `afc53119` (gbrain#10228); PR 1 is built on it.
3. Both pilots ran, and this plan was frozen by a dated change with the pins, the stated difference and the plan-cost receipt, and merged before any counted trial.
4. One second-model reader (GPT-6.2 Sol or Astra, read-only) checks the frozen plan against the counted-run code: the launch path, the interim-look order, and whether the analysis matches these rules.
5. Every pre-launch script runs once on a single fresh VM through the same SSH path the fan-out uses; one canary shard finishes a scored trial before the rest launch.

## What we need from gbrain

Asked through gbrain's maintainers, and pinned here when answered. As of 2026-11-24, gbrain's maintainers said PR 1 will carry items 1 (import off, a bounded explicit import and its bound) and 2 (a folder override for the import source) and the sessions-imported and no-history fields of item 3, that the registration pin in item 1 comes in PR 0, and that item 5 follows when PR 1 lands. Item 4 is `gbrain export --dir`, which exists today. Item 6: an import labels nothing; the access steps under [QM](#qm) make the pages readable. On 2026-11-25 PR 0 and PR 1 landed, which answers items 1 (all but the suggestion switch, which is PR 2's), 2, the PR 1 fields of 3, and 5. Still open: the suggestion switch in item 1, the suggestion marker in item 3, which gbrain's maintainers committed to add in PR 2 as a field in `gbrain onboarding status --json` plus a stable string in the session-start section, recorded only after the suggestion was emitted.

1. **Setup flags on one build:** turn the history import off, turn the first-session suggestion off, run the explicit bounded import (its flag and its bound), and pin the registration to `serve --surface starter --advertise verbs`. At `d7278e4c`, setup writes that registration by default, but an explicit `--surface` makes it drop `--advertise`, so the eval needs a flag that pins both.
2. **The import's input:** which Claude Code and Codex files PR 1 reads and which fields it needs, or a flag that points the import at a folder, so the fixtures are read the way a real HOME is.
3. **A machine-readable setup result:** sessions and pages imported; the no-history outcome (the import-fallback marker; in gbrain#10249's draft, `history.no_history` and `status: nothing_found`); PR 2's suggestion marker.
4. **A page dump at the end of a trial:** each page's slug and text, so references can be audited.
5. **The pilot build:** PR 1's merge commit or release tag. Answered 2026-11-25: pilot 1 runs on `87277dd25898eeb3ae5d58316f7b795989b528cb`, the head of gbrain's main branch, whose package version is 0.60.773.0. No release tag holds it yet (the newest tag is v0.60.772.0, and the 0.60.773.0 release commit `c248a86` comes one commit before PR 1), so the pilot records the commit, not a tag.
6. **QM:** which member an operator-run import labels the pages for, so QM's memory provider returns them to the person who asks.

## Not measured

- Permission prompts (the adapters run with permissions bypassed), hosted gbrain.io, macOS, Cursor, Hermes, and the install itself (gbrain's install eval measures that).
- Semantic search: every gbrain arm is keyless, keyword search only.

## Method decisions (2026-11-24)

Decided by the coordinating agent on 2026-11-24, before any trial, as method choices within the eval Garry approved. Each took the recommendation in the first draft.

- **A. Reference rule:** a gbrain page or a file path counts in every arm, and the share of passes answered through gbrain is reported beside it. The strict reading (a gbrain arm must cite a gbrain page) is scored as a secondary only. Why: under the strict rule today's defaults could pass only if the agent ran an import on its own.
- **B. No-history trials:** 10 per arm per harness on top of the verdict pairs (30 then, 100 from the freeze), so they never take a verdict pair.
- **C. particle-1's harness:** OpenClaw. Overtaken the same day: gbrain's import does not run in OpenClaw, so the cell is left out ([particle-1](#particle-1)).
- **D. QM:** QM with gbrain as its memory against plain QM on both Opus 5.5 and GPT-6.2 Sol.
- **E. One build:** the counted run waits for PR 2, and every arm runs on one build.
- **G. Codex's registration (decided 2026-11-25, before any trial):** Codex's gbrain arms register `serve --surface full` in every arm; Claude Code's register `serve --surface starter --advertise verbs`. Why: gbrain#10248 (PR 0) made full Codex's shipped default, because with the starter set Codex made the right call on 12 of 64 requests against 62 of 64 on full in gbrain's own test; and in this repository's MCP-at-scale result (harness-evals#609) Codex used a tool it had to unlock on request in 13 of 131 trials. Pinning starter would measure Codex on a registration it no longer ships with and that is known to handicap it. This departs from uc8's literal wording ("the defaults arm pins `--surface starter --advertise verbs`"), which is quoted unchanged above; it keeps uc8's intent, a registration held fixed across the import and suggestion contrasts. The cost is more input tokens on each Codex turn, which pilot 1 measures before the projection is repriced.
- **H. QM's read tool (decided by the coordinating agent 2026-11-25, after pilot 1 and before any counted trial):** qm-native's provider reads gbrain with `query`, not `recall`, QM's shipped read tool. Why: `recall` returns saved facts only and an import writes pages, so with `recall` QM answered none of the 27 questions in pilot 1's 9 `recall` trials while every brain held the planted facts; `query` is a configuration a QM user can choose, and measuring `recall` would only repeat that gap. Unlike G, this is not the harness's shipped default, so the results state above the fold that QM's shipped provider reads with `recall` and found none of the imported history in the pilot, that the counted QM row uses `query`, and they include pilot 1's `recall` trials ([pilot-1/summary-qm-recall.json](pilot-1/summary-qm-recall.json)) as the evidence.
- **F. particle-1 on QM (added 2026-11-24, after C was overtaken):** particle-1 runs QM's two arms, 30 pairs (100 from the freeze) and 10 no-history trials each, as the eval's named low-cost model (R54), about $15 to $30 paid. It never carries a verdict alone.

## Dry run

`bun scripts/gbrain-first-wow/dry-run.ts` runs every cell and seed above with scripted stand-in agents, no model and no key: 550 fixtures, 1,540 stand-in trials, through the real Claude Code and Codex transcript parsers, the scorer, the interim look and the decision rules. Its output is in [dry-run/](dry-run/README.md). The stand-ins follow fixed rules (the plain stand-in searches the files for the newest matching message; today's defaults finds nothing in an empty brain and falls back to the files on every fourth seed; pr1 drops its citation on every fifth seed), so its numbers say nothing about gbrain or any harness. It shows that every fixture can be answered from its history alone, and `tests/gbrain-first-wow.test.ts` shows that a stand-in taking the first match it finds is caught by the messy fixtures' decoys and old values.
