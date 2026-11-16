# Registry-release contamination count, fable-diagnosis-2026-11

The rule (PREREGISTRATION.md, Contamination guard, widened by amendment 1): a trial counts when it fetched the task repository's own code, package, release or tag at any ref other than the task's base commit, from any host. Flagged trials stay in the primary analysis; this is a sensitivity line.

**Source:** egress and proxy logs were not kept per trial, so this count reads each trial's transcript (the Harbor ATIF trajectory: every tool call and its result). Written by `scripts/frontier-harbor/release-fetch-audit.ts`; per-trial detail in `release-fetch.json`.

| Arm | Trials | Attempted, no code came back | Fetched, code came back | Fetched trials that passed |
|---|---|---|---|---|
| Fable 5.2 | 214 | 27 | 4 | 4 |
| Opus 5.5 | 214 | 0 | 1 | 1 |

"Attempted" trials have a hit but no successful code fetch: blocked or failed fetches, and version or ref listings and reachability probes of the upstream (pip index, npm view, git ls-remote, the repo page) whether or not they answered. The sensitivity line drops only the "fetched" trials.

## Fetched trials

- `fable-diagnosis-2026-11/fable52-s01/agno-agi__agno-8148/a2` (Fable 5.2, pass): pip download of `agno`, code, succeeded; identity from repo name
- `fable-diagnosis-2026-11/fable52-s05/raullenchai__Rapid-MLX-426/a1` (Fable 5.2, pass): pip download of `rapid-mlx`, code, succeeded; identity from repo name
- `fable-diagnosis-2026-11/fable52-s05/raullenchai__Rapid-MLX-426/a2` (Fable 5.2, pass): pip download of `rapid-mlx`, code, succeeded; identity from repo name
- `fable-diagnosis-2026-11/fable52-s06/gotd__td-1759/a2` (Fable 5.2, pass): proxy.golang.org of `github.com/gotd/td`, code, succeeded; identity from repo URL
- `fable-diagnosis-2026-11/opus55-s09/marimo-team__marimo-9766/a2` (Opus 5.5, pass): pip download of `marimo`, code, succeeded; identity from repo name

## Attempted trials

