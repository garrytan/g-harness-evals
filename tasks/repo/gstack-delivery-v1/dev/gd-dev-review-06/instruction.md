A teammate opened a change on branch `feature/683e2c` of the Python repository at /work/repo (base branch `main`). Review it before it merges.

**Record job runs in an SQLite run history**

Adds `schedule.history.RunHistory`, which records every run of the jobs passed to `track()` in an SQLite database: the job function's name, the job's tags, when the run started, how long it took in seconds, and the error if the run raised. A tracked job behaves exactly as before: its return value and exceptions pass through, and a history that cannot be written only logs an error. `table` must be a plain SQL identifier (letters, digits and underscores, not starting with a digit), otherwise `ScheduleValueError`. Only the newest `keep` runs of each job are kept. `runs(job=None, tag=None, limit=20)` returns the newest runs first, filtered by job name and by exact tag, and `last_success(job)` returns when the job's most recent run that did not raise started. `clock` (default `datetime.datetime.now`) gives the timestamps and durations. Includes tests.

Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:
- `file`: the path relative to the repository root;
- `line`: the line number in the branch version of that file;
- `summary`: one sentence;
- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root and imports the package the normal way.

Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.
