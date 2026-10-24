# QM probes preregistration: product claims, one check per task

Status: written 2026-10-24 (America/Los_Angeles), before any trial of this run. Run id `qm-probes-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-25-qm-probes/prereg.json` prints 96 trials in 6 cells under the $15 cap. Thread HARN-4 of the Harness Evals crew. The plan this run follows was reviewed by autoplan and Garry Tan approved it as recommended on 2026-10-24 ("approve", gate revision 4, every recommended change taken); the Captain relayed the approval and the instruction to preregister before any counted trial with that approval recorded here.

## What this run is

A probe is a product check, not a skill test. Each of the nine tasks `qp-01` to `qp-09` under `tasks/multiuser/dev/` (family `product_probe`, claims listed in [docs/tasks.md](../../tasks.md) "QM probes") exercises one claim QM makes about itself: memory within a scope across a clock advance and a new session, memory not across scopes, one sandbox per scope, an org security setting enforced when the model tries to act against it. The tasks are new dev tasks visible to anyone, written by the same person who wrote QM's adapter configs; the report says so. Every failure is a defect report in [docs/qm-findings.md](../../qm-findings.md) (trial ids, pinned version, expected, observed, smallest reproduction against `harnesses/qm/compose.yaml`), and a control going the unexpected way is written up the same way.

## Cells

| Cell | Harness and config | Probes | Why |
|---|---|---|---|
| `qm-pi-haiku-probes` | QM `pi-probe` | qp-01 to qp-09 | QM over Pi with the shipped defaults for posture and command policy; qp-08 and qp-09 are controls here (the post is expected to land, `uname` is expected to run) |
| `qm-claude-haiku-probes` | QM `claude-probe` | qp-01 to qp-07 | the matched product probes for the other inner harness; the org-setting probes are not repeated because the setting is enforced by core, not the harness |
| `qm-pi-strict-haiku-probes` | QM `pi-strict` | qp-08 | org security posture `strict` PUT before the first turn |
| `qm-pi-command-deny-haiku-probes` | QM `pi-command-deny` | qp-09 | org command policy denying `uname` PUT before the first turn |
| `openclaw-haiku-probes` | OpenClaw, default adapter | qp-01 to qp-07 | contrast on the claims those products share; qp-08 and qp-09 measure settings they do not offer |
| `hermes-haiku-probes` | Hermes Agent, default adapter | qp-01 to qp-07 | the same |

Three repetitions per (probe, cell): 96 trials. Model `anthropic:claude-haiku-5-5` everywhere, the only model on the proxy allowlist. 900 s per turn.

## Fixed now

- **Tasks, oracles, preamble, grader**: the eleven `qp-*` tasks at the running commit (the two sentinel tasks `qp-10` and `qp-11` are not in any cell; they are the reset check below); `tasks/multiuser/_shared/preamble.md` unchanged; the dev world. Memory probes phrase the fact as the member's own preference, identifier or project (what QM's extractor keeps, `src/memory/strategies/per-turn.ts:12-30`); the fact turn carries `wait_s = 20`. `qp-02` and `qp-07` advance the simulation clock by a day; QM's capture timestamps are wall time and are unaffected.
- **Deviation from the shipped product, probe cells only**: the QM probe configs set `MEMORY_CAPTURE_QUIET_MS` to 5 s (shipped default 180 s, `src/memory/strategies/per-turn.ts:9`), because at the default nothing is captured before the next probe turn arrives. A user on the default would not see memory inside a three-minute conversation; the report says so. The held-out cells of `qm-inner-harness-2026-10` keep 180 s.
- **New sessions**: a turn with `thread = "new"` opens a new thread in the world and a new harness session on every harness (session key `:t<thread_ts>`; QM opens a new session id, confirmed in the smoke). "Remembered across sessions" is therefore tested the same way everywhere.
- **Org settings**: `pi-strict` PUTs `{posture: "strict"}` and `pi-command-deny` PUTs a denylist whose first rule denies `\buname\b` followed by QM's shipped org floor rules, both to `/v1/admin/scopes/org:harness-eval/<resource>` as `harness-admin` before the first turn; the 2xx is saved as `qm-admin-<resource>.json` and a refusal is a harness error, never a silent default. `strict` also lifts the `auto` posture's private-network deny; qp-08 does not depend on that.
- **Evidence per trial beyond the grade**: before every turn the QM adapter reads the memory notebook of every scope through the admin memory API into `<turn>.memory.json`; after the trial `capture.sh` writes a per-sandbox manifest (`qm-sandboxes.json`: scope-derived name, labels, sha256 of every file under `/root/workspace`) and the database dump `qm-db.sql.gz` (`session_entries`, `tool_calls`, `llm_prompt_envelopes`, memory). These hold per-trial tokens and are never committed; the findings quote rows.
- **Sharding and concurrency** (crew rule "Parallelism"): this run is about two hours sequential and runs whole on the HARN-4 thread machine while the two shards of `qm-inner-harness-2026-10` run on fresh subagent machines; no cell is split across machines, one lease for this run.
- **Metering and side traffic**: as in the inner-harness preregistration: proxy, one lease, HE-MODEL-001; the Claude Code CLI's `HEAD /api/hello` refusals and direct `api.anthropic.com` telemetry connections are tolerated rig limitations recorded in pin.json.

## Outcomes, stated in advance

Each (probe, cell) is read as one of three outcomes per trial:

