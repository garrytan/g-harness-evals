# ludo-technologies__pyscn-548
Passes: X 1 of 2, Y 2 of 2
Fault named in the instruction: partly (it names the clone-grouping/dedup stage and links #416, but not group_dedup.go, where all four tries made the fix)
- X-a1 FAIL: right place but incomplete or wrong fix. It added the cross-group dedup pass in internal/analyzer/group_dedup.go like the others, but treated windows as the same fragment when they shared only half of their combined lines, and it said itself that this also collapses moderately nested clones that should stay separate findings.
Passing tries did differently: all three used a much tighter rule (one window contains the other and covers at least 80% of its lines or nodes), keep the wider windows, and checked that smaller nested blocks still get their own group.
Rating: NONE, favours neither. X-a2 passed with nearly the same design as Y, so the split comes down to one try's choice of overlap threshold rather than an agent-level difference.
