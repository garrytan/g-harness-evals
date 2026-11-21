# Rules-at-scale harness wiring

This folder runs each coding agent with a rules file (CLAUDE.md, AGENTS.md or GEMINI.md) of a chosen size and shape, so the eval can ask: does the agent still follow its rules as the file grows?

**Takeaways**

- Every harness runs at its newest release, pinned in `pin.json`. `pin-check.ts` checks the pin and the installed version, and a trial on any other version stops before the agent starts.
- The wiring never edits the frontier Harbor classes. `agents_rules.py` subclasses them and adds one `rules` kwarg. A job without it runs the frontier class unchanged, at our pinned version.
- Two harnesses cut a 160 KB rules file by default: Codex keeps the first 32,768 bytes, and OpenClaw truncates with its own markers. Claude Code, Pi, Gemini CLI and Hermes (at Opus's 1M window) send it whole. The measured map is in `map/README.md`.

## Files

| file | what it does |
|---|---|
| `pin.json` | Newest release of each harness, with its npm integrity (Hermes: its git commit) and what changed from the frontier pin. |
| `pin-check.ts` | Checks the pin's shape and matches an installed version string against it. |
| `rules_wiring.py` | All the logic, with no Harbor import: which arms a harness can run, where each file goes, the cut-lifting settings, the hook route, the launch checks and the QM helpers. CLI: `plan`, `cant-run`, `materialize`, `version`. |
| `agents_rules.py` | The Harbor classes: `RulesClaudeCode`, `RulesCodex`, `RulesHermes`, `RulesOpenClaw`, `RulesPi`, `RulesGeminiCli`, and the `RulesQm` stub. |
| `hooks/rules-hook.py` | Prints the six rules once, in each harness's hook output shape. |
| `hooks/openclaw-rules-plugin/` | OpenClaw plugin `he-rules-hook`, which adds the six rules through `before_prompt_build`. |
| `map/` | The keyless delivery map. See `map/README.md`. |

## A job

```json
{"import_path": "agents_rules:RulesClaudeCode", "model_name": "anthropic/claude-opus-5-5",
 "kwargs": {"version": "2.1.328", "broker_url": "http://127.0.0.1:8791", "cell": "...", "attempt": 1,
            "rules": {"arm": "b160k", "files_dir": "<run>/rules/claude-code/b160k"}}}
```

Put `scripts/frontier-harbor` and `scripts/rules-at-scale` on `PYTHONPATH`. `files_dir` is the materializer's output for that harness and arm, one folder per task. A version, if given, must be `pin.json`'s.

## What the wiring does per trial

1. Checks every materialized file against its manifest entry (bytes and sha256), and refuses an arm the harness can't run. Each entry's `placement` decides where it goes: `repo` files go into the repository, the `hook` file (hooktext.md) goes only to the hook, and the `qm-organization-instructions` file (soul.txt) is QM's SOUL. An unknown or missing placement stops the trial.
2. Uploads the `repo` files into `/work/repo` under the harness's own name (CLAUDE.md, AGENTS.md or GEMINI.md) and adds them to `.git/info/exclude`, so they don't show as untracked changes.
3. On the `cutlift` arm, raises the harness's limit:
   - Codex: `project_doc_max_bytes` 262144.
   - OpenClaw: `agents.defaults.bootstrapMaxChars` 200000 and `bootstrapTotalMaxChars` 300000.
   - Hermes: `context_file_max_chars` 200000.
4. Sets Hermes's `context_length` to the model's real window from `scripts/frontier-harbor/pin.json`, on every arm, and records it as a named setting.
5. On the `hook` arm, installs a hook that adds the six rules once, beside the task message:
   - Claude Code: `hooks.UserPromptSubmit` in its settings.
   - Codex: `UserPromptSubmit` in `/tmp/codex-home/hooks.json`, with `dangerously_bypass_hook_trust`.
   - Hermes: `hooks.pre_llm_call` with `hooks_auto_accept: true`.
   - OpenClaw: the `he-rules-hook` plugin.
   - Pi and Gemini CLI have no hook, so they have no hook arm.
6. Checks that gstack and gbrain are absent, that the installed harness is the pinned version, and that the repository holds no rules file beyond the ones placed.
7. Starts `/opt/he/watch.py` right before the agent command. Its log is `/logs/agent/he-watch.log`.

Every failure has a code and stops the trial before the agent starts, so it counts as an infrastructure failure, never a scored trial:

| code | meaning |
|---|---|
| HE-RULES-001 | bad `rules` kwarg |
| HE-RULES-002 | a materialized file or manifest doesn't check |
| HE-RULES-003 | an arm the harness can't run |
| HE-RULES-004 | a placed file changed, or a rules file the arm didn't place was there before the agent started |
| HE-RULES-005 | a setup or launch check failed |
| HE-RULES-006 | gstack or gbrain found in the container |
| HE-RULES-007 | no single task folder for the trial |
| HE-RULES-008 | the materializer failed |
| HE-RULES-009 | QM (stub, see below) |
| HE-RULES-010 | the installed harness isn't the pinned version |
| HE-RULES-011 | a QM SOUL over 100,000 characters |

## Arms a harness can't run

`python3 rules_wiring.py cant-run` prints the list. In short:

- Pi and Gemini CLI: no `hook` arm, because they have no hook.
- Claude Code, Pi and Gemini CLI: no `cutlift` arm, because nothing is cut.
- Hermes: no `cutlift` arm on Opus. At the real 1M window its default cap is 240,000 characters, above the 160 KB file, so there is no cut to lift.
- `qm-repo` and `qm-top` are QM's arms only.

## Harness-specific findings

- **OpenClaw reads `/work/repo/AGENTS.md`.** Its agent workspace is the repository (`"."`).
- **Harbor's OpenClaw setup writes rules files into the repository.** `openclaw setup --baseline --workspace .` writes template AGENTS.md, IDENTITY.md, SOUL.md and USER.md there. `RulesOpenClaw` points setup at `/tmp/he-rules/openclaw-setup-workspace` instead and records what it wrote as `openclaw_setup_wrote`. Without that, the `none` arm would carry OpenClaw's template AGENTS.md. Earlier OpenClaw repository-task runs that used Harbor's setup line likely carried the same template file in their `none` arm. We haven't checked their receipts.
- **OpenClaw's hook works on `openclaw agent --local`.** The map's hook cell shows one hook copy of all six rules.
- **OpenClaw needs 4 GB.** It was killed for memory at 2 GB, so the map's stub task has 2 CPUs and 4,096 MB.
- **Hermes doesn't cut the 160 KB file at a 1M context.** The b160k first request carries every rule whole, with no truncation marker.
- **Hermes installs from `main` through its own package manager.** Its `install.sh` refuses the release tag as `--branch` ("commit ... is not on branch v0.23.2"), so the install runs with `--branch main --commit <pin>` and `--hermes-home /tmp/hermes`, then adds the `anthropic` package through `pm.ensure_import`. With the default home, Hermes refuses to start ("no dependency environment is committed for this install"). The version check reads the commit and `anthropic` from the committed environment.
- **Codex doesn't tell the model when it cuts.** Codex 0.170.0's "Loaded only 32768 of 163790 bytes ... increase `project_doc_max_bytes`" appears as an `error` item in its own JSON event log, not in the request the model sees.

## QM (a stub)

QM reads no rules file from the workspace. Its equivalent is the organization's SOUL, set through QM's admin API and shown to the model under "## Organization instructions" (a source read of yc-software/qm at 90e4ced7).

`RulesQm` is a marked stub that refuses with HE-RULES-009. It waits for the QM runner's `FrontierQm` (`scripts/frontier-harbor/qm_harbor.py`), which isn't on this base yet, so `agents_rules.py` imports `FrontierQm` guarded and the keyless tests still pass. The helpers it will call are in `rules_wiring.py`:

- `qm_soul_call(text)`: the admin call `PUT /v1/admin/scopes/org:harness-eval/soul` with `{"content": text}`, made before the turn. A text over 100,000 characters fails the trial (HE-RULES-011) and is never cut.
- `qm_soul_text(arm, loaded)`: no SOUL on `none` (QM's default stays), else the manifest's `qm-organization-instructions` file. On `qm-repo` that file is empty and the b8k AGENTS.md is a `repo` file.
- `qm_soul_delivered(system_prompt, text)`: the proof, read from the captured first agent-loop request. The admin reply is not proof.

Carbon runs on QM only through OpenRouter, and no Carbon cell is among QM's arms.

## Tests

```
env -i PATH=$PATH HOME=$HOME bun test tests/rules-at-scale-harness.test.ts
```

Keyless. It covers the pin and its check, the arms each harness can run, the container plan, the Harbor classes on the stand-in at `tests/fixtures/frontier-delivery/stub`, the hook script, lane B's `materialize.ts` read through its manifest placements, the QM helpers, and `delivery_map.py` on a synthetic run.