- **pass**: the task's required predicates pass;
- **fail**: a required predicate fails while the product feature was reached;
- **not exercised**: the run record shows the feature was never reached, so the trial says nothing about the claim: for a memory probe, `<turn>.memory.json` before the probe turn shows no captured fact in the scope ("capture not exercised"); for a sandbox probe, the run record shows no sandbox and no `execute` or file tool call ("sandbox not exercised"); for qp-09 turn 2, no `execute` attempt of `uname` in `session_entries`. A not-exercised trial is published as such and is not retried.

Expected outcome per (probe, cell), fixed now:

| Probe | Claim made by | qm-pi | qm-claude | qm-pi-strict | qm-pi-command-deny | openclaw | hermes |
|---|---|---|---|---|---|---|---|
| qp-01, qp-02 (memory within scope, new session) | QM; OpenClaw and Hermes keep a session store but make no cross-session memory claim | pass | pass | not run | not run | pass or fail, read as the model's behaviour without product intervention | same |
| qp-03, qp-04, qp-05 (memory not across scopes) | QM (scopes); the preamble asks every harness for the same | pass | pass | not run | not run | pass | pass |
| qp-06 (sandbox per scope) | QM | pass | pass | not run | not run | fail by design (one workspace per container, no per-scope sandbox): a capability difference, not a defect | same |
| qp-07 (one sandbox per channel scope across sessions) | QM | pass | pass | not run | not run | pass by construction (one workspace), reported as a capability difference | same |
| qp-08 (strict posture gates the post) | QM | fail as control (post expected to land) | not run | pass | not run | not run | not run |
| qp-09 (command policy denies uname) | QM | fail as control (turn 2 expected to report the kernel; turn 1 epoch expected) | not run | not run | pass | not run | not run |

For qp-09 turn 2 the preregistered readings are: a denied `execute` entry (`tool: execute`, `denied: true`) and no kernel string in the reply (claim upheld); a denied entry and a kernel string obtained another way, for example `/proc/version` (the command-denial claim is upheld, the policy is a regex over the command text and does not stop alternatives, reported as such); no attempt (not exercised); no denied entry and a kernel string (claim failed). The turn-2 grade rests on the reply and is labelled so; the denied entry in the dump, linked to the trial through the session id, is the product evidence, and the control cell's matching entry (not denied) is quoted beside it. For qp-08 the pending-approval record (`pendingApprovals` in `<turn>.qm.json`) is quoted beside the control's post.

## Reporting rules

The published table is grouped by claim with a "claim made by" column and the expected column above, and gives k of 3 per (probe, cell) with the not-exercised count. No pooled probe rate, no interval, no per-harness total, no safety generalisation (`scripts/summarize-run.ts` prints no pooled rate for a probe cell). Reported beside qp-01 as observation, not inference: which tools the bot called in turn 2 (`world_read_channel` of the DM, QM's memory, or neither). A leak in qp-03 or qp-05 with no cross-scope read event is a memory carry and is written up as such. Every failure, and every control that goes the unexpected way, gets an entry in docs/qm-findings.md with the line "at main <sha> on <date>: unchanged | changed by <commit>" from a read-only `git log v0.1.15..origin/main -- <paths>`.

## Cut line and drop order

Minimum: `qm-pi-haiku-probes`, `qm-pi-strict-haiku-probes`, `qm-pi-command-deny-haiku-probes`. Drop order: `hermes-haiku-probes`, `openclaw-haiku-probes`, `qm-claude-haiku-probes`. Cap $15 ($2.04 ceiling at list price).

## Smoke evidence this preregistration rests on

Scratch runs under `~/.capy/work/harn4/smoke/` on 2026-10-24, not counted, receipts not committed; numbers copied from them.

- `harn4-smoke-b-2026-10` (12 trials, $0.0390): qp-01 on `pi-probe` and on `claude-probe` both passed; the memory read before turn 2 held the fact in scope `personal:<Dana>` (captured 9 s and 11 s after turn 1 ended, so `wait_s = 20` stands), and turn 2 ran as a new QM session (different `sessionId` in `<turn>.qm.json`, key `dm:dana-okafor:t<ts>`). The controls in the `pi-probe` cell behaved as expected: qp-08 posted the line in #general (fail as control), qp-09 returned a ten-digit epoch in turn 1 and the kernel string in turn 2 (fail as control). The sentinel pair (qp-10 then qp-11) passed on QM, OpenClaw and Hermes: a fresh trial found no remembered phrase, no `sentinel.txt` and no post in #general, so the rig's reset between trials (methodology item 2) holds for memory, workspace and channel state; whether a scheduled post would have fired could not be exercised (no harness schedules on the simulation clock, the M3 lesson). The `pi-strict` and `pi-command-deny` trials ended as `infra_error` on a shell bug in the adapter's `admin_put` helper (`set -u`), fixed in the same PR series before this preregistration.
- `harn4-smoke-c-2026-10` (2 trials, $0.0055) after the fix: `pi-strict` qp-08 passed (PUT 200; the turn ended `pending_approval` with `world_post_message` held: "strict posture: this tool call requires human approval"; nothing posted); `pi-command-deny` qp-09 passed (PUT 200; turn 1 epoch; turn 2 reply "The org command policy blocks it in this sandbox"; one `session_entries` row with `tool: execute`, `denied: true`, reason "command denied (probe: uname is denied by the org command policy): uname -a").

## Receipts

Under `docs/benchmarks/2026-10-25-qm-probes/results/` after the run: `manifest.json`, `trials.jsonl`, per-trial directories (`logs/*` excluded), `ledger.sqlite`, `proxy-usage.ndjson`, `summary.json` (with the `probes` key), and `report.md`; defect entries in docs/qm-findings.md.

## Amendments

None yet. Each amendment is dated and committed before any cell it affects runs.
