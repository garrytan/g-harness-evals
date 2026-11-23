# Skills at scale: the keyless kit

These scripts answer two questions before any paid skills-at-scale cell runs (internal-task-a, internal-task-b):

- **What does each harness show the model when hundreds of skills are installed?** The listing map.
- **Does gbrain's own installer work on each harness, the way a user runs it?** The pre-count checks.

Everything here is keyless. Model requests go to fake endpoints on the loopback with dummy keys. Nothing is spent.

## The arms

An adapter turns an arm on through `HE_HARNESS_CONFIG`. Every other config is unchanged, and the arms apply to the serve entry only (the run entry refuses them with HE-ADAPTER-007).

| Config | What the harness gets |
| --- | --- |
| `skills-catalog` | the catalog in the harness's own skills folder, nothing from gbrain |
| `skills-gbrain-setup` | the catalog, then `gbrain setup <harness> --skill-loading resolve`; `gbrain doctor --only skill_resolver` must pass and the catalog's index must be fresh |
| `skills-gbrain-pins` | the same, then `gbrain skills pin add` for each pinned skill in the kit |

The skills folders are the harness's own: Claude Code `$CLAUDE_CONFIG_DIR/skills`, Codex `$CODEX_HOME/skills`, Hermes `$HERMES_HOME/skills`, OpenClaw `$HE_WORKSPACE_DIR/skills`, Pi `$PI_CODING_AGENT_DIR/skills` with `PI_CODING_AGENT_DIR=/harness-state/pi`.

**OpenClaw** takes two more variants of each config. By default every OpenClaw arm raises both `skills.limits.maxCandidatesPerRoot` and `skills.limits.maxSkillsLoadedPerSource` to fit the catalog. `-printed-fix` raises only the first, which is the fix `gbrain setup` prints, and `-default-limits` leaves both at OpenClaw's defaults. OpenClaw stops loading a source at `maxSkillsLoadedPerSource` (200 by default) without a warning, so the printed fix alone loads no more skills (see openclaw/openclaw#60498). OpenClaw cells run through the `openclaw agent` CLI (`openclaw agent --local` once per turn on the serve entry), not through a chat channel.

**Hermes** also takes `-system-preamble` on each config. After the arm, `agent.system_prompt` in config.yaml gets the task preamble's fixed text (`system-preamble.md` in the kit, made by `systemPreamble` in arm.ts). Run it with `checks.ts --preamble scripts/skills-at-scale/preamble.turn.md`, so each user turn carries only who is writing, where and when, and the message. `--preamble scripts/skills-at-scale/preamble.message-only.md` sends the message alone. Hermes's hook ranks the user turn and never sees the system prompt, so with the shipped preamble the resolver ranks 3.4 KB of rules along with an 80-character ask (`outputs/hermes-ranked-text.md`).

## Where the kit differs from a plain user install

- **gbrain comes from source.** The kit installs gbrain the way its README says, `bun install -g github:garrytan/gbrain#<commit>`, by commit because a tag can move. The release is a variable: `build-kit.ts --gbrain <tag>` (or `SAS_GBRAIN_TAG`), else the default in `gbrain-pin.json`. The pin's tag uses the pin's commit; any other tag also needs its full commit (`--gbrain-commit <sha>` or `SAS_GBRAIN_COMMIT`). Each `sas-<tag>` image carries a `harness-eval.sas-catalog` label with its rung's `catalog_hash`, and run preflight stops a skills-at-scale cell whose image label doesn't match its catalog (HE-ADAPTER-005). OpenClaw cells need gbrain 0.60.743.0 or later, which fixes its plugin ranking the previous message; an older kit marks `openclaw_below_fix` in `sas-arm.json`. Each image installs gbrain fresh and runs `gbrain setup` during untimed cell setup, so no cell upgrades gbrain in place or switches the skill-loading mode while timed. The compiled release binary can't set up OpenClaw or Pi: setup builds a Node library from gbrain's source and stops with `skill_source_unreadable`. The binary is used only on the host, to rank skills offline when `checks.ts` picks its trigger pair.
- **Default state paths are links.** gbrain's install checks run `hermes hooks doctor`, `openclaw plugins inspect` and `pi --help` with an environment that keeps `HOME` but drops `HERMES_HOME`, `OPENCLAW_STATE_DIR` and `PI_CODING_AGENT_DIR`. The adapters here move each harness's state, so those checks would read an empty default folder. The arm links `~/.hermes`, `~/.openclaw` and `~/.pi/agent` to the adapter's folders and records the links in `sas-arm.json`. A user who keeps the defaults never needs this.
- **Hermes's bundled skills come first.** Hermes copies its bundled skills into `$HERMES_HOME/skills` when it is installed and again each time it starts. A user has them before installing gbrain. The arm seeds them first, the way Hermes's own profile code does, so gbrain's index holds them from the first turn. Without this the index went stale after turn 1 and turn 2 ranked a different catalog. A catalog skill named like one of Hermes's category folders (`email`, `research`) is copied into that folder, which is what happens on a user's machine too.

