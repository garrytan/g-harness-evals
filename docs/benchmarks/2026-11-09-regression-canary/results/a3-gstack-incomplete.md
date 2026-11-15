# Re-baseline attempt a3 (baseline-2026-11-13-a3): why the gstack half is INCOMPLETE

Run baseline-2026-11-13-a3 ran gstack, then gbrain, from rig cb982929 under amendments 2 and 3. Its receipts are on the canary-receipts branch at runs/baseline-2026-11-13-a3.

- gbrain finished clean (450 trials, verdict OK) and stands as the gbrain re-baseline.
- gstack stopped at its $300 lease: the proxy first refused a call at 14:02 UTC, refused 249 in all, and the run stopped at 18:53 UTC on 2026-11-13. 167 gstack trials, in all six lanes and the first of them started at 13:53 UTC, ended as lease stops, and 175 of its 612 trials are infra failures. None of its gstack trials is counted, and amendment 4 reruns gstack in full as baseline-2026-11-14-a4.

## What held the lease

At rig cb982929 the metering proxy settled a provider 5xx at $0 only when its body was a known not-billed error envelope (for Anthropic, a 500 or 529 with an `api_error` or `overloaded_error` body). Any other failed call kept its full worst-case reservation, booked as spend. The proxy on main now also settles an Anthropic 503 with an empty body or a credential-validation message at $0. In a3 that held $156.46 of the $298.58 the ledger booked for gstack, so metered spend was $142.12.

| Model | Status the proxy logged | Proxy reason | Calls | Trials | Held | First | Last (UTC) |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | 503 | the response carried no usage | 47 | 15 | $143.61 | 09:47:16 | 13:32:00 |
| GPT-6.1 Sol | 200 (stream) | stream error invalid_request before final usage | 7 | 7 | $11.13 | 08:39:42 | 17:11:32 |
| GPT-6.1 Sol | 200 (stream) | stream error service_unavailable_error before final usage | 1 | 1 | $1.72 | 15:30:02 | 15:30:02 |
| **Total** | | | **55** | **23** | **$156.46** | | |

Every one of the 47 Opus 503s kept its reservation ($2.79 to $5.68, about $3.06 on average), and no other gstack call in a3 got a 503.

## What the 503s said

The proxy log doesn't keep response bodies, so the body text comes from each affected trial's Claude Code log (`harbor/agent/claude-code.txt`):

- In 8 of the 15 trials, Claude Code printed `API Error: 503 credential validation failed`.
- In 3 trials, it printed `API Error: 503 status code (no body)`.
- In 4 trials, it printed no 503 line: those calls were retried and the trial went on (3 finished, 1 timed out).

Claude Code's session logs (`sessions/projects/*.jsonl`) record `503 credential validation failed` in 14 of the 15 trials and `503 status code (no body)` in 10.

So "credential validation failed" is the printed message in 8 trials and the logged message in 14, not a reading of all 47 calls. Amendment 4, written before this count, says the 47 calls were answered "with HTTP 503 (\"credential validation failed\")" between about 09:47 and 11:00 UTC. The count and the held amount there are right, but the message is printed in only 8 trials, 4 of the 15 trials did not end as harness or infra errors, the reservations averaged about $3.06, not $3.16, the lease stops were not the last 167 trials, and the last 503 came at 13:32 UTC. Amendment 4 is left as frozen, and this file is the correction.

## How these numbers were computed

From the shard's proxy log `gstack/T2/shard/proxy-usage.ndjson` (7,065 lines), one line per forwarded call:

```bash
jq -s -c 'map(select(.charged_reservation==true))
  | group_by([.model, (.status|tostring), .reason])
  | map({model: .[0].model, status: .[0].status, reason: .[0].reason, calls: length,
         trials: (map(.key)|unique|length), held_usd: (map(.actual_usd)|add),
         first: (map(.at)|min), last: (map(.at)|max)})' proxy-usage.ndjson
jq -s '[.[] | select(.status==503)] | length' proxy-usage.ndjson                                  # 47
jq -s '[.[] | select(.status==503 and .charged_reservation==true)] | length' proxy-usage.ndjson   # 47
jq -s '[.[] | .actual_usd // 0] | add' proxy-usage.ndjson                                        # 298.58
```

The message counts come from `grep -ao 'API Error: 503[^.]*'` on each of the 15 trials' `claude-code.txt`. Each trial is matched by the `key` in the proxy log, which is the suffix of the trial's `usage.meter_id` in trials.jsonl.
