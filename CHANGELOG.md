# Changelog

What each harness-evals release changed. Versions follow `VERSION` and `package.json`.

## [0.0.5] - 2026-10-23

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
