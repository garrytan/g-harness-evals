# The shared eval rig

**One rig, owned by harness-evals, with a canonical copy of each part.** gstack-evals and gbrain-evals vendor these parts rather than keep their own versions, and every vendored copy names the upstream commit it was copied from in its header.

| Part | Canonical copy | What it is |
|---|---|---|
| Stats kit | [runner/stats/](../runner/stats/) | The preregistered gates (`gates.ts`), the paired, task-clustered bootstrap and exact McNemar (`paired.ts`), vendored from gbrain-evals. [comparing-runs.md](comparing-runs.md) says how a comparison uses them. |
| Price table | [runner/pricing/](../runner/pricing/) | Dated per-model prices the proxy charges against. |
| Metering proxy | [runner/proxy/metering-proxy.ts](../runner/proxy/metering-proxy.ts) | Bind, unbind and finalize per trial with a per-trial dummy token, one usage line per request, every paid call under a ledger lease ([budget-ledger.md](budget-ledger.md)). |
| Per-trial usage | `usage.json` in each trial directory | Tokens and dollars per trial, read by summarize-run and the reconciliation. |
| Trial bundle | [trial-bundle.md](trial-bundle.md) | One archive per finding, with a digest the finding prints. The envelope (`eval-trial-bundle/1`) is shared; each repository writes its own profile. |
| Fan-out | [ubicloud.md](ubicloud.md) | One VM per shard, pinned at the preregistration commit, destroyed on every exit. |

This page lists where each part lives. It does not change them: moves and upstream fixes come in their own pull requests.
