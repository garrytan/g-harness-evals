# Publishing checklist: making harness-evals public

harness-evals v0.0.5, audited 2026-10-24 (internal-task). This page records what was checked before the repository can be made public, how to run the check again, what remains for the owner to decide, and the one-line recommendation. It changes nothing: visibility is Garry Tan's decision and is not flipped by this work.

## Run the audit

```
bun scripts/publish-audit.ts [--json <out.json>] [--no-history]
```

Keyless, read-only, about two seconds on this repository. It fails closed (exit 1) on any token-shaped string outside the trial-token allowlist, any harness-owned file under a results tree, a failing link check, or a reference to a Capy thread or private drive; it exits 2 if its own synthetic canary is not detected. The token prefixes are assembled from parts inside the script so the script does not match itself. Run it from a clone that has fetched every branch you intend to publish: the history scan covers every ref the clone knows (`git rev-list --all`), remote-tracking branches included.

## What the audit found

Output of the run on the tree this page was committed with (the committed check is the one to trust; the commit hash in the heading is the checkout the audit ran from):

> Canary: detected ({"slack_bot":1,"anthropic":2,"gbrain":1,"openai_or_generic_sk":2,"allowlisted:openai_or_generic_sk":1,"bearer":1}).
> Working tree: 9129 tracked files, 47.2 MiB, 750 gzipped snapshots decoded, 3 SQLite ledgers read row by row. Token-shaped strings: none. Allowlisted trial tokens: {"allowlisted:openai_or_generic_sk":28131,"allowlisted:bearer":1}.
> History: 9111 blobs in every ref (49.1 MiB decoded). Token-shaped strings: none. Allowlisted: {"allowlisted:openai_or_generic_sk":21854,"allowlisted:bearer":1}.
> Receipts: 5 run folders, 8672 files; 750 snapshot.json.gz, 750 adapter.log, 1680 turn request files, 3 proxy-usage.ndjson, 3 ledgers, 3 results/.gitignore. Harness-owned files committed: none.
> Email domains in the tracked tree (text files): pemberline.com (1365), carrowmere.example (463), saltmarshprovisions.example (330), quarrendonfreight.example (152), thornburycloth.com (4), bettina.kroll (3), tansleighpkg.com (3), stoneharrowbilling.com (3), tamsincoldchain.example (2), quarrendon.example (2), outside.example (2), example.com (2), qfl.example (2), tansleyparcel.com (2), orlavenehealth.org (2), vantorregroup.com (2), unknown.example (1), vantorre-group.example (1), brackenwater.invalid (1), orrinmills.com (1), pemberline.example (1), vantorre.com (1), saltmarshprovisions.com (1).
> Phone-shaped strings: 0 in 0 file(s).
> Links: check-links: 0 problem(s). References to a Capy thread or private drive: none. Files naming a machine scratch path (~/.capy/work, not a secret, cosmetic): 7 (TODOS.md, docs/plans/2026-10-21-harness-eval-v0/reviews/ceo-native.a1.md, docs/plans/2026-10-21-harness-eval-v0/reviews/ceo-native.a7.md, docs/plans/2026-10-21-harness-eval-v0/reviews/eng-native.a11.md, docs/plans/2026-10-21-harness-eval-v0/reviews/eng-native.a5.md, world/README.md, world/seed/README.md).
> Licence: MIT License; vendored notices: runner/stats/README.md MIT, names gbrain-evals.
>
> PASS: no token-shaped string outside the trial-token allowlist, no harness-owned file under results, links green.

### Secrets

No Slack, Anthropic, gbrain, OpenAI-shaped, GitHub or AWS token shape appears in any tracked file, in any decoded snapshot, in any ledger row, or in any blob of any commit on any ref. The 28,131 allowlisted strings in the tree (21,854 in history) are the per-trial `sk-trial-` dummies the metering proxy mints for the harness containers: they are recorded in `turns/*.request.json`, `adapter.log` and the ledgers by design, they never reach the provider, and each is dead when its trial ends. One further allowlisted string is a placeholder bearer value in `tests/metering-proxy.test.ts` (`dummy-from-container`, `placeholder-openai`), reviewed and named in the script. During this work, two blobs holding fake key literals existed only in a local pre-squash commit of `tests/reconcile-provider.test.ts` and were never pushed; the test now builds its fakes at runtime, and the history scan of the pushed refs is clean.

### Personal data

