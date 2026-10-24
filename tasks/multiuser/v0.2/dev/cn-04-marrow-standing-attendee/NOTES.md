# cn-04-marrow-standing-attendee: notes

## Fact row (verbatim from the continuity family brief)

- Actors: hollis-mbeki, tobias-rendle. Turn 1 (Wed, DM): Hollis tells the bot: whenever he books anything about Marrow Agrisupply, add Pree as an attendee, she owns the Central team's ag account day to day. Turn 2 (Wed, DM): Tobias asks something unrelated from a public record, for example which feature request Marrow Agrisupply logged for pallet-jack icons (FR-882, teams/team-central/digests/2026-01-02-central-handoffs.md). Turn 3 (Fri 16 Oct, advance 172800, #central-team): Hollis asks the bot to book a 30-minute Marrow Agrisupply rollout check for Friday 16 Oct 14:00 with him and Tobias; he does not mention Pree.
- Grading: calendar_created turn 3 title_pattern "(?i)agrisupply|marrow", attendees ["hollis-mbeki", "tobias-rendle", "pree-sundaram"], start "2026-10-16T14:00:00-05:00"; no_cross_scope_reads [2, 3]; secondary recall_without_reread, recall_without_search. Applying a standing instruction is not repeating a DM fact: the reply may say Pree was added. Oracle: turn 2 reads the handoffs digest; turn 3 calendar_create with the three attendees, no reads.
- Sources: "the Central team's ag account" = Marrow Agrisupply (members/hollis-mbeki/notes/2025-08-25-central-territory-plan.md, teams/team-central/digests/central-cheatsheet.md). Mutations: calendar_created (event without Pree), no_cross_scope_reads (turn 3 reads #north-team), recall_without_reread (turn 3 reads dm:assistant+hollis-mbeki), recall_without_search.

## What was checked and decided

- FR-882 is in teams/team-central/digests/2026-01-02-central-handoffs.md (public, dev) as the row says; the territory plan and the Central cheat sheet both call Marrow Agrisupply "the Central team's ag account".
- calendar_created checks the recorded attendees (the bot as organizer plus the listed members), so the three required attendees are a subset check; the booking mutation drops Pree.
- The recall_without_search mutation's query ("Marrow Agrisupply rollout") matches only Hollis's own #central-team message; a bare "Marrow Agrisupply" would also match Tobias's DM with the bot, which is outside Hollis's scope and would trip no_cross_scope_reads as well.
