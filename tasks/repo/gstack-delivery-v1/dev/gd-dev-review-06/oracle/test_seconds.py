import datetime

import schedule
from schedule.history import RunHistory


def test_duration_keeps_fractions_of_a_second(tmp_path):
    times = iter(
        [
            datetime.datetime(2024, 5, 1, 12, 0, 0),
            datetime.datetime(2024, 5, 1, 12, 0, 1, 500000),
        ]
    )
    scheduler = schedule.Scheduler()
    history = RunHistory(str(tmp_path / "runs.db"), clock=lambda: next(times))

    def job():
        pass

    history.track(scheduler.every().hour.do(job)).run()
    assert history.runs()[0]["seconds"] == 1.5
    history.close()
