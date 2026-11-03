# Agent-harness eval compendium

Prepared 2026-10-21 for the harness-eval project. Purpose: everything already published that compares agent *harnesses* (as opposed to models), plus the agent benchmarks the target harnesses could plausibly be run against. Every claim below has a source link; numbers are as published on the date read and were not re-run.

## 0. The harnesses we want to compare

| Harness | Who | Shape | Headless entry point | Model freedom |
|---|---|---|---|---|
| **OpenClaw** | open source (openclaw.ai) | Gateway + channels (Telegram, Slack, etc.) + pluggable "agent harness" runtimes; can also drive external coding harnesses over ACP | `openclaw agent exec "<task>" --cwd <repo> --json` is the documented CI/headless path; it runs one embedded turn with no Gateway and honours the configured `agentRuntime` ([docs](https://docs.openclaw.ai/cli/agent), [harness SDK](https://docs.openclaw.ai/plugins/sdk-agent-harness)) | any configured provider |
| **Hermes Agent** | Nous Research, open source | Single-process gateway to Telegram/Discord/Slack/WhatsApp/Signal/CLI; built-in learning loop (self-authored skills, memory, session search); 7 terminal backends (local, Docker, SSH, Modal, Daytona, …) ([repo](https://github.com/nousresearch/hermes-agent), [architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)) | CLI/TUI; Nous already runs it headlessly for the Hermes Index; FrontierHarness ran it as one of 9 harnesses | any provider (`hermes model`) |
| **QM** | yc-software, MIT | Multiplayer agent harness for a company: Slack + web, per-person isolated workspaces, scoped memory/files/keychain/crons, durable sandboxes. Notably a *harness of harnesses*: Pi, Claude Code, Codex and OpenCode adapters drive the same core ([repo](https://github.com/yc-software/qm), [adapters](https://deepwiki.com/yc-software/qm/2.3-harness-adapters-(pi-claude-codex-opencode))) | Harness Report already runs it from its GitHub repo on Harbor tasks (3 runs on one aider-polyglot task, [page](https://harnessreport.com/harnesses/yc-software-qm.md)); `ianTPE/qm-model-eval` sends tasks through a normal QM turn and grades by reading the database ([repo](https://github.com/ianTPE/qm-model-eval)) | any (per adapter) |

Implication that drives the plan: two of the five products first considered are closed products with no headless API, so a same-model controlled comparison is only possible for OpenClaw, Hermes and QM. Those two products are left out of this survey.

## 1. Prior work that compares harnesses directly (the closest precedents)

### FrontierHarness Eval (Runta, Sept 2026)
Same model (Kimi K3), same 30 SWE/terminal tasks (21 Terminal-Bench 2.1 + 9 DeepSWE), same runtime, 9 harnesses / 12 configurations, 360 trials from one frozen checkpoint. Pass rates were close (50.0% to 66.7%) while cost per pass varied 17.5x ($1.05 to $18.34). Hermes was in the field at 50.0% / $2.90. Ships an agent-neutral reproduction skill and records egress policy per run; runs on unrecorded policy get `methodology_comparable: false`. [repo](https://github.com/frontier-harness-eval/eval), [blog](https://runta.com/blog/introducing-frontierharness-eval/), [site](https://frontierharness.org/).
What to steal: frozen golden checkpoint per trial, cost-per-pass as a first-class metric, cache hit rate, explicit comparability flag.

### Claw-SWE-Bench (TokenRhythm, June 2026)
Built precisely for "OpenClaw-style general-purpose harnesses" on coding: 350 GitHub issues across 8 languages / 43 repos, an 80-instance Lite subset, and a shared adapter protocol so heterogeneous harnesses are comparable. Patch is read from `git diff`, not parsed from the agent reply. Leaderboard: 7 harnesses x 3 models, three runs each, cost-resolve Pareto. OpenClaw, Hermes Agent, nanobot and ZeroClaw are among the harnesses. [paper](https://arxiv.org/abs/2606.12344), [leaderboard](https://claw-swe-bench.github.io/), [dataset](https://huggingface.co/datasets/TokenRhythm/Claw-SWE-Bench).
What to steal: the adapter protocol (task-in, repo-diff-out) and "fix harness vary model" vs "fix model vary harness" as two separate tables.

### Harness Report (harnessreport.com)
Runs agent harnesses straight from their GitHub repos on Harbor tasks and records every model call; pages are also .md/.json and there is an MCP endpoint. Already has a page for **yc-software/qm** (commit a61db71, Anthropic API style, 3 runs on one aider-polyglot task). [qm page](https://harnessreport.com/harnesses/yc-software-qm.md).
What to steal: run-from-repo-at-pinned-commit, per-call logging.

### Personal Agent Bench (Zentor, Sept-Oct 2026)
The only public comparison of *personal* agents. Rebuilds each product runtime with one substituted model and runs errands in stateful simulated worlds; success is read from world state, never the agent's claim; five run-end classes; goal, unwanted actions and a 0-10 reply score are kept separate and never combined; 95% intervals and n on every figure; no ranking, no composite. Also publishes six-axis runtime teardowns and tracks OpenClaw and Hermes from source. [home](https://personalagentbench.com/), [exam](https://personalagentbench.com/how-the-exam-works/), [results](https://personalagentbench.com/results/), [benchmarks critique](https://personalagentbench.com/benchmarks/).
What to steal: world-state grading, the five end classes (incl. "necessary approval" as a pass, "unauthorised action" as a fail), simulated user that only answers from declared-hidden facts, intervals-not-ranks.

### HAL, Holistic Agent Leaderboard (Princeton, ICLR 2026)
Standardised, cost-aware third-party leaderboard: 9 benchmarks, 26k+ rollouts, every model under multiple scaffolds, full encrypted traces, reliability dashboard (consistency, predictability, robustness, safety, self-awareness). Currently paused for new models. [site](https://hal.cs.princeton.edu/).

### "The Harness Moves the Score" (Synopticon, May 2026)
Meta-analysis of 64 same-model, different-harness pairs across 9 benchmarks (mostly HAL). Median gap 15.6pp, max 48pp. Specialised scaffold beat generic agent in 34/36 pairs; harness accounts for 30-50% of the score where design space is still open. Claude Code adds 18-36pp over CORE-Agent on the same Claude. [article](https://www.synopticonresearch.com/articles/harness-effect/).

### "Same Model, Different Harness" (Lewis, Aug 2026)
Paired A/B of one harness's control vs closed-loop treatment (context trimming + stall detection) on SWE-bench Verified/Pro/FeatureBench. Under a 20k window, F2PF rose 28% to 49% and complete solutions 43 to 72 of 169. Argues evaluations must treat model+harness as the solver. [paper](https://arxiv.org/html/2608.26218).

### "Harness or Model?" (Arjmandi, Sept 2026)
Private contamination-controlled suite (256 tasks); vendor-native harness vs neutral deepagents on the same model: no average advantage (-1.25pp Opus 4.8, +1.25pp GPT-5.5, wide CIs), but opposite effects on repo tasks vs contest tasks; 22 of 81 wall-clock-cancelled runs had already produced a passing patch; neutral harness cost 1.2-1.6x more per solve. Also a cautionary tale: the August version was retracted over a telemetry usage-semantics bug. [paper](http://arxiv.org/abs/2609.11987v1).

### Other harness-isolation work
- "The Scaffold Effect in Coding Agents" (KDD 2026 workshop): harness choice as a hidden variable in leaderboards. [pdf](https://kdd-eval-workshop.github.io/agenticai-evaluation-kdd2026/assets/papers/74_The_Scaffold_Effect_in_Codi.pdf)
- joelniklaus/CodingBenchmarkResults: 10 harnesses x 2 models on 250 held-out SWE-bench Pro tasks, 5,000 rollouts. [bucket](https://huggingface.co/buckets/joelniklaus/CodingBenchmarkResults)

## 2. OpenClaw-ecosystem benchmarks (the harness already has a bench culture)

| Bench | What | Notes |
|---|---|---|
| **ClawBench** (openclaw/clawbench) | 19 signal-curated tasks, trace-based scoring, "dynamical-systems diagnostics" of how agents fail; scores harness+config+model | [repo](https://github.com/openclaw/clawbench) |
| **PinchBench** | Model leaderboard *inside* OpenClaw; automated checks + LLM judge; cost/speed/value views; pins the OpenClaw version per run | [site](https://pinchbench.com/) |
| **Claw-Eval** | 25 models, Pass^3 / Pass@3 / Completion / Robustness / Safety with intervals | [site](https://claw-eval.github.io/) |
| **ClawProBench** | Pass^3, Pass@3, cost in CNY/USD, pinned version | [site](https://suyoumo.github.io/bench/) |
| **RealClawBench** | 281 executable tasks reconstructed from real OpenClaw sessions, distribution-preserving (JSD <= 0.045), deterministic scorers; best model 65.8% | [paper](https://arxiv.org/abs/2606.03889) |
| **WildClawBench** (Shanghai AI Lab) | Real-world long-horizon tasks for CLI-harness agents | [paper](https://arxiv.org/abs/2605.10912) |
| **pi-Bench** | 100 multi-turn tasks, 5 personas, hidden intents; proactive assistance; explicitly motivated by OpenClaw | [paper](https://arxiv.org/abs/2605.14678) |

## 3. Hermes-ecosystem benchmarks

- **Hermes Index** (portal.nousresearch.com/bench): models ranked *inside Hermes Agent* on four suites: Hermes Bench (150 tasks graded on files/state left behind), Terminal-Bench 4, Terminal-Bench Science, SkillsBench; pass@1; cost per task. Top: Opus 5.5 at 63.31 / $4.99, GPT 6.1 Sol 57.09 / $1.19. [site](https://portal.nousresearch.com/bench)
- Open issue #23137 asks Nous to publish SWE-bench numbers vs vanilla models, i.e. the harness-effect question is unanswered for Hermes. [issue](https://github.com/NousResearch/hermes-agent/issues/23137)

## 4. QM-ecosystem evaluation

- **qm-model-eval** (ianTPE): grades a model in a live QM deployment by reading the database after a normal turn rather than trusting the reply; motivated by "a model that mostly understands will quietly do the wrong thing and report success". [repo](https://github.com/ianTPE/qm-model-eval)
- Harness Report QM page (above).

## 5. General agent benchmarks that could serve as task sources

### Terminal / coding (verifiable, Harbor-format, well-trodden)
- **Terminal-Bench 4.0** (Stanford/Laude/Harbor): 66 tasks, 5 trials each, 95% CIs and cost on the board; leader 64.8% +/- 3.1 (Opus 5.5 in Claude Code, $4.7k total). Harbor is the official runner (`harbor run --dataset terminal-bench@... --agent <x>`) and supports arbitrary agents. [board](https://www.tbench.ai/), [harbor](https://github.com/harbor-framework/harbor), [CI analysis](https://personalagentbench.com/benchmarks/terminal-bench/)
- **SWE-bench Verified / Pro / Multilingual**; the Verified board now defaults to a "Bash Only" view where every model runs in the same mini-SWE-agent environment, i.e. the board itself has moved to harness control. [site](https://www.swebench.com/)
- **DeepSWE v1.1** (Datacurve, 113 tasks), **SWE-Atlas-QnA** (Scale), aggregated with TB 4.0 in the Artificial Analysis Coding Agent Index, which also reports tokens, cache hit, wall time, and safety refusal rate per agent. [AA](https://artificialanalysis.ai/agents/coding-agents)
- **aider polyglot** (used by Harness Report).

### Tool-use / workplace / long-horizon
- **tau-bench / tau2-bench** (Sierra): tool-agent-user with simulated user and policy; pass^k reliability metric. [tau2](https://github.com/sierra-research/tau2-bench)
- **Toolathlon-Verified** (June 2026): long-horizon, many real tools. [site](https://toolathlon.xyz/docs/leaderboard)
- **MCP-Universe**, **MCP Atlas** (Scale), **MCP-Persona** (personal apps via simulated MCP environments). [MCP-Universe](https://mcp-universe.github.io/), [MCP-Persona](https://arxiv.org/html/2606.02470)
- **SkillsBench v1.1**: 87 tasks, with/without skills, 25 agent-model configs, OpenHands default harness, labels configs run under other harnesses. [site](https://skillsbench.ai/)
- **TheAgentCompany**: simulated software company (GitLab, OwnCloud, RocketChat, Plane), checkpoint-based graders; best agent ~30%. [site](https://the-agent-company.com/)
- **Gaia2 / ARE**: dynamic simulated apps, time-sensitive and noisy scenarios, general-assistant tasks. [docs](https://facebookresearch.github.io/meta-agents-research-environments/user_guide/gaia2_evaluation.html)
- **Vending-Bench 2 / Arena** (Andon): long-term coherence running a business; multi-agent competition variant. [site](https://andonlabs.com/evals/vending-bench-2)
- **Slack Bench** (37 Slack-API tasks), **Agent Diff Bench** (Slack/Linear/Box/Calendar via bash+python). [slack-bench](https://huggingface.co/datasets/hubertmarek/slack-bench)

### Web / computer use (less relevant for a Slack/Telegram harness)
- **GAIA**, **AssistantBench**, **BrowseComp**, **WebArena**, **Online Mind2Web**, **OSWorld-Verified**. [steel index](https://leaderboard.steel.dev/), [OSWorld](https://benchlm.ai/benchmarks/osworld-verified)

## 6. What the literature says a credible harness eval needs

1. **Fix the model, vary the harness.** Every serious harness comparison (FrontierHarness, Claw-SWE-Bench, HAL pairs, Synopticon) holds the model constant. Without it you are measuring one model against another, not harnesses.
2. **Same frozen environment per trial.** FrontierHarness restores every trial from one golden checkpoint; Harbor tasks ship Dockerfiles; RealClawBench reconstructs the execution env.
3. **Grade world state, not the transcript.** Claw-SWE-Bench reads `git diff`; Personal Agent Bench reads the simulated world; qm-model-eval reads the database; Hermes Bench grades "the files and state the agent leaves behind".
4. **Report intervals and n, not ranks.** Terminal-Bench 4.0 prints 95% CIs; Personal Agent Bench refuses composites; tau-bench and Claw-Eval use pass^k for reliability. Five trials per task is the TB norm.
5. **Cost, tokens, cache and wall time beside pass rate.** 17x cost spread at near-equal pass rates (FrontierHarness); "100x more expensive for 1% better" (HAL).
6. **Separate unwanted actions and approvals from goal completion.** Personal Agent Bench's five end classes; Claw-Eval's Safety column; AA's refusal rate.
7. **Record the harness version/commit and egress policy.** PinchBench pins OpenClaw version; Harness Report pins commit; FrontierHarness refuses comparability without a recorded allowlist.
8. **Expect wall-clock cancellation to hide completed work** (22/81 in Arjmandi) and telemetry bugs to invalidate cost claims (the retracted August manuscript).
9. **Nobody has yet measured the thing personal/work harnesses are for**: a continuing relationship with one user (memory, proactivity, learned skills) across many errands. Personal Agent Bench says this outright; pi-Bench is the closest research attempt.

## Disclosures

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
