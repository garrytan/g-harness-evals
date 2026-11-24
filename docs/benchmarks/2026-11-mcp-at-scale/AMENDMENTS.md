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

## Deviations recorded before the interim look, 2026-11-23

- **Controller restart.** The controller machine slept at about 20:55Z on 2026-11-22 and restarted at about 01:35Z on 2026-11-23. Every local shard wrapper died. The VMs kept running, so no trial was lost or rerun, but no results left the VMs between 20:55Z and 01:37Z. Between 01:37Z and 01:40Z, each of the eight running shards was reattached with `ubi-runner attach`, a 600-second pull, cleanup, then `phase-complete`, all from the same checkout at `39d2efef`.
- **Wrapper checkout.** The wrappers ran from the controller's main checkout of this branch, held at `39d2efef`, not from a separate pinned worktree. That checkout did not change while shards ran.
- **Failed launches.** The first launch of s04, s06 and s12 failed while uploading, because the controller's disk filled. Their VMs were destroyed before any lease opened. s05, s08 and s10 died locally before launch. All six were relaunched cleanly from `39d2efef`.
- **Late launches.** s02, s03, s09 and s11 started later than the others because of a crew-wide limit on concurrent VMs. That changes wall time only.
- **s12 final pull.** The last pull ended with a tar EOF. The final directory's row count (1,094) and file count (30,219 scanned plus the scan itself) match the shard's end record and its key scan. This checks counts only; there is no per-file manifest to compare against.
- **Amendment 2 tooling.** `key-review.ts` runs from this amendment's commit, in a separate worktree. Everything else stays at `39d2efef`.

