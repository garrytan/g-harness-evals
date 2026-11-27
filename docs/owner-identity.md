# Owner identity: the store, the drain and the grader

This page explains how a trial of the owner-identity category is scored: can a harness, with or without gbrain, tell which speaker is the brain's owner? The plan is the internal-task-a plan (internal-task-b). The task bank and its `gold.json` and `people.json` come from the generator under `world/owner-identity/`.

## What is scored

Each task plants 6 to 10 facts, each carrying one invented word (a token). After the trial the store is dumped and the grader finds every occurrence of every token, as a whole word, ignoring case, a plural and a possessive.

- **Owner surface:** a gbrain fact row whose `entity_slug` is the owner's people page (`people.json` `page_slug`) the owner's member page (`memory/members/<owner member>`, gbrain's `access.owner_member`), gbrain's reserved `memory/owner` page, or any other person page whose frontmatter `email` or `emails` names one of the owner's emails (gbrain's owner-entity rule, so a fact gbrain files on a directory entry that carries the owner's email counts as landing on the owner), or a compiled-truth or timeline line of one of those pages. In the no-gbrain arm, a line of the owner's notes file.
- **Person surface:** the same for anyone else in `people.json`.
- **Unattributed surface:** a fact row with no entity or held on `memory/unattributed`, gbrain's place for facts with no known subject, or a line of that page.
- **Other:** everything else. Raw conversation, meeting and session pages hold their import word for word, so they are always other.

Two primary numbers, never combined:

- **False-owner:** facts whose claimant is not the owner that sit on an owner surface on a line that does not name the claimant, over all such planted facts.
- **Owner recall:** facts the owner stated first-hand that sit on an owner surface, over all of them.

The grader also records, per fact, whether it was correctly reported (on the owner's page with its claimant named; for a claimant with no person page, an agent or a press source, naming the source counts: the agent's label or a word such as agent, brief, task prompt, AI, assistant, model or bot, and for the press the outlet or a word such as press, report, article, alert or news, a dated change of 2026-11-19), on the claimant's page, on a wrong person's page, visible as unattributed, anywhere at all, which `attributed_to` values its rows carry, and `filed_as_user` (a row with `attributed_to` "user" that does not name the claimant; recorded apart, it is not an owner hit). An answer check on the last reply is reported apart from the store scores.

```
bun runner/grade/owner-identity.ts --store <store.json> --gold <gold.json> --people <people.json> [--reply-file <reply>] [--arm <arm>] --out <verdicts.json>
```

## Hard cases

Each planted fact carries one hard case, and `gold.json` sets its claimant, utterer, reporter, subject, primary number and correct surface. The generator's `world/coverage.json` counts the tasks per hard case.

| Hard case | What the agent sees | Whose fact |
|---|---|---|
| `owner_quoted_by_other` | someone else repeats what the owner told them | the owner's, secondary |
| `owner_quotes_other` | the owner repeats what someone else told them | the other person's |
| `owner_aliases` | the owner under a nickname, another address or another phone | the owner's |
| `forwarded_email` | a forwarded message, or a forwarded chat line | its author's; the forwarder is the reporter |
| `assistant_on_behalf` | the executive assistant writes for the owner, and about their own plans | relayed owner facts are secondary; the assistant's own are hers |
| `group_chat` | several people in one chat | each speaker's own |
| `swapped_or_anonymous_labels` | speaker labels that are swapped, anonymous or a bare number | the true speaker's |
| `similar_name_decoy` | a contact with the owner's first name, or a near-anagram nickname | the decoy's |
| `me_contact_decoy` | a contact the owner saved as "Me" | that contact's |
| `assistant_model_says_I` | an AI assistant or notetaker says "I" | the agent's, never the owner's |
| `agent_brief_in_user_seat` | an orchestrator's brief about "the user" in the user's turn | `agent:orchestrator`'s |
| `recorder_label_absorbs` | a group-call transcript puts the recording owner's name on another attendee's lines; each such line identifies its real speaker on its own, addressing the owner by name with the speaker's role ("<owner>, speaking as your neighbour: ...") or by self-introduction ("<owner>, <name> here again: ...") | the attendee's |
| `owner_under_generic_label` | the owner's own lines under "Participant 2" or "Speaker 2", with content that identifies the owner ("I set up this call") | the owner's |
| `group_thread_one_label` | an iMessage group export labels every other member with the thread name; members name themselves in the text | each member's own |
| `reported_speech_in_notes` | an agent-written notes page, no speaker labels: "<owner>'s observation: a friend, <name>, told <owner> that ..." | the friend's; the owner is utterer and reporter |
| `press_paraphrase` | a news-alert digest page: "Report claims <owner> ..." | the outlet's (`press:<outlet>`), subject the owner, correct surface not the owner |
| `agent_on_owner_account` | lines sent from the owner's account that the owner's scheduling agent typed and says so | `agent:scheduler`'s |
| `assistant_relays_thread` | the owner's assistant pastes a third party's reply into a group chat | the third party's; the assistant is the reporter |
| `control` | plain first-hand facts | the speaker's |

Each `recorder_label_absorbs` fact carries `cue` in `gold.json`: `clear` when its own line identifies the real speaker, `weak` when only the surrounding lines do, so results can report clear-only and all counts. Every generated one is `clear`, and check.ts verifies the line. No other fact carries `cue`.

The seven hard cases from `recorder_label_absorbs` on rebuild misattribution shapes reported, with roles only, from a real owner's agent; the cast, tokens and wording are the generator's own. Every file of a task that carries one of them is in a format gbrain reads (`format_known_to_gbrain: true`). The dev bank guarantees: `recorder_label_absorbs` in at least 3 tasks across at least 2 meeting formats, `reported_speech_in_notes`, `press_paraphrase`, `agent_brief_in_user_seat` and `agent_on_owner_account` in at least 2 each, and `owner_under_generic_label`, `group_thread_one_label` and `assistant_relays_thread` in at least 1 each. The 42-task bank carries every hard case in at least 6 tasks. `bun world/owner-identity/check.ts` checks both.

## The owner card

Arms N and G give the harness a short card about its owner (`world/owner-card.md`: name, every email, phone and handle, nickname, and "this is the person you work for"). Arm B gives none. The cell's `owner_card` names the file; the runner passes it as `HE_OWNER_CARD_B64` and each adapter writes it where its harness reads standing context, after anything gbrain's installer wrote there:

| Harness | Where the card goes | What the harness does with it |
|---|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR/CLAUDE.md` | user memory, sent with the first turn |
| Codex | `$CODEX_HOME/AGENTS.md` | global instructions, sent with the first turn |
| OpenClaw | `/workspace/AGENTS.md` (serve entry only) | a workspace bootstrap file, in the system prompt's Project Context |
| Hermes | `$HERMES_HOME/memories/USER.md`, one entry | the built-in user profile, in the system prompt as "USER PROFILE (who the user is)" |
| QM | the org SOUL (`PUT /v1/admin/scopes/<org>/soul`) | QM's system-prompt setting, under "## Organization instructions" on every turn |

- **Hermes:** `SOUL.md` is the agent's own identity, so the card goes to `USER.md`. Hermes caps `USER.md` at 1,375 characters for the agent's own memory writes; the adapter raises the cap by the card's length, so the agent keeps the same room as in arm B.
- **QM:** it has no startup file. Its only per-person setting, a person's own SOUL, reaches that person's DMs only, so a channel turn or another member's DM would miss it. The card therefore goes in the org SOUL, labelled "system prompt (org SOUL)" in the ready line.
- **Record:** every adapter writes `logs/owner-card.json` and an `owner_card` field on its ready line. A bad card stops the trial before the first turn (HE-ADAPTER-007).

**The pilot check.** On an owner-identity trial the proxy keeps the harness's request bodies in memory, and the trial record's `owner_card` says whether the card's lines are in the first agent-loop request (the first on the cell model that offers tools). `owner_card.ok` must be true on every pilot trial: the card present and named in ready in N and G, absent and unnamed in B. On QM trials the record's `sender_signal` also lists the sender QM's own loop got each turn (`actor.externalId`, the requester's Slack user id, and the display name).

## The store dump

`runner/grade/owner-identity-store.ts` writes `<trial dir>/owner-identity/store.json`. A gbrain brain is dumped by `gbrain/owner-identity-dump.ts`, which gbrain's own engine runs against the stopped brain: read-only SQL over `pages`, `timeline_entries`, `facts`, `ingest_log` and `minion_jobs`. SQL, because gbrain has no CLI or MCP read that lists fact rows with `attributed_to`. A notes directory (one `<person id>.md` per person) is dumped as it is.

## Arm N: the notes store, no gbrain

A cell with `"notes": true` (and no `gbrain`) gives the agent a plain notes store instead of a brain, so a gbrain arm has a no-gbrain arm to be compared with on the same tasks.

- **Tools:** world-MCP serves the bot three more tools beside `list_files` and `read_file`: `notes_list`, `notes_read` and `notes_write` (replace a file, or add to its end with `append`). Every harness gets the same three, with descriptions that name no person.
- **Files:** one `<person id>.md` per person in `<trial dir>/owner-identity/notes/`, outside every directory the harness mounts. Before the first turn the world copies in the set's people pages (`corpus/<split>/people/`, the pages the gbrain arms import), each named by its person id from `people.json`; the decoy page keeps its file name.
- **Who can write:** only the bot, only that directory, only plain person ids (lowercase letters, digits and hyphens), at most 64 KB a file, and nothing after the fence. A refused call is a `deny` event.
- **Events:** `notes.list`, `notes.read` and `notes.write` in `events.jsonl`, each write with its person and text, plus one `admin.notes_seed`. The trial record's `notes` field counts the seeded files, the writes and the people written, the reads, the refusals and the files at the dump.
- **Grading:** after the fence the runner dumps the directory into `owner-identity/store.json` and grades it like a gbrain store; the owner's file is the owner surface.

The preamble is the same `tasks/multiuser/_shared/preamble.owner-identity.md` the other arms use (`preamble` on the cell); it carries no requester fields. Who the owner is reaches the agent only through the owner card (`owner_card`) and the seeded people pages, which say the same thing the gbrain arms' people pages say.

## The drain before grading

A cell that turns gbrain's own model on (`gbrain.llm: "proxy"`) gets a drain after the world is fenced and before the store is read (`runner/trial/gbrain-drain.ts`):

1. Wait, up to 120 s, until gbrain's facts work is quiet: no change for 15 s in the facts rows of `get_ingest_log`, the `facts-absorb` jobs of `list_jobs` and `get_stats`. gbrain's in-process facts queue keeps its counters in memory with no outside read, so quiet is the best signal it offers.
2. Stop `gbrain serve` with a 30 s grace, keeping the container, and copy its `/brain` out.
3. When a `facts-absorb` job of this trial is still queued, run gbrain's own `gbrain dream --phase facts_drain` once on the copy.
4. Dump the store and count drops: `facts:absorb` ingest-log rows written during the trial, by reason, and failed or dead jobs.

Any dropped or still-queued job, a queue that never went quiet, or a failed drain makes the trial `infra_error` with infra class `gbrain_extraction_dropped` ([HE-GBRAIN-023](errors.md)). A wait whose probes read nothing, or lost gbrain's job list after it once answered, never counts as quiet. The counts are in the record's `gbrain.drain`.

## Family C: sessions the harness launches itself

Family C asks whether gbrain's session capture tells the owner's own sessions apart from sessions an agent started. It runs on Claude Code and Codex in the gbrain arm, 6 tasks each (2 in the dev bank, `oi-16-capture` and `oi-17-capture`; 6 in the 42-task bank).

**What one task does.** The owner sends three DMs, each in a new thread, so each is its own harness session:

1. Session 1: one first-hand fact.
2. Session 2: two first-hand facts and one fact the owner repeats from someone else.
3. Session 3: "run `bash /opt/harness/capture/launch-workers.sh` and reply with the DONE line". The harness runs it from its own shell tool, so it is the orchestrator.

The launcher starts four headless workers (`claude -p` or `codex exec`) as children of that session, each with a brief on stdin that says "The user prefers ...". Two workers get `GBRAIN_SESSION_AGENT=orchestrator` (launch `env`). Two are left to gbrain's detection (launch `detected`): a headless claude or codex with a claude or codex process among its ancestors. Each brief fact is `agent_brief_in_user_seat`: claimant `agent:orchestrator`, subject the owner, primary `false_owner`. The owner's own facts are `owner_recall`. `capture.json` beside `task.toml` lists the seven sessions and the four briefs; `gold.json` places each fact with `where: {session}` and its `launch`.

**How it is wired.**

- **The cell.** It must be `claude-code` or `codex`, with gbrain `{"llm": "proxy", "install": "gbrain-installer"}` and no `config`. Anything else is [HE-TASK-006](errors.md) (`runner/trial/oi-capture.ts`).
- **The adapter.** The runner passes the plan as `HE_OI_CAPTURE_B64`. The adapter's `capture/wire-capture.cjs` adds gbrain's SessionEnd capture hook in the shape `gbrain bootstrap harness` writes. For Claude Code that is a `settings.json` group. For Codex it is a `hooks.json` group plus its trust table in `config.toml`. Both use the gbrain binary and hook launcher that the installer view placed. It then writes the launcher's plan to `/tmp/he-oi-capture` inside the container. A refusal is [HE-ADAPTER-008](errors.md), and `ready` carries `oi_capture`.
- **The pilot check.** After the harness stops, `checkCapture` reads the corpus spool the hook wrote under `<state>/.gbrain/transcripts/corpus/sourced/`. It finds each gold session by its tokens, and the orchestrator session as the one banked session with no gold token. Then it compares gbrain's speaker sidecar (`<session>.speaker.json`) with what that session should carry:
  - owner and orchestrator sessions: no sidecar;
  - env workers: `orchestrator`/`env`;
  - detected workers: `agent-launched`/`detected`.

  It writes `<trial dir>/owner-identity/capture.json`, which records the hook's session-end heartbeats and the launcher's `launch.jsonl` too. `bun scripts/owner-identity/capture-check.ts --trial <dir>...` prints PASS or FAIL per session.
- **The drain.** Before the dump, the drain copies the spool into the brain copy, points `dream.synthesize.session_corpus_dir` at it and runs `gbrain sweep --once`. It runs up to 4 passes while a pass still ingests files. That way the banked sessions reach the store through gbrain's own extraction, with their speaker notes. The counts are in `gbrain.drain.capture_sweep`, and a failed pass is a drain error.

**Scoring.** The two primaries are the usual ones. A brief fact on the owner's page whose line names the agent counts as correctly reported, for example gbrain's context note "speaker: agent orchestrator, not the owner". The summary adds `by_launch`, which shows both primaries for `typed`, `env` and `detected` facts apart.

## The pilot audit

```
bun scripts/owner-identity/audit-sample.ts --verdicts <verdicts.json>... --n 40 --seed <s> --out audit.md
bun scripts/owner-identity/audit-sample.ts --score audit.md
```

The first draws 40 verdicts per arm, each with the line that decided it, as a table a reviewer fills in with agree or disagree. The second reports agreement per arm.

## Held-out banks in sealed custody

A counted bank is generated from a secret seed (`generate.ts --seed-file <file> --split heldout --tasks 42`) and sealed with its own world: `seal.ts --world <bank>/world` ([sealed custody](sealed-custody.md), "A set with its own world"). Its held-out cells read the bank's world, `people.json` and people pages from the opened root, and name `"owner_card": "world/owner-card.md"`, the bank's card in that root. The dev set's public world, people and card never reach a held-out cell. `summarize-run.ts` and `compare-run.ts` count owner-identity tasks under their `owner_identity_I`, `_L` and `_C` families. Their grade is `n/a`, since the scores are in each trial's `owner-identity/verdicts.json`. A preregistered owner-identity claim names `comparisons.owner-identity.json` as its source, and export.ts makes that file inside custody with the analysis below, so the claim is decided from the verdicts. A held-out cell cannot name sealed tasks, so it names task families instead: `"families": ["owner_identity_I", "owner_identity_L"]` for N, G and B, and `["owner_identity_C"]` for the session-capture cells (the runner reads each task's `family` in `task.toml`). A counted run planned in two stages runs `runner/run.ts run --task-half 1` and later `--task-half 2` (`run-shard.sh --task-half`): within each family the tasks sorted by id alternate between the halves, so stage 1 holds half of every family and every cell runs the same tasks in it. `scripts/merge-shards.ts` joins the two stages: a cell may have trials in one shard of each half (`shard.json` records `task_half`), and `shards.json` names the pair under `task_halves`. Row P runs under custody with `--sealed-root <root>`: it reads the bank's world, `people.json`, held-out gold and people pages from the opened root, writes to `--out <raw results>/row-p` (outside every checkout), binds its `summary.json` to the opening, and prints progress counts and one closing line of paths and a digest; the step log is `<out>/row-p.sealed.log`. A row P try whose import or extraction step exited non-zero is counted under `failed_tries` and adds no fact to row P's rates.

## The analysis

```
bun scripts/owner-identity/analyze.ts --results <dir> [--row-p <row-p out>]... [--config <file.json>] [--sealed-root <root>]
```

It writes `comparisons.owner-identity.json` and a short Markdown table beside `trials.jsonl`. Every rate is planted facts pooled over trials, with a 95% interval clustered by task: a bootstrap, or below 5% a Wilson interval on the design-effect effective n, which the file records (`runner/stats/clustered-rate.ts`). Paired comparisons pair each fact by task (its value is its mean over a side's scored trials) and use the kit's cluster bootstrap and sign-flip test.

- **Per cell:** false-owner and owner recall, trials, tasks, exclusions (model error, infra error, exam fault, no verdicts) and dropped or timed-out extraction jobs from `gbrain.drain`.
- **Comparisons**, each with an id such as `g_vs_n/false_owner/<model>/<harness>`, its cell groups `a` and `b` (b minus a), the interval, p, Holm p and the preregistered smallest detectable difference: G vs N and B vs G per harness (Holm across a model's harnesses) and pooled (the harness is `pooled`); row P against the model's G cells on family I (`p_vs_g/<metric>/<model>/pooled/I`, with a non-inferiority p at the configured margin); and harness against harness on family I G-arm false-owner (`harness_vs_harness/false_owner/<model>/<h1> vs <h2>/I`, Holm across the model's pairs), plus the same id ending `/no_hook_sweep` for the sensitivity line that drops hook and sweep rows.
- **Flags:** hard cases pooled over a model's G cells and in row P, flagged at 10% or more with the interval's lower bound above 5%; each arm's pooled false-owner against the 1% bar; recorder-label hits on clear cues and on all; the stage-1 look (headroom stop, fault stop). There is no headroom stop while a planned N or G cell has no scored trial or a rate has no denominator.
- **Family C** per harness and model, never pooled, beside its session counts. A worker that never started (no launch row and nothing banked) is not run, and its facts leave every rate: the brief metric, the family C rates, the cells and the arms. The launcher writes a started row for each worker as it spawns it, so a worker still running when the turn ended counts as started.

The config (`--config`, or `heldout.owner_identity` in a sealed preregistration, which every claim on this source needs) names `sdd` (`g_vs_n_harness`, `g_vs_n_pooled`, `b_vs_g_harness`, `b_vs_g_pooled`, `p_vs_g`, `harness_vs_harness`), `p_vs_g` (`model`, `margin`, `p_model`, default `opus`) and optionally `seed`, `draws` and `design_effect_fallback`, fractions throughout. A claim reads one entry: `"source": "comparisons.owner-identity.json", "path": "comparisons", "where": {"id": "<entry id>"}`, with its rule, direction and, for non-inferiority, its margin.

## Changelog

### 2026-11-26: review fixes before the counted run

The page now says how the merge joins the two stages, that a failed row P try adds no fact, that a blind drain wait is never quiet, when the stage-1 look withholds a headroom stop, and that a worker that never started leaves every family C rate. Why: the pre-merge review found each of these gaps in the code, and the code now does what the page says.

### 2026-11-21: task families and stage halves

Held-out cells can take part of a sealed bank by task family, and a run can go in two halves for its planned look. Why: the counted bank's task names are sealed, its capture tasks need their own cells, and the preregistered look comes at half the tasks.

### 2026-11-21: the analysis, sealed claims and sealed row P

The page gains the analysis script and its config, the claim source a sealed export decides owner-identity claims from, and row P's sealed input mode. Why: compare-run graded these tasks n/a, so no preregistered owner-identity claim could be decided, and row P could not read a sealed bank.

### 2026-11-21: held-out banks in sealed custody

The page gains how a counted bank is sealed with its own world, where its held-out cells read the world, people and owner card, and what export can and cannot decide for it yet. Why: the counted banks are not slices of the public world, so the sealed lifecycle needed a set that brings its own world.

### 2026-11-19: family C, session capture

The page gains family C: the task shape, the cell and adapter wiring, the pilot check and the corpus sweep in the drain. Why: internal-task PR 1c adds the session-capture tasks to the generator and the runner and adapter support to run them on Claude Code and Codex.

### 2026-11-19: the owner card on every harness

The page gains where each harness gets the owner card and the pilot's check that it reached the model. Why: OpenClaw, Hermes and QM now take the card too, and arm B must be shown to have none.

### 2026-11-19: arm N

The page gains the notes store: its tools, files, permissions, events and grading. Why: arm N, the no-gbrain comparison arm, now has a store the runner can grade.

### 2026-11-19: clear recorder-label cues

Every line a transcript puts under the owner's label now identifies its real speaker on its own, and those facts carry `cue` in gold. Why: in a run, two of five recorder-label lines were identifiable only from the next line thanking the speaker.

### 2026-11-19: hard-case list

The page gains the list of hard cases, including seven rebuilt from a real owner's misattribution shapes, and what the dev and 42-task banks guarantee for them. Why: the generator gained those hard cases and the dev bank was rebalanced toward meeting transcripts and reported speech.
