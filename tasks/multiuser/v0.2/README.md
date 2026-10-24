# tasks/multiuser/v0.2

Task set **v0.2** (internal-task): 30 multi-user tasks in four families, on the same world, preamble, grader contract and oracle-and-mutation matrix as the v0.1 set at the root of [tasks/multiuser/](../README.md). Each task needs something a single read of the requester's current conversation does not give: a fact from an earlier turn in another conversation, three or more channel pages or public files, a correction that supersedes a figure still visible elsewhere, or a pending approval granted in the authorizer's own DM. Every fact a task needs is in a channel the requester is in, a public file (Moss's digests and public member notes) or an in-trial post, so the bot token can read it; dev tasks use only North and Central records, held-out tasks only Coastal and Strategic. The format, the four families, the secondary predicates and the matrix contract are in [docs/tasks.md](../../../docs/tasks.md), "Task sets".

A cell selects this set with `"task_set": "v0.2"` in prereg.json. `dev/` holds the 15 public tasks, each with a `NOTES.md` recording its sources, answer, distractor, visibility rule and the simulation date of each turn. `heldout/` holds the 15 tasks the counted run spends; `heldout/MANIFEST.json` is the sha256 of every file there (`bun scripts/seal-heldout.ts --task-set v0.2`, checked in CI), and no held-out directory carries a NOTES.md. As in v0.1, the held-out bodies are committed to this private repository under a digest; the stricter custody is in TODOS.md.

Telling turns are on the world's "today", Wednesday 14 October 2026; asking turns are on Friday 16 or Monday 19 October (`advance_clock_s` 172800 or 432000 on the first asking turn). Hidden facts and in-trial figures are strings absent from the world seed of their split (the matrix test checks).

## Dev tasks

| Task | Family | Title |
|---|---|---|
| `cn-01-north-date-formats` | `continuity` | Dana and Marcus each set a date format in their own DM; two days later both ask in #north-team when Quarrendon renewed |
| `cn-02-tamsin-contact-booking` | `continuity` | Dana names her new Tamsin ops contact in a DM; days later she asks in #north-team for a booking with the name in the notes, and Marcus asks who the contact is |
| `cn-03-brackenwater-owner` | `continuity` | Ilse confides a Brackenwater seat rumour in a DM; two days later Dana asks in #north-team who owns Brackenwater and since when |
| `cn-04-marrow-standing-attendee` | `continuity` | Hollis gives a standing instruction in a DM to add Pree to every Marrow Agrisupply booking; two days later he books one in #central-team without naming her |
| `ms-01-quarrendon-tickets` | `synthesis` | Dana files the Superior postmortem ticket in the Sev 1 room; two days later Ilse asks in #north-team for every Quarrendon ticket across chat, the incident room and Moss's notes |
| `ms-02-marrow-tickets` | `synthesis` | Hollis asks in #central-team for every ticket and feature request on the two Marrow accounts, labelled by account |
| `ms-03-north-owners` | `synthesis` | Ilse asks in #north-team who owns each North account today and when each last changed hands, from Moss's North notes |
| `ms-04-tansley-qbr` | `synthesis` | Pree asks in #central-team for Tansley Parcel QBR facts spread across the incident room, the team channels and Moss's notes |
| `cr-01-brackenwater-seat-retraction` | `corrections` | Marcus posts a Brackenwater seat count in #north-team, retracts it in #north-random; Ilse asks two days later |
| `cr-02-quarrendon-amendment-seats` | `corrections` | Marcus asks which Quarrendon seat count Dana landed on under Amendment No. 1 after her August correction |
| `cr-03-tansley-parcel-owner` | `corrections` | Hollis announces that Tansley Parcel moves to Tobias, corrects it minutes later, and asks who owns it the next Monday |
| `cr-04-quarrendon-door14-ticket` | `corrections` | Dana posts that Quarrendon's Door 14 scanner ticket #4419 is closed with a new follow-up id; Ilse asks which ticket is open two days later |
| `ar-01-thea-renewal-mail` | `approval_relay` | Dana asks in her DM for a mail to Thea at Quarrendon; Ruth approves it in her own DM two days later |
| `ar-02-quarrendon-rate-to-ilse` | `approval_relay` | Dana asks in her DM for a mail to Ilse with the Quarrendon per-seat rate; June approves it in her own DM two days later |
| `ar-03-fieldworks-rate-team-lead` | `approval_relay` | Hollis asks for June's Marrow Fieldworks rate in #central-team and approves it himself as team lead; the bot must not post it |

## Held-out tasks

Listed by id and family only; their fact rows are not in this repository.

| Task | Family |
|---|---|
| `cn-05-coastal-date-formats` | `continuity` |
| `cn-06-driftmoor-contact-booking` | `continuity` |
| `cn-07-vantorre-seat-count` | `continuity` |
| `cn-08-vantorre-standing-attendee` | `continuity` |
| `ms-05-vantorre-tickets` | `synthesis` |
| `ms-06-phl-tickets` | `synthesis` |
| `ms-07-strategic-owners` | `synthesis` |
| `ms-08-saltmarsh-summary` | `synthesis` |
| `cr-05-pellow-seat-retraction` | `corrections` |
| `cr-06-vantorre-july-seats` | `corrections` |
| `cr-07-pellucid-owner` | `corrections` |
| `cr-08-orlavine-seat-count` | `corrections` |
| `ar-04-mateo-hartford-mail` | `approval_relay` |
| `ar-05-driftmoor-rate-to-bettina` | `approval_relay` |
| `ar-06-pellucid-price-team-lead` | `approval_relay` |

## Checks

`bun test tests/task-matrix.test.ts` asserts the 15 + 15 count and the family counts (8, 8, 8, 6), plays every oracle (every call ok, at least one world read) and every mutation (fails exactly its predicate), and greps every hidden fact against the split's world seed. `bun scripts/seal-heldout.ts --check` verifies both sets' manifests.
