Your teammate's branch `feature/79a636` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: A parse_spec function that reads a schedule written as text, such as "every 10 minutes" or "every monday at 09:00", so jobs can be configured from a settings file.

How it should behave:
- `schedule.parse_spec(text)` reads `every <unit>`, `every <n> <units>`, `every <n> to <m> <units>` or `every <weekday>`, each optionally followed by `at <time>`. Words are separated by whitespace and may be in any case. A unit is singular (`second`, `minute`, `hour`, `day`, `week`) without a number and plural with one; a weekday takes no number.
- It returns a dict with the keys `interval` (the number, 1 if none), `latest` (`m`, or None), `unit` (the plural unit, `weeks` for a weekday), `at` (the time as written, or None) and `start_day` (the weekday's full lowercase name, or None). A weekday is accepted in every form `Job.on()` accepts on main.
- `n` and `m` are positive integers, and `m` must not be smaller than `n`.
- An `at` time is accepted exactly where `Job.at()` accepts it for the same job, in the same formats: never for seconds or for plain weeks.
- Any other text raises `ScheduleValueError`.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
