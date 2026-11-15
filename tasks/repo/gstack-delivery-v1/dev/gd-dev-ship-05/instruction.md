Your teammate's branch `feature/f40b6d` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Add lower, upper, trim and split string functions, with optional trailing arguments for trim and split.

How it should behave:
- `lower(s)` and `upper(s)` return the string `s` in lower or upper case, non-ASCII letters included (`upper('ä')` is `'Ä'`).
- `trim(s)` removes whitespace from both ends of `s`. `trim(s, chars)` instead removes every leading and trailing character that appears in `chars`; an empty `chars` trims whitespace, as if it were left out.
- `split(s, sep)` returns the parts of `s` between the occurrences of `sep`. `split(s, sep, count)` splits at the first `count` occurrences only, so the last part keeps the rest of `s`, and a `count` of 0 returns `[s]`. An empty `sep` splits `s` into its characters, and `count` limits that the same way: `split('abc', '', 1)` is `['a', 'bc']`.
- Leaving out a required argument or passing too many raises `ArityError`, and an argument of the wrong type (such as a number for `s`, `chars` or `sep`, or a string for `count`) raises `JMESPathTypeError`, as for the built-in functions.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
