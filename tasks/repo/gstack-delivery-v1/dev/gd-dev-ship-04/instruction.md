Your teammate's branch `feature/037a74` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.

What it adds, in their words: 12-hour clock times for daily and weekly jobs: a to_24_hour function that `Job.at()` runs those jobs' times through, so `every().day.at("7:30pm")` works.

How it should behave:
- `schedule.to_24_hour(text)` converts a 12-hour time: an hour from 1 to 12, optionally followed by `:MM` and then `:SS`, then `am` or `pm` in any case, with optional whitespace before it. The result is `HH:MM`, or `HH:MM:SS` when seconds were given, with a two-digit hour.
- `12am` is midnight (`00:00`) and `12pm` is noon (`12:00`); every other pm hour adds 12.
- A 24-hour time, in any form that `Job.at()` on main accepts for a daily job, is returned with a two-digit hour (`9:30` becomes `09:30`, `21:05:09` is unchanged).
- Anything else, including an hour of 0 or above 12 before am or pm, raises `ScheduleValueError`.

Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.

Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.
