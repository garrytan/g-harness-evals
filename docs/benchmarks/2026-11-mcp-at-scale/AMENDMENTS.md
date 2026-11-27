# Amendments: mcp-at-scale-2026-11

Each amendment is a dated commit before any cell it affects. The preregistration is [PREREGISTRATION.md](PREREGISTRATION.md), merged to main at `0f7b4003`.

## Amendment 1, 2026-11-22: four more set R aggregate routes check the filter value

- **What changes:** on r-137, r-141, r-143 and r-144, the `aggregate` route now matches the connection, database and collection without regard to case and requires the request's filter value inside its pipeline (`dead_letter`, `reconciled`, `staging`, `gpu-infer`), the same fix the preregistration made to r-139 and r-142. Before, r-141's route took any aggregate on the collection, and the other three required one exact pipeline, so a correct pipeline with another stage order or an added stage scored wrong.
- **Sealed half:** checked; no sealed request has an `aggregate` route or an alternate route with exact literals, so it is unchanged.
- **Set R sha256** moves from `0de439ea57b2ce449124234e9d8bb35b2f0f57ca8052ad1dae89d40724db61d1` to `d410d5417412257bf55b7e498dc34b198925d3d8576f0ddad811d7d8bdbdcffb`; [run-spec.json](run-spec.json) and [pins.sha256](pins.sha256) are updated to match.
- **Cells affected:** every cell that runs set R. No counted trial has run, so every counted cell runs from this commit or later.
- **Why:** the second-model review of the preregistration found these routes; the coordinating agent ruled the fix goes in as a dated amendment before phase 1.

## Amendment 2, 2026-11-23: a reviewed exemption for key-shaped text that is not a key

- **What changes:** a new script, [key-review.ts](../../../scripts/mcp-at-scale/key-review.ts), may clear a phase final's key scan before `run.ts phase-complete`. A hit on the exact value of a key is always fatal: the script refuses and changes nothing. A hit on a key-shaped pattern is cleared only when every match of that pattern in that file falls into one of two classes:
  - **`sk-test-fixture`:** a whole token under 40 characters made of `sk-test` and then only lowercase letters and dashes. This is a readable test placeholder; a live provider key is random mixed-case text.
  - **`base64-run`:** the match is made only of letters, digits, `+`, `-` and `_`, and sits in a run of at least 200 such characters that starts at least 64 characters before the match. Any `/`, `=` or other character ends a run. This is random encoded data, such as encrypted reasoning, that happens to contain a key prefix. A key after a short name such as `NAME=`, or inside a URL path, is never cleared.
  - Each hit file must be a regular file inside the final, reached through no symlink, and no recorded path may itself contain key-shaped text.
- **What it writes:**
  - The original scan, kept byte for byte as `key-scan.raw.json`.
  - `key-scan-review.json`: for each cleared hit, its pattern, file path, class and match count. It never holds the matched text.
  - `key-scan.json` rewritten with no pattern hits, its exact-value result unchanged, and a pointer to both files.
  - All three are published with the shard's results.
- **Why:** shard s12's phase 1 recorded all 1,094 rows on a drained lease, but its scan found two key-shaped patterns.
  - `sk-test` placeholders came from gbrain's own test source, which Codex read in three trials.
  - `sk-` and `AIza` substrings sat inside base64url runs of 3,684 to 10,808 characters in Codex session and proxy-capture files from four trials.
  - No file held the exact value of any key passed to the VM.
  - Without this amendment, `phase-complete` refuses s12 and the interim look cannot run. The coordinating agent approved the exemption with three conditions: exact-value hits stay fatal, the base64 exemption needs a run of at least 200 characters, and every cleared hit's path and class is recorded.
- **What does not change:** no trial, row, grader, spec or pin. `run.ts`, including its scan and `phase-complete`, is unchanged, so the run commit stays `39d2efef`. Phase 2 VMs and every `run.ts` command still run from `39d2efef`.
- **Scope:** any phase final whose scan has pattern hits, in phase 1 or phase 2. A shard that hits it ends with runner exit 5, and the controller then runs `key-review.ts` and `phase-complete` by hand.
- **Known gap, sent to the scanner's owners:** neither scan can see a real key that has itself been base64-encoded.

