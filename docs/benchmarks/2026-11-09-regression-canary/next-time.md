# Next time: 2026-11-09-regression-canary

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Run every arm in the same hours from the first baseline, because the first gstack baseline ran arms one after another and raised 2 false alarms in 12, which went away when all six cells ran side by side.
- Check free disk on the controlling machine before copying results back from a VM, because a full disk lost 282 raw trial folders after the VM was destroyed.
- Settle at no cost the provider errors that ran no model before a run starts, because during a provider outage failed calls kept their worst-case reservations, drained the lease and stopped one gstack re-baseline before its same-release pairs could be scored.

### Ideas to improve the eval

- Add a skill-load check on prompts that fit a gstack skill, because Opus 5.5 loaded a gstack skill in 0 of 407 trials on these tasks, so for Opus the canary measures the cost of listing gstack, not of using it.
- Lengthen gbrain's task lists, because on 12 and 14 tasks a 30-point pass-rate drop is confirmed only 42% of the time on Opus and 55% on Sol.
