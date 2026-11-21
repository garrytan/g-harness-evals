# Miss reader brief (gbrain install eval, run gbrain-install-2026-11)

You are an independent reader for a preregistered eval. You are **not a judge** and your reads never change the scored numbers; they sit beside the failure table as "as read". Read only; spend nothing; run no harness, model or network call.

## What the eval measures
An agent harness (Claude Code, Codex, OpenClaw or Hermes) gets one of two prompts: **bare** ("install gbrain and use it as your memory") or **paste** (gbrain's README install block pasted in), each ending with a version line naming release v0.60.734.0. The driver then (1) waits for the install, (2) asks it to save a fact containing a random nonce to gbrain, (3) in a fresh session asks it to recall the nonce. The **finish line** is: the recall reply contains the nonce AND it was served by a gbrain call (not the harness's own memory, not a file outside the brain). Steps: binary (gbrain installed and on PATH), brain (brain created), wired (harness can call gbrain in a new session), saved (fact saved to gbrain), recalled (served by gbrain).

## The decision your read feeds
gbrain's maintainers fix install steps in order of most failed runs. A miss caused by gbrain (its install doc, CLI errors, codes such as first_run_decisions, degraded_dedup, doctor_alert_unknown, pglite_busy, a save that went to the harness's own memory because gbrain was hard to use) is a gbrain fix. A miss caused by the harness or the model alone (a model limit, a harness crash, the agent ignoring clear instructions) is not. Say which, plainly.

## What to read, per trial
Trial dirs (state/ and workspace/ are stripped to save disk; transcripts and turn records are here):
`/home/user/.capy/work/gst-2715/run/lite/<shard>/results/trials/<cell>/gbrain-install/rN/`
- `install-turns.json` (driver turns, probe results), `install-classification.json` (route, attempts, stalls, last gbrain code), `turns/turn-000N.request.json|response.json` (what the driver sent and got), `logs/stdout.log`, `logs/adapter.log`, `logs/install-watch.ndjson`, `egress.ndjson`.
- The trial's record line is in `/home/user/.capy/work/gst-2715/run/merged/trials.jsonl` (match trial_id).
- The cell-to-shard map is `/home/user/.capy/work/gst-2715/run/readers/cell-shard.txt`.
- If you truly need the brain or the harness's own session files, extract one trial's state into **your own** scratch dir under ~/.capy/work/gst-2715/readers-scratch/<your name>/ with `tar -I zstd -xf /home/user/.capy/work/gst-2715/run/dest/<shard>/results/trials.tar.zst -C <scratch> --wildcards 'trials/<cell>/gbrain-install/rN/state/*'` (shards s01, s02, s09 are uncompressed under dest/<shard>/results/trials/). Delete your scratch dir when done.

## Rules
- Never open any `secret/` directory or `/he-secret` path, and never print, quote or copy anything that looks like a token or key (long random strings after "sk-", "Bearer", "token", "api_key"). If you see one, stop and say so in your report without quoting it.
- Never run `env`, `printenv`, `set`, `export` or anything that lists environment variables.
- Never edit any file outside your output file and scratch dir. Never touch git.
- Quote at most one short line (under 200 characters) of transcript per trial as evidence.

## Output
Append one JSON object per trial, one per line, to your output file:
`{"trial_id": "...", "as_read": "missed" | "recalled" | "unclear", "died_at_step": "binary"|"brain"|"wired"|"saved"|"recalled", "cause": "<one plain sentence>", "side": "gbrain" | "harness" | "model" | "mixed" | "unclear", "evidence": "<file:line or turn id, plus at most one short quote>"}`
"as_read": "recalled" means you believe the scored miss is wrong (the nonce was recalled through gbrain); say why in cause.
Then end with a report to your parent: per cell, 3 to 5 plain lines on the common failure pattern(s), the count per died_at_step and side, and any trial where you disagree with the score. Keep it short. Done means every trial in your list has one line in your output file.
