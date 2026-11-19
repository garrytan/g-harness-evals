# Owner identity: the store, the drain and the grader

This page explains how a trial of the owner-identity category is scored: can a harness, with or without gbrain, tell which speaker is the brain's owner? The plan is the HARN-116 plan (GST-3217). The task bank and its `gold.json` and `people.json` come from the generator under `world/owner-identity/`.

## What is scored

Each task plants 6 to 10 facts, each carrying one invented word (a token). After the trial the store is dumped and the grader finds every occurrence of every token, as a whole word, ignoring case, a plural and a possessive.

- **Owner surface:** a gbrain fact row whose `entity_slug` is the owner's people page (`people.json` `page_slug`) or the owner's member page (`memory/members/<owner member>`, gbrain's `access.owner_member`), or a compiled-truth or timeline line of either page. In the no-gbrain arm, a line of the owner's notes file.
- **Person surface:** the same for anyone else in `people.json`.
- **Unattributed surface:** a fact row with no entity or held on `memory/unattributed`, gbrain's place for facts with no known subject, or a line of that page.
- **Other:** everything else. Raw conversation, meeting and session pages hold their import word for word, so they are always other.

Two primary numbers, never combined:

- **False-owner:** facts whose claimant is not the owner that sit on an owner surface on a line that does not name the claimant, over all such planted facts.
- **Owner recall:** facts the owner stated first-hand that sit on an owner surface, over all of them.

The grader also records, per fact, whether it was correctly reported (on the owner's page with its claimant named), on the claimant's page, on a wrong person's page, visible as unattributed, anywhere at all, which `attributed_to` values its rows carry, and `filed_as_user` (a row with `attributed_to` "user" that does not name the claimant; recorded apart, it is not an owner hit). An answer check on the last reply is reported apart from the store scores.

```
bun runner/grade/owner-identity.ts --store <store.json> --gold <gold.json> --people <people.json> [--reply-file <reply>] [--arm <arm>] --out <verdicts.json>
```

## The store dump

`runner/grade/owner-identity-store.ts` writes `<trial dir>/owner-identity/store.json`. A gbrain brain is dumped by `gbrain/owner-identity-dump.ts`, which gbrain's own engine runs against the stopped brain: read-only SQL over `pages`, `timeline_entries`, `facts`, `ingest_log` and `minion_jobs`. SQL, because gbrain has no CLI or MCP read that lists fact rows with `attributed_to`. A notes directory (one `<person id>.md` per person) is dumped as it is.

## The drain before grading

A cell that turns gbrain's own model on (`gbrain.llm: "proxy"`) gets a drain after the world is fenced and before the store is read (`runner/trial/gbrain-drain.ts`):

1. Wait, up to 120 s, until gbrain's facts work is quiet: no change for 15 s in the facts rows of `get_ingest_log`, the `facts-absorb` jobs of `list_jobs` and `get_stats`. gbrain's in-process facts queue keeps its counters in memory with no outside read, so quiet is the best signal it offers.
2. Stop `gbrain serve` with a 30 s grace, keeping the container, and copy its `/brain` out.
3. When a `facts-absorb` job of this trial is still queued, run gbrain's own `gbrain dream --phase facts_drain` once on the copy.
4. Dump the store and count drops: `facts:absorb` ingest-log rows written during the trial, by reason, and failed or dead jobs.

Any dropped or still-queued job, a queue that never went quiet, or a failed drain makes the trial `infra_error` with infra class `gbrain_extraction_dropped` ([HE-GBRAIN-018](errors.md)). The counts are in the record's `gbrain.drain`.

## The pilot audit

```
bun scripts/owner-identity/audit-sample.ts --verdicts <verdicts.json>... --n 40 --seed <s> --out audit.md
bun scripts/owner-identity/audit-sample.ts --score audit.md
```

The first draws 40 verdicts per arm, each with the line that decided it, as a table a reviewer fills in with agree or disagree. The second reports agreement per arm.
