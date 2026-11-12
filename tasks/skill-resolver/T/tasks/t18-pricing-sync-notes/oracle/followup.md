# Pricing sync follow-up (Tue 2026-11-04)

Participants: Maya (PM), Dev (eng lead), Rosa (finance), Kenji (sales).
Source: notes/pricing-sync-2026-11-04.md. Gaps: the notes start at 10:05 (first five minutes missing) and miss about four minutes from 10:40. Anything said then is not captured here.

## Decisions
- New annual contracts get a 15% discount from Jan 1; renewals stay at 20%. Decided by Maya. Source: [10:14]

## Proposals not decided
- Drop the monthly Starter plan. Discussed, no decision; revisit in December. Source: [10:27]
- 15% new / 20% renewal split was Kenji's proposal [10:09] and became the decision above.

## Action items
| # | Outcome | Owner | Due date | Dependency | Acceptance | Source |
|---|---|---|---|---|---|---|
| 1 | Billing service reads the annual discount from a config flag instead of the hardcoded 20% | Dev | before the Dec 15 code freeze | none | new annual contracts in staging bill at 15%, renewals at 20% | [10:17] |
| 2 | Pricing page copy shows 15% for new annual contracts | unresolved | unresolved | decision at [10:14] | pricing page live with the new copy before Jan 1 | [10:21] |
| 3 | Sales team knows the new discount rules | Kenji | end of next week (stated; exact date to confirm) | none | sales team briefed, confirmed by Kenji | [10:24] |
| 4 | Count of renewals landing in Q1 | Rosa | unresolved | none | number shared with the group | [10:33] |

No owner or due date above was guessed; "unresolved" means nobody said it.

## Questions and blockers
- Who owns the pricing page copy? Nobody took it at [10:21].
- Does the config flag (item 1) need a decision on the shared Stripe price IDs first? Not discussed.

## Risks and dependencies
- The Stripe price IDs for annual plans are shared with the legacy plan; changing them could touch about 40 legacy customers. Raised by Dev. Source: [10:36]

## Next checkpoint
- Next pricing sync: Dec 2. Source: [10:44]

## Drafts awaiting your approval (nothing sent or created yet)
- Slack post: the Decisions and Action items sections above, with the gap note.
- Tracker: search first for existing tickets on the billing discount and the pricing page. Proposed creates: items 1, 2 and 4; item 3 is a sales task and may not belong in the tracker.
