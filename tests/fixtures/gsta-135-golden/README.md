# internal-task golden fixtures (internal-task)

These fixtures pin what internal-task's scorer, `scripts/gsta-135/evidence.ts`, published for both internal-task panels, so the backward-compatible changes internal-task makes to it (exported readers and types, optional raw fields) can be shown to change no metric. `tests/gsta-135-golden.test.ts` reads them.

## Where they come from

- **Sources:** the Captain drive copies of internal-task's receipts, `handoffs/internal-task/gsta-135/panel-run/` (run `gsta-135-panel-2026-10`) and `handoffs/internal-task/gsta-135/panel-run-3610/` (run `gsta-135-panel-3610-2026-10`). Each holds `cells.jsonl` (60 rows) and `evidence/<trial>.txt` (60 excerpts).
- **Cut by:** `bun tests/fixtures/gsta-135-golden/cut.ts <dir holding panel-run and panel-run-3610>`.
- **`<run>.jsonl`:** one line per `cells.jsonl` row, in file order. It keeps the row's trial id, harness, task, arm and termination, its published `evidence` object verbatim, the sha256 of the original `cells.jsonl` line, the sha256 of the excerpt file, and the excerpt's tool-call and tool-result lines.
- **`sources.json`:** the sha256 and size of each source `cells.jsonl` and each excerpt.
- **Checked for secrets:** no key, token or trial credential pattern appears in these files.
- When the drive is mounted, the test also re-hashes the drive copy and checks that the cut is faithful. Without the drive that one test is skipped, not passed.

## Why there are two layers

The published metrics were computed from the native session stores (the OpenClaw agent sqlite and the Hermes `state.db`). Those stores were not published. What was published is:

- `cells.jsonl`, whose `evidence` object holds the classified events, the full final text, the transcript verdict and the metrics;
- `evidence/<trial>.txt`, an excerpt that clips each tool call's arguments at 240 characters and each result at 120.

So the golden cannot rerun the whole pipeline from raw input. It checks the two steps the published files can check.

## What the golden covers

**Layer A, re-scoring (all 120 rows).** `scoreEvents()` takes the published classified events, final text, transcript verdict and task, and must reproduce, byte for byte:

- every field of `metrics`: `task`, `matching_skill`, `matching_skill_opened`, `matching_skill_started`, `started_attempted`, `started_exit`, `control_false_open`, `router_opened`, `skills_opened`, `other_skills_opened`, `task_success`;
- the summary fields `skill_open`, `sub_skill_open`, `helper_run` and `gstack_paths`.

This covers the metric predicates and the task-success text rules (`metrics()`, `taskSuccessMatch()`). A sensitivity check confirms that `task_success` follows the final text: a text with no success cue scores false on every task 1 and 2 row.

**Layer B, re-classifying (from the clipped excerpts).** The excerpt's tool calls are joined to their result lines and passed through `classify()`:

- `tool_calls` and `unmatched_results` match on all 120 rows;
- every published event whose call is not clipped is reproduced exactly (kind, tool, detail, locator, file, sha256, skill, result, exit, exit_belongs), and no extra event appears: 52 of the 54 published events;
- on the 118 rows whose events all come from unclipped calls, the re-derived events give the published `metrics` object, byte for byte.

**Not covered, and why:**

- **Two events whose call the excerpt clipped.** classify() cannot see their arguments, so they are pinned by name and the test fails if a third appears:
  - `panel-run-3610 gsta135-openclaw-t1-candidate-1`, session 99f433f0 seq 14 (a `gstack_path`);
  - `panel-run-3610 gsta135-openclaw-t2-candidate-4`, session c084e0a4 seq 13 (the `helper_run`, the one piped start, `started_exit` "ambiguous").
- **`transcript`, `termination_hint`, the choice of the main session for `final_text`, `note` and `files`.** These come from session structure, stop reasons and the store bytes, which only the native stores carry. Layers A and B take them as published. The readers that compute them are covered by the twelve captured discovery stores in `tests/fixtures/gsta-135/` (`tests/gsta-135-evidence.test.ts`) and by the raw/default comparison in `tests/gsta-135-shared-scorer.test.ts`.
- **Joining results to calls.** The excerpt drops call ids, so the test joins each result to the oldest waiting call with the same tool name. In the native store evidence.ts joins by id. The two agree on every row here.
