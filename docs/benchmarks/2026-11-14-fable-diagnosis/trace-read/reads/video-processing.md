# video-processing: blind trace read

## 1. What made the task hard

The agent gets one 120-frame example clip (960x540, 30 fps, jump at about frames 53 to 62), while the grader also runs a hidden, longer `/tests/test_video.mp4` and requires takeoff in [219, 223] and landing in [231, 234]. Any detector is tuned blind to that second clip: you cannot measure generalization, only stress-test perturbed copies of the one example. The example has real camera drift (up to about 2 px), which lights up fence and track edges in a plain frame difference, plus late-clip flicker and noise blobs (frames 110 to 119) that can be mistaken for the runner. A small spec trap: `toml` is listed as available but is not installed in the agent's container (it is installed in the grader's), and all four tries added a fallback writer. The 60-minute limit was never in play: every try finished in 3 to 5 minutes against an expert estimate of 400 minutes, so the real constraint was the decision to stop after only the example could be checked.

## 2. Per try

### X-1: FAIL (4/5 tests), category MODEL-WRONG-APPROACH
- 0.2m to 0.8m: background diff stats, contact sheets and colour-diff masks; by eye, takeoff 53 and landing 62.
- 2.0m: wrote a detector using the first-frame background with a min/max envelope, the lowest foot point, a hard-coded hurdle x of about 495, and the apex of flight near the hurdle, walking back and forward to ground contact.
- 2.5m to 3.4m: stress-tested flips, shake, noise, brightness drift, padding, trims and threshold sweeps; every case returned 53/62 (or the correctly shifted values).
- Verifier: "Takeoff frame 239 not within inclusive range [219, 223]", about 17 frames late on the hidden clip.
- Time: 3.7 minutes, all active; the longest command took about 1 minute. Verified only on the example and synthetic copies of it. The trace does not show which wrong event it picked on the test clip.

### X-2: PASS (5/5 tests), category PASS
- 0.2m to 1.4m: the same exploration, plus phase-correlation drift measurement and a tolerant diff at threshold 18.
- 2.4m: wrote a detector with a min/max-tolerant background, the lowest point, a hard-coded ground line (y about 363) and hurdle (x about 492), and the airborne stretch that crosses the hurdle.
- 2.7m: added the toml fallback and checked that both paths write the same file, using a temporary pip install of toml.
- 2.9m: noise, ±2 px jitter and trims gave the expected values.
- Time: 3.2 minutes, all active. Verification was the same kind as X-1's.

### Y-1: PASS (5/5 tests), category PASS
- 0.5m to 1.1m: lowest-point table and zoomed foot crops; "last ground contact at 53... first contact on landing at 62".
- 1.9m: its first version returned 71/119 because noise blobs in frames 110 to 119 were treated as the runner. 2.1m: it added a minimum blob size and a "main pass" filter (the longest contiguous run of detections), and the result became 53/62.
- 2.3m to 2.7m: tested shifted, cut, brightened and noisy copies; all matched the expected values.
- Time: 3.0 minutes, all active. It verified on the example and synthetic copies. The main-pass filter it added after seeing a false result is the one visible design difference from the failed tries.

### Y-2: FAIL (4/5 tests), category MODEL-WRONG-APPROACH
- 0.8m to 1.2m: measured drift and built ECC alignment to the background plus a neighbourhood-tolerant diff; "zero false pixels on empty frames".
- 2.3m: wrote a detector with ECC alignment, shadow suppression, the lowest point, a fitted ground line, a 9 px airborne threshold, and the biggest airborne stretch passing the hurdle (x about 495, with a 60 px margin).
- 3.6m to 4.1m: moved alignment to half resolution for speed and excluded frames cut by the image edge; the example still gave 53/62.
- 4.2m to 4.7m: trimmed, flipped and noisy copies gave the expected values. Verifier: "Takeoff frame 198 not within inclusive range [219, 223]", about 22 frames early.
- Time: 4.9 minutes, all active (one 10 to 18 second script run). Verified only on the example and synthetic copies. The trace does not show which airborne stretch it chose on the test clip.

## 3. X versus Y on this task

There is no consistent difference. All four tries used the same pipeline: first-frame background subtraction, the lowest blob point as the foot, a ground line, a hard-coded hurdle x, the airborne run that crosses the hurdle, and synthetic stress tests on the one clip. All four answered 53/62 on the example and stopped within 5 minutes. Each agent passed once and failed once, and the two failures missed in opposite directions (239 late, 198 early). **Rating: NONE.**

## 4. Environment vs model

This measured the model's heuristics, not the environment, but mostly as luck. The pass or fail split depends on how fragile hand-tuned rules behave on one unseen clip that no try could inspect, so two tries per agent cannot tell these agents apart.
