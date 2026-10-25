Minimum detectable difference for the install ladder (HARN-5): 20 tasks by 5 repetitions (--reps: a design at that many repetitions at each task's measured rate), paired and task-clustered, two-sided alpha 0.05, power 0.8, arms independent given the task; the sign-flip bar is 6 task clusters all one way.
Rates from the gbrain arm's Haiku trials at docs/benchmarks/2026-10-25-gbrain-installer/results.

| Endpoint | Source | Cell | Rate | Tasks (at 0 or all of their repetitions) | Trials | Null SE | Minimum detectable difference | Receipt |
|---|---|---|---|---|---|---|---|---|
| pass | measured | openclaw-haiku-gbrain-told-mu-heldout | 57% | 20 (11) | 100 | 4.3 points | 12.1 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| pass | measured | openclaw-haiku-gbrain-installer-mu-heldout | 62% | 20 (12) | 100 | 4.0 points | 11.2 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| pass | measured | hermes-haiku-gbrain-told-mu-heldout | 64% | 20 (15) | 100 | 3.3 points | 9.3 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| pass | measured | hermes-haiku-gbrain-installer-mu-heldout | 65% | 20 (14) | 100 | 3.6 points | 10.0 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| gbrain use (at least one gbrain tools/call) | measured | openclaw-haiku-gbrain-told-mu-heldout | 90% | 20 (16) | 100 | 2.9 points | 8.1 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| gbrain use (at least one gbrain tools/call) | measured | openclaw-haiku-gbrain-installer-mu-heldout | 1% | 20 (19) | 100 | 1.3 points | 3.6 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| gbrain use (at least one gbrain tools/call) | measured | hermes-haiku-gbrain-told-mu-heldout | 92% | 20 (17) | 100 | 2.2 points | 6.3 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| gbrain use (at least one gbrain tools/call) | measured | hermes-haiku-gbrain-installer-mu-heldout | 0% | 20 (20) | 100 | n/a | n/a | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| cross-scope read via gbrain | measured | openclaw-haiku-gbrain-told-mu-heldout | 11% | 20 (15) | 100 | 3.3 points | 9.3 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| cross-scope read via gbrain | measured | openclaw-haiku-gbrain-installer-mu-heldout | 0% | 20 (20) | 100 | n/a | n/a | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| cross-scope read via gbrain | measured | hermes-haiku-gbrain-told-mu-heldout | 11% | 20 (18) | 100 | 2.1 points | 5.7 points | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
| cross-scope read via gbrain | measured | hermes-haiku-gbrain-installer-mu-heldout | 0% | 20 (20) | 100 | n/a | n/a | docs/benchmarks/2026-10-25-gbrain-installer/results/trials.jsonl |
