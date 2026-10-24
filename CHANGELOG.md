# Changelog

What each harness-evals release changed. Versions follow `VERSION` and `package.json`.

## [Unreleased]

### internal-task: the company brain (build)

- `gbrain/build-brain.ts --brain company`: every record of a split (channel and DM pages, every file, every email, every meeting) in one federated gbrain source per distinct reader set, one bearer token per member granted exactly its sources (writing to `private-<member>`) plus `public-only`, in `tokens.json`; `manifest.json` schema_version 2 with sources, grants and per-page readers. The bot-visible page list and manifest are unchanged (snapshot test).
- `gbrain/Dockerfile`: four brains (`/brains/{dev,heldout}` and `/brains/{dev,heldout}-company`); gbrain pinned at `089bf0d8` (0.60.431.0); the tag rule for a build while the gbrain arm runs (`harness-eval/gbrain:company`). `gbrain/entrypoint.sh`: `HE_GBRAIN_BRAIN` and `HE_GBRAIN_SCOPE`, refusals for each bad value, `tokens.json` copied under member scope, `GBRAIN_REMOTE_PRIVATE_PAGES=1` for a company brain.
- `tests/gbrain-brain.test.ts`: the company page list, readers against the world rule for every kind, source ids and grants; with `HE_GBRAIN_BUILD_TEST=1` a keyless build and serve at the pin proving the grants. Docs: gbrain/README.md, docs/gbrain-arm.md "Company brain".
### internal-task: spend reconciliation

- `scripts/reconcile-provider.ts`: per run, the proxy's priced usage per UTC day and model cross-checked against `trials.jsonl` and the lease ledger, the per-day sheet in the console's shape, and the Admin API comparison (usage report by model and api key, cost report) against proxy totals pooled per day across the runs given, with a status and the 1% bar as a boolean; `results/spend-reconciliation.json` for the three v0.1 runs, each `not_performed` for want of an Admin API key; `tests/reconcile-provider.test.ts`.
- docs/methodology.md item 3 amended (dated entry): reconciliation per run and per key-day instead of per trial; README "What is and is not proven about spend"; HE-RECONCILE-001 to 004; TODOS rows.

### From internal-task (v0.2 task slice): task sets, grader additions, report tooling

- Runner: a multi-user cell may name a `task_set` (default `v0.1`, the root; `v0.2` is `tasks/multiuser/v0.2/{dev,heldout}`), printed on every cell line; one helper `taskDirFor` resolves task directories for the manifest, the trial, `compare-run`, `paired-mdd` and `regrade` (which previously rebuilt the v0.1 path); an explicit task list naming tasks the set does not hold is refused once (HE-PREREG-004 names the set and the list); a cell key outside the Cell interface is refused (new HE-PREREG-007). A cell may set `session_scope: "turn"`, passed to the adapter as `HE_SESSION_SCOPE`: the OpenClaw adapter keys every turn as `agent:main:turn:<NNNN>` (the memoryless contrast of the v0.2 pilot; the pinned OpenClaw version is unchanged), Hermes and QM exit 2 on it.
- Grader: four new families (`continuity`, `synthesis`, `corrections`, `approval_relay`); `predicates.secondary` for predicates that are evaluated and recorded (`kind: "secondary"` in `PredicateResult`) but never decide the grade; `no_message_posted` gains `before_turn`; `draft_created` gains `only_recipients`.
- `scripts/seal-heldout.ts`: `--task-set <set>` seals that set's held-out tree; `--check` checks every sealed set, refuses an unsealed tree that holds tasks and an unknown set name (HE-TASK-SEAL); the v0.1 manifest is unchanged.
- `scripts/summarize-run.ts`: trials ending as `model_error`, `infra_error` or `exam_fault` leave the scored rows and denominators (methodology item 9) and are counted in an Excluded column and `excluded` key, their spend kept; a per-cell x family table and a secondary-predicate table, with `families` and `secondary` keys in `summary.json`.
- Tests: the matrix test discovers every task set, asserts a v0.2 task's family is one of the four, checks every hidden fact against the whole world seed of its split, and for a non-v0.1 oracle requires every bot call to return `ok` and at least one world read; `tests/heldout-manifest.test.ts` iterates every set.

### internal-task: the company brain (runner and tap)

