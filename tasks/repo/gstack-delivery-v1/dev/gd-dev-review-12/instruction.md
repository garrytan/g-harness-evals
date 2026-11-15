A teammate opened a change on branch `feature/7146b2` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Load jobs from a config file**

Adds `schedule.config.load_jobs(text, allowed, scheduler=None)`, so operators can list jobs in a text file in the same words as the Python API, one per line, for example `every monday at 09:00 do tasks.reports:weekly tags reports,mail` or `every 5 to 10 seconds do tasks.queue:poll`. Blank lines and `#` comments are skipped. The config file is edited by operators, not developers, so it can only reach code the application chose: the module must be one of `allowed` or a submodule of one, and the function must be defined in that module (not imported into it) and must not start with an underscore. Any invalid line raises `ScheduleValueError` whose message starts with `line <n>:`, numbered as an editor numbers lines, and then no job from the text is scheduled. Jobs go to `scheduler`, or to the default scheduler when it is None. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
