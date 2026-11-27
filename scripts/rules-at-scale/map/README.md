# Keyless delivery map

The map runs every harness and arm through the real harness, at its pinned version, against a recording fake model server. It records which of the six planted rules reach the model, in what state, and which arms send the same first request. No model is called and no key is used.

**Takeaways**

- **Claude Code, Pi, Gemini CLI and Hermes send every rule whole at every size up to 160 KB.** A big file costs those harnesses tokens, not rules.
- **Codex keeps only the first 32 KB.** At 80 KB and 160 KB only the two rules at the top arrive, in every rotation, and its 80 KB and 160 KB first requests are byte-identical. Codex tells the model nothing about the cut. The `cutlift` arm (`project_doc_max_bytes` 262144) brings all six back.
- **OpenClaw cuts from 28 KB up and loses the two middle rules, in every rotation.** It keeps the head and the end and puts a "Policy digest" of lines picked from the file in between. On real filler that digest also picks up other projects' "never" and "do not" lines (at 160 KB it is nearly all of them), so it differs at every size, and the planted middle rules never make it in. The `cutlift` arm brings all six back.
- **The hook arm delivers all six rules on every harness that has one** (Claude Code, Codex, Hermes, OpenClaw): one hook copy beside the task message, still there in the follow-up, even where the file itself was cut.
- **Split rules aren't loaded at start.** Rules moved into a subfolder's rules file (R3 and R5) are absent from the first request on every harness. The map's one tool call doesn't touch those folders, so it can't show lazy loading. Claude Code's `@docs/conventions.md` import does bring R1 in.

## Results

The final run is `runs/2026-11-19-final/`, on lane B's `materialize.ts` (real filler from public rules files): 48 cells, all ran, none failed. Hermes `cutlift` isn't run on Opus (HE-RULES-003), because at the 1M window its default cap is above the 160 KB file. `rotations/` adds the Codex and OpenClaw 28, 80 and 160 KB cells at rotations 1 and 2. The main run is rotation 0.

W whole, - absent. The full table, with request sizes, follow-up requests, positions and truncation markers, is in [`delivery-map.md`](runs/2026-11-19-final/delivery-map.md).

| harness | where the file lands in the request | b8k | b28k | b80k | b160k | split | hook | cutlift |
|---|---|---|---|---|---|---|---|---|
| Claude Code 2.1.328 | first user message | all W | all W | all W | all W | R3, R5 absent | all W | not offered |
| Codex 0.170.0 | an input message before the task | all W | all W | top pair only | top pair only | R3, R5 absent | all W | all W |
| Gemini CLI 0.69.0 | first user message | all W | all W | all W | all W | R3, R5 absent | not offered | not offered |
| Hermes v0.23.2 | system prompt | all W | all W | all W | all W | R3, R5 absent | all W | not run on Opus |
| OpenClaw 2026.11.5 | system prompt | all W | middle pair lost | middle pair lost | middle pair lost | R3, R5 absent | all W (hook) | all W |
| Pi 1.5.2 | system prompt | all W | all W | all W | all W | R3, R5 absent | not offered | not offered |

The `none` arm carries no rule on every harness, and `short` carries all six whole.

**Per rotation** (top, middle and end pairs: rotation 0 R1 R2, R3 R4, R5 R6; rotation 1 R5 R6, R1 R2, R3 R4; rotation 2 R3 R4, R5 R6, R1 R2):

| harness | rotation 0 | rotation 1 | rotation 2 |
|---|---|---|---|
| Codex b80k and b160k | R1, R2 kept | R5, R6 kept | R3, R4 kept |
| OpenClaw b28k, b80k and b160k | R3, R4 lost | R1, R2 lost | R5, R6 lost |

