# waterfall-frontier-2026-11 run log (HARN-32)

- Preregistration merge commit: 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c (#303). Amendment 1 merged as b6c2390d0a07fa166ac07668ea99d6b802a01610 (#309); it names no cell, so every cell runs at 8f72e440f3.
- Diff check: `git diff --stat 205c1432b6 8f72e440f3` lists exactly #303's six files.
- Merged to main after 8f72e440f3 and before the fan-out: #300, #302, #271, #309. None reaches a cell: the controller and every VM load 8f72e440f3 from a pinned worktree (~/.capy/work/HARN-32/wt-8f72).
- Quota before launch (ubi-runner.sh usage): 6 VMs, 68 vCPUs in use by other owners; maximum not readable.
- Launch: fanout.sh from the pinned worktree, UBI_OWNER=HARN-32, UBI_TTL_HOURS=14, smoke task ar-01-thornbury-rate-hollis, run-shard.sh -- --max-output-tokens 128000. Leases sum to $150.00.
- R71 at launch: HARN-32 own use about $115 (booked line $90 spent + $200 remaining); paid trials, smokes and VMs $0 so far.
- Backup: Subagent 29 (machine machine_01M6SDZZYP701MT99FVBKZ297W) holds a copy of ~/.local/state/ubi-runner/ and every shard-vm.json from 2026-11-06T22:00:32Z; it live-pulls each shard's results (no state/ or workspace/) every 20 minutes into ~/.capy/work/HARN-32/backup/<shard>/live-pull/. VM map: handoffs/HARN-32/waterfall/map/ in the Captain drive.
2026-11-07T03:22:23Z attach cc-opus from controller after reboot, commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T03:22:24Z attach oc-opus from controller after reboot, commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T03:22:24Z attach he-opus from controller after reboot, commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T03:22:24Z attach qm-opus from controller after reboot, commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T03:22:25Z attach cx-sol from controller after reboot, commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T03:22:25Z attach oc-sol from controller after reboot, commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T03:22:25Z attach he-sol from controller after reboot, commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T03:25:01Z attaches showed 0 trial lines; ssh found no ~/shard on all 7 VMs (sync stopped at AGENTS.md, controller rebooted before launch). No trial ran. Attaches cancelled, all 7 VMs destroyed with ubi-runner down.
2026-11-07T03:25:33Z relaunch: prereg Sharding says a shard that fails before its first trial is relaunched at the same commit; all 7 failed before smoke (controller reboot during sync). New dest /home/user/.capy/work/HARN-32/waterfall-run-2, same fanout.json shards and options, commit 8f72e440f3.
2026-11-07T03:26:29Z DEVIATION (verbatim): "Captain HARN-1, 2026-11-07: relaunch after a pre-trial controller loss (0 trials, leases untouched, 7 idle VMs ≈5.45 h ≈$19 sunk, destroyed); booking $633→$655."
2026-11-07T03:27:27Z relaunch try0 refused at usage check (exit 2, no VM created, $0): launch ran under env -i, so the metering proxy keys were absent. Relaunching without env -i.
2026-11-07T03:30:44Z relaunch try1 up: 7 VMs (map rewritten on drive, try-1 map under map/retired-try1); backup machine state swapped to the new VMs and ssh verified; runner commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c.
2026-11-07T03:39:57Z oc-sol smoke failed (exit 4, counted run never started): termination=model_error because the metering proxy refused one call with 402 ("reserving $1.4882 would take this run to $3.0616, over its $3.00 budget"); OpenClaw had two calls in flight against the derived $3.00 Sol smoke lease, committed spend $0.19. Named infrastructure cause: smoke-lease reservation ceiling, not model or harness output. Prereg VM smoke rule allows a relaunch at the same commit for a named infrastructure cause, at most twice. Relaunch 1 of 2 into /home/user/.capy/work/HARN-32/waterfall-run-2/oc-sol-r2, same lease, smoke task, options and commit 8f72e440f3. VM destroyed by teardown (cleanup done).
2026-11-07T03:56:27Z cx-sol done: exit 0, 40 trial lines, VM destroyed, cleanup done. oc-sol relaunch 1 smoke passed; counted run started 03:49:44Z.
2026-11-07T04:00:36Z cc-opus done: exit 0, 40 trial lines, VM destroyed, cleanup done.
2026-11-07T10:01:44Z attach oc-opus from controller after second controller restart (uptime 0 at 10:01Z; watch.log gap 04:02Z-10:01Z), commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T10:01:44Z attach he-opus from controller after second controller restart (uptime 0 at 10:01Z; watch.log gap 04:02Z-10:01Z), commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T10:01:44Z attach qm-opus from controller after second controller restart (uptime 0 at 10:01Z; watch.log gap 04:02Z-10:01Z), commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T10:01:44Z attach he-sol from controller after second controller restart (uptime 0 at 10:01Z; watch.log gap 04:02Z-10:01Z), commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
2026-11-07T10:01:44Z attach oc-sol-r2 from controller after second controller restart (uptime 0 at 10:01Z; watch.log gap 04:02Z-10:01Z), commit 8f72e440f306d0ce1fd7e3cbac58a44276a69a2c
