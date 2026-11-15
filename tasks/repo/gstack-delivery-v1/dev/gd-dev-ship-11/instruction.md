Your teammate's branch `feature/b16903` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add a group_by function, so an array of objects can be split into groups by a string key in one expression.

How it should behave:
- `group_by(array, &expr)` returns an object with one key per distinct value of `expr` over the elements. Each key maps to an array of the elements with that key, in their original order, and the keys appear in the order they first occur.
- The key of an element must be a string. Elements whose key is null are left out; any other type of key (number, boolean, array or object) raises `JMESPathTypeError`.
- An empty array gives an empty object `{}`.
- The first argument must be an array; anything else raises `JMESPathTypeError`, as for `sort_by`.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
