# Cursor CLI harness

**The Cursor Agent CLI (`agent`) `2026.11.05-86047df`, on Claude Opus 5.5 only, with no metering proxy.** Cursor has no bring-your-own-key for the CLI: every model call goes to Cursor's backend with `CURSOR_API_KEY`. So this harness is an approved exception to methodology item 3. Its cost comes from Cursor's usage export, not from our ledger.

**Every Cursor-specific detail here comes from public sources only** (see [Clean-room rebuild](#clean-room-rebuild-2026-11-09) below). Nothing comes from the CLI's JavaScript.

- **Install.** The linux-x64 package from `downloads.cursor.com`, pinned by sha256 in [pin.json](pin.json) and the [Dockerfile](Dockerfile), unpacked under `/opt/harness` on `node:24-bookworm-slim`. The install script at `cursor.com/install` changes per release, so its steps are reproduced at the pinned URL instead of piping it into bash. The build checks the package and launcher sha256 and `agent --version`.
- **Plan tier.** Premium: the plan that adds third-party models at API list price ([Models & Pricing](https://cursor.com/docs/models-and-pricing)).
- **Model.** Cells must be `anthropic:claude-opus-5-5`. The CLI gets `--model 'claude-opus-5-5[effort=high,fast=false]'`. Any other model is refused at plan, preflight, run and in the adapter (HE-CURSOR-001).
- **Effort: high.** Set through the bracket override that `agent --help` documents, as the brief for new harnesses asks. Other harnesses here run medium, so compare across harnesses with that in mind. Fast mode is off, so the priced model is the standard one.

## How a turn runs

- **`run`** is one turn: `agent -p --output-format stream-json --force --trust --approve-mcps --workspace /workspace --model <turn model> --disable-auto-update -- <prompt>`.
- **`serve`** runs the same command per `TurnRequest`. The first turn of a conversation (`dm:<member>`, `channel:<id>`, plus `:t<thread_ts>`) starts a chat; later turns pass `--resume <chat id>` from `/harness-state/cursor-chats.json`.
- **The reply** is the `result` field of the stream's success `result` record.
- **Exit mapping.** 0: a success result and an init record whose model is `Claude Opus 5.5` (the display name, exact match). 124: over the turn budget. 3: no result and "Failed to reach the Cursor API" on stderr. 2: anything else, any other backend error included.
- **Logs.** Each turn's stream-json goes to `turns/turn-NNNN.cursor.jsonl` and its stderr to `.stderr.log`. `.status.json` counts tool calls. **Tokens: unavailable.** The documented stream-json records carry no token counts, so `usage` is null.
- **MCP.** `world` (and `gbrain` when set) go into `$HOME/.cursor/mcp.json` (mode 0600) with the bot token as a bearer. The adapter checks `tools/list` before ready.
- **Config.** [config/cli-config.json](config/cli-config.json) goes to `$HOME/.cursor/cli-config.json`. The adapter unsets `CURSOR_CONFIG_DIR` and `XDG_CONFIG_HOME`, which would move it.

## Keys

- **`CURSOR_API_KEY` exists only on the launcher's machine.** It is not a project variable. The runner moves it out of its own environment at start, so no child process inherits it. Only the Cursor container's `docker run` gets it, by name (`-e CURSOR_API_KEY`), never in argv.
- **The docs don't say whether the agent's shell tool sees the CLI's environment.** So we assume it may, and two things keep the key out of artifacts:
  - the CLI's stdout and stderr pass through [redact.cjs](redact.cjs), which replaces the literal value;
  - after every trial the runner scans the trial directory for the value (whole, first 16, last 12 characters, gzip decoded). A hit stops the run (HE-CURSOR-003). The scan never prints the value.
- **Shard level.** `scripts/run-shard.sh` refuses a Cursor shard without the key (exit 2), runs `bun scripts/cursor/key-scan.ts selfcheck` first, and scans `<out>` after the run (exit 5 on a hit).
- **Ubicloud.** `scripts/ubicloud/run-shard.sh` sends the key over SSH into the same 0600 file as the other keys, which the launcher reads and deletes. On the VM, `vm-shard.sh` keeps it unexported and hands it by name to the run step it starts: `scripts/frontier-harbor/vm-run.sh` on the frontier-harbor workload (the codegen cell), `scripts/run-shard.sh` on the multi-user workload. The controller scans every pull for the value and stops mirroring on a hit.
- **Public export.** `CURSOR_API_KEY` is in `KEY_NAMES`. An export run without it reports the key as not checked (advisory); the scans above cover Cursor results where the key lives.

## Network

- **Internal network only** (HE-CURSOR-002 otherwise). The runner starts a CONNECT allowlist on the network's gateway. The container uses it through `HTTP_PROXY`, `HTTPS_PROXY` and `NODE_USE_ENV_PROXY=1`, the variables Cursor's proxy docs name.
- **Allowed on 443:** `api2.cursor.sh` (the CLI's default endpoint, per `agent --help`) and `api5.cursor.sh` with its six `agent*.api5.cursor.sh` subdomains (Cursor's network page: "agent requests").
- **Denied and logged:** everything else, including the hosts that page lists for Tab (`api3`, `api4`, `*.gcpp.cursor.sh`), codebase search (`repo42.cursor.sh`) and client updates (`downloads.cursor.com`).
- **Every decision** is a line in `egress.ndjson` beside the manifest, with the trial id. No header is logged. Which allowed hosts the CLI really uses shows up first in the keyed smoke's log.

## Web tools

- **Web fetch: denied** by `permissions.deny: ["WebFetch(*)"]`. `agent --help` says `--force` allows commands "unless explicitly denied". The permissions page says deny rules win.
- **Web search: no documented off switch.** `autoAcceptWebSearch: false` keeps the CLI's default (CLI changelog, v2026.07.13). But no public source says what `--force` does with a search, so a search may run.
- **Removed:** the first build's `--exclude-tools` flag, its tool names and its `--force` claim. All three came from the CLI's JavaScript.
- **Audit (plan item F1):**
  - the adapter writes `$HOME/.cursor/hooks.json` with `postToolUse` and `postToolUseFailure` hooks ([hooks docs](https://cursor.com/docs/hooks)). [tool-audit-hook.cjs](tool-audit-hook.cjs) logs each call's `tool_name` (and `failure_type`) to `tool-hooks.ndjson`, nothing else, and answers `{}`;
  - `bun scripts/cursor/web-tool-audit.ts <trials.jsonl>` flags a trial with a `tool_name` outside the documented values (`Shell`, `Read`, `Write`, `Grep`, `Delete`, `Task`, `MCP:<tool>`), tool calls in the stream but none in the hook log, or a denied host outside `*.cursor.sh`. It exits 1 when any trial is flagged;
  - a reader confirms from the logs whether a flagged call was a web call.
- **Can't run counted trials if:** the first keyed smoke shows tool calls in the stream and none in `tool-hooks.ndjson`. Then no documented event shows a web call. pin.json `web_tools.status` says the same.

## Instruction files

Before ready, the adapter lists every name Cursor's docs say it loads on its own, under `/workspace` and `$HOME`:

- `AGENTS.md` (any directory) and `CLAUDE.md` ([rules](https://cursor.com/docs/rules), [CLI](https://cursor.com/docs/cli/using));
- `.cursor/` (rules, skills, hooks, MCP and CLI config);
- `.agents/`, `.claude/` and `.codex/` (skills, agents, Claude Code hooks: [skills](https://cursor.com/docs/skills), [subagents](https://cursor.com/docs/subagents), [third-party hooks](https://cursor.com/docs/reference/third-party-hooks));
- `.cursorignore` ([agent security](https://cursor.com/docs/agent/security)).

The list goes to `instruction-files.json` and `ready`. Any hit is exit 2 (HE-CURSOR-004). The first build also listed `CLAUDE.local.md`, `.cursorrules` and `.[name withheld]/`; no public Cursor source names them, so they are gone.

**Not visible here:** account-level User Rules and Memories live on Cursor's servers. The dedicated account must have none.

## Cost

- **Source:** the account's usage export (dashboard, Usage, export CSV).
- **Columns:** Cursor's docs don't list them. So the script hard-codes none. It reads the header at run time: `--header` prints it, and `--columns <file>` declares it from the first real export (every column, plus which ones are the date, the cost and the model). A column the file doesn't declare fails the script (exit 2).
- **Attribution:** `bun scripts/cursor/usage-export.ts --csv <export.csv> --columns <columns.json> --trials <trials.jsonl> [--out cost.json]` gives each row to the trial whose time window holds it and sums per cell. Rows between trials or in two windows are reported apart.
- **Label:** unreconciled. No proxy record exists to check it against.
- **Fails loudly** (exit 2) on no columns file, a changed column set, an "Included" cost or a date that doesn't parse.

## Running it

- **Keyless check:** `bash scripts/cursor/install-check.sh [--out <dir>]`. It runs the key-list selfcheck, the pin check, the image build and version, and one offline trial: a canary key, no egress host, the CLI denied at its first CONNECT to `api2.cursor.sh`, the canary not found afterwards.
- **Keyless rehearsal of a shard:** `scripts/run-shard.sh ... --cursor-offline`.
- **Counted shard:** needs `CURSOR_API_KEY` in the launcher's shell, Cursor cells only, `"network": "internal"`. The Ubicloud lane (`scripts/ubicloud/run-shard.sh`) refuses a keyed Cursor shard and sends the key to no VM, because no lease can cap Cursor's spend; only `--cursor-offline` runs there.

## Terms

Cursor's terms (1.5 (vii)) allow publishing benchmark results of the Service only with "all necessary information for others to replicate the tests". Every published Cursor result ships with:

- **CLI version:** `2026.11.05-86047df` (package and launcher sha256 in [pin.json](pin.json));
- **flags:** `-p --output-format stream-json --force --trust --approve-mcps --workspace /workspace --model 'claude-opus-5-5[effort=high,fast=false]' --disable-auto-update [--resume <chat id>]`;
- **plan:** Premium; **model id:** `claude-opus-5-5`, effort high, fast off;
- **adapter source:** this directory ([adapter.sh](adapter.sh), [config/cli-config.json](config/cli-config.json), [tool-audit-hook.cjs](tool-audit-hook.cjs)) at the run's commit;
- the preregistration, the task set and the commands above.

### Harbor codegen cell

**The internal-task TB2.1 codegen cell (Opus 5.5, 3 x 52) runs this CLI through Harbor, not through adapter.sh.** Same pinned package, config and model id; the differences are listed here and in every trial's `harness_settings.json` (`differences_from_pin`).

- **Class:** `FrontierCursor` in [scripts/frontier-harbor/agents.py](../../scripts/frontier-harbor/agents.py), on Harbor's `BaseInstalledAgent`. Harbor 0.24.0 also ships a Cursor class (`cursor_cli.py`); it isn't used or subclassed, because it installs from the moving `curl cursor.com/install`, reads `CURSOR_API_KEY` from Harbor's own environment and parses stream records our rebuild removed.
- **CLI version:** `2026.11.05-86047df`, installed in the task container as root from the pinned package URL, both sha256 values checked, `agent --version` checked.
- **Flags:** `-p --output-format stream-json --force --trust --workspace <task working directory> --model 'claude-opus-5-5[effort=high,fast=false]' --disable-auto-update`. No `--approve-mcps` (no MCP server) and no `--resume` (one turn).
- **Plan:** Premium; **model id:** `claude-opus-5-5`, effort high, fast off; the stream's init record must name Claude Opus 5.5 (else HE-CURSOR-001, the trial excluded pairwise).
- **Config:** [config/cli-config.json](config/cli-config.json) at `$HOME/.cursor/cli-config.json`, and `hooks.json` with `postToolUse` and `postToolUseFailure` running [cursor-tool-hook.sh](../../scripts/frontier-harbor/cursor-tool-hook.sh), a POSIX sh port of [tool-audit-hook.cjs](tool-audit-hook.cjs) (a task image may have no node).
- **Key:** `CURSOR_API_KEY` reaches only the Cursor task container, as a 0600 file the turn reads and deletes before the CLI starts. Output is redacted line by line, and `--out` is scanned for the value after the run (HE-CURSOR-003).
- **Egress:** Harbor's blocklist sidecar with the Cursor profile (`scripts/frontier-harbor/pin.json` `egress.cursor_cells`): Cursor's API hosts and `downloads.cursor.com` reachable, its Tab and codebase-search hosts refused. Every other cell is refused `cursor.sh` and `downloads.cursor.com`.
- **Cost:** the usage export by trial window, per cell, unreconciled, left out of the rankings.
- **Adapter sources:** [scripts/frontier-harbor/](../../scripts/frontier-harbor/) (`agents.py`, `frontier_settings.py`, `cursor-tool-hook.sh`, `egress.py`, `egress-sidecar/`) plus this directory's `pin.json`, `cli-help.txt` and `config/`, at the run's commit. The sources are the same three as the clean-room rebuild below.
- **Terms 1.5(vii):** a published result of this cell ships with all of the above, the preregistration and the task pin (`scripts/frontier-harbor/pin.json`).

## Clean-room rebuild (2026-11-09)

**What and why.** The first build read the CLI's shipped JavaScript to find flags and hosts. Cursor's terms, section 1.5(i), forbid decompiling. We ruled that the adapter is rebuilt from public sources before any counted Cursor trial. This rebuild keeps only what one of three allowed sources supports:

1. Cursor's public docs on cursor.com/docs;
2. the CLI's own `--help` and `--version` output in the pinned image, with no key;
3. what the CLI did at run time with no key (files it wrote, hosts it tried).

Our own repository parts stay as they were: key forwarding, `KEY_NAMES`, the literal-value key scan, the time-window attribution of usage and the runner wiring.

**Removed** (JavaScript only, no allowed source found): `--exclude-tools` and its four tool names; the stream keys for web tools and the `interaction_query` records; the `usage` records and their token fields; the Connect error strings and "Authentication failed"; `api3.cursor.sh` as a metrics host; the statsig hosts; the `--force`-approves-web-search claim; `CURSOR_FORCED_SHELL_EGRESS` and the sandbox notes; the shell-environment claim; `CLAUDE.local.md`, `.cursorrules`, `.[name withheld]/`; the token-cache claim; the guessed `opus[ -]?5[.-]5` pattern; the usage-export column names.

**Docs read on 2026-11-09 (UTC)**, each fetched as its `.md` form from the index at https://cursor.com/llms.txt:

| URL | Used for |
| --- | --- |
| https://cursor.com/docs/cli/installation | install command (`curl https://cursor.com/install`) |
| https://cursor.com/docs/cli/reference/parameters | `-p`, `--output-format`, `--force`, `--trust`, `--approve-mcps`, `--workspace`, `--model`, `--resume`, `--api-key`/`CURSOR_API_KEY` |
| https://cursor.com/docs/cli/headless | `-p --force` for scripts, `CURSOR_API_KEY` for headless auth |
| https://cursor.com/docs/cli/reference/output-format | stream-json records: `system`/`init` (`model` is the display name, `session_id`, `apiKeySource`, `permissionMode`), `tool_call` `started` shape, `result` fields (`subtype`, `is_error`, `result`, `session_id`, `request_id`, `duration_ms`) |
| https://cursor.com/docs/cli/reference/configuration | `~/.cursor/cli-config.json`, required fields, `notifications`, `hints`, `sandbox.mode`, `CURSOR_CONFIG_DIR`/`XDG_CONFIG_HOME`, proxy variables incl. `NODE_USE_ENV_PROXY=1` |
| https://cursor.com/docs/cli/reference/permissions | `Mcp(server:tool)`, `WebFetch(*)`, deny wins over allow |
| https://cursor.com/docs/cli/changelog | `--disable-auto-update` (January 2026), `autoAcceptWebSearch` (v2026.07.13), CLI runs hooks (January 2026), skills from `.claude`/`.agents`/`.codex` (March 2026) |
| https://cursor.com/docs/cli/using | CLI reads `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` |
| https://cursor.com/docs/rules | `AGENTS.md` in root and subdirectories, `.cursor/rules` |
| https://cursor.com/docs/skills | `.agents/skills`, `.claude/skills`, `.codex/skills` (project and HOME) |
| https://cursor.com/docs/subagents | `.claude/agents`, `.codex/agents` |
| https://cursor.com/docs/reference/third-party-hooks | `.claude/settings.json` hooks |
| https://cursor.com/docs/agent/security | `.cursorignore`; tools contact "web search providers" |
| https://cursor.com/docs/mcp | `~/.cursor/mcp.json`, `mcpServers` with `url` and `headers` |
| https://cursor.com/docs/hooks | `~/.cursor/hooks.json`, `postToolUse`, `postToolUseFailure`, `tool_name`, matcher values |
| https://cursor.com/docs/enterprise/network-configuration | `api2` (most API), `api5` and agent subdomains (agent), `api3`/`api4`/`gcpp` (Tab), `repo42` (codebase search), `downloads.cursor.com` (updates) |
| https://cursor.com/docs/models-and-pricing | Claude Opus 5.5 row and `claude-opus-5-5-fast`; Premium plan |

Also read that day and not cited: cli/overview, cli/shell-mode, cli/github-actions, cli/mcp, cli/reference/authentication, cli/reference/slash-commands, cli/reference/terminal-setup, agent/overview, agent/security/run-modes, agent/tools/terminal, agent/tools/search, account/teams/dashboard, account/teams/analytics, account/teams/admin-api, enterprise/privacy-and-data-governance, enterprise/endpoint-security, plugins, reference/ignore-file, reference/sandbox, agent-sdk pages. No docs.cursor.com page was needed.

**CLI output (source 2).** Every command and its output is in [cli-help.txt](cli-help.txt), captured as `docker run --rm --network none --entrypoint agent -e HOME=/tmp/h harness-eval/cursor:dev <args>` with `--version` (prints `2026.11.05-86047df`), `--help` and `--help` of `agent`, `mcp`, `sandbox`, `models`, `status`, `about`, `update`, `ls`, `resume`, `create-chat`. From it: `-e/--endpoint` defaults to `https://api2.cursor.sh`; the bracket override example; `--sandbox` choices; `--force` "unless explicitly denied".

**Run time, no key (source 3).**

- `agent -p --output-format stream-json --trust "say hi"` in a fresh HOME with no network and no key wrote [cli-config.observed.json](cli-config.observed.json) (`autoAcceptWebSearch: false`, `sandbox.mode: "disabled"` among its defaults) and `.cache/cursor-compile-cache/`, and printed "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable."
- The install check's offline trial: the CLI tried `api2.cursor.sh:443` only (`egress.ndjson`, 4 denials over 2 turns), printed "Failed to reach the Cursor API. Check that your proxy (...) is reachable.", and accepted `--disable-auto-update`.