## Commands

Run each with a scrubbed environment (`env -i PATH=$PATH HOME=$HOME`).

```sh
# a synthetic nested catalog ladder (used until the real public ladder exists)
bun scripts/skills-at-scale/synth-catalog.ts --out <ladder> --sizes 100,351,700,1500

# the kit and images for one rung
bun scripts/skills-at-scale/build-kit.ts --catalog <ladder>/351 --out <kit> --image claude-code,codex,hermes,openclaw,pi --tag 351

# the listing map: <out>/map.json and <out>/map.md
bun scripts/skills-at-scale/listing-map.ts --ladder <ladder> --out <out> --sizes 100,351,700,1500 --build

# the pre-count checks; exits 1 naming each failed cell and its fix
bun scripts/skills-at-scale/checks.ts --rung <ladder>/351 --tag 351 --config skills-gbrain-setup --harness claude-code,codex,hermes,openclaw,pi --out <dir>

# QM: the listing map, and the installer check inside QM's core
bun scripts/skills-at-scale/qm-listing-map.ts --ladder <ladder> --out <dir>
bun scripts/skills-at-scale/qm-installer-check.ts --rung <ladder>/351 --out <dir> [--musl-gbrain <compiled binary>]

# the Pi trace fixture (tests/fixtures/skills-at-scale/pi-trace/)
bun scripts/skills-at-scale/pi-trace.ts
```

## QM

QM has a native arm only, and these scripts run it on the pinned `harness-eval/qm:dev` and `harness-eval/qm-sandbox:dev` images, unchanged.

- `qm-listing-map.ts` puts QM in the listing map: each rung as QM's catalog layer, plus a names-only copy that shows whether names alone fit QM's 12,000-character Skills block. It uses the OpenAI route. On the Anthropic route the internal-task cell also uploads the catalog to QM's deployment-layer API, which answers 413 `payload_too_large` from 351 synthetic skills (about 2.4 MB) and breaks the turn after it.
- `qm-listing-map.ts --route plugin-dirs` gives QM the same catalog through `PLUGIN_SKILLS_DIRS` instead. It changes only the probe images' environment, with one ENV layer and no file added: `DEPLOYMENT_LAYER` is empty, and `PLUGIN_SKILLS_DIRS=/app/plugins/onboarding/skills,/opt/catalog-layer/skills` keeps QM's own default plugin folder. At 700 and 1,500 skills its Skills block is byte-identical to the deployment-layer route's (`outputs/qm-map-plugin-dirs.md`). The cells' summary.json still describes the deployment layer, because that note is fixed text in qm-listing.ts. The skills' `createdBy` (`system:plugin-skills`) shows the route that ran.
- `qm-installer-check.ts` runs `gbrain setup pi --skill-loading resolve` inside QM's core, records `gbrain doctor --only skill_resolver`, and searches one captured turn for any gbrain block. A compiled musl gbrain can't set up Pi, so the check installs gbrain from source with Bun for Alpine.

## What the listing map records

For every catalog skill, where it ends up in the first model request: listed with its description, listed by name only, loaded by the harness but not shown, not loaded, or not shown on a harness that keeps no list of what it loaded. It also records the listing's size in characters and in o200k tokens. Gemini CLI has no adapter, so `gemini-listing.ts` runs the real CLI from npm in a container.

## What the checks record

- **ready:** the arm came up, the doctor check passed, the index was fresh.
- **trigger:** turn 1 asks for a task only skill A fits and turn 2 one only skill B fits. Turn 2's request must carry a new resolver block naming B.
- **pins:** on `skills-gbrain-pins`, every pinned id is in a `<pinned_skills>` block of turn 1's request.
- **lanes:** each turn's outcome from gbrain's own lane log (delivered, timeout and so on). A turn that missed gbrain's 50 ms deadline fails as `timeout`, not `trigger`; rerun it on an idle machine before reading it as a gbrain result.

## Results

`outputs/` holds the latest keyless outputs: `map.md` and `map.json` (the per-skill places left out), `qm-map.md` and `qm-map.json` (deployment-layer route), `qm-map-plugin-dirs.md` and `qm-map-plugin-dirs.json` (700 and 1,500 through `PLUGIN_SKILLS_DIRS`), `qm-installer.json`, `checks.md` and `checks.json`, `newest-releases.json` (the newest release of each harness tried keyless on `skills-gbrain-setup` at 351 skills, with no pin moved), and `hermes-ranked-text.md` and `hermes-ranked-text.json` (the Hermes trigger check by what the resolver ranks).
