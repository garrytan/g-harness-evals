Your teammate's branch `feature/57b18a` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add default and last options to argmin and argmax, so an empty input can return a fallback and ties can resolve to the last occurrence.

How it should behave:
- `argmin(iterable, default=d)` and `argmax(iterable, default=d)` return `d` when the iterable is empty. Without `default`, an empty iterable still raises ValueError.
- With `last=True`, argmin returns the index of the last occurrence of the smallest value and argmax the index of the last occurrence of the largest value: `argmin([3, 1, 2, 1], last=True) == 3` and `argmax([1, 3, 3, 2], last=True) == 2`.
- Without `last` (or with `last=False`), both still return the first occurrence, as before.
- Both options work in every form argmin and argmax accept, including values given as separate arguments: `argmin(4, 1, 1, last=True) == 2`.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