**Byte-identical first requests** (after the trial's own names, ids, times and tokens are replaced and JSON keys sorted): only Codex b80k and b160k, in all three rotations. OpenClaw's 28, 80 and 160 KB cells all differ, because the digest and the tail change with the size.

## Frozen filler run

`runs/2026-11-19-frozen/` is the same 48-cell map on lane B's frozen filler (rules-at-scale-core 207e824c), which also drops lines that need a person to answer (`blocks_one_turn`) or a tool the task image lacks (`missing_tool`). Every rule state, hook copy count, marker set and byte-identical group is the same as in the final run, and first requests differ by -34 to +287 bytes.

- **OpenClaw's digest lost the lines that would stall a one-turn run**, such as "use bd for ALL task tracking", "Do NOT create markdown TODO lists" and "Never make assumptions, always ask".
- **Other projects' style rules still reach the model through it.** About 22 of 96 digest lines at 28 KB, 58 of 87 at 80 KB and 74 of 80 at 160 KB carry never, do not, must or always. Examples: "No code comments: Never add comments to any code you write", "All options must have both short and long forms" and "Do not manually publish or create tags". The same lines sit in every harness's file. OpenClaw just gathers them in one place.

## Stub run against the final run

`runs/stub-2026-11-19/` is the same map on the stub materializer (synthetic filler), kept for comparison. Every rule state, marker set, hook copy count and byte-identical group is the same in both runs. Per harness:

- **Claude Code, Codex, Gemini CLI, Hermes, Pi:** no change in what arrives. First requests differ by -0.1 to +2.3 KB, from the real filler's text and escaping.
- **OpenClaw:** same states, but a different digest. On synthetic filler the digest repeated the top rules (R1 twice in the request) at 28, 80 and 160 KB. On real filler it still does at 28 and 80 KB. At 160 KB the digest is filled with real "never", "do not" and "must" lines from the filler's source projects (for example "Do NOT create markdown TODO lists" and "No code comments"), so R1 appears once, and once more beside the task in the hook arm.

## What else the map showed

- **OpenClaw reads `/work/repo/AGENTS.md`.** Its `none` arm shows "[MISSING] Expected at: /work/repo/AGENTS.md" (and SOUL.md, IDENTITY.md), so no setup template leaked into the repository.
- **OpenClaw's hook works on `openclaw agent --local`.**
- **Gemini CLI sends no follow-up request.** The fake server makes no Gemini tool call, so Gemini's follow-up column reads "n". The first request is still mapped.

## QM (predicted, not captured)

QM was a stub when this map ran, so its row is a prediction from a source read, not a capture. QM reads no rules file from the workspace. Its rules go in the organization's SOUL, set by one admin call before the turn and shown under "## Organization instructions", up to 100,000 characters. A longer SOUL fails the trial and is never cut, so QM offers no b160k, split, hook or cutlift arm. The `qm-repo` arm (b8k AGENTS.md in the repository, empty SOUL) is predicted absent from the first request. The predicted rows are in `delivery-map.md`, and under `qm_predicted` in `delivery-map.json`.

## Run it

```
bash scripts/rules-at-scale/map/delivery-map.sh <out dir> [--harnesses claude-code,codex] [--arms b8k,b160k] \
  [--concurrency 3] [--rotation 0|1|2] [--materializer <script>]
```

It needs Docker and the Harbor venv at `~/.frontier-harbor/venv` (Harbor 0.24.0, from `scripts/frontier-harbor/harbor-requirements.txt`). The materializer defaults to lane B's `scripts/rules-at-scale/materialize.ts`. A full map takes about 17 minutes at concurrency 3 on a 4-core machine. It writes `delivery-map.json` and `delivery-map.md` in the out dir and exits non-zero if any cell failed. To remap an existing out dir without rerunning the harnesses:

```
python3 scripts/rules-at-scale/map/delivery_map.py <out dir> <materializer>
```

## How it works

| file | what it does |
|---|---|
| `delivery-map.sh` | Materializes every arm, starts the fake model server, a recording forwarder and a stand-in broker, runs one Harbor job per cell and maps the result. |
| `delivery_map.py` | Reads the recorded request bodies, finds each rule in the first agent-loop request and the follow-up, and groups byte-identical first requests. |
| `stub-task/` | A tiny Python repository task (2 CPUs, 4,096 MB) with the watcher baked in. `id`, `rotation`, `package_dir` and `tests_dir` sit at the top of its task.toml, where lane B's materializer reads them. |

- **The server** is `scripts/frontier-harbor/fake-upstream.ts`. A recording forwarder in front of it strips the trial's path segment, so Gemini's `/google/v1beta/...` routes match.
- **The first agent-loop request** is the first one that declares a shell tool. Housekeeping calls (titles, summaries) are skipped.
- **The follow-up** is the first later request that carries the fake tool's output, so it shows whether the rules survive into the second turn.
- **Rule states:** whole (the exact text), partial (a 32-character window of it), absent, or unscorable.
