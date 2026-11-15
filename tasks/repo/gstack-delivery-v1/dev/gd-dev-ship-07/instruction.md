Your teammate's branch `feature/a6dccf` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add a weighted_mean recipe next to dotproduct.

How it should behave:
- `weighted_mean(values, weights)` returns the sum of each value times its weight, divided by the sum of the weights, as a float: `weighted_mean([1, 2, 3], [3, 0, 1]) == 1.5`.
- Without weights every value has weight 1: `weighted_mean([1, 2, 3, 4]) == 2.5`.
- values and weights must have the same length; otherwise ValueError.
- A negative weight raises ValueError, whatever the other weights are.
- If the weights add up to zero, which includes empty input, ValueError is raised.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
