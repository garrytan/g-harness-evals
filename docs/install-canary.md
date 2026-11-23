# The gbrain install canary

**What it is:** every new gbrain release gets installed, the way gbrain's own install guide says, by four stock agent harnesses: Claude Code, Codex, OpenClaw and Hermes. Then each one stores a fact in the new brain and reads it back.

**What it answers:** can an agent following `INSTALL_FOR_AGENTS.md` at this tag install gbrain and use it, in each harness, with that harness's own guard on? If not, which line broke, and did the guard refuse it or did gbrain fail?

**What it does not answer:** whether a real model would choose to follow the guide, or how well gbrain remembers. A scripted model sends the guide's lines one tool call at a time, so the canary tests the route and the harness, not the model. The regression canary ([canary.md](canary.md)) and the head-to-head evals cover the rest.

- Cost: no model calls (the scripted model answers through the metering proxy with dummy keys). One Ubicloud VM per run.
- Code: `scripts/install-canary/`. Tests: `tests/install-canary.test.ts`.
- Results: the org drive folder `handoffs/gbrain-install-canary/`, read by gbrain's severe-bug sweep before a release goes to stable.

## How one run works

1. **Pick releases** (`canary.ts select`): one GitHub call lists gbrain's releases. Every release with no final line in `index.jsonl` is a job, newest first, at most 4 per run. Older ones past the cap get a `skipped` line. The next stable candidate (`--candidate`) always runs, first. A release whose `gbrain-linux-x64` binary isn't uploaded yet waits up to 2 hours. When gbrain's `stable` tag has moved, one more job runs the guide exactly as written (`#stable`, `releases/latest`) from the guide on master.
2. **Run them on one VM** (`vm.sh`, through `scripts/ubicloud/ubi-runner.sh`): build the four install-mode harness images, then run `run-tag.ts` once per job.
3. **Per harness** (`run-tag.ts`):
   - Read the route from `INSTALL_FOR_AGENTS.md` at the tag (`routes.ts`): the Bun install block, the gbrain install, `gbrain init`, and the harness's own registration block. `#stable` and `releases/latest` are pinned to the tag under test.
   - Hermes follows the guide's rule: when the guide has a release-binary section, Hermes takes the binary route and the Bun route is run separately as a probe; before that, Hermes takes the Bun route.
   - Run the harness's install trial (`runner/trial/run.ts`, install mode) against the scripted model (`fake-model.ts`). It sends each line as one shell tool call, stops at the first line that is refused or fails, then saves a fact (`remember`) and asks for it back (`recall`) through the gbrain MCP tools the harness discovered (directly, or through the harness's own tool search).
   - Each tool call is a fresh shell, so the guide's earlier `export` lines are put in front of each later line, as they would be in one terminal session. The line the guard judges is otherwise the guide's line, byte for byte.
4. **Grade** from what happened, never from the reply: the tool results, the install probe, Hermes's guard log, and whether the recalled text holds the saved nonce.
5. **If a release fails**, the failing harnesses run again on the last passing release. Failing there too means the harness or environment changed, not gbrain: the line is `harness_or_env`.
6. **Publish** (`canary.ts publish`), post the commit statuses (below), then take down any VM left over and drop the lock.

## Verdicts

| Status | Meaning | `blocks_stable` | `promotable` |
|---|---|---|---|
| `pass` | every harness installed, listed the MCP tools, saved and recalled the fact | false | true (false for a `--harness` subset) |
| `fail` | a harness's guard refused a line, a line failed, or recall missed the fact, and the previous release passed; on the stable channel, also when a harness installed a different gbrain version than the stable tag | true | false |
| `harness_or_env` | it failed, but the previous release fails the same way now | false | false |
| `incomplete` | the run could not finish (VM, image build, timeout); retried up to 3 times | false | false |
| `skipped` | an older release past the 4-per-run cap; never tested | false | false |

`tested` is false only for `skipped`. Steps per harness: `doc_route`, `bun`, `binary`, `setup`, `mcp_listed`, `remember`, `recall`. A refused step carries the exact command and the guard's message; a failed one carries the exit code and gbrain's error code when it printed one.

## Where results go

`<private drive>/handoffs/gbrain-install-canary/`:

- `latest.json`: one index line. Read this first. It is this run's worst line when the run produced something other than a pass. Otherwise it is a release at or after the stable tag whose most recent line is still `fail`, so a failed candidate stays in view after a newer release passes. Otherwise it is the newest release's line.
- `index.jsonl`: one line per release, channel and run (schema `gbrain-install-canary/1`). Append-only.
- `runs/<tag>/result.json` and `summary.md`: the full result for a release. `runs/stable-<tag>/` for the stable-channel job.

Writes go per-release files first, then the index, then `latest.json`, each by rename, so a reader never sees half a file. A run holds `.lock` (run id and expiry) while it works. Publishing the same run twice adds nothing.

gbrain's maintainers are told about every `fail` and `harness_or_env`, and about `incomplete` twice in a row for the same release. `run.sh` prints those lines between `CANARY_NOTIFY_BEGIN` and `CANARY_NOTIFY_END`.

## Commit status

**Why it matters:** gbrain's daily stable promotion fails closed. From 2026-11-24 20:30Z it promotes a release to stable only when that release's commit has a `gbrain/install-canary` status of `success`. **No status means not tested yet, so stable waits.** A `failure` also holds stable.

`run.sh` posts the status on each tested release's commit in `garrytan/gbrain` (`canary.ts status`, through `gh api` with the machine's GitHub credential):