The company in the world is synthetic: `world/seed/world.json` is generated from the `messy-company-v1` dataset of [gbrain-evals](https://github.com/garrytan/gbrain-evals) (`eval/data/messy-company-v1`, 228 inputs, digests in [world/seed/MANIFEST.json](../world/seed/MANIFEST.json)); the members, accounts, addresses and messages are its inventions, and the tasks and receipts reuse them. The audit cannot tell a real person's name from an invented one, so the claim made here is provenance, not absence: nothing in the tree was taken from a real workplace. Reviewed exceptions: the email domains listed in the output are the corpus's own (`pemberline.com` is the company; the `.example` and `.invalid` domains are reserved; `bettina.kroll` is a mention parsed as a domain). Of the nine corpus domains that end in a real top-level domain, eight did not resolve in DNS from the audit machine on 2026-10-24 and one, `saltmarshprovisions.com`, resolves to a parked address; it appears once, in a mail body in `world/seed/world.json` that came with the dataset. No phone-shaped string appears. A grep of the working tree during the audit also showed `gmail.com` and three other real domains; they are in `node_modules`, not in any tracked file.

### Receipts

Every committed results tree holds evaluator-owned files only: `events.jsonl`, `turns.jsonl`, `turns/*.request.json` (the exact prompts), `snapshot.json.gz`, `usage.json`, `reconcile.json`, `grade.json`, `logs/adapter.log`, and per run `trials.jsonl`, `summary.json`, `proxy-usage.ndjson` (no bodies, no keys), `ledger.sqlite`, `spend-reconciliation.json`, `taxonomy.{json,md}`. The `results/.gitignore` copied into each run excludes `trial.json`, `state/`, `workspace/`, `gbrain/`, raw harness logs, compose overrides and the SQLite journals, and the audit confirms none is committed (750 trials across the three v0.1 runs and the smoke).

### Held-out tasks

The 20 v0.1 held-out task texts are already disclosed: every committed `turns.jsonl` carries the exact prompt, so hiding `tasks/multiuser/heldout/` now would hide nothing. The seal ([MANIFEST.json](../tasks/multiuser/heldout/MANIFEST.json), `bun scripts/seal-heldout.ts --check`, 144 files, 20 tasks) proves the tasks did not change between the preregistration and the reports. Recommendation: keep the v0.1 held-out tasks in the public repository with their seal and treat the set as spent; author v0.2's held-out tasks outside the public repository, publishing each set with its seal only when a run has spent it. The v0.2 held-out sets already committed (`tasks/multiuser/v0.2/heldout`, continuity and synthesis, sealed, 69 files, 8 tasks at the time of writing) are disclosed the moment the repository is public; whether that is acceptable is Garry's call.

### Licence and attribution

`LICENSE` is MIT, copyright 2026 Garry Tan. The statistics kit vendored from gbrain-evals carries its MIT notice and names its source (`runner/stats/README.md`). OpenClaw, Hermes Agent and QM are used as product names only, each with a link to its own repository or documentation, and the pinned versions and commits are in `harnesses/*/pin.json`.

### Links and private references

`python3 scripts/check-links.py` is green. No file links to a Capy thread or to a private drive. Seven files mention `~/.capy/work`, a machine scratch directory, in plan review notes and READMEs; cosmetic, not a secret.

## Residual risks

- Real-looking domains from the generated corpus, one of which resolves. Low: one mail body, no real person, dataset-provided. Owner's call whether to leave it, since world files are frozen between a run's preregistration and its report.
- Provider-side spend is unverified (every dollar figure is the proxy's list-price meter; see `results/spend-reconciliation.json` in each run). Not a publishing risk, but the public report says so in words.
- The receipts carry the harnesses' full prompts and replies through `turns.jsonl` and `adapter.log`, about 47 MiB in the tree. They are the evidence the reports rest on; nothing in them is a secret, but readers will see every harness's system prompt as the runner saw it.
- Conflict-of-interest wording on [docs/report-v0.1.md](report-v0.1.md) is marked for Garry to confirm before the page is public.

## Recommendation

The repository can be made public as it stands once Garry confirms the interests paragraph and decides about the v0.2 held-out set; the audit passes, the receipts are evaluator-owned, and the held-out seal is the proof of custody. This thread did not change visibility.

## Changelog

### 2026-10-24: first version (internal-task)

harness-evals v0.0.5. Audit script and this record written; nothing published.
