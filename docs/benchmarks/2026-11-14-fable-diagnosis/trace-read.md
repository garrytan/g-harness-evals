# Reading the last run's traces with the model names hidden

Written 2026-11-14, before any trial of fable-diagnosis-2026-11. Source: the 56 tries (2 per model) on the 14 tasks where any Fable 5.2 or Opus 5.5 try failed in [fable-5-2-coding-cc322-2026-11](../2026-11-12-fable-5-2-coding-cc322/report.md), read from that run's raw Harbor trial folders (session logs, console tails and verifier output). The traces were exported with model names, costs and context-window fields removed, labelled X and Y at random for each task (seed 20261114), and read by five readers who saw nothing else (the per-task reads are in [trace-read/reads/](trace-read/reads/), with X and Y as the readers saw them; the table below gives each try's result by model name, and the X/Y key file that `export-blind.py` writes is not committed): four Claude Opus 5.5 sessions, and one Gemini 4 Carbon session for the three biology tasks and two cipher tasks, after the first reader given those stopped with no output. Each reader described what made each task hard and put every try in one category. The names were put back only after all five reads were written.

## Takeaways

- **We learned that Fable 5.2 does more on every task, and that only pays when the obvious path is blocked.** It spent a median 1.56x as long waiting on the model per task (more than Opus on 34 of 43 tasks), dug deeper and kept polishing after it was done. That won both tasks where the first idea fails (extract-moves-from-video, install-windows-3.11) and lost the ones where the job was literal or the clock was tight (pytorch-model-cli, make-mips-interpreter, overfull-hbox, make-doom-for-mips). You should keep Opus 5.5 as the default for unattended runs with a time limit.
- **We learned that most failed tries measured the environment, not the models.** 17 of the 34 failed tries were the API safety filter (all 12 bio tries; 5 of 8 cipher tries), and 4 more were correct-looking work that a hidden grader convention rejected. You should read "Opus 2-0 on feal-differential-cryptanalysis" as a filter result, not a skill result.
- **What this can't tell you:** no try in this run went past 190K tokens of context or hit a context problem, so nothing here supports or rules out a long-session or large-codebase edge. The trace read gives no reason to pick that feature.

## Every try, unblinded

Category from the blind reader. F = Fable 5.2, O = Opus 5.5.

| Task | F tries | O tries | What stopped the failed tries | Same-agent difference (blind rating) |
|---|---|---|---|---|
| extract-moves-from-video | 2 of 2 | 0 of 2 | O: wrong approach, stalled on slow OCR, never wrote output (x2) | STRONG, favours F: exploited the fixed font grid |
| install-windows-3.11 | 2 of 2 | 1 of 2 | O: stayed on stock QEMU 8.2.2, failed the keystroke screen-change test (low confidence) | WEAK, F built QEMU 5.2 and patched its Cirrus driver both times |
| raman-fitting | 2 of 2 | 1 of 2 | O: correct fit, unstated window convention, 23% off | WEAK (window choice) |
| video-processing | 1 of 2 | 1 of 2 | both: heuristic off on the hidden clip | NONE |
| feal-linear-cryptanalysis | 1 of 2 | 0 of 2 | F 1x, O 2x: safety filter at 0.3 min | filter only |
| feal-differential-cryptanalysis | 0 of 2 | 2 of 2 | F: safety filter at 0.1 min (x2) | filter only |
| pytorch-model-cli | 0 of 2 | 2 of 2 | F: rescaled inputs beyond the spec (x2) | STRONG, favours O: literal forward pass |
| make-mips-interpreter | 1 of 2 | 2 of 2 | F: working at 6.4 min, 24 more minutes of unrequested speed work, timed out | STRONG, favours O: stopped after a lean check |
| overfull-hbox | 1 of 2 | 2 of 2 | F: blocked 11.5 of 12.5 min on a foreground search | WEAK |
| filter-js-from-html | 0 of 2 | 1 of 2 | F: 13 and 25 minute silent starts, over-built fuzzing, timed out, and the design fails a hidden bs4 test anyway; O: same hidden test | WEAK |
| make-doom-for-mips | 0 of 2 | 0 of 2 | all: out of time on a 15-minute limit (8-hour expert estimate); O got a working ELF (2 of 3 tests), F never ran a binary | WEAK, F long single turns |
| dna-assembly, dna-insert, protein-assembly | 0 of 6 | 0 of 6 | all: bio safety filter in the first minute | NONE |

Failed tries by cause: Fable 18 = 9 filter, 2 grader convention (filter-js, also timed out), 4 clock (make-mips, overfull-hbox, make-doom x2), 2 over-reach (pytorch-model-cli), 1 heuristic miss. Opus 16 = 8 filter, 2 grader convention (filter-js, raman), 2 wrong tool for a 1-CPU box (extract-moves), 1 stopped short (install-windows), 2 clock (make-doom), 1 heuristic miss.

Across all 52 tasks: Fable hit the time limit 12 times (6 of those still passed), Opus 6 times (2 passed). Fable's median session spent 76% of its time waiting on the model, Opus's 66%.

## The pattern, and the prediction it gives

Fable 5.2's two repeatable wins both came from tasks where the first obvious approach does not work and the agent has to diagnose the environment before the real fix (a generic OCR tool too slow for the box; a stock emulator whose video driver draws no text). Its repeatable losses came from doing more than a literal task asked, or from running out of clock. The prediction for fresh tasks: **Fable 5.2's lead over Opus 5.5 is larger on tasks that need a diagnosis step (the instruction states a symptom, not where the fault is) than on tasks whose instruction already points at the fault.** The preregistration turns this into a mechanical label on fresh real-repository issues and writes down the result that would disprove it.

## How to check these numbers

The trial folders these reads come from (session logs and verifier output) were not committed with that run; only its trial records were. The two scripts that made the blind export and the model-time figures are in [trace-read/](trace-read/): `export-blind.py` (the export, scrubbing and X/Y labels) and `model-time.py` (time from a tool result to the next model message, summed per try; a try with under 30 seconds of session time is left out, which is why 43 of 52 tasks have both models). Every pass count above can be checked against that run's committed trials.jsonl, and the five cipher safety-filter stops against its `results/safeguard-stops/` folder. The cause categories come from the reads in [trace-read/reads/](trace-read/reads/). The model-time figures (1.56x, 34 of 43, 76% and 66%) need the session logs, which were not committed, so they can't be rechecked from the repository.
