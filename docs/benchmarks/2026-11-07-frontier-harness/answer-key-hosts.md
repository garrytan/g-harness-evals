# Hosts that served the Hermes answer keys in the frontier harness run

The [report](report.md) is pinned by hash, so this list sits beside it. It answers a reader's question ([g-harness-evals#7](https://github.com/garrytan/g-harness-evals/issues/7)): which hosts returned the answer key in the 4 Hermes trials that a reader blind to the harness confirmed from the contamination audit's flags ([results/lookup-fails.json](results/lookup-fails.json)).

- **Two hosts served all 4:** marginlab.ai, a public explorer of Terminal-Bench results, in 3 trials, and github.com, the benchmark's own upstream repository, in 1.
- **All 4 arrived in the text of a web_search result.** No trial opened the page itself before the answer key reached the model. So a filter on the pages the agent opens would not have caught them. A filter that dropped search hits from marginlab.ai and github.com would have removed all 4, but blocking github.com outright also drops unrelated hits (4 in these same results).
- **In gpt2-codegolf the search came from a Hermes sub-agent** started with delegate_task. The main session file doesn't show the sub-agent's steps, but the proxy capture does: it holds the sub-agent's own requests, including this web_search call and its result.
- **This corrects two details in the report,** which is pinned and can't change. The report says the other three came from "a web_search or web_extract result"; all three were web_search. It also says the capture does not show the sub-task's steps; it does.

| Trial | Tool that returned it | Host | Page |
|---|---|---|---|
| GPT-6.1 Sol, protein-assembly, attempt 1 | web_search | marginlab.ai | https://marginlab.ai/explorers/terminal-bench/protein-assembly/ |
| GPT-6.1 Sol, gpt2-codegolf, attempt 2 | web_search, called by the delegate_task sub-agent | github.com | https://github.com/harbor-framework/terminal-bench/blob/main/original-tasks/gpt2-codegolf/tests/test_outputs.py |
| GPT-6.1 Sol, mteb-leaderboard (kept task), attempt 1 | web_search | marginlab.ai | https://marginlab.ai/explorers/terminal-bench/mteb-leaderboard/ |
| Claude Opus 5.5, extract-elf (kept task), attempt 1 | web_search | marginlab.ai | https://marginlab.ai/explorers/terminal-bench/extract-elf/ |

**Other pages about the benchmark in the same search results.** Running the audit's fingerprint check on each search hit separately finds no hidden-test or reference-solution lines and no canary in them, so they are not answer keys. They are hub.harborframework.com task pages (mteb-leaderboard, extract-elf), www.tbench.ai (protein-assembly), and huggingface.co datasets that copy Terminal-Bench tasks or agent traces (extract-elf). Hosts are matched exactly, so a host filter has to name each one. For example, github.com and raw.githubusercontent.com are different hosts.

**How this was read.** From the run's private raw archive (release raw-2026-11-07-frontier-harness--drive, listed with its digest in [reproduce.md](reproduce.md)). For each trial, the proxy-capture request named in [results/audit.json](results/audit.json) holds the benchmark's canary string. The capture is the copy the final merge scored: protein-assembly from the first pass, mteb-leaderboard and gpt2-codegolf from the rerun, and extract-elf from the second rerun. Each tool result was split by its search hits, and the hit holding the canary names the host. This list holds hosts and public page addresses only, with no test or solution text.
