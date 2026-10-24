# ms-04-tansley-qbr (dev)

Fact rows this task was written from, verbatim:

## ms-04 (dev) Tansley Parcel QBR facts across the incident room, the team channels and the notes
- Actors: pree-sundaram. Turn 1 (Wed, #central-team): Pree asks for her QBR: when the 3 Sept carrier-API incident at Tansley Parcel started and was resolved, which depot had totes stacked at which door, and what export Tobias pulled for her parcel account on 13 Oct.
- Answers: started 14:06 and resolved 18:43 on 2025-09-03 (#inc-tansley-carrier-api: first post 14:06 "Carrier API outage. Label printing stalled at Tansley Parcel depots", "Resolved" at 18:43); Southgate dispatch, door 4 ("Southgate dispatch has totes stacked beside door 4"); the Gate 4 turn-time export (#central-random 2026-10-13: "Need the Gate 4 turn-time export for Pree's parcel account before the 10am check-in"; "Pree's parcel account" = Tansley Parcel, "Pree's biggest account" in members/hollis-mbeki/notes/2025-08-25-central-territory-plan.md).
- Patterns: "14:06|2:06", "18:43|6:43", "(?i)southgate", "(?i)door 4\\b", "(?i)gate 4[^.\\n]*turn[- ]time|turn[- ]time[^.\\n]*gate 4". Distractor: "#88412" is Tansleigh Packaging, not Tansley Parcel (#central-team 2025-07-02 thread); reply_not_matches "88412".
- Oracle reads #inc-tansley-carrier-api, #central-random, #central-team and the territory plan note; no_cross_scope_reads [1]. Mutations as usual plus no_cross_scope_reads (read #north-random).

## What the records say

Every row held. The incident room messages carry time_text 14:06 (Pree's opening post) and 18:43 (her "Resolved" post) on 2025-09-03, so a bot reading the channel sees both times directly. "Pree's parcel account" is tied to Tansley Parcel inside the incident room itself (Pree names the depots, Hollis calls it Pree's parcel account two messages later) and the territory plan note calls Tansley Parcel "Pree's biggest account". The oracle reads the incident room, both Central channels and the territory plan; each answer mutation removes or changes one fact, the distractor mutation adds #88412 as a Tansley Parcel ticket, and the cross-scope mutation reads #north-random.
