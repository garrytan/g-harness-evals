# Next time: 2026-11-01-installer-cc-codex

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it. It also draws on the access-rules rerun, [report-acl.md](report-acl.md).

## Next time

### What we'd change if we ran this again

- Write the fixture's scopes as gbrain access rules, bind each trial's token to the member asking, and run a per-member access check that fails closed before any trial, because with one shared token and no rules gbrain was default-open, so the first run's installer-against-told gap measured how often the agent searched, not whether the installer leaks.
- Make every smoke lease bigger than the proxy's reservation for a single call, because the first fan-out's smoke lease was smaller than one call's reservation, so the proxy refused all 9 calls and that attempt ran no trial.
- Make the per-VM gstack image scan a step that must finish before the first counted trial, because in the first run it hung and ran during the trials, and in the access-rules rerun it was missed until the VMs were gone.

### Ideas to improve the eval

- Teach the exposure grader gbrain's recall wrapper and its member memory pages, because in the access-rules rerun the stock grader left 39 returns unmapped (35 wrapped facts and 4 member pages), and the exposure number had to wait for a hand audit.
- Compare installer and told on held-out tasks scored on the substance of the answer, after a cheap check that no brain sits clearly below the top there, because with access rules on, every gbrain cell passed 18 of 18 on the primary families and exposure was 0, so these tasks can't show the installer helping or hurting.