## Amendment 3, 2026-11-23: the final analysis reports a stopped comparison the way the preregistration says

- **What changes:** in [analyze.ts](../../../scripts/mcp-at-scale/analysis/analyze.ts), a comparison stopped at the interim look now reports the look's own verdict: its decision, difference, 95% range and z, read from the look's record (`interim.json`).
  - It also computes that comparison's difference on all trials, phase 2 included, labelled "descriptive, stopped early".
  - Before this, a stopped comparison showed an empty difference and "No final decision", which drops both numbers that the [Interim look](PREREGISTRATION.md#interim-look) section says are reported.
- **What does not change:** a stopped comparison still decides nothing at the final look. Its pass, slip, hold and "beats" fields stay empty, its final z is not computed, and the decision it feeds still says no final recommendation. Comparisons that continued are untouched.
- **Guard:** the final analysis refuses a look record whose decisions or trial digest differ from the interim state. The record is read from beside the state file, as the preregistration's commands place it, or from `--interim-record`.
- **Why:** the coordinating agent asked for this before any results, after the second-model review of the preregistration noted the gap.
- **Cells affected:** none. This changes only how the final analysis reports, and no analysis has run.

## Amendment 4, 2026-11-23: the key-scan review also clears a documentation placeholder made of x letters

- **What changes:** [key-review.ts](../../../scripts/mcp-at-scale/key-review.ts) gains one class, **`x-placeholder`**: a whole token that is `sk-` and then only the letter x, alone or after `Bearer`. The characters on both sides must not be letters, digits, `+`, `-` or `_`. Exact-value hits stay fatal, and the other two classes are unchanged. A test checks that a long `sk-` token of mixed characters, alone or after `Bearer`, is still refused.
- **Why:** shard s11's phase 1 recorded all 850 rows on a drained lease, but its scan found two key-shaped patterns.
  - One Hermes trial (r-034 at 75 tools) holds 86 copies of `sk-` followed by 20 x's, inside an example `Authorization: "Bearer …"` header in the agent's session, trajectory and proxy-capture files. Both the `sk-` and `bearer` patterns match them.
  - One Codex trial holds two `sk-test` placeholders, which Amendment 2 already covers.
  - No file held the exact value of any key passed to the VM.
  - Amendment 2's review refused the x placeholders, as written. The coordinating agent approved this class before the interim look.
- **What does not change:** no trial, row, grader, spec or pin, and `run.ts` stays at the run commit `39d2efef`.
- **Cells affected:** none. It applies to the review of any phase final, as Amendment 2 does.

## Amendment 5, 2026-11-24: the key-scan review also clears a Bearer value that is the trial's own name

- **What changes:** [key-review.ts](../../../scripts/mcp-at-scale/key-review.ts) gains one class, **`trial-name`**: `Bearer` followed by exactly the name of the trial directory the hit file sits in (`jobs/<cell>/<trial>/...`). The character after it must not be a letter, digit, `+`, `-` or `_`. Exact-value hits stay fatal, and the other classes are unchanged. Tests check that the same header is refused in a different trial's file, with no trial known, and with a longer token that starts with the trial name.
- **Why:** shard s09's phase 2 recorded all 826 rows on a drained lease, but its scan found the `bearer` pattern in 2 files of one OpenClaw trial at 300 tools (r-011).
  - The agent wrote a script that sent made-up headers to the catalog server, among them `Authorization: Bearer <trial name>`. The results report this as a behaviour finding.
  - That accounts for 41 matches across the session and proxy-capture files, and no file held the exact value of any key passed to the VM.
  - The coordinating agent approved this class.
- **What does not change:** no trial, row, grader, spec or pin, and `run.ts` stays at the run commit `39d2efef`.
- **Cells affected:** none. It applies to the review of any phase final, as Amendment 2 does.

## Amendment 6, 2026-11-27: QM's cells and their pilot

- **What changes:** QM's cells join the run, as the [QM](PREREGISTRATION.md#qm) section planned. They are in [run-spec-qm.json](run-spec-qm.json), pinned in [pins.sha256](pins.sha256), with 3,488 trials in total:
  - native QM × Opus 5.5 and QM × particle-1 on set R at all 4 rungs (2,560 trials) and on set T at 30 and 300 tools (128);
  - gbrain full and starter on QM × Opus 5.5 at 150 tools (800), with the same items and repeats as every other gbrain cell.
- **QM build:** `main@77024e79`, the commit `scripts/frontier-harbor/pin.json` pins for QM. **The pin is 168 commits behind QM's main at freeze** (`d8811618`, 2026-11-26). We run the pinned commit because the keyless install check, the daemon digest and the title and model-registry checks were all done at it. Its images are built on each shard VM from `harnesses/qm/Dockerfile` (`scripts/mcp-at-scale/qm-images.sh`).
- **How QM gets the servers:** [agents_qm.py](../../../scripts/mcp-at-scale/agents_qm.py) runs QM exactly as the shared `FrontierQm` class runs it, and changes only how the servers are connected:
  - Before QM's sandbox exists, each catalog server is registered through QM's admin API (`PUT /v1/admin/mcp-servers/<id>`, no auth). A refused registration stops the trial as infra.
  - `PRIVATE_NETWORK_ALLOWED_ORIGINS` lists the servers' origins. QM ships it empty, and setting it is QM's documented way to reach a server on a private network.
  - gbrain is a stdio server. QM connects only to http(s) servers, so gbrain reaches QM through [stdio-http-bridge.ts](../../../scripts/mcp-at-scale/stdio-http-bridge.ts) in the task container. Each MCP session gets its own gbrain process, as a stdio client would start it.
  - The catalog readiness probe runs before the servers are registered, because registering them sends their first requests.
  - A tool call that QM holds for approval is graded from QM's turn reply and flagged `approval_pending`. The grader reads held calls only in QM's cells, which the catalog host's ready line names, because they arrive in a file the agent's container can write. On a catalog server a held call counts as the model's call. It is right only when its server, tool and arguments match and the catalog host's check of its arguments against the tool's frozen input schema passes. That is the same validator every executed call goes through. When the host can't answer that check, the trial is INFRA (HE-MCP-002), as it is when the host's log can't be read. When the host can't compile the tool's schema, the held call counts as not right, which leans against QM. On gbrain, whose rule needs a successful result, a held call is never right.
  - The particle-1 route is new: QM reaches particle-1 as a custom provider (`openai-completions`) on the metering proxy's Particle route. QM's keyless install check passes with its new `qm-particle` cell, at `e95c5665` on a fresh Ubicloud VM (`scripts/frontier-harbor/install-check-qm.json`).
- **Pilot (R111),** run `harn108-qm-pilot-1` at `beedaaf4` on QM × Opus 5.5, using the pilot-only items wave 3 ran on Claude Code. It ran 28 trials for $3.11 paid. One trial was infra: QM core did not answer at setup (`HE-QM-002`). The gates script gave:
  - **native:qm** passes the part-under-test gate. Every server was listed and a catalog tool was called at all 4 rungs, and QM's `tool_search` was called in 8 of 10 parsed transcripts. The task gate fails only on the declared set T size (32 tasks, not 40), as it does for the other five native arms. Spend was $0.91 of a $15.54 cap.
  - **gbrain full** and **gbrain starter** pass.
  - **gbrain verbs** fails: no trial reached a full-only tool. QM opens a new MCP session for every tool call (initialize, then the call, with no session reused). QM also never lists the tools again after registering the server. gbrain's `request_tools` adds tools only to its own session, so a tool it unlocks is gone by QM's next call. In 3 of the 6 verbs trials QM called `request_tools` three times, once with `{"surface": "full"}`, and then called only verbs tools. Under R111, **QM × gbrain verbs is left out** and reported as left out. gbrain starter stays in: its part under test is the shipped starter list, and it passes its gate. On QM, widening starter through `request_tools` cannot reach a full-only tool either, so the full-only half of set G is capped by QM's session model, not by gbrain. QM's starter rows report that cap per harness, the way line 27 of the preregistration does for OpenClaw and Codex.
  - 5 of the 28 trials have no parsed transcript, because the reply to the session request was cut off when `qm-call.mjs` exited. The shared QM support's fix PR (#633) fixes this. Grading reads the catalog log, so no grade changed.
- **particle-1 pilot,** run `harn108-qm-pilot-2` at `693e3eab` on QM × particle-1, after its route landed. It ran 10 trials on the same native items for $0.12 paid, with 0 infra. All 126 model requests the proxy saw were `particle-1` chat completions. native:qm passes the part-under-test gate: every server was listed and a catalog tool was called at all 4 rungs, and `tool_search` was called in 7 of 8 parsed transcripts. The task gate fails only on set T's declared size. Two trials have no parsed transcript, from the same `qm-call.mjs` cut-off. Its gate output is `results/qm-pilot/gates-particle.txt`.
- **Before any counted QM trial:** the shared QM support's fix PR (#633: counted-path smoke, the ZDR gate reading `install-check-qm.json`, the cleanup scope, the `qm-call.mjs` cut-off, the container leak, the Postgres probe) is on main. The counted QM run executes from a pinned worktree at a main commit that contains both that PR and this amendment.
- **Spend:** six shard leases total $351, and the cap is $387: those leases plus a $36 reserve. That is inside QM's approved share of about $435 paid. Lease sizes are the pilot's mean cost per trial for each cell type, plus half again.
- **Shards:** 6 shards of whole cells, one standard-16 VM each, canary shard first. No cell is split across machines.
- **No interim look:** R113's look applies to a counted run planned above $500 paid, and QM's planned paid spend is under that. QM's rows go through the same analysis code in their own pass (`analyze.ts --exploratory` on QM's trials) and are reported beside this run's rows, labelled with the QM build they ran on. They never join this run's trials file and do not enter the run's interim decisions, which are final. The final analysis refuses a trials file that holds QM rows, and the interim recompute leaves them out.
- **What does not change:** the sets, margins, grader rules for every other harness, interim design, run trials and published analysis. `stats.ts` now also counts QM's session transcript as a parsed transcript, and the run's `analysis.json` and `analysis.md` reproduce byte for byte with that change.
- **Cells affected:** the 14 cells in `run-spec-qm.json`.