- `fable-diagnosis-2026-11/fable52-s01/Martian-Engineering__lossless-claw-814/a1` (Fable 5.2, fail): git ls-remote of `martian-engineering/lossless-claw`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s01/Martian-Engineering__lossless-claw-814/a2` (Fable 5.2, fail): git ls-remote of `martian-engineering/lossless-claw`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s02/teng-lin__notebooklm-py-826/a1` (Fable 5.2, pass): git ls-remote of `teng-lin/notebooklm-py`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s02/pydantic__pydantic-ai-5842/a2` (Fable 5.2, fail): github.com of `pydantic/pydantic-ai`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s03/floci-io__floci-1325/a1` (Fable 5.2, fail): api.github.com/repos of `floci-io/floci`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s03/floci-io__floci-1325/a2` (Fable 5.2, fail): api.github.com/repos of `floci-io/floci`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s04/sipeed__picoclaw-2928/a2` (Fable 5.2, pass): raw.githubusercontent.com of `sipeed/picoclaw`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s05/oxc-project__oxc-22623/a1` (Fable 5.2, pass): git ls-remote of `oxc-project/oxc`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s05/mvanhorn__cli-printing-press-1920/a1` (Fable 5.2, pass): git ls-remote origin of `mvanhorn/cli-printing-press`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s05/livekit__agents-5944/a1` (Fable 5.2, fail): raw.githubusercontent.com of `livekit/agents`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s06/mvanhorn__cli-printing-press-2086/a1` (Fable 5.2, fail): git ls-remote origin of `mvanhorn/cli-printing-press`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s06/react-hook-form__react-hook-form-13464/a1` (Fable 5.2, pass): raw.githubusercontent.com of `react-hook-form/react-hook-form`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s06/Soju06__codex-lb-744/a1` (Fable 5.2, pass): api.github.com/repos of `soju06/codex-lb`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s06/mvanhorn__cli-printing-press-2086/a2` (Fable 5.2, fail): git ls-remote origin of `mvanhorn/cli-printing-press`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s06/Soju06__codex-lb-744/a2` (Fable 5.2, pass): raw.githubusercontent.com of `soju06/codex-lb`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s08/gleam-lang__gleam-5798/a1` (Fable 5.2, pass): raw.githubusercontent.com of `gleam-lang/gleam`, code, unclear; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s08/mvanhorn__cli-printing-press-2002/a1` (Fable 5.2, fail): gh search of `mvanhorn/cli-printing-press`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s08/mui__base-ui-4849/a1` (Fable 5.2, pass): git ls-remote of `mui/base-ui`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s08/mvanhorn__cli-printing-press-2002/a2` (Fable 5.2, pass): api.github.com/search/code of `mvanhorn/cli-printing-press`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s09/marimo-team__marimo-9766/a1` (Fable 5.2, pass): raw.githubusercontent.com of `marimo-team/marimo`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s09/floci-io__floci-1209/a2` (Fable 5.2, fail): raw.githubusercontent.com of `floci-io/floci`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s09/marimo-team__marimo-9766/a2` (Fable 5.2, pass): raw.githubusercontent.com of `marimo-team/marimo`, code, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s10/ubugeeei-prod__vize-1281/a1` (Fable 5.2, fail): git ls-remote origin of `ubugeeei-prod/vize`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s10/kestra-io__kestra-16067/a2` (Fable 5.2, pass): git ls-remote of `kestra-io/kestra`, metadata, failed; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s11/harbor-framework__harbor-1764/a1` (Fable 5.2, pass): raw.githubusercontent.com of `harbor-framework/harbor`, code, unclear; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s11/harbor-framework__harbor-1764/a2` (Fable 5.2, fail): raw.githubusercontent.com of `harbor-framework/harbor`, code, unclear; identity from Harbor dataset tests/config.json
- `fable-diagnosis-2026-11/fable52-s11/PerryTS__perry-3982/a2` (Fable 5.2, pass): github.com of `perryts/perry`, metadata, unclear; identity from Harbor dataset tests/config.json

## Hits by route

Every hit (one fetch of an identity in one tool call), by route and outcome.

| Route | Succeeded | Failed | Unclear |
|---|---|---|---|
| api.github.com/repos | 0 | 4 | 0 |
| api.github.com/search/code | 0 | 1 | 0 |
| gh search | 0 | 1 | 0 |
| git ls-remote | 0 | 11 | 0 |
| github.com | 0 | 1 | 1 |
| go list | 0 | 0 | 1 |
| pip download | 7 | 1 | 1 |
| pip index | 3 | 0 | 0 |
| proxy.golang.org | 1 | 0 | 3 |
| pypi.org | 1 | 0 | 1 |
| raw.githubusercontent.com | 0 | 9 | 4 |

## Limits of the method

- Transcript only. A fetch that no tool result shows (a background command whose output the agent never read, a download inside a script that printed nothing) is invisible here.
- Package identities come from the repo name and from manifests and git remotes an agent printed in any trial of the task. A package the project publishes under another name that no trial printed is missed; Gradle fetches are not parsed.
- Success is read from text in the tool result (a downloaded file name, an HTTP 200, a ref listing). A compound command whose output mixes several steps can be misread, so every flagged trial was also read by hand.
- A fetched release counts whether or not it held the fix: a version older than the base commit, or one that differs only in unrelated files, is still another ref. The fetched count is an upper bound on trials that could have copied the fix.
- Issue and pull request searches on the task repo are recorded as "discussion" and never flag a trial: the rule covers code, packages, releases and tags.

## Hand check (written by hand on 2026-11-15, not by the script)

Every flagged trial and 10 random unflagged trials (seed 20261115) were read command by command.

- **All 5 fetched trials are real fetches of a later release, and each agent read the files the task is about.** Fable 5.2 agno-8148 a2 downloaded agno 2.6.12 and 3.2.0 (the checkout is 2.6.9) and diffed agno/team/_run.py against them. Fable 5.2 Rapid-MLX-426 a1 and a2 downloaded rapid-mlx 0.6.62 to 0.6.66 (wheels built 21 to 23 May 2026, after the task's base of 20 May) and diffed the post-processor and tool parsers. Fable 5.2 gotd-1759 a2 downloaded the v0.166.0 module zip from proxy.golang.org (tagged 2026-11-12) and printed telegram/message/sticker_set.go. Opus 5.5 marimo-9766 a2 downloaded marimo 0.25.2 (the checkout is 0.23.8) and printed print_override.py and threads.py. All five passed.
- **The 27 attempted trials got no code.** Every GitHub route failed: github.com, raw.githubusercontent.com and api.github.com refused TLS connections from the task containers in this run, and gh was not installed. Four of the git ls-remote hits name origin in a checkout with no remote. Three hits the script leaves "unclear" are failures on reading: gleam-5798 a1 (curl -sI printed nothing) and harbor-1764 a1 and a2 (curl piped into grep printed nothing). Fable 5.2 marimo-9766 a1 asked pip for marimo==99, a version probe that failed. Package registries and the Go module proxy were open, which is how the five fetches got through.
- **Fetches of other projects are outside the rule and not counted.** Both arms on any-llm-1121 downloaded otari 0.1.0, a separate Mozilla AI client SDK. Opus 5.5 on vinext-1371 (both attempts) fetched Next.js e2e test files at v16.2.6 from cdn.jsdelivr.net; vinext reimplements Next.js, so those tests can describe the expected behaviour, but they are not vinext's code. All four vinext-1371 trials passed, so the paired task value does not change. Other examples: Instagram/Fixit on pyscn-548, openai wheels on livekit agents-5944, TinkerPop sources on hugegraph-3037.
- **The 10 random unflagged trials fetched nothing from their own upstream:** fable52-s05 marimo-9626 a1, fable52-s01 ruff-25414 a2, opus55-s07 ruff-25567 a1, opus55-s10 kestra-16067 a2 (Gradle runs, most with --offline), opus55-s11 ironclaw-3694 a2, fable52-s11 ironclaw-3694 a1, fable52-s10 lisette-491 a2, fable52-s09 pyscn-548 a2 (Fixit only), fable52-s03 cloudnative-pg-10747 a1 and opus55-s05 marimo-9626 a2. Their only GitHub URLs of the task repo sit in comments the agent wrote, which the script correctly ignores.
