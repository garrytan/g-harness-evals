Recent confusion about the limiter (from #gateway-help):
- "I set burst: 0 to disable bursting and the gateway won't start" (burst must be >= 1)
- "We run 4 replicas and customers get 4x the limit" (buckets are per process)
- "ratePerSec: 0.5 means one request every 2 seconds, right?" (yes)
- "Why does retry-after say 1 when I can retry in 200ms?" (it rounds up to whole seconds)
