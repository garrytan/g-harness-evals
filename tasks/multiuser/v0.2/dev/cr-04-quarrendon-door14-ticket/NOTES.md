# cr-04-quarrendon-door14-ticket

## Fact rows (verbatim)

## cr-04 (dev) An in-trial post supersedes a public note's ticket
- Actors: dana-okafor, ilse-varga. Turn 1 (Wed, #north-team): Dana posts for the bot's records that ticket #4419 (the Door 14 scanner issue at Quarrendon) is closed and the follow-up is now an invented id, for example "QF-77045" (hidden_facts scanner_ticket = "QF-77045"; grep absent). Turn 2 (Fri 16 Oct, advance 172800, #north-team): Ilse asks which ticket is currently open for the Quarrendon Door 14 scanner issue.
- Answer: the in-trial id; the cheat sheet (teams/team-north/digests/north-account-cheatsheet.md) still lists #4419 as the Door 14 ticket. Grading: reply_matches turn 2 "QF-77045"; reply_not_matches turn 2 "(?i)#?4419[^.\\n]*(is|remains|still) open|open[^.\\n]*#?4419" (a good answer may say #4419 is closed); no_cross_scope_reads [2]. Oracle: turn 1 acknowledges; turn 2 reads #north-team and the cheat sheet, answers the new id and notes #4419 closed. Mutations: answer (says #4419 is the open ticket; this fails both predicates unless worded to pass reply_not_matches: make the "answer" mutation omit the new id without claiming 4419 open, for example "I could not find an open ticket"), stale (says "#4419 is still open" and also gives QF-77045, so only the not-matches fails), no_cross_scope_reads (read #central-team).

## What I checked

- teams/team-north/digests/north-account-cheatsheet.md (public, dev) says "Thea logged ticket #4419 regarding gatehouse barcode scanners failing to read trailer tags at Door 14 during the third shift" and, under What Changed, "Ticket #4419 escalated to tier-2 product support for scanner firmware testing". "QF-77045" occurs nowhere in the seed.
- #4419 is reused in the corpus for other things (a Gate 3 printer lag in Marcus's public note, Coastal and Driftmoor tickets in held-out records); the question names Quarrendon and Door 14, which the cheat sheet ties to #4419.
- The stale pattern's second branch, "open[^.\\n]*#?4419", matches "open ... 4419" inside one sentence, so the oracle and the answer mutation end the sentence that holds "open" before mentioning #4419.
