# Review rig configuration (cells C1 and C2)

**What this is:** the inputs we hand to gstack-evals' `review-units` command for the review real-bugs eval, and what we learned running them once on two toy pull requests.

**Takeaways:**
- **The rig runs all three C1 arms (plain, /review, /ship's review step) end to end, and their findings parse.** Each toy smoke cost under $3.
- **Two things don't work as the plan assumed.** The outside voice (a second model family inside /review) never runs in the rig's container, and the GPT-6.1 Sol smoke ran out of allowance before it wrote its findings.
- **Three choices need stating in the preregistration:** our own severity map, how C2 reaches Sol, and that the /ship arm runs in its own launch with no reader map.

## Pins

| What | Pin |
| --- | --- |
| gstack under test | `1d3c63c53d17faf0456c564bc5950f18b370d0ef` (stable, tag v1.99.3.0) |
| gstack-evals (the rig and the noloss scorer) for the smokes below | `91d76421a9f127167b3694306aa77f2971f7a712` (main). The counted run uses `064c7f18857e6d1850cfb1f69e87e60812b85933`, which adds only #344's `--pr-context` and leaves `lanes/review-noloss/` unchanged. |
| C1 model | `claude-opus-5-5` on Anthropic |
| C2 model | `openai/gpt-6.1-sol` on OpenRouter, driven by Claude Code (see "C2 route") |

## Files

| File | sha256 | What it does |
| --- | --- | --- |
| `toy-suite.json` | `2f466bb7a24cc0a7dbc32032f00cdd9b3ba1a2612c096c9a8f4dca1e592756f4` | Two sindresorhus/ky pull requests (#846, 494 changed lines; #861, 40 changed lines) for dry runs and smokes. Its blockers are placeholders and are never scored. |
| `reader-map-gstack-1d3c63c53d17.json` | `98f4aa9071bd9a4ccd992e5d9558852040507a8314f83eaf2096aac54f3ef8af` | Tells the rig which file each /review reader loads, so it can count reader rows. Same 11 checklists as the round 2 map; the specialist files are byte-identical to gstack 699a41cb. |
| `severity-map.json` | `4034fd51a417d669f651e966f1b0e9971c6c84706f6f0f840d8e1e781ca3b58b` | Maps each arm's severity words to CRITICAL or INFORMATIONAL. Keys are the rig arm names `none`, `review` and `ship-panel`. |
| `severity-map-dry-run.txt` | `aa560aa5e80810daf001468c256a20b2b60c39ae1724f0741381c73f1992baca` | Counts of unmapped labels under our map and under round 2's map. Counts only. |
| `told-review.txt` | `c6334bf77190ad4db057100d5e3e0b1ee27b454215739474e89a5e0cc7c93482` | The /review arm's told line, round 2's line word for word. |
| `told-ship-panel.txt` | `6d172ca6f4069dc36b4fe454af6dbebb6899f42f78e1c6630d412ec29e1a3e32` | The /ship arm's told line: run Steps 9 to 11 only, with no tests, edits, version bump, commit, push or pull request. |
| `depth-toy.json` | `59b667cd9668c76802b5e5d315168c84fd6fc6a085ee12f0a50c467112e65d86` | Expected readers per host and per unit, from `scripts/review-bugs/depth.ts` on the toy suite. |

The plain arm is the rig's `none` arm with no told prefix.

## Flags

Every launch uses round 2's common flags: `--system-prompt <arm>=claude-code-preset`, `--max-turns 200`, `--cap-stops`, `--timeout 10800`, `--background-wait 3600`, `--severity-map severity-map.json`, `--install sindresorhus/ky='bun install --no-save'` and `--test sindresorhus/ky=true`. Round 2 froze `--allowance 40`. The /review arm adds `--reader-map reader-map-gstack-1d3c63c53d17.json`.

`bun install --no-save` matters: plain `bun install` rewrote `bun.lock`, and the rig refused the dirty tree (`E_UNIT_IMAGE`) before spending anything.

## Why our own severity map

noloss looks labels up by exact match. Round 2's `severity-map.rr2.json` misses labels the eval will see:
- On round 2's real /review findings, `ADVISORY` was unmapped 6 times out of 592.
- On round 2's real plain findings, lowercase `low`, `high`, `medium` and `nit` were unmapped (123 of 129). Round 2 fixed both by hand mid-run.

Our map adds lowercase and title-case twins, `ADVISORY` to INFORMATIONAL, and a few common words a plain prompt uses. For the gstack arms, `High`, `P0` and `P1` map to CRITICAL, because gstack's own rule at the pin says a Critical, High or `Blocks: yes` finding is CRITICAL and that P0 and P1 block. **This differs from round 2, where a High label stopped the run.** Any label still unknown stops the run. Under our map, the dry run leaves 0 labels unmapped in all four sets (`severity-map-dry-run.txt`).

## Expected readers (`depth.ts`)

`depth.ts` builds each unit repo the way the rig does, runs the pin's `gstack-diff-scope` and `gstack-state-matrix`, and applies /review's Step 4.5 rule. It renders /review for each host to see what that host gets:
- **claude:** the reader army and the adversarial reader.
- **codex:** the adversarial reader only (the codex host drops the reader army).
- **openclaw and hermes:** neither.

On the toy units under claude, ky#846 gets adversarial-native, maintainability, performance, red-team, security, simplification and testing, and ky#861 gets adversarial-native only. The /ship arm uses `gstack-review-plan`, which batches the specialists: ky#846 gets adversarial-native, batched and red-team.

## C2 route

The rig can't run a codex host today. `review-units --models gpt-6.1-sol` fails with `E_USAGE ... has no Claude Code route in the policy`, and the rig's `cli.ts` hard-codes the claude host. So C2 runs Claude Code with `openai/gpt-6.1-sol` on OpenRouter's Anthropic-compatible route. **For reader counts, C2 is the claude host.** No outside voice is configured for the Sol cell.

## The /ship arm runs alone

The rig refuses `--reader-map` for an arm whose told line opens with `/ship`, because the map names /review's files. So the /ship arm runs in its own launch, has no reader rows in `cost.tsv`, and its readers have to be read from transcripts.

## Smoke results (ky#846, one pass each)

| Arm | Cap / allowance | Outcome | Cost | Time | Findings |
| --- | --- | --- | --- | --- | --- |
| plain (C1) | $4 / $3.5 | completed | $0.28 | 73 s | 2, parsed |
| /review (C1) | $16 / $15 | completed, no cap stops | $2.56 | 259 s | 6, parsed |
| /ship review step (C1) | $25 / $24 | completed, no cap stops | $2.33 | 246 s | 6, parsed |
| /review (C2, Sol) | $10 / $9 | **allowance stop** | $1.99 | 248 s | none (scored as finding nothing) |

What the transcripts show:
- **/review (C1):** its reader rows match `depth.ts` exactly, and all 7 readers returned.
- **/ship (C1):** it ran `gstack-review-plan` and dispatched exactly the 3 readers `depth.ts` expects (batched, adversarial-native, red-team). It made no commit, push, version bump or pull request; the only test-like runs were the readers' own small repro scripts.
- **Outside voice:** in both C1 gstack arms the voice row is $0 with 0 requests. The voice tool printed `CODEX_MODE: sandbox_unavailable` because the trial container has no bubblewrap. **The cross-family voice never ran.**
- **Sol (C2):** it launched 7 readers and 6 finished. Then a call was refused with `E_ALLOWANCE`: one call's worst case of $4.34 plus $4.75 already reserved didn't fit the $9 allowance. Parallel readers reserve worst cases at once. No `cyber_policy` refusal appeared. Round 2's $40 allowance would likely fit, but this is unproven.

## Metering

The smokes went through gstack-evals' own metering proxy and ledger lease, not harness-evals' `runner/proxy`. The rig hard-codes its upstream URLs, so the two proxies can't be chained without changing the rig. Every dollar above came from the rig's ledger.