- Runner: a gbrain cell may carry `brain` (`bot-visible` | `company`) and `scope` (`member`, company brain only; HE-GBRAIN-003 otherwise); the sidecar gets `HE_GBRAIN_BRAIN` and `HE_GBRAIN_SCOPE`; under member scope `tokens.json` is read from `<trial dir>/gbrain/`, checked against the task's actors (HE-GBRAIN-004) and handed to the world's tap; the requesting member is named to the world at each turn's start and cleared after the last turn; `preflight` probes the company brain per split under the unscoped token (every expected page listed), one member token (nothing outside its reader sets) and public-only; `plan` warns about a company cell without the company preamble; the trial record's `gbrain` field gains `brain`, `scope` and `image_id`.
- World: `POST /admin/gbrain/requester`; the tap presents the requester's token (public-only outside turns) under member scope, reads the requester before its first await, puts `grant` on every gbrain event, and classifies a refused tool result by gbrain's own error code (`page_not_found`, `permission_denied`) instead of `tool_error`.
- `tasks/multiuser/_shared/preamble.gbrain-company.md`: the gbrain-told preamble with rule 7 saying the brain holds every page of the company. Tests: tap under member scope, prereg validation, `checkCompanyTokens`, and with the images a fake-harness trial on the company brain under member scope plus the preflight probe. Docs: runner/README.md, world/README.md, docs/gbrain-arm.md "Company brain", docs/errors.md.

### gbrain arm: preregistration and the gbrain-told arm

- `docs/benchmarks/2026-10-24-gbrain-arm/`: preregistration of run `gbrain-arm-2026-10`, 15 cells and 1,500 trials: three harnesses by Haiku and Sonnet with and without gbrain, plus a Haiku `gbrain-told` arm whose preamble (`tasks/multiuser/_shared/preamble.gbrain.md`) adds gbrain's brain-first rule; cap $350.
- Runner: a cell may name an alternative `preamble` (repository-relative path; HE-TASK-002 when missing); `plan` and `dry-run` show it.
- `scripts/compare-run.ts --pair gbrain` pairs every gbrain cell of a (harness, config, model) against its one cell without gbrain, so arms that differ in preamble are their own pairs; the tables name the gbrain cell.

### From the gbrain arm, lane D (2026-10-24)

- `gbrain/`: the sidecar image `harness-eval/gbrain:dev` (gbrain `f241216c`, 0.60.413.0, PGLite, embeddings off, starter surface) with one prebuilt brain per split holding the bot-visible slice of the corpus (heldout 7 channel pages and 18 public files, dev 7 and 11); the entrypoint mints a per-trial token and refuses to start with a model API key in its environment.
- World: `POST /gbrain` tap (`world/services/gbrain-tap.ts`) forwards a harness's MCP traffic to the sidecar and records every `initialize`, `tools/list` and `tools/call` as a `via: "gbrain"` event with the page slugs it touched; `--gbrain-url` and `--gbrain-token-file` on `start.ts`.
- Runner: a cell may carry `gbrain: {surface: "starter"}`; `run` starts the sidecar per trial before the harness and stops it after the fence, hands the harness `HE_GBRAIN_MCP_URL` and `HE_GBRAIN_MCP_TOKEN`, and writes a `gbrain` field (image, `sidecar_ready_ms`, event counts) to trials.jsonl; `plan`, `dry-run` and `preflight` show and check the sidecar; `--gbrain-image`; HE-GBRAIN-001 and HE-GBRAIN-002.
- Adapters: OpenClaw, Hermes and QM register gbrain as a second MCP server beside `world` when the two variables are set and are byte-identical otherwise; the fake adapter answers `[fake:gbrain ...]` markers.
- Proof: the fake harness through the runner (search, entity, remember, recall inside turn windows) and a live smoke on `sc-06` with Haiku: all three harnesses listed the 33 tools, none called one, $0.04 in total. Design, pins and evidence in `docs/gbrain-arm.md`.

### internal-task: the company brain (grader and report)

- Grader: `mapGbrainSlug` in runner/grade/predicates.ts maps a gbrain page slug to its world record for every page kind, now including emails (mail `slug`, readable by `mailbox_members`) and meetings (calendar `slug`, readable by organizer and attendees); `no_cross_scope_reads` fails on an unreadable email or meeting as it does on a channel or file, names the page kind, and counts a targeted read gbrain refused with `refused by gbrain (<error>)` in the evidence (docs/tasks.md, "gbrain reads").
- `scripts/summarize-run.ts`: the per-cell `gbrain` block gains `scope_leaks` (unreadable rows from `search`/`query`, unreadable pages opened and returned, unreadable pages refused, each by page kind, and all by grant), `pages_by_kind` and `unmapped_slugs`, with a second gbrain table and a marker on a nonzero unmapped count (runner/README.md, report tooling).

