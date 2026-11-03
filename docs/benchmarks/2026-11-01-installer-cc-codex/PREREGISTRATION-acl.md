# Installer rung for Claude Code and Codex, rerun with gbrain's per-member access rules: installer against told on 17 public v0.3 tasks, at gbrain v0.60.554.0

Status: written 2026-11-02 (America/Los_Angeles), before any trial of this run. Run id `installer-cc-codex-acl-2026-11`. It is amendment 3 of [installer-cc-codex-2026-11](PREREGISTRATION.md) and a new run id: that run is counted and stays as it is. This file and [prereg-acl.json](prereg-acl.json) are the whole design. Where a section below says "as in the first run", the first run's preregistration text applies word for word, with this run's cell ids and merge commit.

**In one line: the first run measured gbrain with no access rules, which is default-open. This rerun asks the same installer-against-told question with gbrain's per-member read access switched on the way gbrain ships it.**

- 6 cells, 306 trials, **cap $85** of model spend. Expected spend about $57, from the first run's counted spend.
- **What changes:** gbrain `f650eac5` (v0.60.554.0) instead of `a590ad07`, and an access-ruled member brain with member-bound tokens instead of the bot-visible brain with one bot token.
- **What stays:** the 17 tasks, 3 repetitions, both harness pins and models, the ceilings, the preambles, the installer route, the clean-arms preflight and audit, the endpoints and the decision sentences.
- **Both no-brain cells rerun at this commit** (Captain, 2026-11-02: "removing the confound is worth $15").
- **Dev only.** Public tasks. No trial starts until this preregistration is merged to main.

## Approval

- Captain Harness Evals, 2026-11-02, R40 fix lane: "Approved as written ... the --access rules brain build, the four-check fail-closed keyless preflight on the frozen pin, the four gbrain cells plus both no-brain controls at the same commit ... run id installer-cc-codex-acl-2026-11 as amendment 3 with the told-acl and installer-acl rungs."
- Captain, 2026-11-02: "Approved: cap $85 with the leases in your table, pinned to gbrain v0.60.554.0 (f650eac5) through the prereg's own gbrain_commit, and the runner refuses to start on a mismatch."
- Plan: `handoffs/HARN-13/rerun-acl/plan.md` in the Captain drive.

## Why this run

- **The first run was default-open.** It served the bot-visible dev brain under one bot token with no access rules, so gbrain returned pages the asking member may not read. Trials with cross-scope exposure: Claude Code installer 33/51, told 20/51; Codex installer 17/51, told 9/51; both no-brain cells 0/51. Receipts: that run's results pull request.
- **Its Why-null verdict was FIX-METHOD.** The Claude Code pass drop against no brain rests on a configuration gbrain users with several members are told not to run.
- **What gbrain ships for it (GBRA-108).** gbrain#8134 (b85dd645, 0.60.543.0) hides a page only when a rule names its readers (`readable_by` frontmatter or a `gbrain access rule add --prefix` folder rule), and only from a credential bound to a member (`gbrain access member add`, then `gbrain auth rescope --token <name> --member <id>`). Without both, current gbrain still returns those pages.

## Design

| Shard | Cell | Harness and model | gbrain | Preamble |
|---|---|---|---|---|
| cc-installer | `claude-code-opus-gbrain-installer-acl-mu-v03-dev` | Claude Code 2.1.312, Opus 5.5 | installer, access-ruled member brain | default |
| cc-told | `claude-code-opus-gbrain-told-acl-mu-v03-dev` | Claude Code 2.1.312, Opus 5.5 | starter, access-ruled member brain | gbrain ladder |
| cc-none | `claude-code-opus-none-acl-mu-v03-dev` | Claude Code 2.1.312, Opus 5.5 | none | default |
| cx-installer | `codex-sol-gbrain-installer-acl-mu-v03-dev` | Codex 0.165.0, GPT-6.1 Sol | installer, access-ruled member brain | default |
| cx-told | `codex-sol-gbrain-told-acl-mu-v03-dev` | Codex 0.165.0, GPT-6.1 Sol | starter, access-ruled member brain | gbrain ladder |
| cx-none | `codex-sol-none-acl-mu-v03-dev` | Codex 0.165.0, GPT-6.1 Sol | none | default |

