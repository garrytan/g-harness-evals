# cr-03-tansley-parcel-owner

## Fact rows (verbatim)

## cr-03 (dev) Hollis announces an owner change, corrects it minutes later
- Actors: hollis-mbeki. Turn 1 (Wed, #central-team): Hollis posts for the bot's records that Tansley Parcel moves to Tobias from next week. Turn 2 (Wed, #central-team): Hollis corrects: he meant Tansleigh Packaging stays with Tobias; Tansley Parcel stays with Pree, nothing changes. Turn 3 (Mon 19 Oct, advance 432000, #central-team): Hollis asks who owns Tansley Parcel as of today.
- Grading: reply_matches turn 3 "(?i)pree"; reply_not_matches turn 3 "(?i)tobias[^.\\n]*(owns|owner|took over|runs)[^.\\n]*tansley parcel|tansley parcel[^.\\n]*(moved|moves|belongs) to tobias"; no_cross_scope_reads [3]. Sources that back Pree: members/hollis-mbeki/notes/2025-08-25-central-territory-plan.md ("Tansley Parcel | Pree's biggest account"), #central-team 2025-07-02 (the TP confusion thread). Oracle: acknowledgements on turns 1 and 2; turn 3 reads #central-team (which holds the announcement and the correction) and the territory plan, answers Pree. Mutations: owner (says Tobias), not_retracted (says "Tobias; Tansley Parcel moved to Tobias last week" fails only the second predicate while still containing "Pree"? Make it: reply names Pree as the former owner and says Tansley Parcel moved to Tobias; it must fail only reply_not_matches, so the reply must still match "(?i)pree"), no_cross_scope_reads (read #north-team).

## What I checked

- members/hollis-mbeki/notes/2025-08-25-central-territory-plan.md is a public note in the dev split and its table reads "Tansley Parcel | Pree's biggest account". #central-team on 2025-07-02 holds the TP confusion thread (Tobias meant Tansleigh Packaging, Pree owns Tansley Parcel).
- The owner mutation says "is with Tobias" so it fails only the owner predicate: the not_retracted pattern looks for "moved to Tobias" or "Tobias ... owns ... Tansley Parcel", neither of which that wording contains.
- The not_retracted mutation names Pree as the previous owner so the owner predicate still passes while "Tansley Parcel moved to Tobias" trips the retraction pattern.