### From the gbrain arm, lane E

- Grader: `via` `gbrain` read events count for scope through their page slugs (channel by `source_slugs`, file by `slug`); cross-scope evidence names the gbrain tool and slug; stray reads for `digest_posted` include gbrain reads; `initialize` and `tools/list` never count (docs/tasks.md, "gbrain reads").
- `scripts/summarize-run.ts`: a `gbrain` usage block per cell in `summary.json` from each trial's `events.jsonl`; existing keys unchanged, zeros without gbrain.
- `scripts/compare-run.ts --pair gbrain`: within-run paired comparison of each harness with and without gbrain over the capable families and all tasks, with cost and latency deltas, written to `comparisons.gbrain.json`; `scripts/paired-mdd.ts`: the minimum detectable difference of that design from an existing run.
- `tests/scripts-gbrain.test.ts` and the gbrain cases in `tests/grade.test.ts`.

### internal-task: v0.1 report page and publishing audit

- `docs/report-v0.1.md`: the one-page account of the v0.1 cell (finding with its limits in the same paragraph, interests declared with wording for the owner to confirm, the concrete case, the Sonnet and Haiku tables with intervals and receipts, uninformative parts labelled, safety counts, taxonomy and spend summaries, the gbrain arm marked pending in full, what is next, reproduce and inspect). README's opening paragraph points at it.
- `scripts/publish-audit.ts`: keyless publishing audit that scans every tracked file (gzipped snapshots decoded, SQLite ledgers read row by row) and every blob of every ref for token shapes, allowlisting the per-trial `sk-trial-` dummies and two reviewed test placeholders, self-tests with a synthetic canary, lists email domains and phone-shaped strings, confirms the results trees hold evaluator-owned files only, runs the link check, and fails closed; `tests/publish-audit.test.ts`. `docs/publishing-checklist.md` records its output, the provenance statement for the synthetic corpus, the held-out recommendation, residual risks and the recommendation; visibility is unchanged.

### internal-task: failure taxonomy

- `scripts/taxonomy.ts`: for a run's `trials.jsonl` (or `trials.regraded.jsonl` with `--regraded`), every failed required predicate and forbidden effect labelled with the first matching observed mode (approval relay, cross-scope read, leak, scheduled digest by capability, tool error, wrong target or content, refusal, source not read, read but not found, read but wrong, no reply, no receipts), with the facts behind the label (which oracle sources were read with an ok outcome, which reads the world denied, whether the reply in the turn's own conversation declines or says not found, which writes the world refused) and provenance (classifier version, git commit, sha256 of the trials file, every task.toml and oracle.json read, and the world manifest; the rule order and the refusal and not-found patterns, printed in `taxonomy.md`); `--trial <id>` prints one trial's observations; `--calibration` scores hand labels, read by default from `<run>/taxonomy-calibration.jsonl`; `<run>/taxonomy-annotations.jsonl` marks task or grader defects a report already records as `exam_defect`. Writes `taxonomy.json` and `taxonomy.md` beside `trials.jsonl`; keyless; deterministic apart from `generated_at`.
- `results/taxonomy.{json,md}` for the pilot (as recorded and regraded), the held-out run and the Haiku sensitivity run; `taxonomy-calibration.jsonl` (30 hand-labelled failures across the three, 30 of 30 agree; 25 of 30 before the two rule changes the sample prompted) and the pilot's `taxonomy-annotations.jsonl`; a taxonomy section in each of the three reports, including the `ho-03` one-attendee event read from the OpenClaw Haiku transcripts; `tests/taxonomy.test.ts`.

## [0.0.5] - 2026-10-23

### M3 sensitivity cell run and reported

- `docs/benchmarks/2026-10-24-m3-sensitivity-haiku/`: the same 20 held-out tasks on `claude-haiku-5-5`, 300 trials, $1.84; every harness lost 13 to 19 points against its Sonnet run (detectable within harness for OpenClaw and QM), harness pairs still not distinguished (80%, 79%, 70%), zero consent violations and leaks. `scripts/compare-run.ts --against <run>` pairs each harness's cell across two runs for the model effect.

### M3 held-out run run and reported

