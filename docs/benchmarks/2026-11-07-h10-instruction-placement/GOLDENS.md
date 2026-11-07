# H10 goldens log (keyless, Docker, images built from this tree)

Written 2026-11-06 and rerun 2026-11-07 (UTC) on a Capy cloud machine (Docker 29.9.2, bun 1.4.4), before any counted trial of run `h10-instruction-placement-2026-11`. Tree of the rerun: branch `harn46/h10-prereg` at `1112711212`, which is main `dc618446cf` (with #310, H10 PR 4: the Claude Code Agent SDK driver and the wave2-admit lease fix) plus the preregistration commits and the public-export fix `d0db13b278` (prompt quotes in the Claude Code README, pin.json and SDK driver test replaced by sha256 digests). The images were rebuilt from that tree. No model was called and no key was read: every golden serves a fake model endpoint in the test process.

**What the goldens decide (all gating goldens passed, so nothing dropped):**

- **Family A repetition pairs: all four.** Claude Code (cli, Opus 5.5), Codex, Hermes and OpenClaw (gpt-6.1-sol) each carry the one-time copy into the history of cr-01's repeat turns.
- **Codex route-system is in.** Codex 0.165.0 accepts `developer_instructions` under `--strict-config`. Block C keeps 8 cells, so the run has 30 cells.
- **Placement pairs: three.** Claude Code (cli), Hermes and Codex.
- **Claude Code system prompt:** the cli capture is the full built-in prompt, not the stub. The SDK preset capture matches it except for one header word. The sdk-default capture is the stub. So the run is not stopped.

## Images (receipts only, never compared)

Built with `docker build -t harness-eval/<name>:dev harnesses/<name>` from this tree. Two machines that build the same checkout get different ids, so the provenance digest below is what a shard is checked against (runner/trial/provenance.ts, HE-ADAPTER-005), not the id.

| Harness | Image id (receipt) | Provenance manifest digest | Files listed |
|---|---|---|---:|
| claude-code | `sha256:7cf81428e8e7b2c1e07dcef89ec4acfa18a95a75cff06147035534939f185e0a` | `91e24c1db90fa7c78ff366c8bda5c884d4c8984d58ef9301102f1b654e51cbfd` | 10 |
| codex | `sha256:aaeeb00d3aec48fb10026717fe61ef3c0a08d0d1393882359b9255766139f2e8` | `e9addac8cf679250aabd2eae73dd8605136828d5fdf3d56742dc4417ebc9aca6` | 8 |
| hermes | `sha256:f15be3d0e31b4136690b7cc3c06a3f93762c6a1bf61b459155f52158ba78cd05` | `30c61a3aaa89298765210d3a3a21ad3629a8a15d37ef1189058124f6e159ce21` | 8 |
| openclaw | `sha256:a0bf64654b8f55178210f2b290fc452802a021e42ade554e5c02ec9e96499a46` | `2a3b189b9a82aba4bc075a0175345df80c05b2d840061362e8e3830d0e804c0f` | 10 |

Each digest is `harnessProvenance(<name>, 'harness-eval/<name>:dev')` from runner/trial/provenance.ts: every file in `harnesses/<name>/provenance.json` was found in the image with the checkout's sha256. A rebase that changes any listed file changes its digest, and the goldens rerun.

## Test runs

Every command ran under `env -i PATH=$PATH HOME=$HOME`, with the four images present, so the Docker blocks ran instead of skipping.

| File | Result | Log |
|---|---|---|
| tests/instruction-route-cc-codex.test.ts | 58 pass, 0 fail, 0 skip (281 s) | [goldens/instruction-route-cc-codex.test.txt](goldens/instruction-route-cc-codex.test.txt) |
| tests/claude-code-sdk-driver.test.ts | 5 pass, 0 fail (27 s) | [goldens/claude-code-sdk-driver.test.txt](goldens/claude-code-sdk-driver.test.txt) |
| tests/instruction-route.test.ts | 70 pass, 0 skip, 0 fail (1,626 s) | [goldens/instruction-route.test.txt](goldens/instruction-route.test.txt) |
| tests/instruction-route.test.ts `-t "hermes route-system"`, run on its own | 4 pass, 0 fail, 0 skip (71 s) | [goldens/instruction-route.hermes-route-system.test.txt](goldens/instruction-route.hermes-route-system.test.txt) |

- The host-side Hermes route-system byte checks need PyYAML to parse `config.yaml` back. On the first run (tree `5ceb1b0c9d`) the machine had none, so the full run skipped those 2 tests (68 pass, 2 skip), and they passed after installing it. On this rerun PyYAML was present and the full run passed all 70.
- **The provenance digests:** claude-code changed from `4cbb972a96ec` because the export fix edits `harnesses/claude-code/pin.json`, which the manifest lists; codex, hermes and openclaw are unchanged.
- The full system field of each Claude Code driver is summarised in [goldens/sdk-system-capture.summary.json](goldens/sdk-system-capture.summary.json) (lengths, sha256 per block and the skill guidance line). The full text is not committed: it is Claude Code's own prompt, which the public tree does not carry. For the same reason the committed SDK test log omits one field, the `heads` (first 80 characters of each prompt block) of its `SDK_SYSTEM_CAPTURE` line; every other byte of every log is as the test printed it.

## 1. History carry: family A repetition pairs

A harness enters the repetition pair only if its cr-01 golden shows the one-time copy carried on the repeat turns (cr-01 is three member turns in one channel).

| Harness, driver, model | route-once on cr-01, turn by turn | Admitted |
|---|---|---|
| Claude Code, cli, claude-opus-5-5 | turn 1: 1 copy in this turn (and its tool-call follow-up); turns 2 and 3: 0 in this turn, 1 in history (`HISTORY_CARRY claude-code yes`) | yes |
| Codex 0.165.0, gpt-6.1-sol | the same pattern on `codex exec resume` (`HISTORY_CARRY codex yes`) | yes |
| Hermes v2026.9.24, gpt-6.1-sol | emitted true, false, false; turns 2 and 3 carry 1 copy in history, 0 in this turn | yes |
| OpenClaw 2026.10.6, gpt-6.1-sol | emitted true, false, false; turns 2 and 3 carry 1 copy in history, 0 in this turn | yes |

The per-turn hook gives N copies on a session's turn N on every harness, and on cn-03 (four session firsts) both hooks emit on every turn and no request carries history. The test asserts both.

## 2. Codex developer_instructions under --strict-config

- **Config check, keyless, the built image with no network:** a `config.toml` holding only `developer_instructions = "x"` loads under `codex exec --json --skip-git-repo-check --strict-config` (the thread starts; the turn then times out because there is no network). The same file with `not_a_codex_key = "x"` is refused: `Error loading config.toml: ... unknown configuration field \`not_a_codex_key\``, exit 1. So the check would catch an unaccepted key. `codex --version` prints `codex-cli 0.165.0`.
- **Golden:** route-system places the rule once in a developer message (the test's "preamble" location) on every request of every turn, on cn-02, cr-01 and cn-03, follow-ups included, with the real binary running `--strict-config` on every turn.
- Decision: Codex route-system is in. Block C has 8 cells, the Codex placement pair is admitted, and the Codex family B has 7 contrasts (first Holm step 0.0071).

The config check command, for a rerun (no key reaches the container):

```
docker run --rm --network none --entrypoint sh harness-eval/codex:dev -c 'export CODEX_HOME=/tmp/ch HOME=/tmp; mkdir -p /tmp/ch /tmp/w; printf "developer_instructions = \"x\"\n" > /tmp/ch/config.toml; echo hi | timeout 20 codex exec --json --skip-git-repo-check --strict-config -C /tmp/w -; echo rc=$?'
```

## 3. Claude Code system prompt, per driver

From the SDK driver test's "system block per driver" case (route-skill, one cn-02 turn each, claude-opus-5-5):

| Driver | System blocks (characters) | Block sha256 (first 12) | Skill guidance line | brain-first listed in |
|---|---|---|---|---|
| cli (`claude -p`, block A) | 74, 62, 6,210 | `1d302e24c389`, `0d7062851dd7`, `cac2c15c013a` | present: "When the user types `/<skill-name>`, invoke it via Skill." | messages |
| sdk-preset (block B) | 73, 62, 6,210 | `9e19c06829a6`, `0d7062851dd7`, `cac2c15c013a` | present, same line | messages |
| sdk-default (block B) | 73, 62 | `9e19c06829a6`, `0d7062851dd7` | absent (the stub) | messages |

- **The cli capture is not the stub.** Its third block (6,210 characters, beside internal-task's 5.8k) holds the guidance, including the skill line. So the stop rule ("a CLI capture that shows the stub stops the run") does not fire.
- **Preset against cli:** blocks 2 and 3 are byte-identical. Block 1 is the billing header and differs in its entrypoint: `cc_entrypoint=sdk-cli` (cli) against `cc_entrypoint=sdk-ts` (preset), the field the test pins; the receipts give each header's length (74 and 73) and sha256, not its full text. The user agent differs the same way (`sdk-cli` against `sdk-ts, agent-sdk/0.3.312`). Both carry 12 tools and `max_tokens` 128000. The Bash tool's text also differs: its `run_in_background` timeout reads 600000 ms under the cli and 1800000 ms under both SDK drivers (`harnesses/claude-code/pin.json`, `system_prompt.rest_of_request`). Those are the differences in the captured request. Other setup differences between the drivers are in the preregistration's limits.
- **sdk-default:** only the header and the 62-character identity block (sha256 `0d7062851dd7`). This is the stub.
- The brain-first skill listing is in the messages (the skills reminder), not the system field, in all three. So discovery reads the same in the preset and the stub cells.

## 4. gpt-6.1-sol as a harness model

The Codex, Hermes and OpenClaw goldens ran with `HE_MODEL_NAME=gpt-6.1-sol`. What each adapter sent, from the captures:

- **OpenClaw:** model `gpt-6.1-sol`, reasoning effort medium (summary auto), `max_output_tokens` 128000.
- **Hermes:** model `gpt-6.1-sol`, reasoning effort medium (summary auto), no `max_output_tokens` (the shard proxy writes 128000).
- **Codex:** reasoning effort medium from `harnesses/codex/pin.json`; the test's catalog check ("the provider catalog prices both cell models") passed.
- No housekeeping request was seen on any Hermes or OpenClaw golden (0 requests, 0 copies).

## 5. Hermes: the gbrain call needs no approval

On every Hermes golden, turn 1's first request is answered with a gbrain tool call and a second request follows with that call's output (the follow-up row). So the call completed with no approval card on every route, as the plan expects. The clean-arm preflight below reads `tirith 0.4.2 offline` as the trial uid in the Hermes image (the pinned scanner, no download).

## 6. Clean-arm preflight on the four images (receipt)

- **`scripts/matrix/clean-arm-preflight.sh claude-code codex openclaw hermes`** (the shard pre-smoke, merged with matrix-mu-2026-11): `mounts clean`, and each of the four images `clean (no gstack path, no .capy directory)`. Its host check failed on this Capy machine, as it should: the machine holds `~/.capy`, `~/.local/share/gstack` and `~/.gstack`. On a shard VM that check must pass, or the shard stops before any key or trial.
- **`scripts/tool-discipline/clean-arm-preflight.sh --arm none --image harness-eval/<name>:dev`** (merged at `e77ca6a3`): on all four images every gstack check reads clean (mounts ok, 0 gstack SKILL.md files, 0 user-level installs, `GSTACK_CAPY` unset, `/opt/gstack` absent). It still exits 1 on all four, for two checks written for the tool-discipline Hermes images: the image label `org.harness-eval.gstack.commit` (these images carry no such label) and the Tirith pin on every image (only Hermes ships Tirith, and Hermes reads `tirith 0.4.2 offline`). So it cannot be the shard pre-smoke as written. The preregistration says how each check is used.

