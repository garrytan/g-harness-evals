Scope: within-run gbrain arm; grading as recorded; seed 7, 10000 draws.

Primary endpoint, families continuity, synthesis, corrections, approval_relay:

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | 42 / 75 | 42 / 75 | +0 [-7, +8] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.204, 0.200 | 83, 97 | 28,816,574, 27,202,010 |
| hermes | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-mu-v02-heldout` | 50 / 75 | 46 / 75 | -5 [-16, +4] | 0.469 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.136, 0.146 | 54, 71 | 27,590,194, 30,117,696 |
| qm pi | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | 38 / 75 | 40 / 75 | +3 [-19, +25] | 0.906 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.074, 0.092 | 29, 26 | 12,846,243, 17,966,993 |
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-mu-v02-heldout` | 34 / 75 | 25 / 75 | -12 [-32, +8] | 0.328 (exact-sign-flip) | 0.984 | 15 | 75 | 0 | 0.011, 0.008 | 84, 89 | 26,399,602, 21,996,404 |
| hermes | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-mu-v02-heldout` | 35 / 75 | 40 / 75 | +7 [-4, +17] | 0.391 (exact-sign-flip) | 0.984 | 15 | 75 | 0 | 0.008, 0.010 | 55, 67 | 24,875,541, 32,725,416 |
| qm pi | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | 33 / 75 | 36 / 75 | +4 [-9, +19] | 0.750 (exact-sign-flip) | 0.984 | 15 | 75 | 0 | 0.005, 0.006 | 32, 38 | 13,083,539, 19,937,595 |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 3/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 1/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 1/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 4/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 3/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 4/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 1/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 2/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 3/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 1/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 3/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 3/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 0/5 | 4/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 3/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 0/5 | 4/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 2/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 2/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 1/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 3/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 4/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 0/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 2/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 3/5 | 3/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 2/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 2/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 4/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 1/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 4/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 0/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 3/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 1/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 0/5 | 4/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 3/5 | 5/5 |

All tasks (secondary):

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | 42 / 75 | 42 / 75 | +0 [-7, +8] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.204, 0.200 | 83, 97 | 28,816,574, 27,202,010 |
| hermes | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-mu-v02-heldout` | 50 / 75 | 46 / 75 | -5 [-16, +4] | 0.469 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.136, 0.146 | 54, 71 | 27,590,194, 30,117,696 |
| qm pi | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | 38 / 75 | 40 / 75 | +3 [-19, +25] | 0.906 (exact-sign-flip) | 1.000 | 15 | 75 | 0 | 0.074, 0.092 | 29, 26 | 12,846,243, 17,966,993 |
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-mu-v02-heldout` | 34 / 75 | 25 / 75 | -12 [-32, +8] | 0.328 (exact-sign-flip) | 0.984 | 15 | 75 | 0 | 0.011, 0.008 | 84, 89 | 26,399,602, 21,996,404 |
| hermes | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-mu-v02-heldout` | 35 / 75 | 40 / 75 | +7 [-4, +17] | 0.391 (exact-sign-flip) | 0.984 | 15 | 75 | 0 | 0.008, 0.010 | 55, 67 | 24,875,541, 32,725,416 |
| qm pi | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | 33 / 75 | 36 / 75 | +4 [-9, +19] | 0.750 (exact-sign-flip) | 0.984 | 15 | 75 | 0 | 0.005, 0.006 | 32, 38 | 13,083,539, 19,937,595 |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 3/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 1/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 1/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 4/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 3/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 5/5 | 4/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 2/5 | 1/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 2/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 3/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 1/5 | 0/5 |
| hermes | `hermes-sonnet-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 5/5 | 3/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 3/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 0/5 | 4/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 3/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 0/5 | 4/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 2/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 2/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 5/5 | 1/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 3/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 4/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 0/5 | 4/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 2/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 3/5 | 3/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 2/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 2/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 1/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 4/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 1/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 4/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ar-04-mateo-hartford-mail` | approval_relay | 0/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ar-05-driftmoor-rate-to-bettina` | approval_relay | 1/5 | 1/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ar-06-pellucid-price-team-lead` | approval_relay | 3/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-06-driftmoor-contact-booking` | continuity | 1/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-05-vantorre-tickets` | synthesis | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-06-phl-tickets` | synthesis | 0/5 | 4/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-07-strategic-owners` | synthesis | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-mu-v02-heldout` | `ms-08-saltmarsh-summary` | synthesis | 3/5 | 5/5 |