- `docs/benchmarks/2026-10-24-m3-heldout/report.md` and `results/`: 300 trials, $35.67, no errors; pass rates not distinguished over the capable families (77, 73, 71 of 80; Holm-adjusted p 1.0 on every pair; 13 of 16 tasks at ceiling), zero consent violations and leaks, one cross-scope read, cost and time differing two to three times between harnesses, no scheduler fires on the simulation clock.

### M3 held-out run preregistered

- `docs/benchmarks/2026-10-24-m3-heldout/`: preregistration of the counted multi-user run on the 20 sealed held-out tasks (300 trials, $200 cap): primary endpoint over the four capable families, pairwise task-clustered paired comparisons with Holm correction, minimum detectable difference, decision sentences.
- `scripts/compare-run.ts`: pairwise harness comparison for a run (task-clustered paired bootstrap, exact sign-flip p, Holm), per family scope.

### Audit before M3: finance rule scope, task patterns, reply grading

- Preamble: rule 3 names the finance rule's scope (money terms and the documents that carry them are finance figures; seat counts, dates, tickets and contacts are operational facts; a figure already posted in the conversation may be repeated there), rule 4 says where to record the approval ask and the prompt carries the request's ts (`request_ts`), rule 6 asks the bot to name the member it answers in a channel. Found in the M2 pilot: `sc-01` and the old rule disagreed.
- Grader: `reply_matches` reads the reply plus the bot's posts into the turn's channel inside its window (pilot: recaps posted as their own message failed `ho-01` 12 times out of 15).
- World-MCP: the `request_approval` channel description says the DM goes to the approver.
- Tasks: 15 of 30 changed in small ways (patterns tolerant of common date, time and number forms, two `asked_in` constraints removed, one hidden fact replaced because it appeared in the corpus, `sc-01` and `sd-01` asks pointed at the chat record); the full table is in `tasks/multiuser/README.md`. Held-out manifest re-sealed.

## [0.0.4] - 2026-10-23

### Pilot findings: directory tool, recipient resolution, approval place, regrade

- World: `list_members` tool (logged as `users.list`); `mail_send_draft` resolves recipients against the directory and refuses an unknown pemberline.com address with `unknown_recipient`. Found in the M2 pilot: both harnesses guessed `tobias.rendle@pemberline.com` in all ten `ho-02` trials because no tool exposed addresses, so the handoff predicates failed by construction.
- Grader: `approval_requested` accepts a pending action whose `channel.dm` is the DM channel id with the authorizer, not only the member id (pilot: OpenClaw reported the channel id returned by `send_dm` in every org-security trial).
- Preamble: names `list_members` as the directory and lists email addresses among the things not to invent.
- M2 pilot run and reported: 150 trials, $16.69, receipts and report under `docs/benchmarks/2026-10-23-m2-pilot/`; `scripts/summarize-run.ts` produces the tables (task-clustered bootstrap intervals); `docs/benchmarks/*/results/` is no longer gitignored (each results folder carries its own ignore list for harness state, workspaces, raw logs and tokens).
- `scripts/regrade.ts`: a labelled second grading of recorded trials from their stored evidence, written beside `trials.jsonl`, never over it.

## [0.0.3] - 2026-10-22

### M1 lane A: trial dispatch

- `runner/run.ts run --manifest <file>` dispatches a manifest: one metering proxy per run with a control token and a per-trial slot bound to `sk-trial-<id>`; per trial an in-process world, a harness in docker, process or scripted mode, the turn loop of docs/tasks.md (clock advances, actor messages through the Slack mock, `TurnRequest` / `TurnResponse` files, bot replies, `TurnWindow` seqs), fence and snapshot, `usage.json` and `reconcile.json`, `gradeTrial` from `runner/grade`, and one `TrialRecord` line in `trials.jsonl`. `--resume`, `--stop-on-cap` (HE-BUDGET-001, exit 3), hello/smoke cells through `harnesses/run-trial.sh`.
- Manifests: multi-user cells resolve tasks from `tasks/multiuser/<split>/` and are priced per turn; scripted cells (`harness: scripted`, `script: oracle | mutations`) expand to one trial per script and cost nothing.
- `runner/scripted/executor.ts` plays a `Script` as the bot over world-MCP through the same loop; `world/services/start.ts` exports `writeTrialConfig`; `runner/contracts.ts` gains `PREAMBLE_PLACEHOLDERS`, `HarnessMode`, `TrialUsage`, `TrialRecord`; the proxy's usage line gains `cached_tokens`.
- Tests: `tests/trial-loop.test.ts` runs the loop offline with `tests/fixtures/serve-adapter.ts` on a fixture task (leak, cross-scope read, clock advance, timeout, exit mapping, cap stop, ready timeout, scripted oracle and mutations, resume); manifest pricing cases in `tests/run.test.ts`. New HE codes in docs/errors.md.

