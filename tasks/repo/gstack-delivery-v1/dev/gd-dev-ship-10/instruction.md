Your teammate's branch `feature/201adc` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add shape(), which reports the dimensions of a nested list or tuple, the counterpart of reshape().

How it should behave:
- `shape(tensor)` returns a tuple with the size of each dimension of a nested list or tuple, outermost first: `shape([[1, 2, 3], [4, 5, 6]]) == (2, 3)`. A scalar has shape `()`.
- Scalars are exactly what reshape treats as scalars on main: strings, bytes, mappings such as dicts, and anything that is not iterable. So `shape(['ab', 'cd']) == (2,)` and `shape([{'a': 1}, {'b': 2}]) == (2,)`.
- All arrays in one dimension must have the same size; otherwise shape raises ValueError.
- Within one dimension the items must be all arrays or all scalars; any mix, in any order, raises ValueError.
- An empty array has size 0 and nothing below it: `shape([]) == (0,)` and `shape([[], []]) == (2, 0)`.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
