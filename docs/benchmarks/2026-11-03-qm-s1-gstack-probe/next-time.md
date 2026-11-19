# Next time: 2026-11-03-qm-s1-gstack-probe

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it. It ran alongside the [QM memory run](../2026-11-03-qm-c4-told-live/report.md), whose report also covers this probe.

## Next time

### What we'd change if we ran this again

- Stage the skills so QM can read each one whole and run gstack's own commands in its sandbox, because those commands did not exist there, so a skill start could only be an attempt and no turn on either model reached a skill's first step.
- Settle in both the preregistration and the driver how a turn that stops to ask for command approval counts, because the driver left out one such turn that the preregistration counts, so the report had to give two counts for that cell.
- Run the shards with the shared fan-out scripts instead of scripts written for this run, because review found that this run's own controller script could destroy a VM after a failed results pull.

### Ideas to improve the eval

- Keep each driver invocation's leftover-container check in its own record, because the driver rewrote one file on every invocation and only the last invocation's check survived.
- Use more than 5 requests, because with 5 request clusters and 15 turns per arm and model no test was possible.