- Tasks, repetitions, run order, ceilings, network and harness settings: as in the first run.
- gbrain cells carry `{"brain": "member", "scope": "member", "access": "rules"}` beside the first run's fields.

## Fixed now

**gbrain.** `prereg-acl.json` `gbrain_commit` is `f650eac5cf063f9ecda767bc424eae146dee84eb` (v0.60.554.0, gbrain#8318, published 2026-11-02T20:50:12Z; Test, E2E Tests, Release and Nightly watch all passed on that commit).

- Every shard builds its gbrain image with `build-gbrain-image.sh --gbrain` at that commit. `preflight` and `run` refuse to start when the image's gbrain commit differs.
- `gbrain/pin.json` (`a590ad07`, v0.60.522.0, the first run's pin) does not move.
- **Why .554 and not .551.** GBRA-108: pin .554 if it is published and green when the design is frozen. It is. It also carries gbrain#8318's install and serve-stdio fixes, which touch the installer route this run measures.
- The installer views are built from the same commit, so the installer installs gbrain `f650eac5`. At this commit `gbrain setup claude-code` and `gbrain setup codex` also write gbrain's hook launcher (`.gbrain/hook-launcher/gbrain-hook`). Before #229 (GST-970) the image build refused it (HE-GBRAIN-007), so this preregistration's merge commit must contain #229.
- **Codex hooks.** From v0.60.547.0 gbrain's post-upgrade no longer rewrites Codex hooks, so the Codex installer path here differs from the first run's.

**Brain: the access-ruled member brain** (`/brains/dev-member-acl`, `gbrain/build-brain.ts --brain member --access rules`).

- The same pages the first run served: the bot-visible slice of the dev split. They are staged one federated source per reader set (the member brain of gbrain-memory-2026-10), so each page's gbrain slug is unchanged.
- One folder rule per source that has a reader set: `gbrain access rule add --prefix dev/ --readers <the source's readers> --source <id> --yes`. The public source gets no rule.
- Each token member (the employees and Moss loaded for dev) is added with `gbrain access member add <id>`. Its token is minted with `gbrain auth create member-<id>` and bound with `gbrain auth rescope --token member-<id> --member <id>`, with no `--sources`. The rules are the only read gate.
- The public-only token is minted and left unbound. An unbound credential reads only pages under no rule.
- Keyword search, embeddings off, live ingestion off, as in the first run.
- The world tap presents the requesting member's token in each turn and the public-only token before the first turn (scope `member`, HARN-2).
- **Declared: writes are not gated.** A member token bound with `--member` and no `--sources` writes to gbrain's `default` source, which has no rule, so every member reads what any member wrote. Checked on the draft image: a `put_page` under one member's token was then served to another member and to public-only. This is gbrain's shipped behaviour with access rules, and the rerun measures it as shipped. The first run's grader already scopes a page the harness wrote by every conversation it was written in, so a write that carries one member's scope into another member's read counts as exposure in both arms.

**Fail-closed preflight, keyless, per shard, before its smoke.** Any failure stops the shard (HE-GBRAIN-002) and no trial runs:

1. `gbrain access check --token member-<id> --json` reports each member token bound to exactly that member, and the public-only token unbound.
2. Every page is readable by exactly the world's reader set for that record. Readers come from `gbrain access rule list` for the page's source. `gbrain access who-can-read` reads only a page's own `readable_by` frontmatter at this commit, so for a page covered only by a folder rule it answers `every_source_reader`; the check counts those answers and does not take them as the reader set.
3. A probe through the tap under each member token (search, query and recall over fixed queries, list_pages once) returns no row outside that member's reader set, matching each row on its source and slug. `get_page` under each member token is refused for every page outside that member's reader set and serves one page inside it (added in review, after the frozen-pin preflight below).
4. The installer-view preflight passes for both hosts at the pinned commit (HE-GBRAIN-006, HE-ADAPTER-005).

All four ran on the frozen pin before this pull request opened. Their output is under "Preflight on the frozen pin" below.

**Clean arms.** As in the first run, including amendment 2's recorded matches, with this run's images. The preflight output per shard is kept with its results.

**Runner and commit binding, sharding, shard smokes, wall time.** As in the first run, with this preregistration's merge commit.

**Leases and spend.** Cap **$85** of model spend. VMs are outside it at list price, about $8. Smokes go to the lane's smoke line, about $2.

- There is no costing smoke. Each projection is the cell's counted spend in the first run.
- Each lease is 1.5 times its projection, rounded down to the next $0.05: cc-installer $19.85, cc-told $15.55, cc-none $12.95, cx-installer $15.00, cx-told $12.45, cx-none $9.05. They sum to $84.85.
- **Why 1.5 times.** The proxy reserves each call's worst case before forwarding it ($3.04 for Opus, $1.62 for Sol in the first run's costing smoke), so the last reservation of a lease cannot be spent. At 1.5 times, every shard keeps 15 to 27 percent above its projection after that reservation.
- A cell that reaches its lease is published as partial, as in the first run. Leases change only by a dated amendment.

## Endpoints

As in the first run: the primary endpoint (cross-scope exposure via gbrain, installer minus told, per host, `--require-exposure`), the secondary and descriptive rows, and the decision sentences, with "(dev)" in each.

- **Ladder rungs.** Two new rungs in `scripts/gbrain-ladder.ts`: `told-acl` (base `told`) and `installer-acl` (base `told-acl`). compare-run `--pair gbrain --design ladder --require-exposure` pairs installer-acl with told-acl within each host.
- **Refused cross-scope attempts** by gbrain tool are printed per cell. With the rules on, a cross-scope read gbrain refuses is the expected outcome, and it is not exposure.
- **If both arms of a host show no exposure**, that host's decision is "Not distinguished" by construction. The report then says the rules closed the exposure on that host, and pass rate against no brain is its main descriptive result.
- **Against no brain.** Each gbrain cell's pass rate, per family, against its host's no-brain cell in this run. This answers the first run's Why-null question.
- **Against the first run.** The first run's rows are printed next to these as default-open. They are never pooled with them.

## Receipts

As in the first run, under `results-acl/` and `report-acl.md` in this directory.

## Preflight on the frozen pin

Run 2026-11-02, keyless, on a gbrain image built at `f650eac5` from this branch with #229's files applied (`sha256:76e7294ddbfd`, `gbrain 0.60.554.0`; `image.json` records `gbrain_commit` `f650eac5cf063f9ecda767bc424eae146dee84eb`). A scratch copy of `prereg-acl.json` was planned and `preflight --cells` ran the four gbrain cells: `PREFLIGHT: ok`.

- **Pin.** `GBRAIN: image ... records gbrain f650eac5cf063f9ecda767bc424eae146dee84eb, the preregistration's gbrain_commit`. `/health` answered gbrain 0.60.554.0 with 33 tools on starter.
- **Check 1.** 15 member tokens, each bound to its own member. public-only is unbound.
- **Check 2.** 20 folder rules over 20 sources, none on the public source, nothing held or pending. 18 pages, each readable by exactly the world's reader set. who-can-read answered `every_source_reader` for the 7 pages covered only by a folder rule.
- **Check 3.** 16 credentials x 8 queries over search, query and recall, plus list_pages to the end: 987 rows (search 263, query 263, recall 263, list_pages 198), 0 outside the credential's reader set, and every readable page listed.
- **Check 4.** Claude Code view `aa3adaf6a314` and Codex view `912eab47a65f`, 6 files each, both carrying `.gbrain/hook-launcher/gbrain-hook` and the UserPromptSubmit hook. Adapter digests match the checkout (`c447b248a72f`, `bc936be26b6b`).
- Each shard reruns checks 1 to 4 on images built from this preregistration's merge commit before its smoke.
