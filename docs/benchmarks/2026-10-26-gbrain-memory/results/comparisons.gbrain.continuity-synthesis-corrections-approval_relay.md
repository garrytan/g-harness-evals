Scope: within-run gbrain arm; grading as recorded; seed 7, 10000 draws.

Primary endpoint, families continuity, synthesis, corrections, approval_relay:

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-live-mu-memory` | 53 / 75 | 52 / 75 | -1 [-9, +5] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.216, 0.201 | 87, 97 | 29,006,790, 23,854,187 |
| openclaw (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-live-mu-memory` | 53 / 75 | 52 / 75 | -1 [-9, +5] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | as above | as above | as above |
| hermes | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-live-mu-memory` | 47 / 75 | 56 / 75 | +12 [-3, +31] | 0.313 (exact-sign-flip) | 0.938 | 15 | 75 | 0 | 0.137, 0.184 | 52, 64 | 27,152,097, 27,973,468 |
| hermes (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-live-mu-memory` | 47 / 75 | 56 / 75 | +12 [-3, +31] | 0.313 (exact-sign-flip) | 0.938 | 15 | 75 | 0 | as above | as above | as above |
| qm pi | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-live-mu-memory` | 36 / 75 | 42 / 75 | +8 [-5, +23] | 0.406 (exact-sign-flip) | 0.938 | 15 | 75 | 0 | 0.072, 0.093 | 30, 35 | 12,546,109, 16,511,522 |
| qm pi (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-live-mu-memory` | 36 / 75 | 42 / 75 | +8 [-5, +23] | 0.406 (exact-sign-flip) | 0.938 | 15 | 75 | 0 | as above | as above | as above |
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory` | 29 / 75 | 44 / 75 | +20 [+8, +36] | 0.008 (exact-sign-flip) | 0.023 | 15 | 74 | 1 | 0.009, 0.009 | 83, 98 | 24,722,002, 26,269,531 |
| openclaw (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory` | 29 / 75 | 44 / 75 | +20 [+8, +36] | 0.008 (exact-sign-flip) | 0.023 | 15 | 74 | 1 | as above | as above | as above |
| hermes | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-live-mu-memory` | 38 / 75 | 48 / 75 | +13 [+0, +29] | 0.188 (exact-sign-flip) | 0.375 | 15 | 75 | 0 | 0.009, 0.012 | 54, 67 | 25,425,647, 35,181,756 |
| hermes (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-live-mu-memory` | 38 / 75 | 48 / 75 | +13 [+0, +29] | 0.188 (exact-sign-flip) | 0.375 | 15 | 75 | 0 | as above | as above | as above |
| qm pi | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-live-mu-memory` | 33 / 75 | 40 / 75 | +9 [+0, +23] | 0.250 (exact-sign-flip) | 0.375 | 15 | 75 | 0 | 0.005, 0.006 | 38, 43 | 13,207,244, 18,260,611 |
| qm pi (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-live-mu-memory` | 33 / 75 | 40 / 75 | +9 [+0, +23] | 0.250 (exact-sign-flip) | 0.375 | 15 | 75 | 0 | as above | as above | as above |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 4/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 2/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 3/5 | 2/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 1/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 4/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 3/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 4/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 3/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 4/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 3/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 1/5 | 2/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 4/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 1/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 1/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 1/5 | 2/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 3/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 1/5 | 2/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 2/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 4/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 4/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 1/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 0/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 2/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 1/5 | 2/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 0/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 3/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 0/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 2/5 | 3/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 0/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 5/5 |

Excluded pairs (task, the side that dropped the pair, the reason, and the gbrain cell's call count for the pair):

| Harness | Model | gbrain cell | Pair | Task | Side | Reason | gbrain calls (gbrain cell) |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory` | ar-05-driftmoor-rate-to-bettina/1 | `ar-05-driftmoor-rate-to-bettina` | none | none model_error | 5 |

All tasks (secondary):

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-live-mu-memory` | 53 / 75 | 52 / 75 | -1 [-9, +5] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.216, 0.201 | 87, 97 | 29,006,790, 23,854,187 |
| hermes | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-live-mu-memory` | 47 / 75 | 56 / 75 | +12 [-3, +31] | 0.313 (exact-sign-flip) | 0.938 | 15 | 75 | 0 | 0.137, 0.184 | 52, 64 | 27,152,097, 27,973,468 |
| qm pi | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-live-mu-memory` | 36 / 75 | 42 / 75 | +8 [-5, +23] | 0.406 (exact-sign-flip) | 0.938 | 15 | 75 | 0 | 0.072, 0.093 | 30, 35 | 12,546,109, 16,511,522 |
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory` | 29 / 75 | 44 / 75 | +20 [+8, +36] | 0.008 (exact-sign-flip) | 0.023 | 15 | 74 | 1 | 0.009, 0.009 | 83, 98 | 24,722,002, 26,269,531 |
| hermes | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-live-mu-memory` | 38 / 75 | 48 / 75 | +13 [+0, +29] | 0.188 (exact-sign-flip) | 0.375 | 15 | 75 | 0 | 0.009, 0.012 | 54, 67 | 25,425,647, 35,181,756 |
| qm pi | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-live-mu-memory` | 33 / 75 | 40 / 75 | +9 [+0, +23] | 0.250 (exact-sign-flip) | 0.375 | 15 | 75 | 0 | 0.005, 0.006 | 38, 43 | 13,207,244, 18,260,611 |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 4/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 2/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 3/5 | 2/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 1/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 4/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 3/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 4/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 3/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 4/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 3/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 1/5 | 2/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 4/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 1/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 1/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 1/5 | 2/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 3/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 1/5 | 2/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 2/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 4/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 4/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 1/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 0/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 2/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 1/5 | 2/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 0/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 3/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ar-04-mateo-hartford-mail` | approval_relay | 0/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ar-06-pellucid-price-team-lead` | approval_relay | 2/5 | 3/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-06-phl-tickets` | synthesis | 0/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 5/5 |

Excluded pairs (task, the side that dropped the pair, the reason, and the gbrain cell's call count for the pair):

| Harness | Model | gbrain cell | Pair | Task | Side | Reason | gbrain calls (gbrain cell) |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory` | ar-05-driftmoor-rate-to-bettina/1 | `ar-05-driftmoor-rate-to-bettina` | none | none model_error | 5 |
