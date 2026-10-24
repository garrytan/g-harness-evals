# ms-02-marrow-tickets (dev)

Fact rows this task was written from, verbatim:

## ms-02 (dev) Every ticket on the two Marrow accounts
- Actors: hollis-mbeki. Turn 1 (Wed, #central-team): Hollis asks for every open or recent ticket and feature request on Marrow Agrisupply and Marrow Fieldworks, from the team channels and Moss's notes, labelled by account.
- Answers: Agrisupply: "PD-4821" (#central-team 2026-06-09 "Ticket PD-4821 has the Eastbank receiving-door import attached") and "FR-882" (teams/team-central/digests/2026-01-02-central-handoffs.md "Marrow Agrisupply logged a feature request (FR-882)"). Fieldworks: "#8841" (#central-random 2026-10-13 "flagged it on ticket #8841", on "Tobias's dealer account": the dealer account is Marrow Fieldworks, which changed hands to Tobias on 5 Jan 2026 per the handoffs digest; before that it was "Pree's dealer account"), "#4409" and "#4412" (handoffs digest: "two open support tickets on Pree's dealer account before the Monday transition ... Ticket #4409 ... Ticket #4412"). Patterns with word boundaries: "PD-?4821", "FR-?882\\b", "#?8841\\b", "#?4409\\b", "#?4412\\b".
- Distractor: "#88412" (Tansleigh Packaging, #central-team 2025-07-02; pattern "88412" as reply_not_matches; note "#?8841\\b" must not match 88412, hence the boundary and the leading # optional).
- Oracle reads #central-team, #central-random, the handoffs digest (and the cheat sheet teams/team-central/digests/central-cheatsheet.md for "the Central team's ag account"); no_cross_scope_reads [1]. Mutations: one per answer, the 88412 distractor, no_cross_scope_reads (read #north-team).

## What the records say

Every row held. The handoffs digest names Marrow Fieldworks as the account changing hands on 5 Jan 2026 and lists #4409 and #4412 on "Pree's dealer account"; #central-random on 13 Oct 2026 has Tobias flagging #8841 on "Tobias's dealer account", so the dealer account chain (Pree, then Tobias) is readable without any private record. PD-4821 also appears in a Coastal digest for Pellow Home Living, but that file is held-out and never loads in a dev trial. The oracle reads both Central channels, the handoffs digest and the cheat sheet; each answer mutation drops one ticket, the distractor mutation adds #88412 under Marrow, and the cross-scope mutation reads #north-team.
