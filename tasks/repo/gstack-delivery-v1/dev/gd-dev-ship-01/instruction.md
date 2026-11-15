Your teammate's branch `feature/3a9dd9` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: Public functions for adding inflection rules, irregular words and uncountable words at runtime, so applications stop editing the module's tables by hand.

How it should behave:
- `inflection.plural(rule, replacement)` and `inflection.singular(rule, replacement)` add a pluralization or singularization rule. `rule` is a regular expression string and `replacement` its `re.sub` replacement, as in the built-in tables. The newest rule is tried first, before rules added earlier and before the built-in rules.
- `inflection.irregular(singular, plural)` registers an irregular word in both directions and keeps the case of its first letter (`Octopus` becomes `Octopuses`). A word registered as irregular, in either form, is no longer uncountable.
- `inflection.uncountable(*words)` makes each word uncountable: `pluralize` and `singularize` return it unchanged, whatever case it is written in and whatever case it was registered in.
- The built-in rules and words keep working as they do on main.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
