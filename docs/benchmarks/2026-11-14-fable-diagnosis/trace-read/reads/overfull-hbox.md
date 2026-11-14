# overfull-hbox: blind trace read

## 1. What made the task hard

The document has a 2.5 in text width and starts with 7 overfull hboxes in four paragraphs. The fix is a search over single-word synonym swaps, rebuilding with pdflatex after each one (about 0.1 s per build, measured in Y-1). The hard part is search design: a greedy or bounded search finishes in 1-3 minutes, but enumerating pairs of candidates per paragraph blows up fast. The grader's token check (whitespace tokens, same punctuation, word in the same family) quietly forbids multi-word or punctuation-changing swaps. None of the tries hit that, because all used single-word replacements. The agent limit is 750 s (12.5 min) against 1.5-3.5 min of honest work, so the limit is generous for a sensible search and unforgiving for a blocking one.

## 2. Tries

### X-1: PASS (4.4 min wall)
- Category: PASS
- [0.0m] cats all three files and compiles, listing 7 overfull boxes.
- [0.3m] greedy per-paragraph search: at each step it tries every swap and keeps the one that most reduces overflow. Done at [1.7m]: 6 swaps (reserved->quiet, marshes->bogs, promises->vows, name->title, rooms->chambers, pathfinder->pioneer).
- [1.7m] applies the swaps, does a word-level diff against the original, recompiles: `rc=0`, overfull count `0`.
- Time: about 1.8 min, of which 1.4 min was the search. Verified: clean build, zero overfull boxes, diff shows only the 6 swaps.

### X-2: PASS (14.7 min wall, harness ending "timeout")
- Category: PASS
- [0.2m] makes 6 manual swaps, which leaves 4 warnings; [0.4m] greedy whole-document search runs in the background and finishes at [3.0m] with 3 more swaps.
- [3.1m] does a clean rebuild: exit 0, `0` overfull, no warnings. Reports done at [3.2m].
- [12.5m] its background watcher (`until ... ! pgrep -f search.py`) never exited because pgrep matched its own command line, so the session ran into the agent time limit. The work was already graded correct, so this cost nothing.
- Time: about 3.2 min of real work, then about 9 min idle with a stuck watcher.

### Y-1: FAIL (15.0 min wall, timeout)
- Category: MODEL-STALLED
- [0.5m] starts a per-paragraph search that tries all singles and then `itertools.combinations(cands,2)` pairs, run in the foreground with a 600 s timeout and buffered output.
- [10.5m] the command is moved to the background with no output read; [10.6m] it times one compile at `real 0m0.100s`.
- [10.7m] kills the search, patches it to rank singles and pair only the top 40, then [10.9m] reruns it in the foreground with `timeout 550`. The agent is stopped about 1.5 min later.
- Verifier: input.tex unchanged (`test_input_file_matches` passes), `test_no_overfull_hboxes` fails.
- Time: about 1 min active, about 11.5 min blocked on its own search. It never applied even a partial fix, and it verified nothing.

### Y-2: PASS (5.7 min wall)
- Category: PASS
- [0.6m] per-paragraph beam search (width 6) with an early stop at zero overflow; done at [3.1m] with 6 swaps (including heart->core).
- [3.2m] clean rebuild: exit 0, `0` overfull, word diff; [3.3m] a second compile also shows 0.
- Time: about 3.4 min, of which 2.5 min was the search. Verified: two clean builds and a word diff. It noted the heart->core swap uses a non-head word of its family.

## 3. X versus Y

Both X tries used a greedy search that printed progress and finished in under 3 minutes. Y used heavier searches (exhaustive pairs, then a beam), and one of them blocked the session past the limit. The difference is real but shows in only one Y try, since Y-2's beam search was quick. **Rating: WEAK.**

## 4. Environment vs model

This measured the agents: the environment was fine, and the one failure came from a search that could not finish inside the limit.