### M1 lane B: tasks and grader

- `tasks/multiuser/`: 30 tasks (10 dev, 20 held-out, six per family) grounded in the Pemberline world, each with `task.toml`, an oracle and one mutation per required predicate and forbidden effect; the shared preamble with the two admin rules; the task list in `tasks/multiuser/README.md`; `heldout/MANIFEST.json` written by `scripts/seal-heldout.ts`.
- `runner/grade/`: `task.ts` (parse and validate task.toml), `predicates.ts` (every kind in docs/tasks.md with event-level evidence; effect classes `external_mail` and `finance_disclosure`), `index.ts` (`gradeTrial`), `play.ts` (in-process player over the Slack mock and world-MCP).
- World: `search.messages` events record the channels their matches came from, so a bot-wide search counts as a read of those channels.
- Tests: `tests/grade.test.ts` (hand-built evidence per predicate kind), `tests/task-matrix.test.ts` (every oracle passes, every mutation fails exactly its predicate), `tests/heldout-manifest.test.ts`, `tests/world-search-effect.test.ts`.

### M1 lane C: adapter serve and live smoke

- `adapter.sh serve` for the fake harness, OpenClaw, Hermes Agent and QM: the TurnRequest/TurnResponse file queue, per-conversation sessions (`dm:<member>`, `channel:<id>`), the world-MCP server wired through each harness's own MCP config, SIGTERM handling; per-harness detail in docs/adapters.md and each pin.json.
- `harnesses/serve-smoke.ts`: drives one image in serve mode against an in-process world and the Slack mock. Live proof: three turns each on OpenClaw, Hermes and QM through the metering proxy (two trials per harness, $0.63 in total), receipts in the harness READMEs.
- Hermes image installs the `mcp` extra (the M0 image could not connect an MCP server); QM compose takes `HE_ENTRY` and a turns mount, `qm-api.mjs` replaces `post-turn.mjs`; the fake image gains jq and curl.
- `tests/adapter-conformance.test.ts`: eight serve tests at the process level and one in a container.

### M1 contracts and the program cap

- `runner/contracts.ts`: the turn protocol between runner and adapters (`TurnRequest`, `TurnResponse` over a file queue), the evidence a grader receives (`TurnWindow`, `TrialEvidence`), `GradeResult`, and the `Script` shape for oracles and mutations.
- `docs/tasks.md`: the multi-user task format, the M1 access model (one bot token, isolation measured on reads and replies), the predicate library and the oracle/mutation matrix contract.
- Program cap (plan D10) set to $2,000 in the ledger and recorded in docs/methodology.md and the M0 preregistration's amendments.

## [0.0.2] - 2026-10-22

### M0 runner, proxy and ledger

- Metering proxy, SQLite budget ledger and the list-price table vendored from gbrain-evals and gbrain (`runner/proxy`, `runner/ledger`, `runner/pricing`) with their tests (40 more passing).
- `runner/run.ts`: `plan`, `dry-run` and `preflight` over a preregistration JSON; writes a manifest with preallocated trial ids and a priced cost ceiling; `run` refuses until the adapters and world land.
- `docs/errors.md`: the HE-<AREA>-<NNN> code table.
- M0 smoke preregistration (`docs/benchmarks/2026-10-22-m0-smoke/`) with the D1 model amendment (newest Sonnet instead of Kimi K3), the cut line and the drop order; registered for the preregistration-order check.

## [0.0.1] - 2026-10-22

### Repository created with the approved plan

- Plan v2 for the harness comparison approved after two gstack autoplan review rounds (12 reviewer passes, 172 findings, 30 open tasks). Plan, review record, findings, decisions, timing and every reviewer file under `docs/plans/2026-10-21-harness-eval-v0/`.
- Research compendium of published harness comparisons and agent benchmarks (`compendium.md`).
- Conventions taken from gbrain-evals and the reasons (`docs/gbrain-evals-conventions.md`).
- Trial contract (`docs/methodology.md`).
- Statistics kit vendored from gbrain-evals v0.10.128 (`6999ebc9`) with its unit tests; the preregistration-order checker and an empty experiment registry.
- Keyless CI: typecheck, tests, link check, preregistration order.
