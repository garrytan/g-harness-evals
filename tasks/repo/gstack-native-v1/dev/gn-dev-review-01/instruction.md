A teammate opened a change on branch `feature/change-b57c80` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Add batch pluralization with per-call uncountable words**

Add `pluralize_many` for callers processing collections of labels. It returns a list in input order and accepts additional uncountable words for domain-specific vocabulary without requiring callers to configure global inflection rules. Additional uncountables are matched case-insensitively. Includes coverage for generators, ordinary inflections, and custom vocabulary.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. Run it from the repository root; it imports the package the normal way.

Report only real problems, at most 10. If you find none, write `[]`. Do not change the branch.
