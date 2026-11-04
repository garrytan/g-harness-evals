# What harness-eval takes from garrytan/Gbrain-evals

harness-evals v0.0.12. Read 2026-10-22 at Gbrain-evals v0.10.128 (`6999ebc9`). Gbrain-evals is a mature public eval repo for one product (gbrain) against comparison systems; harness-eval compares five harnesses with no home-team product. Most of its machinery transfers; its "put the product's best foot forward" framing does not.

## Adopt as-is (reuse code or copy the shape)

| Convention | Where in Gbrain-evals | How harness-eval uses it |
|---|---|---|
| **Preregistration before the first counted cell**: question, fixed seeds, models, arms, caps, comparator rule, primary endpoint, decision sentences, planning MDD; dated amendments committed before the cells they affect; a CI job (`prereg-order`) checks that preregistration commits precede result commits | `docs/benchmarks/cat40-hard/PREREGISTRATION.md`, `docs/benchmarks/preregistrations.d/*.json`, `.github/workflows/ci.yml` | One `PREREGISTRATION.md` per slice run; the `preregistrations.d` JSON registry and the `prereg-order` CI job copied verbatim |
| **Budget ledger**: SQLite, reserve worst case before a request leaves, settle to provider usage, program cap stored in the ledger, refusal messages name the fix, overshoot recorded | `eval/runner/budget-ledger.ts`, `docs/budget-ledger.md` | Vendor the ledger into the model proxy; the DX/Eng reviewers' spend-cap, concurrency and paid-call-uncertainty findings are solved by this one component |
| **Metering proxy as the only network exit**: strips the container's credential, injects the real key, allowlists provider routes and models, prices every request, enforces output limits, handles or disables streaming, totals checked against the provider usage page within 2% | OSS memory shootout plan, `eval/runner/metering-proxy.ts` | This is our `runner/proxy/`; it also answers Eng F1 (per-trial virtual keys, forced `stream_options.include_usage`) and the DX Critical on redaction |
| **Pinned harness image with read-only mounts**: one Docker image pins the agent CLIs by version and labels them; the thing under test and the driver are mounted read-only at run time so one image serves every build | `eval/runner/cat41/Dockerfile` | Our `harnesses/<name>/Dockerfile` pattern: task image unchanged, harness at `/opt/harness` read-only, state in `/harness-state`; answers Eng F3/F4 |
| **Ground truth from effects, never from the agent's words**: a fake provider request log, a command-wrapper log and filesystem probes; a taxonomy of consent `Effect`s (`paid`, `destructive`, `credentials`, `egress`, `persistent_install`, `capture`) and per-step classes (`authorized_execution`, `required_relay`, `correct_refusal`, `successful_recovery`, `consent_violation`, `false_empty`) | `eval/runner/cat41/scenarios.ts`, `types.ts` | Replace our vague "unauthorised action" with Cat 41's effect and step-class taxonomy; approval stops become world-state events (fixes DX contradiction on items 6/7) |
| **Receipts manifest**: a JSON map from each published claim to an artifact path, its SHA-256 and JSON-pointer expected values, checked by a test | `docs/receipts-manifest.json`, `test/eval/receipts-manifest.test.ts` | Every number in `report.md` has a manifest row; `make score` byte-for-byte reproducibility becomes a test |
| **Statistics kit**: exact / noninferiority / superiority / exploratory gate kinds, Holm correction, task-clustered paired bootstrap, `cluster_by`, min-clusters rule, "a model at ceiling is uninformative, not a tie" | `eval/runner/stats/gates.ts`, `paired.ts`, `holdout_stats.py` | Vendor the kit; cluster by task (five trials of one task are one cluster), which the outside Eng voice asked for |
| **Dev / held-out split with custody**: tune on dev, confirm once on a held-out or sealed world generated from a private seed; digests committed before the world is opened; a world that has run once is spent | `docs/decisions.md`, `cat40-hard/SEALED.md`, `messy-company-v1` dev/heldout clusters | Work and multi-user tasks get a dev split (public, for adapter development) and a held-out split (run once for the report); fixes CEO F9 (public repo contaminates tasks) |
| **Frozen data manifests**: `MANIFEST.json` with sha256 per data file; `validate-data.ts` fails on drift | `eval/data/messy-company-v1/MANIFEST.json` | Same for `tasks/` and world seeds |
| **Keyless CI tier**: CI runs with zero secrets (typecheck, validators, hermetic scripted arms); paid runs are manual and land receipts | `.github/workflows/ci.yml` | Fixes the DX finding that smoke cannot run on fork PRs: CI runs scripted-model arms and oracle graders, never a real harness with a key |
| **Document shape**: README = what it is at the pin, current results (each number with commit and report), comparisons; hub pages end with a `## Changelog` newest first; replace superseded claims instead of appending "Update" blocks; CLAUDE.md + AGENTS.md as the operating guide for agents; TODOS.md for deferred work with its origin | `CLAUDE.md`, `AGENTS.md`, `README.md`, `TODOS.md`, `CHANGELOG.md` | Copy the shape; drop the "positively disposed toward the product" rule since we have no product |
| **Plan and review artefacts in-repo**: `docs/plans/<date>-<name>/PLAN.md` with `reviews/ceo-*.md`, `eng-*.md` and a `## Review record` | `docs/plans/2026-10-05-oss-memory-shootout/` | This autoplan run's exported artefacts land at `docs/plans/2026-10-21-harness-eval-v0/` |
| **Benchmark report shape**: finding, concrete case, experiment and results, what to use and avoid, reproduce and inspect | CLAUDE.md "Shape of a benchmark report" | Our `report.md` template |
| **Named denominators**: never combine recall-all, recall-any, precision, accuracy under one number | CLAUDE.md evidence rules | Already in our contract; adopt the wording |
| **Model freshness rule**: every model-comparison run uses the newest frontier model of each family; a newer release replaces its predecessor only through a dated amendment | CLAUDE.md "Choose models" | Governs the sensitivity cell (d3b) |

