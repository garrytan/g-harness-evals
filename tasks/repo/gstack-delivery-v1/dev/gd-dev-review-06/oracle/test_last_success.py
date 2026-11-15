import datetime

import schedule
from schedule.history import RunHistory


def test_last_success_is_the_newest_successful_run(tmp_path):
    now = [datetime.datetime(2024, 5, 1, 12, 0)]
    scheduler = schedule.Scheduler()
    history = RunHistory(str(tmp_path / "runs.db"), clock=lambda: now[0])

    def report():
        pass

    job = history.track(scheduler.every().hour.do(report))
    job.run()
    now[0] = datetime.datetime(2024, 5, 1, 13, 0)
    job.run()
    assert history.last_success("report") == datetime.datetime(2024, 5, 1, 13, 0)
    history.close()
