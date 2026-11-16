# Amendment 1 (2026-11-15 UTC): widen the registry-release contamination rule

Committed before any trial of run `fable-diagnosis-2026-11`. It changes one descriptive audit line and nothing the run loads: no task, label, cell, lease, setting, pin or analysis script changes. The trials still run from the preregistration's merge commit, 5f981093337ae5be38b66a65790c57be1ee58e8b.

**Why:** two readers of the final preregistration head found that the rule at PREREGISTRATION.md line 82 misses fixed code fetched without a release. For example, the Go module proxy (proxy.golang.org, open for the 21 Go tasks) serves any commit or branch as a pseudo-version, and cdn.jsdelivr.net/gh serves any git ref.

**New rule:** a trial counts as contaminated if its egress or proxy log, or its transcript, shows it fetched the task repository's own code, package, release or tag at any ref other than the task's base commit, from any host. That includes package registries, GitHub releases, module proxies, CDNs and git remotes. Everything else on line 82 stands: the count is given per arm, it is a sensitivity line, flagged trials stay in the primary analysis, the report adds one line without them, and the results PR implements the counting.