**Note added 2026-10-28 (internal-task).** The dev and held-out row above was not enforced from 2026-10-23 to 2026-10-28: the v0.1 held-out set served ten counted runs and the v0.2 set two, with nothing counting looks across runs. From 2026-10-28 only a held-out set's first counted opening is confirmatory and every later opening is dev, as the [README Corrections](../README.md#corrections) entry of that date records.

## Reuse the data

`eval/data/messy-company-v1` is a frozen fictional company (Pemberline Systems, 14 employees, 16 accounts, emails, chats, CRM notes, meeting notes, support tickets, weekly updates, private notes, 41 contracts; dev/held-out split by account cluster; look-alike names, renamed accounts, superseded values, private-only assignments). It is a ready-made seed for the simulated Slack workspace: its 14 employees become the workspace members, its chats become channel history, its private notes become per-person scoped memory, and its existing gold labels (ownership, governing records, contradictions) become graders for multi-user tasks. Reusing it saves M2's "author a world from scratch" and inherits a validated MANIFEST.

## Adapt, do not copy

- Gbrain-evals compares *systems* behind a narrow `Adapter` / `MemorySystem` interface; our harnesses are whole agents, so the equivalent contract is the Claw-SWE-Bench adapter protocol (task in, world state out) plus Cat 41's effect log, not a retrieve/ingest API.
- Cat 41's `Harness = 'claude' | 'codex'` is two closed CLIs with bypassed permission prompts; ours adds server-shaped harnesses (OpenClaw gateway, QM web/Slack) that need a non-interactive first-run path (DX Critical).
- Gbrain-evals has one product and a "known limits" section about it; our report has no home team and must give every harness the same treatment, including an identical "what to use and avoid" paragraph structure.

## Do not take

- The "write for the engineer deciding whether to try gbrain / best foot forward" rule.
- The Bun-only toolchain as a requirement: Harbor and most harness adapters are Python; Bun stays for the ledger, proxy and stats if vendored.

## README and docs aligned 2026-10-26 (internal-task)

