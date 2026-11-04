# Publishing checklist: making harness-evals public

harness-evals v0.0.7, audited 2026-10-24 (internal-task), with the merge record added 2026-10-25 (internal-task). This page records what was checked before the repository can be made public, how to run the check again, what remains for the owner to decide, and the one-line recommendation. It changes nothing: visibility is Garry Tan's decision and is not flipped by this work.

**Status, 2026-11-02: the plan changed.** This repository stays private. The public repository is to be a separate, curated export of main: a publication manifest will decide what goes out, a history filter will keep only those paths, and secret, marker and sealed-file gates will fail closed on the exported tree and history. That tooling is planned and not yet in this tree. The custody branch never leaves this repository. The decisions below are settled:

- **Interests:** answered. Every page that tests, compares or features gstack, gbrain, QM, Hermes, OpenAI or OpenClaw closes with a Disclosures section in Garry's words.
- **Held-out tasks:** spent sets (v0.1 and v0.2) are published, labelled spent. Sets that are still sealed stay private, with only their hash manifests public.
- **Preregistration order** for runs before the export is attested privately, not publicly verifiable.
- **Claude Code captures** (full prompt text and tool schemas) are to stay out of the export; the public copy keeps their hashes, sizes and short quotations ([THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) lists the paths).

The rest of this page is the 2026-10-24 audit, kept as written, with superseded lines marked.

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

No Slack, Anthropic, gbrain, OpenAI-shaped, GitHub or AWS token shape appears in any tracked file, in any decoded snapshot, in any ledger row, or in any blob of any commit on any ref. The 28,131 allowlisted strings in the tree (21,854 in history) are the per-trial dummies the metering proxy mints for the harness containers (`trial-token:<id>` since 2026-10-26; `sk-trial-<id>` in every run before that, which is every committed receipt): they are recorded in `turns/*.request.json`, `adapter.log` and the ledgers by design, they never reach the provider, and each is dead when its trial ends. One further allowlisted string is a placeholder bearer value in `tests/metering-proxy.test.ts` (`dummy-from-container`, `placeholder-openai`), reviewed and named in the script. During this work, two blobs holding fake key literals existed only in a local pre-squash commit of `tests/reconcile-provider.test.ts` and were never pushed; the test now builds its fakes at runtime, and the history scan of the pushed refs is clean.

### Personal data

