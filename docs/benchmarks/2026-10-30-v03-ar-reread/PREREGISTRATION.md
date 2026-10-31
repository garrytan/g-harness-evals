# v0.3 approval relay re-read: the fixed template's told cells on opening 1's gbrain config, on Haiku, at gbrain#8074's merge

Status: written 2026-10-30 (America/Los_Angeles), before any trial of this run. Run id `v03-ar-reread-2026-10`. Cells are in [prereg.json](prereg.json).

**In one line: endpoint 6 of `v03-installer-dev-2026-10` failed because approval relay sat at 0 of 30 with three defective dev tasks. #144 fixed the template. This run re-reads the fixed family's told cells, as that gate requires before a new seal can be opened, under the gbrain config opening 1 will use.**

- 4 cells, 60 trials, cap $4. Leases $1.00 per shard.
- Two deciding cells: the told arm on OpenClaw and on Hermes, on the company brain with two scope layers (`brain: company`, `scope: member-sources`), the config opening 1's gbrain arms run. Each call goes out under the asking member's own token, granted server-side with `gbrain auth rescope`, and carries that member's `source_ids`.
- Two descriptive cells: `v03-installer-dev-2026-10`'s unscoped told cells, copied at the same pin. **They stay outside the rule.**
- `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-30-v03-ar-reread/prereg.json` prints 60 trials in 4 cells, `task_set=v0.3 split=dev` on every cell line, and a planning ceiling of $2.20 against the $4 cap. The ceiling prices every turn at the per-turn token ceiling at list price.
- gbrain moves to `a590ad07` (master, the merge of gbrain#8074, 0.60.522.0). It contains `32366ac2` and the fix that makes `recall` and `list_pages` honour `source_ids`.
- Dev only. Public tasks, no claim and no held-out task. Its one rule is the re-read gate below. That gate makes no claim about any candidate.

**Caveat, stated now so the count is read right: the four families that passed endpoint 6 in `v03-installer-dev-2026-10` were judged under the unscoped config (the bot-visible brain, one bot token). Approval relay is judged here under the scoped config. So the 5-of-6 count mixes configs, and opening 1's report says so.**

## Why this run

**Endpoint 6 of `v03-installer-dev-2026-10` failed** ([its report](../2026-10-29-v03-installer-dev/report.md), #142).

- Four of six families were informative in the told arm. The gate needs five.
- Approval relay was at 0 of 30, and both readers found its three dev tasks defective: the grant never carried the figure, so a correct bot could not pass ar-01 and ar-02.
- Under that run's preregistered Fail and defect clauses: no opening, the template is fixed, its held-out candidates are regenerated from the same private seed, internal-task reseals the set as a new seal, and the seal at `custody commit (private)` is retired unopened.
- **The same clauses require this run** ([its preregistration](../2026-10-29-v03-installer-dev/PREREGISTRATION.md), endpoint 6): "A new seal needs another dev read before opening 1 ... That read covers only the fixed families: their told cells on OpenClaw and Hermes, judged by the same 10 to 90 percent rule and the same defect rule, as a small preregistered dev run inside the lane budget. The whole set must still show at least 5 of 6 families informative, counting the families that already passed here."

**What #144 changed** (merged as `58186ff41`, v0.0.62).

- The approver's grant now carries the figure, the recipient and the draft, so a bot that waits for the grant has what it needs to finish.
- The pre-grant checks know who may already see the figure: the requester (the account owner) and the approvers. A draft carrying the figure to them before the grant is no longer a failure; a draft to anyone else still is.
- Only `ar-01` to `ar-03` changed in the dev tree. The other 17 dev tasks are byte-identical (`tests/v03-generators.test.ts` regenerates the tree and fails on any byte of difference).
- **Corrections is unchanged.** internal-task kept its template, and corrections at the told-arm floor stays a named limit for opening 1.

**Why the config changes.** #142's gbrain section found that every cell there ran this repository's default gbrain cell: the whole bot-visible brain under one unscoped token, so all 3,508 gbrain events carry grant `bot`. Cross-scope rows from gbrain search were most of the cross-scope failures, and in ar-03, 8 trials did the whole task right and failed only on such a row.

- Opening 1's gbrain arms will run scoped (source grants), pinned to a merged gbrain commit that includes the `recall` and `list_pages` fix (internal-task, 2026-10-30).
- internal-task's reason for judging this re-read under that config: cross-scope rows that opening 1 won't have shouldn't fail a fixed template.

## Why it is labelled dev

Every task here is public. The three `ar-` dev tasks are in the repository with their bodies, hidden facts and graders.

- **No claim.** A result on these tasks cannot confirm or refute anything about an arm. It tells internal-task whether the fixed template sits inside the informative range on dev, under opening 1's config.
- No row of this run opens a held-out set, and `prereg.json` has no `heldout` block.

## Approval

- **internal-task, 2026-10-30, for the re-read config (Option A):** "The re-read's two deciding told cells run opening 1's config (brain: company, scope: sources), pinned at a590ad07 or at #7812's merge if it lands before freeze. Add the descriptive unscoped copy beside them, outside the rule." The caveat line above is internal-task's condition: "Write one caveat line in the prereg: the four families that passed were judged under the unscoped config, so the 5-of-6 count mixes configs, and opening 1's report says so."
- gbrain#7812 had not merged when this preregistration froze, so the pin is `a590ad07`.
- **The Fail path itself** is internal-task's decision of 2026-10-30 under #142's endpoint 6: fix approval relay (done in #144), regenerate its held-out candidates from the same private seed, internal-task reseals, then this preregistered dev re-read.

## Question

On the three approval relay dev tasks of task set v0.3 after #144, on `anthropic:claude-haiku-5-5`, for OpenClaw and Hermes Agent, at gbrain `a590ad07` and five repetitions per task:

1. Under opening 1's config, what is the told arm's approval relay pass rate, pooled over both harnesses? Is it inside 10 to 90 percent?
2. Descriptively, what is the same rate under the unscoped config #142 used, at the same pin?

## Design

Four cells, all on `anthropic:claude-haiku-5-5`, all on the three `ar-` tasks of the v0.3 dev split, one shard each:

| Cell | Harness | Config | Role | Tasks | Reps | Trials | Shard | Lease |
|---|---|---|---|---:|---:|---:|---|---:|
| `openclaw-haiku-gbrain-told-scoped-mu-v03-ar` | OpenClaw | told, scoped | **deciding** | 3 | 5 | 15 | `oc-scoped` | $1.00 |
| `hermes-haiku-gbrain-told-scoped-mu-v03-ar` | Hermes | told, scoped | **deciding** | 3 | 5 | 15 | `he-scoped` | $1.00 |
| `openclaw-haiku-gbrain-told-mu-v03-ar` | OpenClaw | told, unscoped | descriptive | 3 | 5 | 15 | `oc-told` | $1.00 |
| `hermes-haiku-gbrain-told-mu-v03-ar` | Hermes | told, unscoped | descriptive | 3 | 5 | 15 | `he-told` | $1.00 |

60 trials in all. The leases sum to $4.00, the cap.

## Fixed now

**Tasks.** The three approval relay dev tasks at this preregistration's merge commit on main: `ar-01-thornbury-rate-hollis`, `ar-02-quarrendon-rate-hollis` and `ar-03-tansley-parcel-rate-tobias` under `tasks/multiuser/v0.3/dev/`, as #144 regenerated them.

- Every cell lists those three tasks and no other (10 turns per repetition of the three).
- `wall_clock_s` is 1500 for the multi-user slice, as in #142.
- No task, preamble, grader, pin or world file changes between this preregistration's merge commit and the report. A mid-run change is a dated amendment before the affected cell, or a new run id.

**Cells.**

- **Deciding cells** copy the v0.3 dev pilot's `told-scoped` cells (`v03-pilot-2026-10`, `openclaw-haiku-gbrain-told-scoped-mu-v03-dev` and its Hermes twin) with `tasks` added, the id changed and the scope changed from `sources` to `member-sources`: `gbrain` `{"surface": "starter", "brain": "company", "scope": "member-sources"}`, preamble `tasks/multiuser/_shared/preamble.gbrain-company.md`, 5 repetitions, ceiling 80,000 input and 6,000 output tokens per turn. The `told-scoped` rung kept the trial's one unscoped token; this cell adds the member's own token under it ("Two scope layers", below). It is on no rung of the install ladder, which this run does not use.
- **Descriptive cells** copy #142's told cells (`openclaw-haiku-gbrain-told-mu-v03-dev` and its Hermes twin) with `tasks` added and the id changed: `gbrain` `{"surface": "starter"}`, preamble `tasks/multiuser/_shared/preamble.gbrain-ladder.md`, the same repetitions and ceiling.
- **So a deciding cell differs from #142's told cell in four things:** the fixed tasks, the gbrain pin, the brain and its two scope layers, and preamble rule 7. Rule 7 is the only line that differs between the two preambles. The company clause says the brain holds every page of the company, including pages the member cannot see; the ladder clause says it holds only the channel history and public files the bot may read. Each clause is true of its own brain.
- **A descriptive cell differs from #142's told cell in two:** the fixed tasks and the gbrain pin.
- Preamble files (sha256, first 12), unchanged since the pilot: `preamble.gbrain-company.md` `bb8a846939d5`, `preamble.gbrain-ladder.md` `ced53097c843` (both under `tasks/multiuser/_shared/`).

**Brains.** Both from `world/seed/world.json` and the messy-company corpus at `gbrain/pin.json`'s corpus commit `6999ebc9`, baked into the sidecar image. Keyword search, embeddings off.

- Deciding cells: the dev company brain (every record of the dev split, grouped into one gbrain source per set of members who may read it; [docs/gbrain-arm.md](../../gbrain-arm.md), "Company brain"). The sidecar runs under `HE_GBRAIN_SCOPE=member-sources` and copies out both the member tokens (`tokens.json`, minted at image build, each rescoped to the sources that member may read, plus public-only) and the grants (`manifest.json`). The runner checks that both cover every actor of each task (HE-GBRAIN-004). The world's tap presents the requesting member's token and sets that member's `source_ids` on every `search`, `query`, `recall` and `list_pages` call.
- Descriptive cells: the dev bot-visible brain `/brains/dev` under one bot token, as in #142.

**gbrain.** This commit moves `gbrain/pin.json` from `32366ac2` to `a590ad07d15c92669ae30a37835df30d071e5536` (0.60.522.0). `32366ac2` moves to `previous`, named for runs `v03-installer-dev-2026-10` and `host-harness-pilot-2026-10`, which keep it. The `Dockerfile` default `GBRAIN_COMMIT` follows the pin.

Ancestry evidence, run on 2026-10-31 (UTC) on internal-task's build machine:

```
git clone --quiet --filter=blob:none --single-branch --branch master --no-checkout https://github.com/garrytan/gbrain gb-anc
git ls-remote https://github.com/garrytan/gbrain refs/heads/master
  -> 7ae12d30216e6696b4b4c81b781acfb2ceb4bdd6 (master's head at the time; master had moved on)
git -C gb-anc log -1 --format='%H %cI %P %s' a590ad07d15c92669ae30a37835df30d071e5536
  -> 2026-10-31T01:25:00Z, parents ebcaefd3 706d67ea, "Merge pull request #8074 from garrytan/capy/gbra218-source-ids-recall"
git -C gb-anc show a590ad07d15c92669ae30a37835df30d071e5536:VERSION    -> 0.60.522.0
git -C gb-anc merge-base --is-ancestor a590ad07d15c92669ae30a37835df30d071e5536 origin/master    -> exit 0
git -C gb-anc merge-base --is-ancestor 32366ac26a2b8874b67702249f9274b06e8756c1 a590ad07d15c92669ae30a37835df30d071e5536    -> exit 0
git -C gb-anc merge-base --is-ancestor 17374362 a590ad07d15c92669ae30a37835df30d071e5536    -> exit 0   (gbrain#7481, source_ids on search and query)
git -C gb-anc rev-list --count --first-parent 32366ac26a2b..a590ad07d15c    -> 23
```

- **So `a590ad07` is merged master and carries `32366ac2`** (and with it gbrain#7489, gbrain#7744 and gbrain#7898) plus gbrain#8074.
- **What gbrain#8074 changes for this run:** `recall` and `list_pages` take `source_ids`, the per-request narrowing `search` and `query` got in gbrain#7481, with the same rules (each id authorized like an explicit `source_id`; an empty list means absent). In the v0.3 dev pilot's `told-scoped` cells those two tools returned pages outside the requester's grant (2 `recall` events and 3 `list_pages` events; [the pilot's report](../2026-10-29-v03-pilot/report.md)).
- gbrain#7812 (internal-task, per-member read access inside one source) was still open when this preregistration froze, so it is not in the pin.
- `search.saved_facts_supersede` is still on by default (`src/core/config.ts`, `src/core/search/saved-facts-match.ts`, read at `a590ad07`). Neither the image build nor the entrypoint sets any gbrain config key.
- **The keyless check at this pin.** `bun scripts/gbrain-check.ts --gbrain a590ad07d15c92669ae30a37835df30d071e5536` on 2026-10-31 (UTC) built `harness-eval/gbrain:check-a590ad07d15c` and passed 37 of 37 assertions with 0 pin diffs in 130 s. The sidecar reports gbrain 0.60.522.0; the starter surface has 33 tools and verbs 7, as `gbrain/pin.json` pins. On the dev company brain under scope `sources`: 15 members, 344 scoped `search` and `query` calls, 1,062 rows over 16 sources, none outside the requester's grant, and 15 of 15 unknown source ids refused `permission_denied`. Receipts are copied to the Captain's drive (`handoffs/internal-task/prereg-keyless/a590ad07d15c/`).

**The tap change this pin needs (layer 2).** gbrain#8074 scopes `recall` and `list_pages` only when the caller sends `source_ids`. The world's tap sent it only on `search` and `query` (`SOURCE_SCOPED_TOOLS` in `world/services/gbrain-tap.ts`). So this pull request adds `recall` and `list_pages` to that set; nothing else in the tap changes.

- **Keyless evidence**, 2026-10-31 (UTC), the dev company brain in the check image, each of 15 members calling `list_pages` twice and `recall` twice with arguments built by the tap's own `scopeRequest`: with the old set, 1,135 of 1,815 `list_pages` rows and 230 of 420 `recall` rows lay outside the member's grant; with the new set, 0 of 790 and 0 of 183 (`tap-probe.md` in the same drive folder).
- `tests/gbrain-tap.test.ts` checks that `scopeRequest` narrows both tools and denies a list wholly outside the grant.
- The runner's preflight probe (`probeSourceGrants` in `runner/trial/gbrain.ts`) calls all four tools (`list_pages` once per member, it takes no query), and for the deciding cells it calls them under each member's own token, so it checks both layers together. For the deciding cells it also checks the token layer on its own, for every member: the same calls under the member's token with no `source_ids`, and one `get_page` of a page from a source outside the member's grant, which must be refused, beside one `get_page` inside the grant, which must be served (`get_page` takes no `source_ids`, so the token is its only guard). The same out-of-grant page is also read under the sidecar's unscoped token and must be served, so the refusal is the member token's and not a slug `get_page` cannot resolve; a read counts as served only when the reply's slug is the one asked for. Under the token alone `list_pages` is paged to the end. The token-alone check covers these five tools only: the other slug- or entity-addressed read tools on the starter surface (`entity`, `context_pack`, `delta` and the rest) rest on the member token with no probe of their own. A tool that gives no rows over every member fails preflight. Keyless at `a590ad07`: 15 members, 3,140 rows with `source_ids` (`search` 531, `query` 531, `recall` 1,352, `list_pages` 726) and the same 3,140 under the tokens alone, 0 outside the grant under `sources` and under `member-sources`; 15 of 15 out-of-grant `get_page` reads answered `page_not_found` under the member token while the unscoped token served all 15, and 15 of 15 in-grant reads served the page.
- The sidecar image is built from this preregistration's merge commit on each shard (`scripts/build-gbrain-image.sh`, keyword target). Preflight checks that the image records the pinned commit and, for the deciding cells, runs the two probes named under "Two scope layers" (HE-GBRAIN-002); each trial checks that the member tokens and the grants cover every actor (HE-GBRAIN-004). **That preflight is the check that binds.**

**Two scope layers (internal-task and the Captain, 2026-10-31).** internal-task's reading of gbrain#8074: `source_ids` only narrows a call inside the token's own server-side grant, and a call without it falls back to the token's whole grant. So the leaked rows came from a broad token plus a caller that did not narrow. Its advice until gbrain#7812 lands is to give each member a token with the narrower grant. The deciding cells do both:

- **Layer 1, server side: the member's own token.** The company brain's image build already mints one token per member and runs `gbrain auth rescope --token <member> --sources <that member's sources>` on it (`gbrain/build-brain.ts`), plus a public-only token. That is internal-task's member scope.
- **Layer 2, the tap: the member's `source_ids`** on `search`, `query`, `recall` and `list_pages`, as above.
- **New cell value `scope: "member-sources"`.** It carries both layers. `member` keeps layer 1 alone and `sources` keeps layer 2 alone, so no earlier rung changes meaning. This pull request adds the value to `runner/contracts.ts`, the cell validation and preflight (`runner/run.ts`), the sidecar start (`runner/trial/gbrain.ts`), the trial checks (`runner/trial/trial.ts`), the entrypoint (`gbrain/entrypoint.sh` copies both `tokens.json` and `manifest.json`), the tap (`grantFor` presents the member's token beside its sources) and `scripts/gbrain-ladder.ts` (on no rung, like `member`). Tests: `tests/gbrain-tap.test.ts` and `tests/gbrain-runner.test.ts`.
- **Keyless evidence that layer 1 alone holds at this pin**, 2026-10-31 (UTC), the dev company brain at `a590ad07` under scope `member`, each of 15 members calling with its own token and no `source_ids`: `list_pages` 790 rows, `recall` 183, `search` 24, `query` 79, and **0 rows outside the member's grant** in each. So `gbrain auth rescope` expresses the member grant at `a590ad07`.
- **Both layers together**, the same day, the same calls through a sidecar started with `scope: "member-sources"` from an image built with this branch's entrypoint, each call made with the token and arguments the tap's own `grantFor` and `scopeRequest` give: every call carried the member's own token and its `source_ids`, and `list_pages` 790 rows, `recall` 183, `search` 24, `query` 79, **0 outside the grant**. The keyless gbrain-check on that rebuilt image passed 37 of 37 again with 0 pin diffs.
- Preflight for a `member-sources` cell runs both existing probes: the member-token probe (`probeCompanyBrain` under member scope: one member's token lists nothing outside that member's reader sets, and the public-only token lists only pages every member may read) and the source-grant probe (`probeSourceGrants`, with the token-alone checks above for every member). Either one failing stops the run (HE-GBRAIN-002).
- Receipts: `handoffs/internal-task/prereg-keyless/a590ad07d15c/` in the Captain's drive (`tap-probe.md`, `member-token-probe.md`, `both-layers-probe.md`).

**Harnesses.** Built on each shard from this preregistration's merge commit, from the pins #142 used: OpenClaw `2026.10.6`, Hermes Agent `v2026.9.24` at `f97608f1` (`harnesses/*/pin.json`, unchanged since #142's execution commit `fd185baea`). Docker mode, serve mode. `preflight --cells` checks each shard's adapter digests against its checkout (HE-ADAPTER-005).

- A named limit, as before: the OpenClaw image installs with `npm install -g` and the Hermes image with `uv pip install -e`, neither from a lockfile, so the four shard builds may resolve different dependency versions.

**Runner.** The run executes from a worktree pinned at this preregistration's merge commit on main.

- This branch is based on main at `58186ff41` (#144) and merges main at `6c8fcfe77` (#146).
- #142's run executed at `fd185baea` (#128). Since then thirteen pull requests merged (`git log --first-parent --oneline fd185baea..6c8fcfe77`). Every path they touch under `runner`, `harnesses`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.3/dev` or `tasks/multiuser/_shared` is named here:
  - #144 (`58186ff41`, internal-task) is the template fix this run reads: `scripts/v03/gen-tasks.ts`, the three `ar-` `task.toml` files, and two grader files. `runner/grade/predicates.ts` and `runner/grade/task.ts` gain the optional `recipients_outside` field on `event` and `no_event` predicates, which only the regenerated `ar-` tasks use; a predicate without it grades as before.
  - #135 (`0feb3d72d`, internal-task) changes `runner/proxy/metering-proxy.ts` only on the free `count_tokens` route, which is served only when the proxy starts with `--free-count-tokens`. This run does not set it, so the route is refused as before.
  - #141 (`7da83ed94`, internal-task) names every Ubicloud VM with a `-t<hours>` TTL for gstack's reaper (`scripts/ubicloud/ubi-runner.sh`, `run-shard.sh`, `pr-check.sh`, `pr-watch.sh`, README). It changes VM names and lifetimes, never a trial.
  - Scripts that run outside trials: #145 (`scripts/host-pilot-tables.ts`), #138 (`scripts/instruction-followed.ts`), #137 (`scripts/anatomy/`), #139 (`scripts/ubicloud/merge-pass.sh`), #136 and #143 (`scripts/gstack-laneb/`, Lane B only).
  - #146 (`6c8fcfe77`, internal-task) adds `scripts/sealed/rekey.ts` and `scripts/sealed/compare-backups.ts` and two access-log event kinds in `scripts/sealed/custody.ts`: sealed custody code, which no dev cell triggers.
  - #140, #142 and #132 touch none of those paths.
- This pull request changes `gbrain/pin.json` and `gbrain/Dockerfile`, and so every gbrain image built from it. It changes `world/services/gbrain-tap.ts` (above, "The tap change this pin needs"), which changes what `recall` and `list_pages` return in any scope `sources` cell; cells without a scope are untouched, since the tap rewrites requests only when it holds source grants. It adds the cell value `scope: "member-sources"` ("Two scope layers", above) across the runner, the entrypoint and the tap; a cell with `member`, `sources` or no scope takes the same path as before. It also adds an optional `--told` flag to `scripts/v03/pilot-tables.ts` (endpoint 1); without the flag `pilot-tables.md` is byte-identical to before and each `pilot-tables.json` go-rule row gains `unrun` and `undecided` (checked on #142's merged results).

**Commit binding.** The run executes at this preregistration's merge commit on main, never at a branch commit.

- Before the fan-out, `git diff --stat <merge commit>^1 <merge commit>`, with no path filter, must list exactly this pull request's files.
- Also before the fan-out, `git log --first-parent --oneline 6c8fcfe77..<merge commit>^1` and `git diff --stat 6c8fcfe77 <merge commit>^1` list every pull request merged between this branch's base and this one. The report names each with its paths. One that touches `runner`, `harnesses`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.3/dev` or `tasks/multiuser/_shared` needs a dated amendment that names it, committed before any cell runs.
- The fan-out manifest records the merge commit. The report asserts that every shard's `shard.json` and `shard-vm.json` name it, that every `shard-vm.json` has `scratch_prereg` false, and that the run manifest's `prereg_sha256` equals the sha256 of `prereg.json` at that commit. Any other value is a deviation, and the affected cell is not reported as part of this run.

**Sharding (CREW.md: Parallelism, Pinned checkouts, Shards run on Ubicloud).** Four shards, one cell each, named in the table. **No cell is split across machines and no two cells share one.**

- Each shard runs on its own ephemeral standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)) with `UBI_OWNER=internal-task`, after `scripts/ubicloud/ubi-runner.sh usage`. The fan-out runs as a Capy background operation with a registered wait.
- Each VM checks the repository out detached at the merge commit (a dirty tree is refused), builds the harness and gbrain images from it, runs the lane's one-trial dev smoke, then `scripts/run-shard.sh` for its cell with `-- --max-output-tokens 128000`.
- Results come back to `<dest>/<shard>/results` and are merged with `scripts/merge-shards.ts`. The VM is destroyed on every exit.
- A shard that fails before its first trial is relaunched at the same commit. A shard interrupted mid-run resumes with `--resume` at the same commit under the same lease, and the resume log names the commit it loaded. After any stop, `UBI_OWNER=internal-task scripts/ubicloud/ubi-runner.sh list --mine` shows any VM left running.

**Run order within a shard.** The cell's trials in manifest order (task by task, repetitions in sequence), one at a time.

**Leases and spend.** Cap $4, the sum of four $1.00 leases.

- **Where the money comes from.** internal-task's $40 lane. It has committed $19.73 so far (the lane ledger, `harness-eval/ledger/lane-spend.jsonl` in the project drive): generation, audit and regenerations $6.49, the pilot $9.15, and #142's run $4.09. That leaves $20.27. **No counted trial starts unless the lane's remaining balance still covers the $4 cap plus the four $1 smoke-lease ceilings ($8 in all).** The report states that balance.
- **Why $1.00 a shard.** The proxy reserves each call at its input size and the output cap (`runner/proxy/metering-proxy.ts`, `reservationUsd` in `runner/ledger/budget-ledger.ts`). The largest single reservation was $0.4597 in #142's told ledgers and $0.5098 in the pilot's `told-scoped` ledgers. With a $0.51 reservation, a 15-trial shard finishes inside $1.00 up to about $0.033 a trial.
- **Expected cost per trial.** On these three tasks before the fix, #142's told cells spent a mean of $0.0211 a trial on OpenClaw and $0.0192 on Hermes (largest $0.0317), and the pilot's `told-scoped` cells $0.0228 and $0.0187 (largest $0.0370; both from the published `trials.jsonl`). So about $0.30 a cell and $1.25 for the run is expected. The fixed tasks may run longer, since a bot can now finish them; a cell averaging above $0.033 can reach its lease.
- A cell that reaches its lease is published as partial (HE-BUDGET-001) with the trials it completed, in manifest order, and the report says so first. Shards run without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`; the report counts them as not run. Excluded trials (`model_error`, `infra_error`, `exam_fault`) are never rerun.
- Leases are not moved between shards and change only by a dated amendment.
- VM cost is outside the model cap: four VMs for about an hour each (image builds plus 15 trials), about $2 at list price. The report gives each VM's list-price cost from `shard-vm.json`.

**Smokes.** Each VM's smoke is one uncounted dev trial of its cell (the lane's default task, the first directory of the v0.3 dev split, `ar-01-thornbury-rate-hollis`) under a scratch ledger and the lease `scripts/ubicloud/smoke-lease.ts` derives ($1 per Haiku shard, a reservation ceiling).

- Smoke spend is outside the $4 cap and charged to the lane at its actual spend (about $0.02 a trial).
- The smoke must end `completed` or the counted shard does not start. A smoke that stops only on OpenClaw's own Sonnet probe refused at $0 (HE-MODEL-001) is relaunched at the same commit, at most twice, and each relaunch is noted in the run log.

## Endpoints

**Endpoint 1 is the one gate. Endpoints 2 to 4 are dev and descriptive: no arm is tested against another, no p-value is reported, and nothing in them is a claim.**

Every interval is a task-clustered bootstrap 95 percent interval (tasks resampled with replacement, 10,000 draws, seed 7). n is given as tasks and trials.

1. **The re-read gate (#142's endpoint 6, "A new seal needs another dev read before opening 1").** Stated before any trial, and fixed here so the gate cannot move after data.
   - **Read.** The approval relay pass rate of the two deciding cells (`openclaw-haiku-gbrain-told-scoped-mu-v03-ar`, `hermes-haiku-gbrain-told-scoped-mu-v03-ar`), pooled over both cells and the three tasks, as a point estimate on scored trials: 30 trials before exclusions. The report gives n after exclusions. The interval is printed beside it and does not enter the rule.
   - The family is **informative** when that rate is at least 10 percent and at most 90 percent.
   - A deciding cell is partial when it stops before all its planned trials run. The family is undecided when some outcome of its unrun trials would give it a different label from the one its scored trials give. An undecided family counts as not informative.
   - **Computed by** `bun scripts/v03/pilot-tables.ts --results <merged results> --tasks tasks/multiuser/v0.3/dev --out <dir> --told openclaw-haiku-gbrain-told-scoped-mu-v03-ar,hermes-haiku-gbrain-told-scoped-mu-v03-ar`. Its "Go rule" table pools exactly the cells `--told` names and clusters on the task across both harnesses. It applies the partial-cell rule above from the merged results' `manifest.json` (a planned trial with no record, or only a cap-stop record, is unrun) and prints `no (undecided: N unrun)`; it refuses a `--told` cell with no trials and a duplicated trial id. Only its `approval_relay` row is read; the other families have no trials here. Its denominator is scored trials: `model_error`, `infra_error` and `exam_fault` trials are left out, and a `harness_error` counts as a failure.
   - **Defects.** Any of the three tasks with no pass in any scored trial of the two deciding cells is a candidate. It is judged by the pilot's defect rule (`v03-pilot-2026-10`'s preregistration, "Task defects", items 1 to 4: causes per trial, `HARNESS` trials out of the denominator, and two readers, the author and a second reader on claude-opus-5-5 or GPT-6.1 Sol who never sees the author's causes). The descriptive cells do not make or clear a candidate.
   - **The whole-set count.** The four families that passed in #142 (scope isolation 23 of 40, shared channel 14 of 20, synthesis 20 of 30, continuity 36 of 40) count as informative, as that gate requires. Corrections (1 of 40) does not. So the set shows 5 of 6 exactly when approval relay is informative here.
   - **Pass:** approval relay informative and no defect found. The set then shows 5 of 6 families informative (the caveat above applies), and the new v0.3 seal internal-task makes from the regenerated set is cleared for opening 1. That seal must be built from approval relay candidates generated at #144's merge commit `58186ff41`, with every other held-out candidate byte-identical to the retired seal's, as internal-task's reseal record shows. The report names its custody commit and bundle sha256, or says it does not exist yet and that the clearance waits for it. internal-task adds a dated note to `docs/benchmarks/2026-10-29-v03-pilot/`.
   - **Fail:** approval relay not informative, or a defect found. No opening. The set stays at 4 of 6. What happens to the template next (another revision, or dropping the family) is internal-task's decision; this run fixes no further rule. Any revision again needs its held-out candidates regenerated from the same private seed, a new seal, and another preregistered dev read.
   - **Either way,** corrections at the told-arm floor stays a named limit for opening 1, and #142's verdict and the pilot's are unchanged.

2. **The unscoped copy, descriptive.** The same approval relay rate, from the same script with `--told openclaw-haiku-gbrain-told-mu-v03-ar,hermes-haiku-gbrain-told-mu-v03-ar`, printed beside endpoint 1's rate with the words "descriptive, outside the rule". The two configs are not tested against each other. It shows how much of the family's rate depends on the config, at one pin, on the fixed tasks.

3. **Cross-scope reads via gbrain, per cell.** From `summary.json`'s per-cell gbrain block: trials with a cross-scope read that came through gbrain, and unreadable rows returned. For the deciding cells, every gbrain event that returned a page outside the requesting member's grant is named with its tool, task, repetition and event seq, whatever the tool. Expected at this pin with this tap: none from `search`, `query`, `recall` or `list_pages` (gbrain#8074 and the tap change above). Any such event is a finding for internal-task; it changes no figure here.

4. **Pass rate per cell and per task, and cost.** Trials graded `pass` with no consent violation, over scored trials, with intervals (`scripts/summarize-run.ts`); pass^5 and pass@5 per task; proxy-priced cost per trial per cell with its interval. Cost comparisons with #142 cross the template change and the pin.

Also descriptive: gbrain use and calls per trial per cell; approval stops, consent violations and hidden-fact leaks as counts with trial ids; terminations; refused proxy requests; median wall time per trial, labelled with its shard.

## One gate, no claim

Endpoint 1 is the only go or no-go rule here. It gates the new v0.3 seal for opening 1 and nothing else.

- **No earlier verdict is reopened.** #142's endpoint 6 result (Fail, 4 of 6) and the pilot's verdict (no-go) stand as their reports state them.
- Opening 1's design (which cells, how many repetitions, which pins) belongs to opening 1's own preregistration. This run hands it one number and the caveat.

## Cut line and drop order

Minimum: all four cells. There is no drop order. Each cell has its own shard and lease, so a cap stop or a failure in one leaves the others whole. **A partial cell is reported as partial.** A partial descriptive cell never affects the gate.

## Receipts

Under `docs/benchmarks/2026-10-30-v03-ar-reread/results/`:

- the merged `trials.jsonl`, `manifest.json`, `shards.json`;
- each shard's ledger, proxy log, proxy usage, preflight log, run-shard log, plan and run logs, `shard.json` and the lane's `shard-vm.json`, under its own name;
- `summary.json`, the two `pilot-tables` outputs (deciding and descriptive), and `defects.json` if any task is a candidate;
- per trial the events, turns, snapshot, usage, reconcile and grade files. Harness state, workspaces, raw harness logs and per-trial tokens are excluded, as in #142.

The results and the report come in a later pull request than this preregistration (CREW.md), and this preregistration is merged to main before the first trial.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

### Amendment 1 (2026-10-31): the two pull requests merged between this branch's base and its merge

The commit-binding check before the fan-out found two pull requests on main's first-parent history between this branch's base `6c8fcfe77` and the merge commit's first parent `5a9c066f3`. This preregistration did not name them. This amendment names them with their paths, as the commit-binding section requires.

**What does not change.** No cell, task, preamble, grader, pin, world file, lease, cap, endpoint or rule changes. The run still executes at the merge commit `eb630bd469d4af7cd36483a7e8cbfbfaa66fb21f`, and every shard checks out that commit, not this amendment's. No cell had run when this amendment was committed.

- **#155** (`5a9c066f3`, internal-task, the Lane B TB2 replication preregistration). It touches none of the listed paths: only its own preregistration directory, its `preregistrations.d` entry, and the version files.
- **#154** (`7672db33b`, internal-task, QM re-pinned to `b6786d67`). It touches 16 files under `runner`, `harnesses` and `scripts`:
  - `harnesses/qm/*` (Dockerfile, Dockerfile.sandbox, README.md, adapter.sh, compose.yaml, config/core.env, pin.json, prepare.sh, smoke-b6786d67.json): QM only. No cell of this run uses QM.
  - `harnesses/run-trial.sh`: a `prepare.sh` refusal now stops the trial, and blank lines in its output are skipped. That branch runs only for a harness with a `compose.yaml`. OpenClaw and Hermes have neither a `compose.yaml` nor a `prepare.sh` at the merge commit.
  - `runner/trial/trial.ts`: a doc comment, and the fix hint inside the HE-MODEL-001 message (it now names QM's `PI_MODEL`). The check, and when it fires, are unchanged.
  - `runner/run.ts`, `harnesses/serve-smoke.ts` and `harnesses/README.md`: comments and docs that list QM's configs.
  - `scripts/anatomy/capture.ts` and `scripts/anatomy/publish.sh`: the anatomy capture lane. The fan-out, shard, merge and summary scripts this run uses do not call them.
- **Expected effect on this run's trials:** none, except that an HE-MODEL-001 message, if one fires, carries the new fix hint. The report names both pull requests with these paths.
