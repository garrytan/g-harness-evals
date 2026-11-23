# Shared-brain access run: uncounted per-arm pilot

This is the per-arm pilot the preregistration's "Pilot" section asks for. It publishes no number, and none of its trials is counted or pooled with the counted run.

- **Run id:** `shared-brain-access-2026-11-pilot`, from the commit that adds this file, on one Ubicloud standard-16 VM.
- **Build:** gbrain v0.60.761.0 (`87bdceed85b8b47446cadcb89eb26a9c7fcaa467`), as the 2026-11-22 amendment in [../AMENDMENTS.md](../AMENDMENTS.md) sets.
- **Plan:** [prereg.json](prereg.json) is the preregistration's prereg.json with only these changes: the run id, the question, a $51.80 cap (the sum of the per-arm pilot caps), one repetition per cell, and fixed tasks. The OpenClaw and Hermes cells get three dev tasks: `si-01-marrow-agrisupply-site`, `sc-01-central-random-two-asks` and `ar-01-thornbury-rate-hollis`. The Claude Code and Codex cells get two: `si-01-marrow-agrisupply-site` and `ar-01-thornbury-rate-hollis`. That gives 28 cells and 72 trials.
- **Why two tasks for Claude Code and Codex:** with three, the summed per-trial cost ceilings of each installer and told arm ($4.62) would pass that arm's pilot cap ($3.30 to $3.50). With two, every arm's worst case is at or under its cap: $3.36 each for open, refused and labelled, $5.82 for none and $3.30 for each installer and told arm. The plan allows two or three tasks per cell.

For each arm, the pilot checks from that arm's own outputs:
- the sidecar served the arm's brain and settings;
- the tap presented the expected credential;
- refused arms read nothing and get `requester_scope_required`;
- none arms show no gbrain and no gstack read;
- the tasks load and are graded;
- the captured model ids are the pinned models, including GPT-6.2 Sol in Codex 0.165.0, OpenClaw and Hermes.

The results, and any arm fixed or left out, are recorded by a dated amendment before that arm's first counted trial.