- **pending** when that release's job starts on the VM (`run.sh` watches the VM log for the job's start line). Only releases in this run's plan get one.
- **success** after publish, when the release was tested and is promotable.
- **failure** after publish, when it was tested and blocks stable or isn't promotable (`fail`, `harness_or_env`, `incomplete`). An `incomplete` run is no verdict, so when the release already has an earlier verdict, that verdict is posted again instead.
- **nothing** for a release that wasn't tested (`skipped`).

The description is `v<V> run <run id>: pass` or `v<V> run <run id>: fail <harness/step,...>` (`testing` while pending), at most 140 characters. A failure that names no harness names its status instead (`fail incomplete`), and a list too long to fit ends in `+<n>`. A release and its stable-channel job on the same commit post once: `failure` if either failed. There's no link: the results folder isn't public. A re-test posts again, and GitHub shows the newest status.

- **Who posts:** Capy machines post through Capy's GitHub app, so the status shows as `capy-ai[bot]`, the login gbrain accepts. `run.sh` reads the poster back from each reply and logs it.
- **When none is posted:** a `--harness` check (a few harnesses only; no verdict on the release) and a run whose results go to another `--dest` folder.
- **When a post fails:** `run.sh` prints a `CANARY_STATUS` line and exits 7, after the results are published. If publish itself fails, the releases keep this run's pending status, and `run.sh` prints a `CANARY_STATUS` line naming them. The automation forwards `CANARY_STATUS` lines. Repost by hand with `bun scripts/install-canary/canary.ts status --dest <results folder> --run-id <run id> [--tag <tag>]`.

## Guard modes

Each harness runs with the guard its install-mode image ships:

- **Claude Code:** `claude -p --permission-mode bypassPermissions`, the install eval's unattended mode. Its permission prompts can't refuse here.
- **Codex:** `approval_policy=never` with full access, also unattended.
- **OpenClaw:** shipped exec defaults.
- **Hermes:** shipped defaults: `hermes chat --oneshot`, `approvals.single_query_mode=deny`, Tirith pinned and offline. This is the guard that refused gbrain's pipe-to-shell Bun install at v0.60.734.0.

## What it does not check

- **PATH lines:** the adapters already put `~/.bun/bin` and `~/.local/bin` on PATH, so a guide that forgot an `export PATH` line would still pass.
- **Two image changes toward a stock install.** The canary changes two things in the harness images so they match what a person's own install looks like:
  - **Hermes:** the image keeps the `hermes` command only inside its virtualenv. Hermes's own installer links it into `/usr/local/bin`, so the canary adds that link. Without it, `gbrain setup hermes` can't find Hermes and skips the MCP registration.
  - **OpenClaw:** the image's `openclaw.json` has `//` comment lines explaining the eval's settings. A config OpenClaw writes itself has none, so the canary removes them. With them, gbrain's JSON5 reader fails on the first bare key after a comment line.
- **Hermes's `HERMES_HOME`:** the Hermes adapter keeps Hermes's state in a non-default `HERMES_HOME`, as Hermes profiles and its Docker image do. The canary leaves that alone, so a gbrain step that loses `HERMES_HOME` shows up as a failure.
- **Hermes's interactive mode:** only `--oneshot`.
- **New harness releases:** harnesses are pinned (`harnesses/*/Dockerfile`). A weekly run on the newest harness releases is not built yet: the images and adapters check their versions against the pins, so it needs changes there first.
- **Other platforms and routes:** Linux x64 only; no hosted gbrain.io route, no plugin routes, keyword brain only.

## Error codes

Every failure prints one code and a fix line. Codes are stable.

| Code | What happened | Retry |
|---|---|---|
| `CANARY_LOCKED` | another run holds the lock | next trigger |
| `CANARY_GITHUB` | the releases call failed | next trigger |
| `CANARY_LS_REMOTE` | `git ls-remote` on gbrain failed | next trigger |
| `CANARY_DOC_FETCH` | the guide couldn't be read at the tag | 3 incomplete tries |
| `CANARY_VM` | the VM couldn't be created or reached | 3 incomplete tries |
| `CANARY_IMAGE_BUILD` | a harness image didn't build | 3 incomplete tries |
| `CANARY_DRIVE_WRITE` | the drive write failed; results stay in `~/.capy/work/install-canary/<run id>` | by hand |
| `CANARY_VM_LEFT` | this run's VM was still up after the run; `run.sh` took it down | none |
| `CANARY_RUN_FAILED` | a job wrote no result | 3 incomplete tries |
| `CANARY_STATUS` | a commit status didn't post, or posted as a login gbrain doesn't accept; the results still published, `run.sh` exits 7 | by hand |

## Running it by hand

```bash
bash scripts/install-canary/run.sh                       # what the automation runs
bash scripts/install-canary/run.sh --tag v0.60.757.0     # one release again
bash scripts/install-canary/run.sh --dest /tmp/canary    # publish somewhere else
bash scripts/install-canary/run.sh --tag v0.60.757.0 --harness claude-code,codex   # some harnesses only (not promotable)
```

The same arguments (`--candidate`, `--tag`, `--max`, `--harness`, `--dest`) can be left in `request.args` in the results folder, one request per line. The next run claims the file by renaming it and runs the first line. Once it has published it puts the other lines back; if it stops before then, it puts every line back ahead of any request written in the meantime. That is how the next stable candidate gets tested first.

`run.sh` needs `UBICLOUD_API_KEY` and tags its VM with owner `installcanary`. To run one release on a machine that already has the images built: `bun scripts/install-canary/run-tag.ts --out /tmp/x --tag v0.60.757.0`.
