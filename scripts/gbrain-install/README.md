# gbrain install eval: scoring

These scripts score the gbrain install eval: a fresh agent is told "install gbrain", saves a made-up fact, and a new chat has to recall it through gbrain.

- **Everything here is mechanical.** Regular expressions over transcripts, probes and logs. No model judges anything.
- **Claude Code and Codex parsing is ported from tested code.** OpenClaw and Hermes parsing is new, written from the adapters' export code and the pinned stream format, and **needs a live check** before its numbers count (see "Known limits").

## Files

| File | What it does |
|---|---|
| `transcript.ts` | Turns one turn file into a flat event list (`parseTurn`). Also: `isGbrainCall` (a gbrain MCP tool, or the gbrain CLI in command position), `isGbrainServed` (the finish line's gbrain call: a gbrain MCP tool, or a shell command that is one gbrain invocation, with gbrain as the command word, optionally after `cd <dir> &&` and optionally piped into `head` or `tail` with no file, and otherwise no `;`, `&&`, `||`, `|`, subshell or command substitution), `hasToken` (whole-word match, case and punctuation ignored), `githubRateLimited`, `norm`. |
| `steps.ts` | `stepOf` (the first install step a probe has not passed) and the time to each step. |
| `classify.ts` | `classifyInstall`: one trial's route, install attempts, version, fetched install doc, stalls, person-needed events, failed and retried commands, question types, harness-memory saves, last gbrain error code, step times, the step a failed install died at, and infra flags. |
| `verdict.ts` | Per cell and arm: n, finish-line rate with a Wilson 95% interval, median and IQR of time to finish, median agent turns, person-needed counts, harness-memory count, the three release-pin counts, hinted recall. |
| `failure-table.ts` | One row per step (binary, brain, wired, saved, recalled): failed runs, person-needed events, top gbrain error codes, two example trials, and empty "as read" and "reader note" columns for the independent reader. |
| `real-image-check.ts`, `real-image-check.sh` | The keyless check of the four real harness images, described under [Real-image check](#real-image-check). Not part of scoring. |

Run the scoring files on a results directory that holds `trials.jsonl`:

```sh
bun scripts/gbrain-install/verdict.ts <run dir>            # Markdown
bun scripts/gbrain-install/verdict.ts <run dir> --json
bun scripts/gbrain-install/failure-table.ts <run dir> [--arm bare|paste] [--md <file>] [--csv <file>]
```

Every run is counted except those [docs/methodology.md](../../docs/methodology.md) item 9 excludes (`model_error`, `infra_error`, `exam_fault`), an adapter's HE-INSTALL-003 refusal (the cell was set up wrong) and runs with an infra flag. Those are listed apart, with the reason. A `timeout` or another `harness_error` counts as a run that missed the finish line.

## Transcript formats

| Harness | Turn file | Status |
|---|---|---|
| Claude Code | `logs/turns/turn-NNNN.claude.jsonl` (`claude -p --output-format stream-json --verbose`) | ported |
| Codex | `logs/turns/turn-NNNN.codex.jsonl` (`codex exec --json`, codex-cli 0.165.0) | ported |
| OpenClaw | `logs/turns/turn-NNNN.openclaw.json` (`openclaw agent --local --json` envelope, for the final text) and `turn-NNNN.openclaw-session.jsonl` (the session events the adapter exports, for tool calls and results) | new, needs a live check |
| Hermes | `logs/turns/turn-NNNN.hermes.jsonl` (`hermes chat --format stream-json`, which cuts each tool output at 5,000 characters) and `turn-NNNN.hermes-session.jsonl` (the `state.db` message rows the adapter exports; a tool row's whole output replaces the cut one, paired by `tool_call_id`) | new, needs a live check |

## The rules

**Steps.** binary (gbrain on PATH), brain (a brain exists), wired (the harness config registers gbrain by MCP, instructions or a hook), saved, recalled.

- Install-step times: the earliest of the 1-second watcher line and the end-of-turn probe that shows the step. The watcher is earlier whenever it ran.
- Save and recall times: the end of the save (or recall) turn that holds the first successful gbrain call. Transcripts carry no per-call times. Recall time is null when the finish line was missed.

**Person needed.** Three kinds, each tagged with the step:

- **Scripted reply.** Every scripted reply counts once, at the step of the turn before it. The same rule applies in every arm and harness.
- **Blocked step.** An error line from a pinned list (`BLOCKED_LINES` in classify.ts) in a tool output, which the agent's text in the same turn repeats or explains. The first entry is Bun's "Blocked 1 postinstall", reported as "One install step was blocked by Bun". Each other entry states why it is on the list.
- **Question.** An agent turn ends on a question to the user before the finish line is met: any turn of session 1, and the session 2 recall turn when the recall missed. It is tagged with the step the turn was on: "Stopped to ask a question at step X". The hinted turn is not counted. The scripted reply still fires only on the probe state.

**Routes** (from shell commands; the first that succeeded, else the last tried): bun-github, npm, git-clone, clawhub, hosted (gbrain.io, gbrainio, terminalwire), codex-plugin, curl-script.

**Release pin.** Both arms end with a line naming the pinned release tag, while gbrain's docs say `#stable`. The counts use what was installed, never the commands the agent typed: per cell and arm, over counted runs, the verdict counts runs whose **first** gbrain version on PATH was not the pin (it installed `#stable` or another build first), runs whose **last** version was not the pin (it never reached the pin), and runs where **no** gbrain version was seen. The versions are `probe_versions`, the earliest and latest `gbrain --version` the probe recorded (the 1-second watcher and the end-of-turn probe). Two limits: the watcher samples once a second, so a build replaced in under a second can be missed; and the harness image must start with no gbrain on PATH, which the runner checks before the first install trial of each image (HE-INSTALL-006). `install_attempts` (every shell command that matches a route, with the gbrain ref it seems to name and whether it succeeded) is descriptive only and feeds no count.

**Other fields.**

- **Install doc:** each INSTALL_FOR_AGENTS.md URL a tool fetched, with the git ref from the URL path. The sha256 is filled only when the tool output holds the body (curl or wget to stdout, normalised to end in one newline, or a printed sha256sum). It is null for WebFetch, which returns a summary.
- **Harness memory:** the save turn wrote to the harness's own memory (a memory tool, or CLAUDE.md, AGENTS.md, MEMORY.md, USER.md or a memory directory) and made no successful gbrain call.
- **Last gbrain code:** the last JSON `"code"` in the output of a gbrain call, or in any output that also has a `"fix"` field.
- **Infra:** `github-rate-limit` when a tool output shows GitHub answering 403, 429 or a rate limit, or an egress log line to a GitHub host has status 403 or 429.


## Real-image check

`real-image-check.sh` runs the four install-mode images, built from this tree, through the runner's own install trial with no provider key and no spend. A fake model upstream inside `real-image-check.ts` stands in for the model: the metering proxy forwards to it, and it answers with shell tool calls. Those calls install bun and gbrain for real, through the run's egress proxy, then wire gbrain into the harness the way gbrain's INSTALL_FOR_AGENTS.md says. Each command prints `HECHECK key=value` lines, which reach the fake in the next request.

It runs six install cases: Claude Code, Codex and OpenClaw on one model each, and Hermes on Anthropic, OpenAI and Particle. Each passes four checks:

- **a.** The harness's model call went through the metering proxy, with the trial token, to the fake.
- **b.** bun, gbrain and the setup command exited 0, and the harness's own `mcp list` names gbrain in a new conversation. On Codex and Hermes, which start MCP servers with the session, a gbrain serve process runs too.
- **c.** In both conversations the agent's shell could read the token file, yet no provider key variable is set and no variable holds the token. Only names and counts are printed.
- **d.** The brain path gbrain's config names matches the one the install probe and the install watcher recorded.

A seventh case, **WebFetch** on Claude Code, installs nothing. The fake model loads WebFetch with Claude Code's ToolSearch (Claude Code 2.1.312 declares WebFetch only after that), then calls it once on gbrain's INSTALL_FOR_AGENTS.md (raw.githubusercontent.com). It passes **a** and **fetch**: the page host was admitted by the egress proxy, the page reached a model request, and the tool result is not an error. It also reports, from the egress log, whether Claude Code's own domain check before a fetch (its preflight to api.anthropic.com or claude.ai) was blocked. The preflight is reported, never failed on: the blocklist refuses api.anthropic.com on purpose.

```bash
scripts/gbrain-install/real-image-check.sh --out ~/ric --tag v0.60.733.0   # build the images, run all seven cases
scripts/gbrain-install/real-image-check.sh --out ~/ric --tag v0.60.733.0 --skip-build --harness hermes
```

It needs Docker and internet access, so it runs on a fresh VM, not in CI. `--tag` names the gbrain release the run pins; without `--commit` it installs the commit that tag names now. The report is `<out>/real-image-check.json`: per case the four checks with their evidence, every marker, the trial's outcome and the run directory. Exit 0 means every case passed, here and with `--codex-semantic`. Tests: `bun test tests/gbrain-install-real-image-check.test.ts`.

## Known limits

- **OpenClaw:** tool calls and results come from the session export: assistant `toolCall` blocks paired with `toolResult` messages by `toolCallId`. OpenClaw drops a result's details past 8 KiB, so a long command's exit code can be missing (null). Without the session file, only tool names from the envelope's `meta.toolSummary` are available, with no input or output, so no OpenClaw gbrain call can show the fact.
- **Hermes:** `tool_result` output is cut at 5,000 characters, so a long terminal result may not parse as JSON; its exit code then comes from `is_error` only.
- Step times for save and recall are turn ends, not call times.

## Provenance

Ported from gbrain-evals `eval/runner/cat41/` at commit 4f27313a (MIT, same owner). Each ported file names its source in its first lines.

| Source file | sha256 | Used in |
|---|---|---|
| transcript.ts | 92a286dd5459ab66bf8d4e0fed1a72773c431948bcdfe845559d0e98923247d7 | transcript.ts (Claude Code and Codex parsers) |
| scenarios.ts | 36fba23ab39dad9c7bd40452b82c6f1185574f7ee005ad6f61038f01242aba4b | transcript.ts (norm), classify.ts (ASK_RE, INPUT_REQUEST_RE, closingBlock, asksForInput) |
| classify.ts | 42232d5a5f490c391ea7600b59d56f0e83d9d1d886bea66ac670d9035cfba068 | transcript.ts (gbrain CLI argv), classify.ts (structure); recalledViaMcp became isGbrainCall |
| tthw-verdict.ts | dba6e468d0a4861156e7c57cb73dc992a3900a64ba229ab9dbe4505ebd8282ec | verdict.ts (median, rounding, per-cell tally) |

Tests: `bun test tests/gbrain-install-scoring.test.ts` (fixtures in `tests/fixtures/gbrain-install/transcripts/`).
