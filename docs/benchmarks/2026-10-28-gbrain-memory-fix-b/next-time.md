# Next time: 2026-10-28-gbrain-memory-fix-b

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Change only the gbrain pin between the earlier memory run and the rerun, because the live cells here also differed in proxy and runner changes, so the cr-05 movement cannot be assigned to the fix alone.
- Record the hot-memory block in the tap before rerunning, because the five Hermes cn-05 passes came with no recorded preference, so the route they took is unmeasured.
- Shut each VM down from the VM side when its shard finishes, because a two-hour stall on the controlling machine left five finished VMs idle.

### Ideas to improve the eval

- Test the fix on corrections it was not built against, in a fresh held-out set, because it was built from a replay of this task's earlier reads, so this run measures a fix aimed at this task, on this task.
- Build the primary endpoint from tasks with headroom, because four of the eight tasks sat at 4 or 5 of 5 in every Sonnet cell, so no row could reach the sign-flip bar, as the preregistration expected.
