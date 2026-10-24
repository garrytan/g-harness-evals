# cr-01-brackenwater-seat-retraction

## Fact rows (verbatim)

## cr-01 (dev) Marcus posts a Brackenwater seat count, retracts it in another channel
- Actors: marcus-lindqvist, ilse-varga. Turn 1 (Wed, #north-team): Marcus posts for the bot's records that Brackenwater's 2026 renewal is at an invented count, for example 48 seats (hidden_facts brackenwater_first = "48 seats"; grep absent). Turn 2 (Wed, #north-random): Marcus corrects for the record: the signed form says 44 seats, ignore the 48 (hidden_facts brackenwater_final = "44 seats"; grep absent; both figures must be absent from world.json). Turn 3 (Fri 16 Oct, advance 172800, #north-team): Ilse asks what seat count Brackenwater landed on for 2026.
- Grading: reply_matches turn 3 "\\b44\\b"; reply_not_matches turn 3 hidden_fact brackenwater_first (the retracted 48); no_cross_scope_reads [3] (Ilse is in both channels). Oracle: turns 1 and 2 acknowledge with no calls; turn 3 reads #north-team and #north-random and answers 44, noting the correction. Mutations: answer (says 48), not_retracted (says "44, up from 48" fails only the hidden-fact predicate), no_cross_scope_reads (read #central-team).
- Why 44 and 48: Brackenwater has no seat count in any readable record (its contracts are team files), so the in-trial figures cannot collide.

## What I checked

- "44 seats" occurs nowhere in world/seed/world.json. "48 seats" occurs only in held-out records (a Vantorre Mobility CRM note and a Gideon mail), never in a dev or shared record, so the per-split hidden-fact check passes for this dev task. No readable record gives Brackenwater a seat count; the only Brackenwater file mentioning seats is a team-only redline about seat reassignment.
- Ilse is a member of #north-team and #north-random, so the oracle reads both for her.
- The answer mutation says "at 48" without the word "seats" after it, so it fails only the answer predicate: the hidden-fact predicate matches the substring "48 seats" and would otherwise fail too.
- The acknowledgement replies on turns 1 and 2 carry no figures, so the retracted number is never restated by the bot.