Read again at gbrain-evals `README.md` of 2026-10-26 (its changelog's newest entry re-pins to gbrain `7a6bdd357`, v0.10.129) and its `docs/` tree. What this repository's README and docs took, adapted and left out:

| gbrain-evals | Here | Why |
|---|---|---|
| README sections in this order: the thing under test with its pin, what it does, current results, how it compares, known limits, where to read next, try a small experiment, corrections, inspect or extend, changelog | The same order in [../README.md](../README.md). "The gbrain under test" is "The harnesses under test" (three pins and the gbrain sidecar pin); "What gbrain does" is "What the world and the tasks are", because the harnesses are the subjects and the world is what is fixed; "How gbrain compares" is kept and a "How the harnesses compare" section stands before it | Taken as the shape; the subject differs |
| Current results: one table, one row per finding, a bold headline number, the commit, a link to the report | One table, one row per counted run, with cells and trials, the question, the primary estimate with its interval and Holm p, spend against the lease, and links to the report and the `results/` directory. No bold numbers | A run here is a comparison with a preregistered family, so the row carries the interval and the p value rather than a headline figure; CLAUDE.md asks for intervals, never ranks |
| Numbers quoted with the gbrain commit they were measured at | Numbers quoted with the run id and date, each row linking the report whose line they come from; the harness and gbrain commits are in each run's `PREREGISTRATION.md` and receipts | Three harnesses and a sidecar per run; one commit column would not fit |
| `docs/README.md` index, one line per page | [README.md](README.md), one line per page plus one line per benchmark folder with its run id and the UTC dates the trials ran | Taken as is; the folder lines are added because three directories are dated a day before their trials ran |
| `docs/decisions.md`: dated one-line decisions with a source | [decisions.md](decisions.md), newest first, each line naming who decided and the committed file or private drive file it comes from | Taken as is |
| `docs/budget-ledger.md`: spend per lane, hand-maintained | [budget-ledger.md](budget-ledger.md) rendered by `scripts/budget-ledger.ts` from [ledger/lane-spend.jsonl](ledger/lane-spend.jsonl), a verbatim copy of the project drive's ledger notes, with `--check`; a second table lists run ledgers the lane ledger does not yet carry | Rendered rather than hand-written so the page cannot drift from the JSONL; the program cap and the proxy-side caveat are stated on the page |
| `docs/comparing-runs.md`: how two results are compared | [comparing-runs.md](comparing-runs.md): the paired task-clustered estimator, sign-flip test, Holm and minimum detectable difference, each script's flags, and the exact commands every counted report names | Taken as is; the content is this repository's statistics kit |
| `docs/receipts-manifest.json`: machine-readable list of receipts | [receipts-manifest.json](receipts-manifest.json) generated by `scripts/receipts-manifest.ts` with `--check`: every results directory, run id, preregistration commit and amendments, trial count, cells, ledger files with sha256 and committed dollars, sha256 of `trials.jsonl` | Taken as is, generated so a new run cannot be left out |
| `docs/usage-receipt.md`, `docs/settings.md`, `docs/retrieval-lessons.md`, `docs/comparison-systems.md`, `docs/audit/` | Not added | No product usage to receipt, no settings surface, no retrieval system; the publishing audit lives in [publishing-checklist.md](publishing-checklist.md) and `scripts/publish-audit.ts` |
| Corrections: dated entries saying what was wrong and what the receipts say, the original kept in the report | The same, in the README's Corrections section, collecting every dated correction the reports already carry and the numbers the review voices caught before a merge | Taken as is |
| "Best foot forward" framing and a known-limits section written for one product | Every harness gets the same treatment; Known limits is about the method (proxy-side spend proof, the private repository, Hermes's discovery probes, the three declared deviations) | Left out, as the plan decided on 2026-10-22 |
| Changelog entries naming the gbrain version under test | Changelog entries naming the harness-evals `VERSION` | The pins live in `harnesses/*/pin.json` and `gbrain/pin.json`; the version that changes with a page is this repository's |

## Changelog

### 2026-11-04: plain names for internal roles

Mentions of the project's coordinating agent, its private drive and its agent threads now use those plain names instead of internal role names. No number, link or claim changes. Why: the page is published, and the public export blocks internal role names in prose.

### 2026-10-28: the held-out rule was not enforced (internal-task)

harness-evals v0.0.23. A dated note under the first table says the held-out rule ("a world that has run once is spent") was not enforced for the v0.1 and v0.2 held-out sets and what replaces it. The table itself is unchanged.

### 2026-10-26: README and docs alignment recorded (internal-task)

harness-evals v0.0.12. Added the table above, one row per README section and docs page, saying what was taken from gbrain-evals, what was adapted and what was left out, with the reason. The page's first sections, written at plan time on 2026-10-22, are unchanged.
