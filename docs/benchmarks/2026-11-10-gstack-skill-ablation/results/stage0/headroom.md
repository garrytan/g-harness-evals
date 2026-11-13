# Headroom (stage 0): gstack-skill-ablation-2026-11

Rule: pass when the none arm's task-mean pass rate on the model's subset is at or below 0.75 and at least 8 subset tasks are informative (a scored attempt failed; floor tasks left out); a model that misses is ceiling-limited. Seed 7, 10000 draws.

| Model | Role | Cell | Subset | Tasks scored / subset | Trials scored | Pass rate [95% CI] | Informative tasks | Status |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 (Claude Code) | frontier | opus-none | opus | 21 / 21 | 41 | 64.3% [45.2%, 83.3%] | 9 | passed |
| GPT-6.1 Sol (Codex) | frontier | sol-none | sol | 20 / 20 | 40 | 67.5% [50.0%, 82.5%] | 10 | passed |
| Particle-1 (Hermes), low-cost | low-cost | particle-none | opus | 0 / 21 | 0 | n/a | 0 | no scored trial |

Truncated captures (cut at the proxy's size cap; opens after the cap are unobserved): opus full 0, opus none 0, sol none 0, sol full 0.
