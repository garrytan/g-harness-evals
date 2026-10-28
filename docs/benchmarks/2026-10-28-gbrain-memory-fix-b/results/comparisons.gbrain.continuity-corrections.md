Scope: within-run gbrain arm; grading as recorded; seed 7, 10000 draws.

Primary endpoint, families continuity, corrections:

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | 24 / 40 | 26 / 40 | +5 [-15, +30] | 1.000 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.166, 0.134 | 83, 95 | 12,625,973, 9,691,555 |
| openclaw (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | 24 / 40 | 26 / 40 | +5 [-15, +30] | 1.000 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | as above | as above | as above |
| hermes | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | 25 / 40 | 34 / 40 | +23 [+0, +50] | 0.250 (exact-sign-flip) | 0.750 | 8 | 40 | 0 | 0.096, 0.149 | 54, 60 | 12,844,840, 13,935,478 |
| hermes (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | 25 / 40 | 34 / 40 | +23 [+0, +50] | 0.250 (exact-sign-flip) | 0.750 | 8 | 40 | 0 | as above | as above | as above |
| qm pi | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | 21 / 40 | 21 / 40 | +0 [-8, +8] | 1.000 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.072, 0.083 | 32, 38 | 6,639,163, 7,907,168 |
| qm pi (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | 21 / 40 | 21 / 40 | +0 [-8, +8] | 1.000 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | as above | as above | as above |
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | 20 / 40 | 24 / 40 | +10 [+0, +25] | 0.500 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.007, 0.007 | 85, 97 | 10,130,084, 10,448,047 |
| openclaw (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | 20 / 40 | 24 / 40 | +10 [+0, +25] | 0.500 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | as above | as above | as above |
| hermes | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-live-mu-memory-fix` | 21 / 40 | 29 / 40 | +20 [-3, +45] | 0.250 (exact-sign-flip) | 0.750 | 8 | 40 | 0 | 0.006, 0.009 | 57, 64 | 12,482,695, 16,628,909 |
| hermes (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-live-mu-memory-fix` | 21 / 40 | 29 / 40 | +20 [-3, +45] | 0.250 (exact-sign-flip) | 0.750 | 8 | 40 | 0 | as above | as above | as above |
| qm pi | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | 18 / 40 | 22 / 40 | +10 [+0, +25] | 0.500 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.004, 0.006 | 36, 42 | 6,530,483, 9,963,269 |
| qm pi (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | 18 / 40 | 22 / 40 | +10 [+0, +25] | 0.500 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | as above | as above | as above |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 4/5 | 2/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 1/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 4/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 4/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 1/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 1/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 3/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 2/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 1/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 2/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 3/5 | 5/5 |

Excluded pairs: none.

All tasks (secondary):

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | 24 / 40 | 26 / 40 | +5 [-15, +30] | 1.000 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.166, 0.134 | 83, 95 | 12,625,973, 9,691,555 |
| hermes | anthropic:claude-sonnet-5-5 | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | 25 / 40 | 34 / 40 | +23 [+0, +50] | 0.250 (exact-sign-flip) | 0.750 | 8 | 40 | 0 | 0.096, 0.149 | 54, 60 | 12,844,840, 13,935,478 |
| qm pi | anthropic:claude-sonnet-5-5 | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | 21 / 40 | 21 / 40 | +0 [-8, +8] | 1.000 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.072, 0.083 | 32, 38 | 6,639,163, 7,907,168 |
| openclaw | anthropic:claude-haiku-5-5 | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | 20 / 40 | 24 / 40 | +10 [+0, +25] | 0.500 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.007, 0.007 | 85, 97 | 10,130,084, 10,448,047 |
| hermes | anthropic:claude-haiku-5-5 | `hermes-haiku-gbrain-told-live-mu-memory-fix` | 21 / 40 | 29 / 40 | +20 [-3, +45] | 0.250 (exact-sign-flip) | 0.750 | 8 | 40 | 0 | 0.006, 0.009 | 57, 64 | 12,482,695, 16,628,909 |
| qm pi | anthropic:claude-haiku-5-5 | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | 18 / 40 | 22 / 40 | +10 [+0, +25] | 0.500 (exact-sign-flip) | 1.000 | 8 | 40 | 0 | 0.004, 0.006 | 36, 42 | 6,530,483, 9,963,269 |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 4/5 | 2/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 4/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-sonnet-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 3/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 2/5 | 1/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 4/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 4/5 | 5/5 |
| hermes | `hermes-sonnet-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 1/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sonnet-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 1/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 3/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| openclaw | `openclaw-haiku-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 2/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 1/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 4/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| hermes | `hermes-haiku-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-05-coastal-date-formats` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-06-driftmoor-contact-booking` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-07-vantorre-seat-count` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cn-08-vantorre-standing-attendee` | continuity | 0/5 | 0/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-05-pellow-seat-retraction` | corrections | 0/5 | 2/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-06-vantorre-july-seats` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-07-pellucid-owner` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-haiku-gbrain-told-live-mu-memory-fix` | `cr-08-orlavine-seat-count` | corrections | 3/5 | 5/5 |

Excluded pairs: none.
