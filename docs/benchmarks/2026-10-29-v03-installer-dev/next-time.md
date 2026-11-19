# Next time: 2026-10-29-v03-installer-dev

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Check before the run that the approver the bot may ask can see the figure an approval relay task needs, because in ar-01 and ar-02 the grant came from an approver who held no record of the figure, so both readers found the tasks unreachable.
- Choose and state the gbrain access setup (per-member source grants or the default bot-wide token) in the preregistration, because the default cell served the whole bot-visible brain under one unscoped token, and gbrain search returned 95 to 166 out-of-scope channel rows per cell, most of the cross-scope failures.
- Shrink the opening design (fewer repetitions or cells) before preregistering it, because the measured installer cost barely moved the pilot's estimate and the design still missed its cap at the largest per-call reservation.

### Ideas to improve the eval

- Let the pre-grant check pass a draft to a recipient who may already see the figure, because it failed a trial that drafted the figure to the account owner, who may receive it.
- Decide in the gate rule whether a family at the floor with no task defect gets its template revised, because corrections failed the range at 1 of 40 and the rule left that choice open.