## Deviations recorded before the interim look, 2026-11-23

- **Controller restart.** The controller machine slept at about 20:55Z on 2026-11-22 and restarted at about 01:35Z on 2026-11-23. Every local shard wrapper died. The VMs kept running, so no trial was lost or rerun, but no results left the VMs between 20:55Z and 01:37Z. Between 01:37Z and 01:40Z, each of the eight running shards was reattached with `ubi-runner attach`, a 600-second pull, cleanup, then `phase-complete`, all from the same checkout at `39d2efef`.
- **Wrapper checkout.** The wrappers ran from the controller's main checkout of this branch, held at `39d2efef`, not from a separate pinned worktree. That checkout did not change while shards ran.
- **Failed launches.** The first launch of s04, s06 and s12 failed while uploading, because the controller's disk filled. Their VMs were destroyed before any lease opened. s05, s08 and s10 died locally before launch. All six were relaunched cleanly from `39d2efef`.
- **Late launches.** s02, s03, s09 and s11 started later than the others because of a crew-wide limit on concurrent VMs. That changes wall time only.
- **s12 final pull.** The last pull ended with a tar EOF. The final directory's row count (1,094) and file count (30,219 scanned plus the scan itself) match the shard's end record and its key scan. This checks counts only; there is no per-file manifest to compare against.
- **Amendment 2 tooling.** `key-review.ts` runs from this amendment's commit, in a separate worktree. Everything else stays at `39d2efef`.

