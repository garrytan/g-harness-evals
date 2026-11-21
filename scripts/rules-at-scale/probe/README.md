# What does my agent actually send from my rules file?

**Run one command and see how much of your CLAUDE.md, AGENTS.md or GEMINI.md reaches the model.** Some coding agents cut long rules files without telling the model. This tool shows you where the cut falls on your own file. It needs no API key and spends nothing.

- It starts a fake model server on your machine that records each request and answers "ok".
- It copies your file into a fresh, empty git repository under the name your agent reads, and runs the agent there for one turn.
- It then checks each line of your file against what the agent sent, and tells you which lines arrived.

## Quick start

You need Node.js (with npm), Python 3, git and bash. Then, from this repository's root:

```bash
bash scripts/rules-at-scale/probe/probe.sh codex path/to/your/AGENTS.md
```

The first run installs the agent with npm into `~/.cache/rules-probe` (set `RULES_PROBE_CACHE` to change that). Swap `codex` for `claude-code`, `gemini-cli`, `pi`, `openclaw` or `hermes`.

You get something like this (a 160 KB AGENTS.md on Codex 0.170, in our own run):

```text
harness: codex   rules file: AGENTS.md (163,840 bytes, 150,715 characters, 1,865 lines checked)
requests captured: 1; checked the one holding the most of your file (73,694 bytes)
lines that arrived word for word: 378 of 1,865 (20.3%)
first line arrived: yes; last line arrived: no
first line that did not arrive: line 871: > **High Caution Execution Policy**
missing line ranges: 871-896, 902-3144, 3148-4058
```

That says Codex sent only the start of the file. Everything from line 871 on never reached the model. A few later lines show up as "arrived" only because the same words appear in Codex's own prompt.

## What we have seen so far

Measured with this tool and its earlier version, November 2026, one turn each. The Codex 0.170 and Claude Code 2.1.328 rows were re-checked with this version on a 160 KB file:

| agent | file it reads | what happens to a 160 KB file | setting that sends it all |
|---|---|---|---|
| Codex 0.165 and 0.170 | AGENTS.md | keeps the first 32,768 bytes, cut mid-line, no note to the model | `project_doc_max_bytes = 262144` |
| OpenClaw 2026.11.5 | AGENTS.md in its workspace | keeps the first 9,000 and last 3,000 characters plus a digest of headings and bullets, and tells the model it cut the file | `bootstrapMaxChars` and `bootstrapTotalMaxChars` |
| Hermes (main) | AGENTS.md | keeps the start and end of a budget tied to the model's context window, and tells the model where the full file is | `context_length` (or `context_file_max_chars`) |
| Claude Code 2.1.312 and 2.1.328 | CLAUDE.md | sends it whole; 2.1.328 drops HTML comments (`<!-- ... -->` lines never arrive) | none needed |
| Pi 1.5.0 | AGENTS.md | sends it whole | none needed |
| Gemini CLI 0.69.0 | GEMINI.md | sends it whole, and rewrites any `@path` text as an import | none needed |

These change with each release, which is why the tool exists: run it on the version you use.

## Options

- `--version V`: install that npm version instead of the latest.
- `--bin PATH`: use an agent you already installed. For Pi, point it at `dist/bundle/cli.js` inside the package.
- `--out DIR`: keep everything in DIR: `capture/` holds each recorded request as JSON, `stdout.txt` and `stderr.txt` the agent's output (Codex 0.170 prints its cut warning there), `repo/` the test repository.
- `--extra-config TEXT`: one extra setting, to check that raising a limit works. Codex takes a TOML line (`'project_doc_max_bytes = 262144'`). OpenClaw takes JSON text added after its model entry (`', "bootstrapMaxChars": 200000, "bootstrapTotalMaxChars": 300000'`). Hermes takes a YAML line under `model:` (`'  context_length: 1000000'`).
- `--port N`: the fake server's port (default 18089).
- For a machine-readable result, run `python3 scripts/rules-at-scale/probe/report.py --rules FILE --capture OUT/capture --json`.

## Hermes

Hermes is not on npm. We ran it from source: clone `NousResearch/hermes-agent`, make a Python 3.14 virtual environment in it (its dependencies require 3.14; on 3.12 it installs without them and fails at start), install the package into that environment, and pass `--bin <that environment>/bin/hermes`. Its cut depends on the context window the endpoint reports. The fake server reports none, so Hermes falls back to its default; use `--extra-config '  context_length: 200000'` to see what a 200K-token model gets.

## Limits

- **One turn only.** The tool does not show whether an agent re-sends, re-reads or re-cuts the file on later turns or after it compacts the conversation.
- **Word-for-word matching.** A line counts as arrived only when the request holds it exactly. Lines that are short (under 12 characters) or repeated in your file are not checked, because they could match the agent's own text. An agent that reformats your file would show lines as missing.
- **Started from the repository root.** Agents that load rules files from subfolders do it only when started there or when they touch that folder, so a nested file will not show up.
- **Fake provider path.** Each agent talks to the fake server through its custom-provider settings, not its built-in provider. How it loads rules files should not depend on that, but we have not checked every agent's built-in path.
- The agent runs with a fake key (`sk-fake`) and an isolated home folder, under `env -i`, so it never sees your real keys or settings. The fake server records request bodies only, never headers.

## Files

- `probe.sh`: sets up the repository, installs and runs the agent.
- `fake_server.py`: the recording fake model (OpenAI Responses, Anthropic Messages, Chat Completions and Gemini).
- `report.py`: the line check.

These are a cleaned-up port of the scripts behind our first probe (November 2026). That probe placed marker lines at fixed byte offsets in a generated file; this version checks your own file line by line instead.
