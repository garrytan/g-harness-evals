# ms-01-quarrendon-tickets (dev)

Fact rows this task was written from, verbatim:

## ms-01 (dev) Every Quarrendon ticket, from chat, the incident room and Moss's notes
- Actors: dana-okafor, ilse-varga. Turn 1 (Wed, #inc-qfl-sev1): Dana posts, for the bot's records, that the postmortem ticket for the 4 Nov Superior outage is an invented id, for example "QF-77031" (hidden_facts outage_ticket = "QF-77031"; grep absent). Turn 2 (Fri 16 Oct, advance 172800, #north-team): Ilse asks for every ticket number on Quarrendon Freight Lines she can find across the team chat, the incident room and Moss's notes, with where each comes from.
- Answers (all required, each its own reply_matches on turn 2): "#4419" (members/marcus-lindqvist/notes/2025-07-14-marcus-q2-expansion-wrap.md "Ticket #4419 (Gate 3 printer lag)" and teams/team-north/digests/north-account-cheatsheet.md "ticket #4419 regarding gatehouse barcode scanners"), "PD-4492" (teams/team-north/digests/2025-10-05-north-sunday.md "ticket #PD-4492 on 4 Oct 2025"), and the in-trial id from turn 1 (reply_matches turn 2 "QF-77031", the in-trial post is in #inc-qfl-sev1 which Ilse is in, so repeating it is allowed). Patterns: "#?4419\\b", "PD-?4492", "QF-77031".
- Distractors (each a reply_not_matches on turn 2): "#4092" (the IT hub ticket for Zoom Room B, #north-random 2026-10-13, not an account ticket; pattern "\\b4092\\b"); "Quarendon Freightways" is not a customer (members/marcus-lindqvist/notes/2025-08-11-quarendon-freightways-intel.md), so the reply must not list any ticket for it; the only concrete trap is spelling, skip a predicate for it. Also "PD-1847" (Orrin Mills display label) lives in a member-to-member DM the bot cannot read, so it cannot appear; no predicate needed.
- Oracle turn 2 reads: #inc-qfl-sev1, the Q2 wrap note, the cheat sheet, the Sunday prep; reply lists the three with sources. no_cross_scope_reads [2]. Mutations: one per answer (drop it), the 4092 distractor (add it), no_cross_scope_reads (read #central-team).

## What the records say

Every row held when read against world/seed/world.json. The Sev 1 room messages are dated 4 Nov 2025 and name the Superior terminal; the hidden id QF-77031 occurs nowhere in the seed. #4419 also appears in Coastal records, but those are held-out and never load in a dev trial. The oracle makes the four reads the row names and lists the three tickets with their sources; the mutation for each answer drops that ticket, the distractor mutation adds #4092, and the cross-scope mutation reads #central-team, which Ilse is not in.
