# Cost smokes for the particle-1, DeepSeek and DeepSeek Harness routes (uncounted)

These trials ran before the freeze, under `--uncounted`, to check each new route end to end and to price the leases. None of them is a result, and none enters a call.

- **Where:** one Ubicloud standard-16 VM per smoke, through `scripts/ubicloud/fanout.sh --workload frontier-harbor`, on the scratch branch `harn57/smokes` (this directory's code plus a smoke plan).
- **Tasks:** the first tasks of the run's shared order (filter-js-from-html, pytorch-model-recovery, gcode-to-text), one attempt each.
- **Each smoke ran the keyless install check first.** Smokes 1 to 3 stopped there:
  - smokes 1 and 2: GitHub answered 429 to the Hermes install script fetch (fixed: the fetch retries, and the install is tried up to 3 times);
  - smoke 3: the web-tools check had no tool list for DeepSeek Harness on DeepSeek, because the install check had no such cell (fixed: `dsh-deepseek` added).

## Smoke 4 (23 of 24 trials, $5.60 of trial usage)

| Cell | Trials | Passed | USD per trial | Notes |
|---|---|---|---|---|
| particle-hermes | 3 | 1 | 0.034, 0.210, 0.565 | gcode-to-text hit the agent timeout |
| particle-openclaw | 3 | 1 | 0.027, 0.450, 0.991 | gcode-to-text hit the agent timeout |
| particle-pi | 3 | 2 | 0, 0.372, 0.057 | pytorch-model-recovery: Pi refused the instruction (below) |
| deepseek-hermes | 3 | 1 | 0.031, 0.358, 0.248 | two agent timeouts |
| deepseek-openclaw | 3 | 1 | 0.029, 0.107, 0.235 | no timeouts |
| deepseek-pi | 3 | 1 | 0, 0.048, 0.104 | pytorch-model-recovery: Pi refused the instruction (below) |
| deepseek-dsh | 3 | 1 | 0.093, 0.196, 0.119 | two agent timeouts |
| opus-dsh | 1 | 1 | 0.871 | |
| sol-dsh | 1 | 0 | 0.451 | |
| particle-dsh | 0 | | | not reached: the smoke's 4-hour limit stopped the shard |

- **Pi and an instruction that starts with "-":** pytorch-model-recovery's instruction begins with "- You are given". Harbor passes the instruction to Pi as an argument, and Pi 1.5.0 read it as an unknown option and stopped before any model request. #337's Pi cells hit the same thing on this task. Fixed before the freeze: Pi gets `--` before the instruction, so the rest is always a message.
- **Hermes's session-title call** got HTTP 400 on DeepSeek (non-streamed, reasoning effort none), as declared in the preregistration.

## Smoke 5 (3 trials)

| Cell | Task | Passed | USD |
|---|---|---|---|
| particle-pi | gcode-to-text | yes | 0.085 |
| deepseek-pi | gcode-to-text | yes | 0.058 |
| particle-dsh | filter-js-from-html | yes | 0.718 |

## Smoke 6: the install check at the freeze code (3 trials, $0.42 at the proxy)

It ran on harn57/smokes 48cdee078b (recorded as repo_commit in smoke 6's install-check.json; that scratch commit is not kept on any branch), which is this preregistration's code at e4acedadaa plus the smoke plan. The only later commit before the freeze adds pre-merge secret-scan allowlist entries in .gstack/pregate.json and changes nothing a trial runs. Smoke 7 repeated it after main was merged in.

- **Agents:** all 22 keyless cells completed with the model reached, hermes-opus (install retry) and dsh-deepseek included. cursor-opus stopped at agent setup with HE-CURSOR-002 (no Cursor key, nothing sent to Cursor), as designed.
- **Egress:** the reply held back 30 seconds got through (slow_reply ok, 30.0 s). Blocklisted hosts, model APIs included, were refused. github.com, pypi.org, raw.githubusercontent.com and huggingface.co were reachable. The task container has no Docker socket.
- **Oracle and nop:** 3 of 3 and 0 of 3, as expected. The canary check passed.
- **Web tools:** no web tool on particle-pi (smoke 6's `install-check-web-tools.json`, at 663bcd48ab; the file now holds smoke 7's). Smoke 4 found none on any particle-1, DeepSeek or DeepSeek Harness cell (`smoke4-web-tools.json`). Every counted shard repeats this check before its first counted trial.

| Cell | Task | Result | Requests | USD |
|---|---|---|---|---|
| particle-pi | filter-js-from-html | fail | 46 | 0.402 |
| particle-pi | pytorch-model-recovery | pass | 7 | 0.011 |
| particle-pi | gcode-to-text | agent timeout | 11 | 0.012 |

pytorch-model-recovery, the task whose instruction starts with "-", now reaches the model and passes, so the Pi fix works on a real trial.

## Smoke 7: the install check after main was merged in (3 trials, $1.55 of trial usage)

Merging main changed the shard scripts (bootstrap.sh, fanout.sh, run-shard.sh, vm-shard.sh), so the install check ran again, on harn57/smokes aefa37e81b: this preregistration's code at dffe982aab plus the smoke plan. One more merge of main followed. It changed analysis, pricing, the multi-user runner and the merge lane, but no harness install, model route, egress file or shard bootstrap, so the install check was not run again. Four later merges of main changed the preregistration checker, the sealed-publication check, the public export, the CI scripts, the ship policy, two memory task sets and published corrections, again with no harness install, model route, egress file or shard bootstrap. One later edit rewords the Cursor cells' credential note in frontier_settings.py (a description string in harness_settings.json; no setting changes) so the pre-merge secret scan does not read the variable name CURSOR_API_KEY as a key. After that, four more merges of main changed code the install check exercises (each list names the main files, not every file the merge changed): 4e27dd13b2 (fanout.sh), 086043bb29 (agents.py, frontier_settings.py, install-check.sh, vm-run.sh, plan.ts and run-shard.sh, among others), 5929aade99 (the metering proxy, the trial runner and the harness adapters, among others) and 0c0becc534 (the metering proxy, the trial runner, the Hermes and OpenClaw adapters, agents.py, frontier_settings.py, plan.ts, the Harbor pin.json, both run-shard.sh scripts, vm-shard.sh and ubi-runner.sh, among others). The install check was not run again after them; the preregistration's run order runs it at the preregistration commit before any counted trial. The other later commits change only this preregistration's text, the install-check file, the public-safety class list, the ship policy and the key-scan self-check pattern for merge-pass.sh. The pre-merge review also made the metering proxy refuse OpenRouter server tools (a tools entry whose type starts with openrouter:) and `web_search_options`, either of which would run a web search on OpenRouter's servers. It made the Ubicloud controller's Cursor key scan in run-shard.sh read regular files only, so a named pipe under a trial's state cannot stall the controller; that scan runs on the controller after each pull, not in the VM bootstrap. It also made the Pi world-MCP extension match a streamed answer to its request by exact id; the Harbor cells run Harbor's own Pi agent and do not load that extension. Its install-check.json is `scripts/frontier-harbor/install-check.json`.

- **First try:** the VM's bootstrap stopped after installing Bun and never returned, so no check ran. The VM was destroyed and the shard launched again on a fresh VM.
- **Agents:** all 22 keyless cells completed with the model reached. cursor-opus stopped at agent setup with HE-CURSOR-002, as designed.
- **Egress:** the 30-second held reply got through, blocklisted hosts were refused, the allowed hosts were reachable, and the task container has no Docker socket.
- **Oracle, nop, canary and web tools:** all passed as in smoke 6. particle-pi offers no web tool.

| Cell | Task | Result | Requests | USD |
|---|---|---|---|---|
| particle-pi | filter-js-from-html | fail | 45 | 0.132 |
| particle-pi | pytorch-model-recovery | pass | 13 | 0.032 |
| particle-pi | gcode-to-text | agent timeout | 106 | 1.390 |