The company in the world is synthetic: `world/seed/world.json` is generated from the `messy-company-v1` dataset of [gbrain-evals](https://github.com/garrytan/gbrain-evals) (`eval/data/messy-company-v1`, 228 inputs, digests in [world/seed/MANIFEST.json](../world/seed/MANIFEST.json)); the members, accounts, addresses and messages are its inventions, and the tasks and receipts reuse them. The audit cannot tell a real person's name from an invented one, so the claim made here is provenance, not absence: nothing in the tree was taken from a real workplace. Reviewed exceptions: the email domains listed in the output are the corpus's own (`pemberline.com` is the company; the `.example` and `.invalid` domains are reserved; `bettina.kroll` is a mention parsed as a domain). Of the nine corpus domains that end in a real top-level domain, eight did not resolve in DNS from the audit machine on 2026-10-24 and one, `saltmarshprovisions.com`, resolves to a parked address; it appears once, in a mail body in `world/seed/world.json` that came with the dataset. No phone-shaped string appears. A grep of the working tree during the audit also showed `gmail.com` and three other real domains; they are in `node_modules`, not in any tracked file.

### Receipts

Every committed results tree holds evaluator-owned files only: `events.jsonl`, `turns.jsonl`, `turns/*.request.json` (the exact prompts), `snapshot.json.gz`, `usage.json`, `reconcile.json`, `grade.json`, `logs/adapter.log`, and per run `trials.jsonl`, `summary.json`, `proxy-usage.ndjson` (no bodies, no keys), `ledger.sqlite`, `spend-reconciliation.json`, `taxonomy.{json,md}`. The `results/.gitignore` copied into each run excludes `trial.json`, `state/`, `workspace/`, `gbrain/`, raw harness logs, compose overrides and the SQLite journals, and the audit confirms none is committed (750 trials across the three v0.1 runs and the smoke).

### Merge record

The pull requests merged from #21 to #78 (55 of them by GitHub's pull request list on 2026-10-25; #28 and #31 were closed without merging and #77 was still open) landed on the GitHub Actions checks (and, from 2026-10-24, the Ubicloud lane's `ubicloud/checks` status) plus the coordinating agent's receipts checks. From 2026-10-25 every pull request also carries a gstack /ship receipt on its head before it merges: the PR body ends with `GSTACK_RESULT: skill=ship status=<s> run=<dir>` and the head sha the pass ran on, the pass's artifacts are kept under the project's private drive's `handoffs/<thread>/ship/<pr>/`, and a push after the pass needs a new one.

### Held-out tasks

The 20 v0.1 held-out task texts are already disclosed: every committed `turns.jsonl` carries the exact prompt, so hiding `tasks/multiuser/heldout/` now would hide nothing. The seal ([MANIFEST.json](../tasks/multiuser/heldout/MANIFEST.json), `bun scripts/seal-heldout.ts --check`, 144 files, 20 tasks) proves the tasks did not change between the preregistration and the reports. Recommendation: keep the v0.1 held-out tasks in the public repository with their seal and treat the set as spent; author v0.2's held-out tasks outside the public repository, publishing each set with its seal only when a run has spent it. The v0.2 held-out sets already committed (`tasks/multiuser/v0.2/heldout`, continuity and synthesis, sealed, 69 files, 8 tasks at the time of writing) are disclosed the moment the repository is public; whether that is acceptable is Garry's call. (Decided 2026-11-02: the spent v0.2 set is published, labelled spent; see the status note at the top.)

### Licence and attribution

`LICENSE` is MIT, copyright 2026 Garry Tan. The statistics kit vendored from gbrain-evals carries its MIT notice and names its source (`runner/stats/README.md`). OpenClaw, Hermes Agent and QM are used as product names only, each with a link to its own repository or documentation, and the pinned versions and commits are in `harnesses/*/pin.json`.

### Links and private references

`python3 scripts/check-links.py` is green. No file links to a Capy thread or to a private drive. Seven files mention `~/.capy/work`, a machine scratch directory, in plan review notes and READMEs; cosmetic, not a secret.

## Residual risks

- Real-looking domains from the generated corpus, one of which resolves. Low: one mail body, no real person, dataset-provided. Owner's call whether to leave it, since world files are frozen between a run's preregistration and its report.
- Provider-side spend is unverified (every dollar figure is the proxy's list-price meter; see `results/spend-reconciliation.json` in each run). Not a publishing risk, but the public report says so in words.
- The receipts carry the harnesses' full prompts and replies through `turns.jsonl` and `adapter.log`, about 47 MiB in the tree. They are the evidence the reports rest on; nothing in them is a secret, but readers will see every harness's system prompt as the runner saw it.
- Conflict-of-interest wording on [docs/report-v0.1.md](report-v0.1.md) is marked for Garry to confirm before the page is public. (Resolved 2026-11-02: Garry gave the disclosure lines, and that page closes with them.)

### Sealed custody: before any visibility change

From v0.3, sealed sets keep their ciphertext, the custody access log and the identity escrow on the orphan branch `custody` of this repository ([sealed custody](sealed-custody.md#if-the-repository-is-to-become-public)). Making the repository public would publish them. `scripts/sealed/open.ts`, `export.ts` and `seal.ts` check `gh api repos/garrytan/harness-evals -q .private` and refuse (HE-SEALED-013) when it is not `true` or cannot be read, but that guard only stops later custody work. The step that must come first:

1. Move `refs/heads/custody` to a private repository or delete it, and confirm `git ls-remote origin refs/heads/custody` prints nothing.
2. If any set is to stay sealed, generate a new identity (`scripts/sealed/keygen.ts`), reseal those sets under it as new sets, and re-escrow; whatever was on the old branch counts as published once the repository is public.
3. Run `bun scripts/check-sealed-publication.ts` on main (no `*.age`, no identity, no access log, no raw sealed receipts), then change the visibility.

## Recommendation

Superseded on 2026-11-02 by the export plan in the status note at the top. The 2026-10-24 recommendation was: the repository can be made public as it stands once Garry confirms the interests paragraph and decides about the v0.2 held-out set; the audit passes, the receipts are evaluator-owned, and the held-out seal is the proof of custody. This thread did not change visibility.

## Changelog

### 2026-11-04: plain names for internal roles

Mentions of the project's coordinating agent, its private drive and its agent threads now use those plain names instead of internal role names. No number, link or claim changes. Why: the page is published, and the public export blocks internal role names in prose.

### 2026-11-02: status note for the public export

A status note at the top says the public repository is a curated export and lists the settled decisions: disclosures, spent held-out sets, privately attested preregistration order and Claude Code captures. The interests risk and the v0.2 held-out question are marked resolved, and the old recommendation is marked superseded. The 2026-10-24 audit text is otherwise unchanged.

### 2026-10-28: sealed custody before a visibility change (internal-task)

Added "Sealed custody: before any visibility change": the custody branch moves or goes, and still-sealed sets are re-keyed, before the repository is made public.

### 2026-10-25: merge record (internal-task)

harness-evals v0.0.7. Added the merge record: the 55 pull requests merged from #21 to #78 landed on CI plus the coordinating agent's receipts checks; from 2026-10-25 every pull request carries a gstack /ship receipt on its head before merge.

### 2026-10-24: first version (internal-task)

harness-evals v0.0.5. Audit script and this record written; nothing published.
